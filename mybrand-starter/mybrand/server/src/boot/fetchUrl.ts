import net from "node:net";
import type { FetchUrlResult } from "./types";

const FETCH_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CHARS = 12_000;
const MAX_IMAGE_URLS = 20;

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata",
]);

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("fe80:")) return true;
  if (lower.startsWith("::ffff:")) {
    return isPrivateIpv4(lower.slice(7));
  }
  return false;
}

export function validateFetchableUrl(rawUrl: string): { ok: true; parsed: URL } | { ok: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { ok: false, error: `Invalid URL: '${rawUrl}'` };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      error: `Unsupported URL protocol '${parsed.protocol}'; only http and https are allowed`,
    };
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !host ||
    BLOCKED_HOSTNAMES.has(host) ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return { ok: false, error: `Blocked private/internal host '${host}'` };
  }

  const ipType = net.isIP(host);
  if (ipType === 4 && isPrivateIpv4(host)) {
    return { ok: false, error: `Blocked private IPv4 address '${host}'` };
  }
  if (ipType === 6 && isPrivateIpv6(host)) {
    return { ok: false, error: `Blocked private IPv6 address '${host}'` };
  }

  return { ok: true, parsed };
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, dec: string) => {
      const code = Number(dec);
      return Number.isFinite(code) && code > 0 && code < 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code < 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    });
}

function extractMetaContent(html: string, attrName: string, attrValue: string): string | undefined {
  const metaTagRe = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  const target = attrValue.toLowerCase();

  while ((match = metaTagRe.exec(html)) !== null) {
    const tag = match[0];
    const nameMatch = new RegExp(
      `\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
      "i"
    ).exec(tag);
    const actual = (nameMatch?.[1] ?? nameMatch?.[2] ?? nameMatch?.[3] ?? "")
      .trim()
      .toLowerCase();
    if (actual !== target) continue;

    const contentMatch = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const value = (contentMatch?.[1] ?? contentMatch?.[2] ?? contentMatch?.[3] ?? "").trim();
    if (value) {
      return decodeHtmlEntities(value);
    }
  }
  return undefined;
}

export function extractHtmlContent(
  html: string,
  baseUrl: string
): {
  title?: string;
  description?: string;
  text: string;
  image_urls: string[];
} {
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title =
    decodeHtmlEntities(titleMatch?.[1] ?? "").replace(/\s+/g, " ").trim() ||
    extractMetaContent(html, "property", "og:title");

  const description =
    extractMetaContent(html, "name", "description") ??
    extractMetaContent(html, "property", "og:description");

  const imageSet = new Set<string>();
  const addImageCandidate = (raw: string | undefined): void => {
    if (!raw || imageSet.size >= MAX_IMAGE_URLS) return;
    const trimmed = raw.trim();
    if (
      !trimmed ||
      trimmed.startsWith("data:") ||
      trimmed.startsWith("javascript:")
    ) {
      return;
    }
    try {
      const resolved = new URL(trimmed, baseUrl);
      if (resolved.protocol === "http:" || resolved.protocol === "https:") {
        imageSet.add(resolved.href);
      }
    } catch {
      // Ignore malformed image URLs.
    }
  };

  addImageCandidate(extractMetaContent(html, "property", "og:image"));
  addImageCandidate(extractMetaContent(html, "name", "twitter:image"));

  const imgRe = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let imgMatch: RegExpExecArray | null;
  while ((imgMatch = imgRe.exec(html)) !== null && imageSet.size < MAX_IMAGE_URLS) {
    addImageCandidate(imgMatch[1] ?? imgMatch[2] ?? imgMatch[3]);
  }

  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/?(p|div|section|article|header|footer|main|li|h[1-6]|br|tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  const decoded = decodeHtmlEntities(stripped)
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();

  const text =
    decoded.length > MAX_TEXT_CHARS
      ? `${decoded.slice(0, MAX_TEXT_CHARS)}... [truncated]`
      : decoded;

  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    text,
    image_urls: Array.from(imageSet),
  };
}

async function readLimitedText(
  response: globalThis.Response,
  maxBytes: number
): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    return text.slice(0, maxBytes);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = maxBytes - total;
      if (value.byteLength <= remaining) {
        chunks.push(value);
        total += value.byteLength;
      } else {
        chunks.push(value.subarray(0, remaining));
        total += remaining;
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
}

export async function fetchUrlContent(
  rawUrl: string,
  externalSignal?: AbortSignal,
  fetchImpl: typeof fetch = fetch
): Promise<FetchUrlResult> {
  const checked = validateFetchableUrl(rawUrl);
  if (!checked.ok) {
    return { url: rawUrl, ok: false, error: checked.error };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  timer.unref?.();

  const onExternalAbort = (): void => controller.abort();
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

  try {
    const response = await fetchImpl(checked.parsed.href, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "MyBrandBootAgent/1.0 (+https://mybrand.local)",
        Accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5",
      },
    });

    if (!response.ok) {
      return {
        url: checked.parsed.href,
        ok: false,
        status: response.status,
        error: `HTTP ${response.status} ${response.statusText}`,
      };
    }

    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    const body = await readLimitedText(response, MAX_RESPONSE_BYTES);

    if (
      contentType.includes("text/html") ||
      contentType.includes("application/xhtml") ||
      body.trimStart().startsWith("<")
    ) {
      const extracted = extractHtmlContent(body, response.url || checked.parsed.href);
      return {
        url: response.url || checked.parsed.href,
        ok: true,
        status: response.status,
        ...extracted,
      };
    }

    const plainText = body.replace(/\s+/g, " ").trim();
    return {
      url: response.url || checked.parsed.href,
      ok: true,
      status: response.status,
      text:
        plainText.length > MAX_TEXT_CHARS
          ? `${plainText.slice(0, MAX_TEXT_CHARS)}... [truncated]`
          : plainText,
      image_urls: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      url: checked.parsed.href,
      ok: false,
      error: message,
    };
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}
