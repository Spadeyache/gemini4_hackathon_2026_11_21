import fs from "node:fs/promises";
import path from "node:path";
import type { Request, Response } from "express";
import { BrandCoreSchema, WorldSpecSchema } from "@mybrand/shared";
import { listDiskBoots, REQUIRED_BOOT_ARTIFACTS, resolveBootDir } from "../boot";
import { buildBrandRead, isBootReady } from "./artifacts";
import { createCarbonClient } from "./carbon";
import { fetchUrlContent } from "./fetchUrl";
import { createGeminiImageGenClient } from "./imageGen";
import { generateBootId, saveBootInputs } from "./inputs";
import { BootJobRunner } from "./runner";
import { attachBootSseClient } from "./sse";
import type {
  BootGeneratedAsset,
  BootJobSnapshot,
  BootListItem,
  CarbonClient,
  CreateBootRequest,
  ImageGenClient,
  ShopifyResponsePayload,
  UrlFetcher,
} from "./types";

export interface BootJobManagerOptions {
  workspaceRoot: string;
  geminiApiKey?: string;
  shopifySecrets?: ReadonlyArray<string | undefined>;
  carbonClient?: CarbonClient;
  imageGenClient?: ImageGenClient;
  urlFetcher?: UrlFetcher;
  clock?: () => number;
  maxTurns?: number;
  heartbeatIntervalMs?: number;
  imageRetryDelayMs?: number;
  apiRetryDelayMs?: number;
  logger?: (message: string) => void;
}

export interface StartBootResult {
  bootId: string;
  status: "running";
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function readJsonSafe(filePath: string): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function buildDiskJobSnapshot(
  workspaceRoot: string,
  bootId: string
): Promise<BootJobSnapshot | null> {
  const dir = await resolveBootDir(workspaceRoot, bootId);
  if (!dir) return null;

  const savedArtifacts: string[] = [];
  for (const name of REQUIRED_BOOT_ARTIFACTS) {
    if (await fileExists(path.join(dir, `${name}.json`))) {
      savedArtifacts.push(name);
    }
  }
  if (await fileExists(path.join(dir, "brand_card.json"))) {
    savedArtifacts.push("brand_card");
  }

  const brandCoreRaw = await readJsonSafe(path.join(dir, "brand_core.json"));
  const brandCoreParsed = brandCoreRaw
    ? BrandCoreSchema.safeParse(brandCoreRaw)
    : null;
  const brandRead = brandCoreParsed?.success
    ? buildBrandRead(brandCoreParsed.data)
    : null;

  const worldSpecRaw = await readJsonSafe(path.join(dir, "world_spec.json"));
  const worldSpecParsed = worldSpecRaw
    ? WorldSpecSchema.safeParse(worldSpecRaw)
    : null;

  const assets: BootGeneratedAsset[] = worldSpecParsed?.success
    ? worldSpecParsed.data.assets.map((a) => ({
        asset_id: a.id,
        url: a.url,
        prompt: a.prompt,
        model: a.model,
        kind: a.kind,
      }))
    : [];

  const readyToOpen = isBootReady(new Set(savedArtifacts));

  return {
    bootId,
    status: readyToOpen ? "completed" : "failed",
    phase: readyToOpen ? "Phase 6 — Handoff" : "Incomplete boot",
    messages: [],
    pendingQuestion: null,
    activities: [],
    assets,
    artifacts: savedArtifacts,
    brandRead,
    readyToOpen,
  };
}

export class BootJobManager {
  private readonly workspaceRoot: string;
  private readonly carbonClient: CarbonClient;
  private readonly imageGenClient: ImageGenClient;
  private readonly urlFetcher: UrlFetcher;
  private readonly secretsToRedact: ReadonlyArray<string | undefined>;
  private readonly clock: () => number;
  private readonly maxTurns?: number;
  private readonly heartbeatIntervalMs?: number;
  private readonly imageRetryDelayMs?: number;
  private readonly apiRetryDelayMs?: number;
  private readonly logger: (message: string) => void;

  private readonly jobs = new Map<string, BootJobRunner>();

