import crypto from "node:crypto";
import type { Content, FunctionCall, Part } from "@google/genai";
import type { Response } from "express";
import {
  saveBootArtifact,
  type SavedArtifactCache,
} from "./artifacts";
import {
  BOOT_TOOL_DECLARATIONS,
  loadOrchestratorPrompt,
  sanitizeSecrets,
} from "./carbon";
import { executeGenerateImage, runWithConcurrency } from "./imageGen";
import { loadInputImagesData } from "./inputs";
import { attachBootSseClient, broadcastBootSse, closeAllBootSse } from "./sse";
import type {
  BootActivity,
  BootActivityKind,
  BootBrandRead,
  BootGeneratedAsset,
  BootInputManifest,
  BootJobSnapshot,
  BootJobStatus,
  BootMessage,
  BootPendingQuestion,
  BootSseEvent,
  CarbonClient,
  ImageGenClient,
  ShopifyResponsePayload,
  UrlFetcher,
} from "./types";

const MAX_INLINE_INPUT_BYTES = 15 * 1024 * 1024;
const DEFAULT_MAX_TURNS = 45;
const DEFAULT_HEARTBEAT_MS = 2_000;
const DEFAULT_TOOL_CONCURRENCY = 4;
const DEFAULT_API_RETRY_DELAY_MS = 2_000;

interface DeferredWaiter<T> {
  kind: "ask_host" | "request_shopify_connection";
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
}

