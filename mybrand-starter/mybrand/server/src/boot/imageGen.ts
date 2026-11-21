import fs from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI, Modality, type Part } from "@google/genai";
import { sanitizeSecrets } from "./carbon";
import { createPaletteFallbackPng, detectImageMimeType } from "./fallbackPng";
import { getBootAssetsDir, loadInputImageById } from "./inputs";
import type {
  BootGeneratedAsset,
  BootInputManifest,
  ImageGenClient,
  ImageGenParams,
  ImageGenResult,
  ReferenceImageData,
} from "./types";

export const NANO_BANANA_MODEL = "gemini-nano-banana-2.1" as const;
export const PRO_IMAGE_MODEL = "gemini-3-pro-image" as const;

export type AllowedImageModel =
  | typeof NANO_BANANA_MODEL
  | typeof PRO_IMAGE_MODEL;

const SUPPORTED_ASPECT_RATIOS = new Set([
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "9:16",
  "16:9",
  "21:9",
]);

const ASPECT_ALIASES: Record<string, string> = {
  square: "1:1",
  portrait: "3:4",
  tall: "9:16",
  landscape: "4:3",
  wide: "16:9",
  panoramic: "16:9",
  panorama: "16:9",
  ultrawide: "21:9",
};

const MAX_REF_IMAGES = 4;
const IMAGE_RETRY_BACKOFF_MS = 800;

export function normalizeImageModel(raw: unknown): AllowedImageModel {
  if (raw === undefined || raw === null || raw === "") {
    return NANO_BANANA_MODEL;
  }
  if (raw === NANO_BANANA_MODEL || raw === PRO_IMAGE_MODEL) {
    return raw;
  }
  throw new Error(
    `Unsupported image model '${String(raw)}'. Allowed exact model IDs: '${NANO_BANANA_MODEL}' or '${PRO_IMAGE_MODEL}'.`
  );
}

export function normalizeAspectRatio(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return "1:1";
  const cleaned = raw.trim().toLowerCase();
  if (SUPPORTED_ASPECT_RATIOS.has(cleaned)) return cleaned;
  if (cleaned in ASPECT_ALIASES) return ASPECT_ALIASES[cleaned];
  const colonMatch = /(\d+)\s*[:x/]\s*(\d+)/.exec(cleaned);
  if (colonMatch) {
    const candidate = `${colonMatch[1]}:${colonMatch[2]}`;
    if (SUPPORTED_ASPECT_RATIOS.has(candidate)) return candidate;
  }
  return "1:1";
}

export interface GeminiImageGenClientOptions {
  apiKey?: string;
}

export function createGeminiImageGenClient(
  options: GeminiImageGenClientOptions
): ImageGenClient {
  const apiKey = options.apiKey?.trim() || undefined;
  let ai: GoogleGenAI | null = null;

  function getAi(): GoogleGenAI {
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured");
    }
    if (!ai) {
      ai = new GoogleGenAI({ apiKey });
    }
    return ai;
  }

  return {
    isAvailable(): boolean {
      return Boolean(apiKey);
    },

    async generateImage(params: ImageGenParams): Promise<ImageGenResult> {
      const client = getAi();
      const parts: Part[] = [];

      for (const ref of params.references.slice(0, MAX_REF_IMAGES)) {
        parts.push({ text: `Reference image (${ref.id}):` });
        parts.push({
          inlineData: {
            mimeType: ref.mimeType,
            data: ref.dataBase64,
          },
        });
      }
      parts.push({ text: params.prompt });

      try {
        const response = await client.models.generateContent({
          model: params.model,
          contents: [{ role: "user", parts }],
          config: {
            responseModalities: [Modality.IMAGE],
            // Gemini Developer API imageConfig supports ONLY aspectRatio and imageSize (1K = 1024px budget).
            imageConfig: {
              aspectRatio: params.aspectRatio,
              imageSize: "1K",
            },
            abortSignal: params.abortSignal,
          },
        });

        const responseParts = response.candidates?.[0]?.content?.parts ?? [];
        // Skip intermediate thought images (`part.thought === true`) and take the final generated image part.
        const imagePart = responseParts.find(
          (part) => !part.thought && Boolean(part.inlineData?.data)
        );
        const inlineData = imagePart?.inlineData;
        if (!inlineData?.data) {
          const textHint = responseParts
            .filter((p) => !p.thought && typeof p.text === "string")
            .map((p) => p.text)
            .join(" ")
            .trim();
          throw new Error(
            textHint
              ? `Image model returned no image bytes (${textHint.slice(0, 160)})`
              : "Image model returned no inlineData image bytes"
          );
        }

        const bytes = Buffer.from(inlineData.data, "base64");
        if (bytes.length === 0) {
          throw new Error("Image model returned empty image buffer");
        }

        return {
          bytes,
          mimeType: inlineData.mimeType ?? detectImageMimeType(bytes),
        };
      } catch (error) {
        throw new Error(sanitizeSecrets(error, [apiKey]));
      }
    },
  };
}

export async function runWithConcurrency<T, R>(
  items: readonly T[],
  maxConcurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const limit = Math.max(1, maxConcurrency);
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await worker(items[current], current);
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => runWorker()
  );
  await Promise.all(workers);
  return results;
}