  constructor(options: BootJobManagerOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.carbonClient =
      options.carbonClient ?? createCarbonClient({ apiKey: options.geminiApiKey });
    this.imageGenClient =
      options.imageGenClient ??
      createGeminiImageGenClient({ apiKey: options.geminiApiKey });
    this.urlFetcher =
      options.urlFetcher ?? ((url, signal) => fetchUrlContent(url, signal));
    this.secretsToRedact = [
      options.geminiApiKey,
      ...(options.shopifySecrets ?? []),
    ];
    this.clock = options.clock ?? Date.now;
    this.maxTurns = options.maxTurns;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs;
    this.imageRetryDelayMs = options.imageRetryDelayMs;
    this.apiRetryDelayMs = options.apiRetryDelayMs;
    this.logger = options.logger ?? console.log;
  }

  async listBoots(): Promise<BootListItem[]> {
    const diskBoots = await listDiskBoots(this.workspaceRoot);
    const byId = new Map<string, BootListItem>();

    for (const item of diskBoots) {
      byId.set(item.bootId, item);
    }

    for (const runner of this.jobs.values()) {
      const existing = byId.get(runner.bootId);
      byId.set(runner.bootId, {
        bootId: runner.bootId,
        name: runner.getDisplayName(),
        brandSlug: runner.getBrandSlug() ?? existing?.brandSlug,
        source: existing?.source ?? "data",
        ready: runner.isReadyToOpen() || (existing?.ready ?? false),
        status: runner.getStatus(),
      });
    }

    // Fixtures first, then data boots.
    return Array.from(byId.values()).sort((a, b) => {
      if (a.source !== b.source) return a.source === "fixture" ? -1 : 1;
      return a.bootId.localeCompare(b.bootId);
    });
  }

  async startBoot(input: CreateBootRequest): Promise<StartBootResult> {
    let bootId = generateBootId(input.hostName);
    while (
      this.jobs.has(bootId) ||
      (await resolveBootDir(this.workspaceRoot, bootId)) !== null
    ) {
      bootId = generateBootId(input.hostName);
    }

    const manifest = await saveBootInputs(this.workspaceRoot, bootId, input);
    const runner = new BootJobRunner({
      workspaceRoot: this.workspaceRoot,
      bootId,
      manifest,
      carbonClient: this.carbonClient,
      imageGenClient: this.imageGenClient,
      urlFetcher: this.urlFetcher,
      secretsToRedact: this.secretsToRedact,
      clock: this.clock,
      maxTurns: this.maxTurns,
      heartbeatIntervalMs: this.heartbeatIntervalMs,
      imageRetryDelayMs: this.imageRetryDelayMs,
      apiRetryDelayMs: this.apiRetryDelayMs,
      logger: this.logger,
    });

    this.jobs.set(bootId, runner);
    void runner.start();

    return { bootId, status: "running" };
  }

  async getJobSnapshot(bootId: string): Promise<BootJobSnapshot | null> {
    const runner = this.jobs.get(bootId);
    if (runner) {
      return runner.getSnapshot();
    }
    return buildDiskJobSnapshot(this.workspaceRoot, bootId);
  }

  async attachStream(
    bootId: string,
    req: Request,
    res: Response
  ): Promise<boolean> {
    const runner = this.jobs.get(bootId);
    if (runner) {
      runner.attachStream(req, res);
      return true;
    }

    const diskSnapshot = await buildDiskJobSnapshot(this.workspaceRoot, bootId);
    if (!diskSnapshot) return false;

    const ephemeralSet = new Set<Response>();
    attachBootSseClient(req, res, diskSnapshot, ephemeralSet);
    return true;
  }

  submitReply(
    bootId: string,
    text: string
  ): { ok: true } | { ok: false; statusCode: number; error: string } {
    const runner = this.jobs.get(bootId);
    if (!runner) {
      return {
        ok: false,
        statusCode: 404,
        error: `Active boot job '${bootId}' not found`,
      };
    }
    return runner.submitHostReply(text);
  }

  submitShopifyResponse(
    bootId: string,
    payload: ShopifyResponsePayload
  ): { ok: true } | { ok: false; statusCode: number; error: string } {
    const runner = this.jobs.get(bootId);
    if (!runner) {
      return {
        ok: false,
        statusCode: 404,
        error: `Active boot job '${bootId}' not found`,
      };
    }
    return runner.submitShopifyResponse(payload);
  }

  destroy(): void {
    for (const runner of this.jobs.values()) {
      runner.destroy();
    }
    this.jobs.clear();
  }
}
