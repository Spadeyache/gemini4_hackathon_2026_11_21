import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { SessionAdapterOutputSchema } from "@mybrand/shared";
import type {
  AdapterCallResult,
  SessionAdapterClient,
  SessionAdapterInput,
} from "./types";

export const HYDROGEN_MODEL = "gemini-4-hydrogen";

export const SESSION_ADAPTER_OUTPUT_JSON_SCHEMA = {
  type: "object",
  properties: {
    ops: {
      type: "array",
      items: {
        type: "object",
        properties: {
          op: { type: "string", enum: ["replace"] },
          path: { type: "string" },
          value: {
            anyOf: [{ type: "string" }, { type: "integer", enum: [0, 1] }],
          },
          reason: { type: "string" },
        },
        required: ["op", "path", "value", "reason"],
      },
    },
    visitor_read: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["ops", "visitor_read", "confidence"],
} as const;

const promptCache = new Map<string, string>();

export function getSessionAdapterPromptPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, "prompts", "session_adapter.md");
}

/**
 * Loads prompts/session_adapter.md from disk at runtime (never hardcoded in source).
 */
export async function loadSessionAdapterPrompt(
  workspaceRoot: string,
  options?: { bypassCache?: boolean }
): Promise<string> {
  const promptPath = path.resolve(getSessionAdapterPromptPath(workspaceRoot));
  if (!options?.bypassCache) {
    const cached = promptCache.get(promptPath);
    if (cached !== undefined) return cached;
  }
  const content = await fs.readFile(promptPath, "utf-8");
  promptCache.set(promptPath, content);
  return content;
}

export function clearSessionAdapterPromptCache(): void {
  promptCache.clear();
}

function sanitizeErrorMessage(error: unknown, apiKey?: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (apiKey && raw.includes(apiKey)) {
    return raw.split(apiKey).join("[REDACTED]");
  }
  return raw;
}

export interface HydrogenClientOptions {
  apiKey?: string;
  workspaceRoot: string;
}

export function createHydrogenClient(
  options: HydrogenClientOptions
): SessionAdapterClient {
  const apiKey = options.apiKey?.trim() || undefined;
  let ai: GoogleGenAI | null = null;

  function getAiClient(): GoogleGenAI | null {
    if (!apiKey) return null;
    if (!ai) {
      ai = new GoogleGenAI({ apiKey });
    }
    return ai;
  }

  return {
    isAvailable(): boolean {
      return Boolean(apiKey);
    },

    async propose(
      input: SessionAdapterInput,
      deadlineMs: number,
      callOptions?: { hostNoteOnly?: boolean }
    ): Promise<AdapterCallResult> {
      const client = getAiClient();
      if (!client) {
        return {
          ok: false,
          error: "GEMINI_API_KEY is not configured",
          timedOut: false,
          latency_ms: 0,
        };
      }

      const start = performance.now();
      const systemInstruction = await loadSessionAdapterPrompt(
        options.workspaceRoot
      );

      const userPayload = callOptions?.hostNoteOnly
        ? {
            ...input,
            mode_constraint:
              "Rules already applied the structural edit. Return at most 1 op targeting ONLY /host_note (<=90 chars, host voice, no new facts), or ops: [] if no note is needed.",
          }
        : input;

      const controller = new AbortController();
      let timedOut = false;
      let timer: NodeJS.Timeout | null = null;

      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new Error(`Hydrogen request exceeded deadline (${deadlineMs}ms)`));
        }, deadlineMs);
        timer.unref?.();
      });

      const requestPromise = client.models.generateContent({
        model: HYDROGEN_MODEL,
        contents: JSON.stringify(userPayload),
        config: {
          systemInstruction,
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.LOW,
          },
          responseMimeType: "application/json",
          responseJsonSchema: SESSION_ADAPTER_OUTPUT_JSON_SCHEMA,
          abortSignal: controller.signal,
        },
      });

      // Avoid unhandled rejection if timeout settles the race before the SDK rejects.
      requestPromise.catch(() => {});

      try {
        const response = await Promise.race([requestPromise, timeoutPromise]);
        const latency_ms = Math.round(performance.now() - start);
        const text = response.text?.trim();
        if (!text) {
          return {
            ok: false,
            error: "Empty model response text",
            timedOut: false,
            latency_ms,
          };
        }

        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(text);
        } catch (parseErr) {
          return {
            ok: false,
            error: `Invalid JSON from model: ${sanitizeErrorMessage(parseErr, apiKey)}`,
            timedOut: false,
            latency_ms,
          };
        }

        const zodResult = SessionAdapterOutputSchema.safeParse(parsedJson);
        if (!zodResult.success) {
          return {
            ok: false,
            error: `Model output failed schema validation: ${zodResult.error.issues.map((i) => i.message).join("; ")}`,
            timedOut: false,
            latency_ms,
          };
        }

        return {
          ok: true,
          output: zodResult.data,
          latency_ms,
        };
      } catch (error) {
        const latency_ms = Math.round(performance.now() - start);
        const isAbort =
          timedOut ||
          (error instanceof Error && error.name === "AbortError") ||
          controller.signal.aborted;
        return {
          ok: false,
          error: sanitizeErrorMessage(error, apiKey),
          timedOut: isAbort,
          latency_ms,
        };
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}
