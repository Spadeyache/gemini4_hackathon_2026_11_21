import { describe, expect, it } from "vitest";
import { parseRoute } from "../routing";
import {
  computeScaledDimensions,
  formatBytes,
  stripDataUrlPrefix,
} from "../utils/imageUpload";
import {
  MAX_INTAKE_IMAGES,
  normalizeIntakeUrl,
  validateIntake,
} from "../utils/intakeValidation";

describe("parseRoute", () => {
  it("parses landing, host intake, host workspace, and boutique routes", () => {
    expect(parseRoute("/")).toEqual({ kind: "landing" });
    expect(parseRoute("/host")).toEqual({ kind: "host-intake" });
    expect(parseRoute("/host/")).toEqual({ kind: "host-intake" });
    expect(parseRoute("/host/boot_123")).toEqual({
      kind: "host-workspace",
      bootId: "boot_123",
    });
    expect(parseRoute("/host/my%20brand/")).toEqual({
      kind: "host-workspace",
      bootId: "my brand",
    });
    expect(parseRoute("/b/demo-brand")).toEqual({
      kind: "boutique",
      bootId: "demo-brand",
    });
    expect(parseRoute("/b/kestrel-clay/")).toEqual({
      kind: "boutique",
      bootId: "kestrel-clay",
    });
  });

  it("returns not-found for unknown or nested paths", () => {
    expect(parseRoute("/unknown")).toEqual({ kind: "not-found" });
    expect(parseRoute("/host/a/b")).toEqual({ kind: "not-found" });
    expect(parseRoute("/b/a/b")).toEqual({ kind: "not-found" });
  });
});

describe("intakeValidation", () => {
  it("normalizes URLs and rejects unsafe schemes or invalid domains", () => {
    expect(normalizeIntakeUrl("kestrelclay.com/about")).toEqual({
      ok: true,
      url: "https://kestrelclay.com/about",
    });
    expect(normalizeIntakeUrl("http://example.org")).toEqual({
      ok: true,
      url: "http://example.org/",
    });
    expect(normalizeIntakeUrl("javascript:alert(1)").ok).toBe(false);
    expect(normalizeIntakeUrl("not-a-domain").ok).toBe(false);
    expect(normalizeIntakeUrl("   ").ok).toBe(false);
  });

  it("enforces Phase 0 minimum (hostName + >=3 images OR >=1 URL, max 20 images)", () => {
    const empty = validateIntake({
      hostName: "  ",
      hostType: "person",
      imageCount: 0,
      urls: [],
      voiceSamples: [],
    });
    expect(empty.valid).toBe(false);
    expect(empty.hasHostName).toBe(false);
    expect(empty.hasMinimumSources).toBe(false);

    const tooFewImages = validateIntake({
      hostName: "Maren Solis",
      hostType: "person",
      imageCount: 2,
      urls: [],
      voiceSamples: [],
    });
    expect(tooFewImages.valid).toBe(false);
    expect(tooFewImages.hasHostName).toBe(true);
    expect(tooFewImages.hasMinimumSources).toBe(false);

    const threeImagesValid = validateIntake({
      hostName: "Maren Solis",
      hostType: "person",
      imageCount: 3,
      urls: [],
      voiceSamples: [],
    });
    expect(threeImagesValid.valid).toBe(true);

    const oneUrlValid = validateIntake({
      hostName: "Harbor Surf Co.",
      hostType: "company",
      imageCount: 0,
      urls: ["https://harborsurf.example"],
      voiceSamples: [],
    });
    expect(oneUrlValid.valid).toBe(true);

    const tooManyImages = validateIntake({
      hostName: "Maren Solis",
      hostType: "person",
      imageCount: MAX_INTAKE_IMAGES + 1,
      urls: ["https://maren.example"],
      voiceSamples: [],
    });
    expect(tooManyImages.valid).toBe(false);
    expect(tooManyImages.withinImageLimit).toBe(false);
  });

  it("auto-includes unsaved URL and voice drafts when valid", () => {
    const res = validateIntake({
      hostName: "Kestrel",
      hostType: "company",
      imageCount: 0,
      urls: [],
      voiceSamples: ["First note"],
      pendingUrlDraft: "kestrel.studio",
      pendingVoiceDraft: "  Pulled from cone 10 this morning.  ",
    });
    expect(res.valid).toBe(true);
    expect(res.effectiveUrls).toEqual(["https://kestrel.studio/"]);
    expect(res.effectiveVoiceSamples).toEqual([
      "First note",
      "Pulled from cone 10 this morning.",
    ]);
  });
});

describe("imageUpload pure helpers", () => {
  it("scales large images to <=1280px longest edge without upscaling small ones", () => {
    expect(computeScaledDimensions(800, 600)).toEqual({
      width: 800,
      height: 600,
      resized: false,
    });
    expect(computeScaledDimensions(4032, 3024, 1280)).toEqual({
      width: 1280,
      height: 960,
      resized: true,
    });
    expect(computeScaledDimensions(2000, 4000, 1280)).toEqual({
      width: 640,
      height: 1280,
      resized: true,
    });
  });

  it("strips data URL prefixes cleanly and formats byte sizes", () => {
    expect(stripDataUrlPrefix("data:image/jpeg;base64,ABC123==")).toBe(
      "ABC123=="
    );
    expect(stripDataUrlPrefix("RAWBASE64")).toBe("RAWBASE64");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(145_000)).toBe("142 KB");
    expect(formatBytes(2_500_000)).toBe("2.4 MB");
  });
});
