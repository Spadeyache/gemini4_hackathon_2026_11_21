import type { HostType } from "@mybrand/shared";

export const MAX_INTAKE_IMAGES = 20;
export const MIN_INTAKE_IMAGES_WITHOUT_URL = 3;
export const MIN_INTAKE_URLS_WITHOUT_IMAGES = 1;

export interface IntakeDraftInput {
  hostName: string;
  hostType: HostType;
  imageCount: number;
  urls: readonly string[];
  voiceSamples: readonly string[];
  pendingUrlDraft?: string;
  pendingVoiceDraft?: string;
}

export interface IntakeValidationResult {
  valid: boolean;
  hasHostName: boolean;
  hasMinimumSources: boolean;
  withinImageLimit: boolean;
  errors: string[];
  effectiveUrls: string[];
  effectiveVoiceSamples: string[];
}

export interface NormalizedUrlResult {
  ok: true;
  url: string;
}

export interface NormalizedUrlError {
  ok: false;
  error: string;
}

export function normalizeIntakeUrl(
  raw: string
): NormalizedUrlResult | NormalizedUrlError {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "Enter a URL first." };
  }

  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: `"${trimmed}" is not a valid URL.` };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      error: "Only http:// and https:// URLs are supported.",
    };
  }

  if (!parsed.hostname || !parsed.hostname.includes(".")) {
    return {
      ok: false,
      error: `"${trimmed}" needs a valid domain (e.g. yoursite.com).`,
    };
  }

  return { ok: true, url: parsed.toString() };
}

export function collectEffectiveVoiceSamples(
  samples: readonly string[],
  pendingDraft?: string
): string[] {
  const cleaned = samples.map((s) => s.trim()).filter((s) => s.length > 0);
  const draft = pendingDraft?.trim();
  if (draft && draft.length > 0) {
    cleaned.push(draft);
  }
  return cleaned;
}

export function collectEffectiveUrls(
  urls: readonly string[],
  pendingUrlDraft?: string
): { urls: string[]; draftError: string | null } {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const existing of urls) {
    const normalized = normalizeIntakeUrl(existing);
    if (normalized.ok && !seen.has(normalized.url)) {
      seen.add(normalized.url);
      result.push(normalized.url);
    }
  }

  let draftError: string | null = null;
  if (pendingUrlDraft && pendingUrlDraft.trim().length > 0) {
    const normalizedDraft = normalizeIntakeUrl(pendingUrlDraft);
    if (normalizedDraft.ok) {
      if (!seen.has(normalizedDraft.url)) {
        seen.add(normalizedDraft.url);
        result.push(normalizedDraft.url);
      }
    } else {
      draftError = normalizedDraft.error;
    }
  }

  return { urls: result, draftError };
}

export function validateIntake(input: IntakeDraftInput): IntakeValidationResult {
  const errors: string[] = [];
  const hasHostName = input.hostName.trim().length > 0;
  const { urls: effectiveUrls, draftError } = collectEffectiveUrls(
    input.urls,
    input.pendingUrlDraft
  );
  const effectiveVoiceSamples = collectEffectiveVoiceSamples(
    input.voiceSamples,
    input.pendingVoiceDraft
  );

  if (!hasHostName) {
    errors.push("Add a host or brand name.");
  }

  if (draftError) {
    errors.push(draftError);
  }

  const withinImageLimit = input.imageCount <= MAX_INTAKE_IMAGES;
  if (!withinImageLimit) {
    errors.push(`Maximum ${MAX_INTAKE_IMAGES} images allowed.`);
  }

  const hasMinimumSources =
    input.imageCount >= MIN_INTAKE_IMAGES_WITHOUT_URL ||
    effectiveUrls.length >= MIN_INTAKE_URLS_WITHOUT_IMAGES;

  if (!hasMinimumSources) {
    errors.push(
      `Add at least ${MIN_INTAKE_IMAGES_WITHOUT_URL} images or ${MIN_INTAKE_URLS_WITHOUT_IMAGES} URL to start.`
    );
  }

  return {
    valid: errors.length === 0,
    hasHostName,
    hasMinimumSources,
    withinImageLimit,
    errors,
    effectiveUrls,
    effectiveVoiceSamples,
  };
}