export interface BootJobRunnerOptions {
  workspaceRoot: string;
  bootId: string;
  manifest: BootInputManifest;
  carbonClient: CarbonClient;
  imageGenClient: ImageGenClient;
  urlFetcher: UrlFetcher;
  secretsToRedact?: ReadonlyArray<string | undefined>;
  clock?: () => number;
  maxTurns?: number;
  heartbeatIntervalMs?: number;
  imageRetryDelayMs?: number;
  apiRetryDelayMs?: number;
  logger?: (message: string) => void;
}

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(4).toString("hex")}`;
}

function isTransientApiError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("429") ||
    lower.includes("500") ||
    lower.includes("502") ||
    lower.includes("503") ||
    lower.includes("504") ||
    lower.includes("resource_exhausted") ||
    lower.includes("unavailable") ||
    lower.includes("deadline exceeded") ||
    lower.includes("econnreset") ||
    lower.includes("etimedout") ||
    lower.includes("fetch failed")
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    timer.unref?.();
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error("Aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function extractVisibleText(parts: readonly Part[]): string {
  return parts
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text ?? "")
    .join("")
    .trim();
}

function extractFunctionCalls(parts: readonly Part[]): FunctionCall[] {
  const calls: FunctionCall[] = [];
  for (const part of parts) {
    if (part.functionCall && part.functionCall.name) {
      calls.push(part.functionCall);
    }
  }
  return calls;
}

function normalizeScopes(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((s) => String(s).trim())
      .filter((s) => s.length > 0);
  }
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return [
    "read_products",
    "write_products",
    "read_publications",
    "write_publications",
  ];
}

function phaseForArtifact(name: string): string {
  switch (name) {
    case "brand_core":
    case "brand_card":
      return "Phase 2 — Product line";
    case "products":
      return "Phase 3 — World & assets";
    case "world_spec":
      return "Phase 4 — Adaptation policy";
    case "adaptation_policy":
    case "demo_personas":
      return "Phase 5 — Shopify sync";
    case "session_config":
      return "Phase 6 — Handoff";
    default:
      return "Building boutique";
  }
}

export class BootJobRunner {
  readonly bootId: string;
  readonly manifest: BootInputManifest;

  private readonly workspaceRoot: string;
  private readonly carbonClient: CarbonClient;
  private readonly imageGenClient: ImageGenClient;
  private readonly urlFetcher: UrlFetcher;
  private readonly secretsToRedact: ReadonlyArray<string | undefined>;
  private readonly clock: () => number;
  private readonly maxTurns: number;
  private readonly heartbeatIntervalMs: number;
  private readonly imageRetryDelayMs: number;
  private readonly apiRetryDelayMs: number;
  private readonly logger: (message: string) => void;

  private readonly startedAtMs: number;
  private readonly sseClients = new Set<Response>();
  private readonly abortController = new AbortController();

  private status: BootJobStatus = "running";
  private phase = "Phase 0 — Intake";
  private readonly messages: BootMessage[] = [];
  private pendingQuestion: BootPendingQuestion | null = null;
  private readonly activities: BootActivity[] = [];
  private readonly assets: BootGeneratedAsset[] = [];
  private readonly savedNames = new Set<string>();
  private readonly artifactCache: SavedArtifactCache = {};
  private brandRead: BootBrandRead | null = null;
  private readyToOpen = false;
  private errorMessage: string | undefined;

  private assetCounter = 0;
  private contents: Content[] = [];
  private systemInstruction: string | null = null;
  private loopRunning = false;
  private loopPromise: Promise<void> | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private waiter: DeferredWaiter<unknown> | null = null;
  private readonly queuedHostMessages: string[] = [];

  constructor(options: BootJobRunnerOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.bootId = options.bootId;
    this.manifest = options.manifest;
    this.carbonClient = options.carbonClient;
    this.imageGenClient = options.imageGenClient;
    this.urlFetcher = options.urlFetcher;
    this.secretsToRedact = options.secretsToRedact ?? [];
    this.clock = options.clock ?? Date.now;
    this.maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
    this.heartbeatIntervalMs =
      options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS;
    this.imageRetryDelayMs = options.imageRetryDelayMs ?? 800;
    this.apiRetryDelayMs =
      options.apiRetryDelayMs ?? DEFAULT_API_RETRY_DELAY_MS;
    this.logger = options.logger ?? console.log;
    this.startedAtMs = this.clock();
  }

  getStatus(): BootJobStatus {
    return this.status;
  }

  isReadyToOpen(): boolean {
    return this.readyToOpen;
  }

  getBrandSlug(): string | undefined {
    return this.artifactCache.brand_core?.brand_slug;
  }

  getDisplayName(): string {
    return this.artifactCache.brand_core?.host.name ?? this.manifest.host.name;
  }

  getSnapshot(): BootJobSnapshot {
    return {
      bootId: this.bootId,
      status: this.status,
      phase: this.phase,
      messages: [...this.messages],
      pendingQuestion: this.pendingQuestion ? { ...this.pendingQuestion } : null,
      activities: [...this.activities],
      assets: [...this.assets],
      artifacts: Array.from(this.savedNames),
      brandRead: this.brandRead ? { ...this.brandRead } : null,
      readyToOpen: this.readyToOpen,
      ...(this.errorMessage ? { error: this.errorMessage } : {}),
    };
  }

  attachStream(req: Parameters<typeof attachBootSseClient>[0], res: Response): void {
    attachBootSseClient(req, res, this.getSnapshot(), this.sseClients);
  }

  start(): Promise<void> {
    if (this.loopPromise) return this.loopPromise;
    this.loopPromise = this.bootstrapAndRun();
    return this.loopPromise;
  }

  submitHostReply(text: string): { ok: true } | { ok: false; statusCode: number; error: string } {
    const trimmed = text.trim();
    if (!trimmed) {
      return { ok: false, statusCode: 400, error: "Reply text cannot be empty" };
    }

    if (this.status === "failed") {
      return { ok: false, statusCode: 409, error: "Boot job has failed" };
    }

    if (this.status === "waiting_shopify") {
      return {
        ok: false,
        statusCode: 409,
        error: "Waiting for Shopify connection response",
      };
    }

    this.pushMessage("host", trimmed);

    if (this.status === "waiting_host" && this.waiter?.kind === "ask_host") {
      const resolve = this.waiter.resolve;
      this.waiter = null;
      this.clearPendingQuestion();
      this.setStatus("running");
      resolve(trimmed);
      return { ok: true };
    }

    if (this.status === "completed") {
      this.contents.push({
        role: "user",
        parts: [{ text: trimmed }],
      });
      this.setStatus("running", "Applying host edit");
      this.pushActivity("status", "Host follow-up received", trimmed.slice(0, 120));
      this.loopPromise = this.runLoop();
      return { ok: true };
    }

    // Running mid-turn: queue message for the next tool response / turn boundary.
    this.queuedHostMessages.push(trimmed);
    this.pushActivity("status", "Queued host note for next turn");
    return { ok: true };
  }

  submitShopifyResponse(
    payload: ShopifyResponsePayload
  ): { ok: true } | { ok: false; statusCode: number; error: string } {
    if (
      this.status !== "waiting_shopify" ||
      this.waiter?.kind !== "request_shopify_connection"
    ) {
      return {
        ok: false,
        statusCode: 409,
        error: "Boot job is not waiting for a Shopify connection response",
      };
    }

    const resolve = this.waiter.resolve;
    this.waiter = null;
    this.clearPendingQuestion();

    const skipped = Boolean(payload.skip) || !payload.connected;
    if (skipped) {
      this.pushMessage(
        "system",
        "Shopify connection skipped — finishing boutique with coming-soon products."
      );
    } else {
      const domainLabel = payload.shop_domain ?? "connected store";
      this.pushMessage("system", `Shopify connected (${domainLabel}).`);
    }

    this.setStatus("running", "Phase 5 — Shopify sync");
    resolve(payload);
    return { ok: true };
  }

  destroy(): void {
    this.stopHeartbeat();
    this.abortController.abort();
    if (this.waiter) {
      const reject = this.waiter.reject;
      this.waiter = null;
      reject(new Error("Boot job cancelled"));
    }
    closeAllBootSse(this.sseClients);
  }

  // ---------------------------------------------------------------------------
  // Internal state & SSE helpers
  // ---------------------------------------------------------------------------

  private nowIso(): string {
    return new Date(this.clock()).toISOString();
  }

  private elapsedSeconds(): number {
    return Math.max(0, Math.floor((this.clock() - this.startedAtMs) / 1000));
  }

  private emit(event: BootSseEvent): void {
    broadcastBootSse(this.sseClients, event);
  }

  private pushActivity(
    kind: BootActivityKind,
    label: string,
    detail?: string
  ): BootActivity {
    const activity: BootActivity = {
      id: makeId("act"),
      kind,
      label,
      ...(detail ? { detail } : {}),
      timestamp: this.nowIso(),
    };
    this.activities.push(activity);
    if (this.activities.length > 200) {
      this.activities.splice(0, this.activities.length - 200);
    }
    this.emit({ type: "activity", activity });
    return activity;
  }

  private pushMessage(
    role: BootMessage["role"],
    text: string,
    options?: string[]
  ): BootMessage {
    const message: BootMessage = {
      id: makeId("msg"),
      role,
      text,
      ...(options && options.length > 0 ? { options } : {}),
      timestamp: this.nowIso(),
    };
    this.messages.push(message);
    this.emit({ type: "message", message });
    return message;
  }

  private setPendingQuestion(question: BootPendingQuestion): void {
    this.pendingQuestion = question;
    this.emit({ type: "question", pendingQuestion: question });
  }

  private clearPendingQuestion(): void {
    if (this.pendingQuestion !== null) {
      this.pendingQuestion = null;
      this.emit({ type: "question", pendingQuestion: null });
    }
  }

  private setStatus(
    status: BootJobStatus,
    phase?: string,
    error?: string
  ): void {
    this.status = status;
    if (phase) {
      this.phase = phase;
    }
    if (error !== undefined) {
      this.errorMessage = error;
    }
    if (status === "running") {
      this.startHeartbeat();
    } else {
      this.stopHeartbeat();
    }
    this.emit({
      type: "status",
      status: this.status,
      phase: this.phase,
      readyToOpen: this.readyToOpen,
      ...(this.errorMessage ? { error: this.errorMessage } : {}),
    });
  }

  private startHeartbeat(): void {
    if (this.heartbeatIntervalMs <= 0 || this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      if (this.status !== "running") {
        this.stopHeartbeat();
        return;
      }
      this.emit({
        type: "heartbeat",
        elapsed_s: this.elapsedSeconds(),
        phase: this.phase,
      });
    }, this.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private failJob(rawError: unknown): void {
    const sanitized = sanitizeSecrets(rawError, this.secretsToRedact);
    this.clearPendingQuestion();
    this.pushActivity("error", "Boot failed", sanitized);
    this.pushMessage("system", `Boot stopped: ${sanitized}`);
    this.setStatus("failed", this.phase, sanitized);
    this.logger(`[boot:${this.bootId}] failed: ${sanitized}`);
  }

  // ---------------------------------------------------------------------------
  // Kickoff & main Carbon loop
  // ---------------------------------------------------------------------------

  private async buildInitialUserContent(): Promise<Content> {
    const loadedImages = await loadInputImagesData(
      this.workspaceRoot,
      this.bootId,
      this.manifest
    );

    const kickoffLines = [
      `Start Boot '${this.bootId}' for host '${this.manifest.host.name}' (type: ${this.manifest.host.type}).`,
      `Uploaded inputs: ${this.manifest.images.length} image(s) (${this.manifest.images.map((i) => i.id).join(", ") || "none"}), ${this.manifest.urls.length} URL(s), ${this.manifest.voice_samples.length} voice sample(s).`,
      "Begin by calling `read_inputs()` to retrieve the full structured manifest, then follow your workflow phases in order.",
      "Important tool & world-building guidelines:",
      "- Whenever you need input or approval from the host, call `ask_host(message, options?)` so the UI shows your question and pauses cleanly.",
      "- Save every artifact with `save_artifact(name, json)` (`brand_core`, `products`, `world_spec`, `adaptation_policy`, `demo_personas`, `session_config`).",
      "- For `world_spec` visual assets (staying strictly within <= 12 total assets, 1K resolution):",
      "  * Generate `room.wall_asset` as a wide `16:9` photorealistic panoramic environment backdrop capturing the host's authentic real-world setting (e.g. sunlit ocean horizon & weathered pier for an ocean brand, departure terminal glass overlooking jets & runway for an aviation/flights brand, sunlit maker workshop for a craftsperson — NOT a plain blank wall).",
      "  * Generate `room.floor_asset` as the matching realistic ground/floor surface texture (e.g. coastal boardwalk/sand, terrazzo terminal floor, warm terracotta tile).",
      "  * Generate photorealistic, high-craft studio visuals for `poster` and `product_image` assets (call `generate_image` in parallel).",
    ];

    if (loadedImages.length > 0) {
      kickoffLines.push(
        "The host's uploaded photos are attached directly below, each labeled with its exact input id (`[img_01]`, `[img_02]`, ...) so you can inspect every visual detail and cite exact IDs."
      );
    }

    const parts: Part[] = [{ text: kickoffLines.join("\n") }];

    const totalBytes = loadedImages.reduce((sum, img) => sum + img.sizeBytes, 0);
    const useFilesApi =
      totalBytes > MAX_INLINE_INPUT_BYTES &&
      typeof this.carbonClient.uploadFile === "function";

    for (const img of loadedImages) {
      parts.push({ text: `[${img.id}] ${img.filename}` });
      if (useFilesApi && this.carbonClient.uploadFile) {
        const uploaded = await this.carbonClient.uploadFile(
          img.filePath,
          img.mimeType
        );
        parts.push({
          fileData: {
            fileUri: uploaded.fileUri,
            mimeType: uploaded.mimeType,
          },
        });
      } else {
        parts.push({
          inlineData: {
            mimeType: img.mimeType,
            data: img.dataBase64,
          },
        });
      }
    }

    return { role: "user", parts };
  }

  private async bootstrapAndRun(): Promise<void> {
    this.startHeartbeat();
    try {
      if (!this.carbonClient.isAvailable()) {
        throw new Error(
          "GEMINI_API_KEY is not configured on the server. Add GEMINI_API_KEY to .env to run the Boot agent."
        );
      }

      this.pushActivity(
        "status",
        "Starting Boot agent",
        `${this.manifest.host.name} (${this.manifest.images.length} images, ${this.manifest.urls.length} URLs, ${this.manifest.voice_samples.length} voice samples)`
      );

      this.systemInstruction = await loadOrchestratorPrompt(this.workspaceRoot);
      const initialUser = await this.buildInitialUserContent();
      this.contents = [initialUser];
      await this.runLoop();
    } catch (error) {
      if (!this.abortController.signal.aborted) {
        this.failJob(error);
      }
    }
  }

  private async callCarbonWithRetry(): Promise<{ content: Content }> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (this.abortController.signal.aborted) {
        throw new Error("Boot job aborted");
      }
      try {
        return await this.carbonClient.generateTurn({
          contents: this.contents,
          systemInstruction: this.systemInstruction ?? "",
          functionDeclarations: BOOT_TOOL_DECLARATIONS,
          abortSignal: this.abortController.signal,
        });
      } catch (error) {
        lastErr = error;
        const msg = sanitizeSecrets(error, this.secretsToRedact);
        if (attempt < 3 && isTransientApiError(msg) && !this.abortController.signal.aborted) {
          this.pushActivity(
            "status",
            `Retrying Carbon call (attempt ${attempt + 1}/3)`,
            msg.slice(0, 140)
          );
          await sleep(this.apiRetryDelayMs * attempt, this.abortController.signal);
          continue;
        }
        throw error;
      }
    }
    throw lastErr;
  }

  private async runLoop(): Promise<void> {
    if (this.loopRunning) return;
    this.loopRunning = true;

    try {
      for (let turnIdx = 0; turnIdx < this.maxTurns; turnIdx++) {
        if (this.abortController.signal.aborted) return;

        this.pushActivity(
          "status",
          `Thinking (${this.phase})`,
          `Turn ${turnIdx + 1}`
        );

        const turn = await this.callCarbonWithRetry();
        if (this.abortController.signal.aborted) return;

        // Preserve exact model Content (including thought / thoughtSignature / functionCall parts).
        this.contents.push(turn.content);

        const parts = turn.content.parts ?? [];
        const visibleText = extractVisibleText(parts);
        const functionCalls = extractFunctionCalls(parts);

        if (functionCalls.length === 0) {
          if (visibleText) {
            this.pushMessage("assistant", visibleText);
          }

          if (this.queuedHostMessages.length > 0) {
            const combined = this.queuedHostMessages.splice(0).join("\n\n");
            this.contents.push({ role: "user", parts: [{ text: combined }] });
            continue;
          }

          if (this.readyToOpen) {
            this.setStatus("completed", "Phase 6 — Handoff");
            this.pushActivity(
              "status",
              "Boot complete — boutique ready to open",
              `${this.savedNames.size} artifacts, ${this.assets.length} assets`
            );
            return;
          }

          // Model emitted text before finishing all 6 required artifacts: pause for host reply.
          const promptText =
            visibleText || "Please confirm or share your thoughts so I can continue.";
          const reply = await this.waitForHostAnswer(promptText, undefined, false);
          if (this.abortController.signal.aborted) return;
          this.contents.push({ role: "user", parts: [{ text: reply }] });
          continue;
        }

        // If the model emitted commentary alongside non-ask_host tool calls, show it to the host.
        const hasAskHostCall = functionCalls.some((fc) => fc.name === "ask_host");
        if (visibleText && !hasAskHostCall) {
          this.pushMessage("assistant", visibleText);
        }

        const responseParts = await this.executeToolCalls(functionCalls);
        if (this.abortController.signal.aborted) return;

        // Drain any host messages typed mid-turn by attaching them cleanly to the last functionResponse payload.
        if (this.queuedHostMessages.length > 0 && responseParts.length > 0) {
          const queued = this.queuedHostMessages.splice(0);
          const lastPart = responseParts[responseParts.length - 1];
          if (lastPart.functionResponse?.response) {
            lastPart.functionResponse.response = {
              ...lastPart.functionResponse.response,
              host_messages_received_while_working: queued,
            };
          }
        }

        this.contents.push({ role: "user", parts: responseParts });
      }

      throw new Error(
        `Boot agent exceeded maximum turn limit (${this.maxTurns}) before finishing.`
      );
    } catch (error) {
      if (!this.abortController.signal.aborted) {
        this.failJob(error);
      }
    } finally {
      this.loopRunning = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Tool execution
  // ---------------------------------------------------------------------------

  private async executeToolCalls(
    functionCalls: readonly FunctionCall[]
  ): Promise<Part[]> {
    const indexed = functionCalls.map((call, idx) => ({ call, idx }));
    const results = new Array<Part>(functionCalls.length);

    const readCalls = indexed.filter((x) => x.call.name === "read_inputs");
    const parallelCalls = indexed.filter(
      (x) =>
        x.call.name === "fetch_url" || x.call.name === "generate_image"
    );
    const saveCalls = indexed.filter((x) => x.call.name === "save_artifact");
    const interactiveCalls = indexed.filter(
      (x) =>
        x.call.name === "ask_host" ||
        x.call.name === "request_shopify_connection"
    );
    const unknownCalls = indexed.filter(
      (x) =>
        x.call.name !== "read_inputs" &&
        x.call.name !== "fetch_url" &&
        x.call.name !== "generate_image" &&
        x.call.name !== "save_artifact" &&
        x.call.name !== "ask_host" &&
        x.call.name !== "request_shopify_connection"
    );

    for (const item of readCalls) {
      results[item.idx] = await this.runSingleTool(item.call);
    }

    if (parallelCalls.length > 0) {
      await runWithConcurrency(
        parallelCalls,
        DEFAULT_TOOL_CONCURRENCY,
        async (item) => {
          results[item.idx] = await this.runSingleTool(item.call);
        }
      );
    }

    for (const item of saveCalls) {
      results[item.idx] = await this.runSingleTool(item.call);
    }

    for (const item of unknownCalls) {
      results[item.idx] = await this.runSingleTool(item.call);
    }

    for (const item of interactiveCalls) {
      results[item.idx] = await this.runSingleTool(item.call);
    }

    return results;
  }

  private buildFunctionResponsePart(
    call: FunctionCall,
    payload: Record<string, unknown>
  ): Part {
    return {
      functionResponse: {
        ...(call.id ? { id: call.id } : {}),
        name: call.name ?? "unknown",
        response: payload,
      },
    };
  }

  private async runSingleTool(call: FunctionCall): Promise<Part> {
    const name = call.name ?? "unknown";
    const args = (call.args ?? {}) as Record<string, unknown>;

    switch (name) {
      case "read_inputs": {
        this.phase =
          this.phase === "Phase 0 — Intake" ? "Phase 1 — Brand core" : this.phase;
        this.pushActivity(
          "tool_call",
          "read_inputs",
          `${this.manifest.images.length} images, ${this.manifest.urls.length} URLs, ${this.manifest.voice_samples.length} voice samples`
        );
        const output = {
          boot_id: this.bootId,
          host: this.manifest.host,
          images: this.manifest.images.map((img) => ({
            id: img.id,
            filename: img.filename,
            mime_type: img.mimeType,
          })),
          urls: this.manifest.urls,
          voice_samples: this.manifest.voice_samples,
          visual_context_note:
            "Uploaded images img_01..img_N are attached directly in the initial user turn with [img_XX] labels.",
        };
        this.pushActivity("tool_result", "Loaded host inputs");
        return this.buildFunctionResponsePart(call, { output });
      }

      case "fetch_url": {
        const url = typeof args.url === "string" ? args.url : "";
        this.pushActivity("tool_call", "fetch_url", url);
        const fetched = await this.urlFetcher(url, this.abortController.signal);
        this.pushActivity(
          fetched.ok ? "tool_result" : "error",
          fetched.ok ? `Fetched ${url}` : `Failed to fetch ${url}`,
          fetched.ok
            ? `${fetched.title ?? "Page"} (${fetched.image_urls?.length ?? 0} images)`
            : fetched.error
        );
        return this.buildFunctionResponsePart(call, { output: fetched });
      }

      case "generate_image": {
        const prompt = typeof args.prompt === "string" ? args.prompt : "";
        const modelArg = typeof args.model === "string" ? args.model : undefined;
        const aspectArg = typeof args.aspect === "string" ? args.aspect : undefined;
        const kindArg = typeof args.kind === "string" ? args.kind : undefined;
        const refIds = Array.isArray(args.ref_asset_ids)
          ? args.ref_asset_ids.map((x) => String(x))
          : undefined;

        this.phase = "Phase 3 — Generating assets";
        this.pushActivity(
          "tool_call",
          "generate_image",
          `${modelArg ?? "gemini-nano-banana-2.1"} (${aspectArg ?? "1:1"}): ${prompt.slice(0, 90)}`
        );

        try {
          const outcome = await executeGenerateImage(
            {
              prompt,
              model: modelArg,
              aspect: aspectArg,
              ref_asset_ids: refIds,
              kind: kindArg,
            },
            {
              workspaceRoot: this.workspaceRoot,
              bootId: this.bootId,
              manifest: this.manifest,
              imageGenClient: this.imageGenClient,
              allocateAssetId: () => {
                const index = ++this.assetCounter;
                return {
                  assetId: `asset_${String(index).padStart(2, "0")}`,
                  index,
                };
              },
              getPaletteHex: () =>
                this.artifactCache.brand_core?.visual.palette_hex ?? [],
              abortSignal: this.abortController.signal,
              retryDelayMs: this.imageRetryDelayMs,
            }
          );

          this.assets.push(outcome.asset);
          this.emit({ type: "asset", asset: outcome.asset });
          this.pushActivity(
            "tool_result",
            outcome.asset.fallback
              ? `Saved fallback texture ${outcome.asset.asset_id}`
              : `Generated ${outcome.asset.asset_id}`,
            outcome.asset.url
          );
          return this.buildFunctionResponsePart(call, {
            output: outcome.toolOutput,
          });
        } catch (error) {
          const errMsg = sanitizeSecrets(error, this.secretsToRedact);
          this.pushActivity("error", "generate_image error", errMsg);
          return this.buildFunctionResponsePart(call, { error: errMsg });
        }
      }

      case "save_artifact": {
        const artifactName = typeof args.name === "string" ? args.name : "";
        this.pushActivity("tool_call", `save_artifact(${artifactName})`);

        const saved = await saveBootArtifact(artifactName, args.json, {
          workspaceRoot: this.workspaceRoot,
          bootId: this.bootId,
          cache: this.artifactCache,
          savedNames: this.savedNames,
        });

        if (!saved.ok) {
          this.pushActivity(
            "error",
            `Validation failed for ${artifactName}`,
            saved.error.slice(0, 220)
          );
          return this.buildFunctionResponsePart(call, { error: saved.error });
        }

        if (saved.brandRead) {
          this.brandRead = saved.brandRead;
        }
        this.readyToOpen = saved.readyToOpen;
        this.phase = phaseForArtifact(saved.name);

        this.pushActivity(
          "artifact",
          `Saved ${saved.name}`,
          saved.readyToOpen ? "All 6 required artifacts ready" : saved.savedPath
        );
        this.emit({
          type: "artifact",
          name: saved.name,
          artifacts: saved.artifacts,
          readyToOpen: saved.readyToOpen,
          ...(saved.brandRead ? { brandRead: saved.brandRead } : {}),
        });
        this.emit({
          type: "status",
          status: this.status,
          phase: this.phase,
          readyToOpen: this.readyToOpen,
        });

        return this.buildFunctionResponsePart(call, {
          output: {
            ok: true,
            name: saved.name,
            saved_path: saved.savedPath,
            artifacts: saved.artifacts,
            ready_to_open: saved.readyToOpen,
          },
        });
      }

      case "ask_host": {
        const message =
          typeof args.message === "string" && args.message.trim()
            ? args.message.trim()
            : "Please share your preferences so I can continue.";
        const options = Array.isArray(args.options)
          ? args.options.map((o) => String(o).trim()).filter(Boolean)
          : undefined;

        this.pushActivity("tool_call", "ask_host", message.slice(0, 120));
        const reply = await this.waitForHostAnswer(message, options, true);
        this.pushActivity("tool_result", "Host replied", reply.slice(0, 120));
        return this.buildFunctionResponsePart(call, {
          output: { reply },
        });
      }

      case "request_shopify_connection": {
        const scopes = normalizeScopes(args.scopes);
        this.pushActivity(
          "tool_call",
          "request_shopify_connection",
          scopes.join(", ")
        );
        const shopifyResponse = await this.waitForShopifyResponse(scopes);
        const skipped = Boolean(shopifyResponse.skip) || !shopifyResponse.connected;
        this.pushActivity(
          "tool_result",
          skipped ? "Shopify skipped" : "Shopify connected",
          shopifyResponse.shop_domain ?? "coming soon mode"
        );

        const output = skipped
          ? {
              connected: false,
              skipped: true,
              shop_domain: null,
              granted_scopes: [],
              note: "Host skipped Shopify sync for now. Per Phase 5, keep product shopify fields as DRAFT with checkout_url: null ('coming soon'), briefly note the skipped step, and proceed directly to Phase 6 (save session_config and complete handoff).",
            }
          : {
              connected: true,
              shop_domain: shopifyResponse.shop_domain ?? null,
              granted_scopes: shopifyResponse.granted_scopes ?? scopes,
            };

        return this.buildFunctionResponsePart(call, { output });
      }

      default: {
        const err = `Unknown tool '${name}'`;
        this.pushActivity("error", err);
        return this.buildFunctionResponsePart(call, { error: err });
      }
    }
  }

  private waitForHostAnswer(
    message: string,
    options: string[] | undefined,
    emitAssistantMessage: boolean
  ): Promise<string> {
    if (emitAssistantMessage) {
      this.pushMessage("assistant", message, options);
    }

    const question: BootPendingQuestion = {
      id: makeId("q"),
      kind: "ask_host",
      message,
      ...(options && options.length > 0 ? { options } : {}),
      createdAt: this.nowIso(),
    };

    this.setPendingQuestion(question);
    this.setStatus("waiting_host");

    return new Promise<string>((resolve, reject) => {
      if (this.abortController.signal.aborted) {
        reject(new Error("Boot job aborted"));
        return;
      }
      this.waiter = {
        kind: "ask_host",
        resolve: (value) => resolve(value as string),
        reject,
      };
    });
  }

  private waitForShopifyResponse(
    scopes: string[]
  ): Promise<ShopifyResponsePayload> {
    const question: BootPendingQuestion = {
      id: makeId("shopify"),
      kind: "request_shopify_connection",
      message:
        "Connect your Shopify store to sync products, or skip to launch with coming-soon items.",
      scopes,
      createdAt: this.nowIso(),
    };

    this.setPendingQuestion(question);
    this.setStatus("waiting_shopify", "Phase 5 — Shopify sync");

    return new Promise<ShopifyResponsePayload>((resolve, reject) => {
      if (this.abortController.signal.aborted) {
        reject(new Error("Boot job aborted"));
        return;
      }
      this.waiter = {
        kind: "request_shopify_connection",
        resolve: (value) => resolve(value as ShopifyResponsePayload),
        reject,
      };
    });
  }
}
