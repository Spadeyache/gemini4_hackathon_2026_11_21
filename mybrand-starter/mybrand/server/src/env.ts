import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export type SessionAdapterMode =
  | "hybrid"
  | "full"
  | "rules_plus_host_note"
  | "rules_only";

export interface ServerEnv {
  port: number;
  geminiApiKey?: string;
  sessionAdapterMode: SessionAdapterMode;
  shopifyDomain?: string;
  shopifyClientId?: string;
  shopifyClientSecret?: string;
  publicAssetBaseUrl?: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const WORKSPACE_ROOT = path.resolve(__dirname, "..", "..");

function nonEmpty(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Default adapter mode: "hybrid" combines instant (~1ms) policy rules with live
 * gemini-4-hydrogen multi-op thematic product/signage/lighting/host_note adaptation
 * (respecting all §5 levers, validator limits, and graceful offline rules fallback).
 * Override via SESSION_ADAPTER_MODE=full | rules_plus_host_note | rules_only.
 */
export const DEFAULT_SESSION_ADAPTER_MODE: SessionAdapterMode = "hybrid";

function parseAdapterMode(value: string | undefined): SessionAdapterMode {
  const normalized = nonEmpty(value)?.toLowerCase();
  if (
    normalized === "hybrid" ||
    normalized === "full" ||
    normalized === "rules_plus_host_note" ||
    normalized === "rules_only"
  ) {
    return normalized;
  }
  return DEFAULT_SESSION_ADAPTER_MODE;
}

export function parseServerEnv(
  raw: Record<string, string | undefined>,
  warn: (message: string) => void = console.warn
): ServerEnv {
  const parsedPort = Number(raw.PORT ?? 3001);
  const port =
    Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort < 65536
      ? parsedPort
      : 3001;

  const geminiApiKey = nonEmpty(raw.GEMINI_API_KEY);
  if (!geminiApiKey) {
    warn(
      "[mybrand] Warning: GEMINI_API_KEY is not set. Server booted without Gemini credentials."
    );
  }

  return {
    port,
    geminiApiKey,
    sessionAdapterMode: parseAdapterMode(raw.SESSION_ADAPTER_MODE),
    shopifyDomain: nonEmpty(raw.SHOPIFY_DOMAIN),
    shopifyClientId: nonEmpty(raw.SHOPIFY_CLIENT_ID),
    shopifyClientSecret: nonEmpty(raw.SHOPIFY_CLIENT_SECRET),
    publicAssetBaseUrl: nonEmpty(raw.PUBLIC_ASSET_BASE_URL),
  };
}

export function loadServerEnv(
  envPath: string = path.join(WORKSPACE_ROOT, ".env"),
  warn: (message: string) => void = console.warn
): ServerEnv {
  dotenv.config({ path: envPath });
  return parseServerEnv(process.env, warn);
}
