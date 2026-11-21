import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { HostTypeSchema } from "@mybrand/shared";
import { SAFE_BOOT_ID } from "../boot";
import type {
  BootInputManifest,
  CreateBootRequest,
  ReferenceImageData,
  StoredInputImage,
} from "./types";

export const MAX_UPLOAD_IMAGES = 20;
export const MAX_UPLOAD_URLS = 10;
export const MAX_VOICE_SAMPLES = 30;
export const MAX_SINGLE_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB per photo

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

function normalizeMimeType(raw: string): string {
  const lower = raw.trim().toLowerCase().split(";")[0];
  return lower === "image/jpg" ? "image/jpeg" : lower;
}

function extensionForMime(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "png";
  }
}

export function stripBase64DataUrlPrefix(input: string): string {
  const trimmed = input.trim();
  const commaIdx = trimmed.indexOf(",");
  if (trimmed.startsWith("data:") && commaIdx >= 0) {
    return trimmed.slice(commaIdx + 1).replace(/\s+/g, "");
  }
  return trimmed.replace(/\s+/g, "");
}

const UploadImageSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  mimeType: z
    .string()
    .trim()
    .transform(normalizeMimeType)
    .refine(
      (mime) => ALLOWED_IMAGE_MIME_TYPES.has(mime),
      "Unsupported image mimeType (use image/png, image/jpeg, image/webp, or image/gif)"
    ),
  dataBase64: z.string().trim().min(1),
});

const HttpUrlSchema = z
  .string()
  .trim()
  .url("Invalid URL")
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }, "URL must use http:// or https://");

export const CreateBootRequestSchema = z
  .object({
    hostName: z.string().trim().min(1, "hostName is required").max(120),
    hostType: HostTypeSchema,
    images: z
      .array(UploadImageSchema)
      .max(MAX_UPLOAD_IMAGES, `At most ${MAX_UPLOAD_IMAGES} images allowed`)
      .default([]),
    urls: z
      .array(HttpUrlSchema)
      .max(MAX_UPLOAD_URLS, `At most ${MAX_UPLOAD_URLS} URLs allowed`)
      .default([]),
    voiceSamples: z
      .array(z.string().trim().min(1).max(4000))
      .max(MAX_VOICE_SAMPLES, `At most ${MAX_VOICE_SAMPLES} voice samples allowed`)
      .default([]),
  })
  .refine(
    (data) =>
      data.images.length > 0 ||
      data.urls.length > 0 ||
      data.voiceSamples.length > 0,
    "Provide at least one image, URL, or voice sample to start a boot"
  );

export function slugifyHostName(hostName: string): string {
  const base = hostName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return base || "brand";
}

export function generateBootId(hostName: string): string {
  const slug = slugifyHostName(hostName);
  const suffix = crypto.randomBytes(3).toString("hex");
  const candidate = `${slug}-${suffix}`;
  if (!SAFE_BOOT_ID.test(candidate)) {
    return `brand-${suffix}`;
  }
  return candidate;
}

export function getBootDataDir(workspaceRoot: string, bootId: string): string {
  return path.join(workspaceRoot, "server", "data", bootId);
}

export function getBootInputsDir(
  workspaceRoot: string,
  bootId: string
): string {
  return path.join(getBootDataDir(workspaceRoot, bootId), "inputs");
}

export function getBootAssetsDir(
  workspaceRoot: string,
  bootId: string
): string {
  return path.join(getBootDataDir(workspaceRoot, bootId), "assets");
}

export function formatInputImageId(indexZeroBased: number): string {
  return `img_${String(indexZeroBased + 1).padStart(2, "0")}`;
}

export async function saveBootInputs(
  workspaceRoot: string,
  bootId: string,
  input: CreateBootRequest
): Promise<BootInputManifest> {
  const inputsDir = getBootInputsDir(workspaceRoot, bootId);
  const assetsDir = getBootAssetsDir(workspaceRoot, bootId);
  await fs.mkdir(inputsDir, { recursive: true });
  await fs.mkdir(assetsDir, { recursive: true });

  const storedImages: StoredInputImage[] = [];

  for (let i = 0; i < input.images.length; i++) {
    const img = input.images[i];
    const id = formatInputImageId(i);
    const mimeType = normalizeMimeType(img.mimeType);
    const cleanBase64 = stripBase64DataUrlPrefix(img.dataBase64);
    const bytes = Buffer.from(cleanBase64, "base64");
    if (bytes.length === 0) {
      throw new Error(`Image '${img.filename}' has empty base64 payload`);
    }
    if (bytes.length > MAX_SINGLE_IMAGE_BYTES) {
      throw new Error(
        `Image '${img.filename}' exceeds 10 MB limit (${bytes.length} bytes)`
      );
    }

    const ext = extensionForMime(mimeType);
    const fileName = `${id}.${ext}`;
    const fullPath = path.join(inputsDir, fileName);
    await fs.writeFile(fullPath, bytes);

    storedImages.push({
      id,
      filename: img.filename,
      mimeType,
      relativePath: path.join("inputs", fileName),
      sizeBytes: bytes.length,
    });
  }

  const manifest: BootInputManifest = {
    boot_id: bootId,
    host: {
      name: input.hostName,
      type: input.hostType,
    },
    images: storedImages,
    urls: input.urls.map((url, idx) => ({
      id: `url_${idx + 1}`,
      url,
    })),
    voice_samples: input.voiceSamples.map((text, idx) => ({
      id: `voice_${idx + 1}`,
      text,
    })),
    created_at: new Date().toISOString(),
  };

  await fs.writeFile(
    path.join(inputsDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8"
  );

  return manifest;
}

export async function loadInputImagesData(
  workspaceRoot: string,
  bootId: string,
  manifest: BootInputManifest
): Promise<Array<ReferenceImageData & { filename: string; filePath: string; sizeBytes: number }>> {
  const bootDir = getBootDataDir(workspaceRoot, bootId);
  const results: Array<
    ReferenceImageData & { filename: string; filePath: string; sizeBytes: number }
  > = [];

  for (const img of manifest.images) {
    const filePath = path.join(bootDir, img.relativePath);
    const bytes = await fs.readFile(filePath);
    results.push({
      id: img.id,
      filename: img.filename,
      mimeType: img.mimeType,
      dataBase64: bytes.toString("base64"),
      filePath,
      sizeBytes: bytes.length,
    });
  }

  return results;
}

export async function loadInputImageById(
  workspaceRoot: string,
  bootId: string,
  manifest: BootInputManifest,
  imageId: string
): Promise<ReferenceImageData | null> {
  const entry = manifest.images.find((img) => img.id === imageId);
  if (!entry) return null;

  const fullPath = path.join(
    getBootDataDir(workspaceRoot, bootId),
    entry.relativePath
  );
  try {
    const bytes = await fs.readFile(fullPath);
    return {
      id: entry.id,
      mimeType: entry.mimeType,
      dataBase64: bytes.toString("base64"),
    };
  } catch {
    return null;
  }
}
