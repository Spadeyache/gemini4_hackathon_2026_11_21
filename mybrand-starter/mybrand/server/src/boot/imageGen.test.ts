import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPaletteFallbackPng, detectImageMimeType } from "./fallbackPng";
import {
  executeGenerateImage,
  NANO_BANANA_MODEL,
  normalizeAspectRatio,
  normalizeImageModel,
  PRO_IMAGE_MODEL,
  runWithConcurrency,
} from "./imageGen";
import { saveBootInputs } from "./inputs";
import type { ImageGenClient, ImageGenParams } from "./types";

const tempDirs: string[] = [];

function makeTempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mybrand-img-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("image generation tool", () => {
  it("enforces exact allowed image model IDs and normalizes aspect ratios", () => {
    expect(normalizeImageModel(undefined)).toBe(NANO_BANANA_MODEL);
    expect(normalizeImageModel(NANO_BANANA_MODEL)).toBe(NANO_BANANA_MODEL);
    expect(normalizeImageModel(PRO_IMAGE_MODEL)).toBe(PRO_IMAGE_MODEL);
    expect(() => normalizeImageModel("imagen-3.0")).toThrow(/Allowed exact model IDs/);

    expect(normalizeAspectRatio("16:9")).toBe("16:9");
    expect(normalizeAspectRatio("panoramic")).toBe("16:9");
    expect(normalizeAspectRatio("portrait")).toBe("3:4");
    expect(normalizeAspectRatio("unknown")).toBe("1:1");
  });

  it("passes resolved uploaded and generated ref_asset_ids and saves PNG bytes to disk", async () => {
    const workspaceRoot = makeTempWorkspace();
    const bootId = "img-ref-boot";
    const samplePng = createPaletteFallbackPng(["#223344"], { width: 16, height: 16 });

    const manifest = await saveBootInputs(workspaceRoot, bootId, {
      hostName: "Ocean Lab",
      hostType: "company",
      images: [
        {
          filename: "pier.png",
          mimeType: "image/png",
          dataBase64: samplePng.toString("base64"),
        },
      ],
      urls: [],
      voiceSamples: [],
    });

    const receivedCalls: ImageGenParams[] = [];
    const mockClient: ImageGenClient = {
      isAvailable: () => true,
      async generateImage(params) {
        receivedCalls.push(params);
        return { bytes: samplePng, mimeType: "image/png" };
      },
    };

    let counter = 0;
    const first = await executeGenerateImage(
      {
        prompt: "Wide 16:9 sunlit ocean horizon with weathered timber pier",
        model: NANO_BANANA_MODEL,
        aspect: "16:9",
        ref_asset_ids: ["img_01"],
        kind: "texture",
      },
      {
        workspaceRoot,
        bootId,
        manifest,
        imageGenClient: mockClient,
        allocateAssetId: () => {
          counter += 1;
          return { assetId: `asset_0${counter}`, index: counter };
        },
        getPaletteHex: () => ["#1E3A5F", "#E8DCC8"],
        retryDelayMs: 0,
      }
    );

    expect(first.asset.asset_id).toBe("asset_01");
    expect(first.asset.url).toBe(`/data/${bootId}/assets/asset_01.png`);
    expect(first.asset.fallback).toBeUndefined();
    expect(receivedCalls[0]?.references).toHaveLength(1);
    expect(receivedCalls[0]?.references[0]?.id).toBe("img_01");

    // Second call references previously generated asset_01 with gemini-3-pro-image
    const second = await executeGenerateImage(
      {
        prompt: "Minimal studio poster with legible OCEAN LAB typography",
        model: PRO_IMAGE_MODEL,
        aspect: "3:4",
        ref_asset_ids: ["asset_01"],
        kind: "poster",
      },
      {
        workspaceRoot,
        bootId,
        manifest,
        imageGenClient: mockClient,
        allocateAssetId: () => {
          counter += 1;
          return { assetId: `asset_0${counter}`, index: counter };
        },
        getPaletteHex: () => ["#1E3A5F", "#E8DCC8"],
        retryDelayMs: 0,
      }
    );

    expect(second.asset.model).toBe(PRO_IMAGE_MODEL);
    expect(receivedCalls[1]?.references[0]?.id).toBe("asset_01");

    const onDisk = fs.readFileSync(
      path.join(workspaceRoot, "server", "data", bootId, "assets", "asset_01.png")
    );
    expect(detectImageMimeType(onDisk)).toBe("image/png");
  });

  it("retries once and falls back to a valid palette PNG after two failures", async () => {
    const workspaceRoot = makeTempWorkspace();
    const bootId = "fallback-boot";
    const manifest = await saveBootInputs(workspaceRoot, bootId, {
      hostName: "Fallback Brand",
      hostType: "person",
      images: [],
      urls: ["https://example.com"],
      voiceSamples: [],
    });

    const generateImage = vi.fn().mockRejectedValue(new Error("503 backend unavailable"));
    const failingClient: ImageGenClient = {
      isAvailable: () => true,
      generateImage,
    };

    const outcome = await executeGenerateImage(
      {
        prompt: "Warm terracotta ceramic floor tile",
        model: NANO_BANANA_MODEL,
        aspect: "1:1",
      },
      {
        workspaceRoot,
        bootId,
        manifest,
        imageGenClient: failingClient,
        allocateAssetId: () => ({ assetId: "asset_01", index: 1 }),
        getPaletteHex: () => ["#C46D4E", "#EDE4D8"],
        retryDelayMs: 0,
      }
    );

    expect(generateImage).toHaveBeenCalledTimes(2);
    expect(outcome.asset.fallback).toBe(true);
    expect(outcome.asset.model).toBe("fallback-palette");
    expect(outcome.toolOutput.fallback).toBe(true);

    const savedBytes = fs.readFileSync(
      path.join(workspaceRoot, "server", "data", bootId, "assets", "asset_01.png")
    );
    expect(savedBytes.length).toBeGreaterThan(100);
    expect(detectImageMimeType(savedBytes)).toBe("image/png");
  });

  it("caps parallel execution with runWithConcurrency", async () => {
    let active = 0;
    let maxActive = 0;
    const results = await runWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 15));
      active -= 1;
      return n * 10;
    });

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(results).toEqual([10, 20, 30, 40, 50, 60]);
  });
});