export interface ExecuteGenerateImageContext {
  workspaceRoot: string;
  bootId: string;
  manifest: BootInputManifest;
  imageGenClient: ImageGenClient;
  allocateAssetId: () => { assetId: string; index: number };
  getPaletteHex: () => string[];
  abortSignal?: AbortSignal;
  retryDelayMs?: number;
}

export interface GenerateImageToolInput {
  prompt: string;
  model?: string;
  aspect?: string;
  ref_asset_ids?: string[];
  kind?: string;
}

export interface GenerateImageToolOutcome {
  asset: BootGeneratedAsset;
  toolOutput: {
    asset_id: string;
    url: string;
    model: string;
    aspect: string;
    fallback: boolean;
    note?: string;
  };
}

async function resolveReferenceImages(
  workspaceRoot: string,
  bootId: string,
  manifest: BootInputManifest,
  refIds: readonly string[]
): Promise<ReferenceImageData[]> {
  const resolved: ReferenceImageData[] = [];
  const assetsDir = getBootAssetsDir(workspaceRoot, bootId);

  for (const rawId of refIds.slice(0, MAX_REF_IMAGES)) {
    const id = rawId.trim();
    if (!id) continue;

    // 1) Try uploaded host input image (img_01..img_N)
    const fromInput = await loadInputImageById(workspaceRoot, bootId, manifest, id);
    if (fromInput) {
      resolved.push(fromInput);
      continue;
    }

    // 2) Try previously generated asset (asset_XX -> assets/asset_XX.png)
    if (/^[a-zA-Z0-9_-]+$/.test(id)) {
      const candidatePath = path.join(assetsDir, `${id}.png`);
      try {
        const bytes = await fs.readFile(candidatePath);
        resolved.push({
          id,
          mimeType: detectImageMimeType(bytes, `${id}.png`),
          dataBase64: bytes.toString("base64"),
        });
      } catch {
        // Ignore unknown reference id rather than failing the generation.
      }
    }
  }

  return resolved;
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

/**
 * Runs generate_image with up to 2 attempts, falling back to a valid palette-themed
 * PNG texture per orchestrator.md §4 Phase 3 ("If an image fails twice, use a flat
 * palette texture and move on").
 */
export async function executeGenerateImage(
  input: GenerateImageToolInput,
  ctx: ExecuteGenerateImageContext
): Promise<GenerateImageToolOutcome> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    throw new Error("generate_image requires a non-empty prompt");
  }

  const model = normalizeImageModel(input.model);
  const aspectRatio = normalizeAspectRatio(input.aspect);
  const refIds = Array.isArray(input.ref_asset_ids) ? input.ref_asset_ids : [];
  const references = await resolveReferenceImages(
    ctx.workspaceRoot,
    ctx.bootId,
    ctx.manifest,
    refIds
  );

  const { assetId, index } = ctx.allocateAssetId();
  const assetsDir = getBootAssetsDir(ctx.workspaceRoot, ctx.bootId);
  await fs.mkdir(assetsDir, { recursive: true });
  const filePath = path.join(assetsDir, `${assetId}.png`);
  const publicUrl = `/data/${ctx.bootId}/assets/${assetId}.png`;

  let generatedBytes: Buffer | null = null;
  let lastError: string | null = null;
  const retryDelayMs = ctx.retryDelayMs ?? IMAGE_RETRY_BACKOFF_MS;

  for (let attempt = 1; attempt <= 2; attempt++) {
    if (ctx.abortSignal?.aborted) {
      throw new Error("Boot job aborted during image generation");
    }
    try {
      const result = await ctx.imageGenClient.generateImage({
        prompt,
        model,
        aspectRatio,
        references,
        abortSignal: ctx.abortSignal,
      });
      generatedBytes = result.bytes;
      break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < 2) {
        await sleep(retryDelayMs, ctx.abortSignal);
      }
    }
  }

  let fallback = false;
  let effectiveModel: string = model;
  if (!generatedBytes) {
    fallback = true;
    effectiveModel = "fallback-palette";
    const dims =
      aspectRatio === "16:9"
        ? { width: 512, height: 288 }
        : aspectRatio === "4:3"
          ? { width: 320, height: 240 }
          : aspectRatio === "3:4"
            ? { width: 240, height: 320 }
            : { width: 256, height: 256 };
    generatedBytes = createPaletteFallbackPng(ctx.getPaletteHex(), {
      ...dims,
      seed: index,
    });
  }

  await fs.writeFile(filePath, generatedBytes);

  const asset: BootGeneratedAsset = {
    asset_id: assetId,
    url: publicUrl,
    prompt,
    model: effectiveModel,
    ...(input.kind ? { kind: input.kind } : {}),
    ...(fallback ? { fallback: true } : {}),
  };

  return {
    asset,
    toolOutput: {
      asset_id: assetId,
      url: publicUrl,
      model: effectiveModel,
      aspect: aspectRatio,
      fallback,
      ...(fallback && lastError
        ? {
            note: `Image generation failed twice (${lastError}); saved a flat palette fallback PNG so you can move on.`,
          }
        : {}),
    },
  };
}
