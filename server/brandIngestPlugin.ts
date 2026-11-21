import { loadEnv, type Plugin } from 'vite';
import type {
  GarmentAssetSet,
  LightingPreset,
  RackPlacement,
  StoreConfig,
  StorePalette,
} from '../src/types/storeConfig';

export type IngestSourceType = 'shopify' | 'jsonld' | 'html_meta';

export interface IngestUrlResponsePayload {
  storeConfig: StoreConfig;
  rawProductCount: number;
  sourceType: IngestSourceType;
  usedGemini: boolean;
}

interface ScrapedProductCandidate {
  id: string;
  handle: string;
  sku: string;
  title: string;
  subtitle: string;
  price: number;
  frontImageUrl: string;
  rearImageUrl?: string;
  productType: string;
  tags: string[];
  vendor?: string;
  wearableScore: number;
}

interface ParsedHtmlMetadata {
  title: string;
  siteName: string;
  ogTitle: string;
  description: string;
  themeColor?: string;
  ogImage?: string;
  hexPalette: string[];
  jsonLdProducts: ScrapedProductCandidate[];
  htmlImgProducts: ScrapedProductCandidate[];
}

interface CachedProxyImage {
  bytes: Uint8Array;
  contentType: string;
  cachedAt: number;
}

interface MinimalReq {
  method?: string;
  url?: string;
  on(event: 'data', listener: (chunk: Uint8Array | string) => void): void;
  on(event: 'end', listener: () => void): void;
  on(event: 'error', listener: (err: unknown) => void): void;
}

interface MinimalRes {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(data?: Uint8Array | string): void;
}

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const IMAGE_CACHE = new Map<string, CachedProxyImage>();
const MAX_IMAGE_CACHE_ENTRIES = 64;
const IMAGE_CACHE_TTL_MS = 60 * 60 * 1000;

const VALID_LIGHTING_PRESETS: ReadonlySet<LightingPreset> = new Set<LightingPreset>([
  'warm_court_sunlight',
  'cool_gallery_spot',
  'kyoto_golden_hour',
]);

function readRuntimeEnv(viteEnv: Record<string, string>): Record<string, string | undefined> {
  const procEnv =
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  return { ...viteEnv, ...procEnv };
}

function isDisallowedHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  if (!h) return true;
  if (
    h === 'localhost' ||
    h === '0.0.0.0' ||
    h === '[::1]' ||
    h === '::1' ||
    h.endsWith('.local') ||
    h.endsWith('.internal')
  ) {
    return true;
  }
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) {
    return true;
  }
  const m172 = h.match(/^172\.(\d+)\./);
  if (m172) {
    const second = Number(m172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

function normalizeExternalUrl(rawInput: string): URL {
  let trimmed = rawInput.trim().replace(/^['"<]+|['">]+$/g, '');
  if (!trimmed) {
    throw new Error('Please enter a store or brand website URL.');
  }
  if (trimmed.startsWith('//')) {
    trimmed = `https:${trimmed}`;
  } else if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid URL "${rawInput}". Try a domain like kotn.com or rowingblazers.com.`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// and https:// URLs are supported.');
  }
  if (isDisallowedHost(parsed.hostname)) {
    throw new Error('Local or private network URLs are not permitted.');
  }
  if (!parsed.hostname.includes('.')) {
    throw new Error(`"${parsed.hostname}" does not look like a public website domain.`);
  }

  return parsed;
}

function resolveCandidateImageUrl(rawSrc: string | undefined | null, baseOrigin: string): string | null {
  if (!rawSrc || typeof rawSrc !== 'string') return null;
  let cleaned = decodeHtmlEntities(rawSrc.trim());
  if (!cleaned || cleaned.startsWith('data:')) return null;
  if (cleaned.startsWith('//')) {
    cleaned = `https:${cleaned}`;
  }
  try {
    const resolved = new URL(cleaned, baseOrigin);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    if (isDisallowedHost(resolved.hostname)) return null;
    if (/\.svg(\?|$)/i.test(resolved.pathname)) return null;
    if (/no[-_]?image|placeholder|blank\.gif|spacer\.gif|1x1/i.test(resolved.href)) return null;

    // Cap oversized Shopify CDN images to 1080px width for fast proxy streaming & crisp 720px CIELAB cutouts
    if (
      (resolved.hostname.includes('cdn.shopify.com') || resolved.pathname.includes('/cdn/shop/')) &&
      !resolved.searchParams.has('width')
    ) {
      resolved.searchParams.set('width', '1080');
    }

    return resolved.toString();
  } catch {
    return null;
  }
}

function toProxyImageUrl(remoteUrl: string): string {
  return `/api/proxy-image?url=${encodeURIComponent(remoteUrl)}`;
}

function decodeHtmlEntities(input: string): string {
  if (!input) return '';
  return input
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&ndash;|&#8211;/gi, '–')
    .replace(/&mdash;|&#8212;/gi, '—')
    .replace(/&times;/gi, '×')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) && code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtmlTags(input: string): string {
  return decodeHtmlEntities(input.replace(/<[^>]*>/g, ' '));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'item';
}

function parsePriceNumber(raw: unknown, fallback = 78): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.round(raw * 100) / 100;
  }
  if (typeof raw === 'string') {
    const cleaned = raw.replace(/[^0-9.]/g, '');
    const parsed = Number.parseFloat(cleaned);
    if (Number.isFinite(parsed) && parsed > 0 && parsed < 50000) {
      return Math.round(parsed * 100) / 100;
    }
  }
  return fallback;
}

const EXCLUDED_PRODUCT_RE =
  /\b(gift[-_ ]?card|e-gift|shipping[-_ ]?protection|package[-_ ]?protection|navidium|corso|route[-_ ]?protect|donation|mystery[-_ ]?box|warranty|digital[-_ ]?download)\b/i;

const UPPER_GARMENT_RE =
  /\b(tee|t-shirt|tshirt|shirt|overshirt|polo|sweater|cardigan|hoodie|sweatshirt|fleece|pullover|crewneck|longsleeve|long-sleeve|long\s+sleeve|jacket|coat|blazer|parka|anorak|windbreaker|vest|gilet|jersey|henley|knit|knitwear|top|blouse|tunic|flannel|oxford|rugby|sherpa|quarter[-_ ]?zip|half[-_ ]?zip)\b/i;

const FULL_BODY_GARMENT_RE = /\b(dress|jumpsuit|romper|kimono|robe|overalls)\b/i;

const LOWER_APPAREL_RE =
  /\b(pant|pants|trouser|trousers|jean|jeans|denim|short|shorts|chino|cargo|skirt|jogger|sweatpant)\b/i;

const NON_HANGING_ACCESSORY_RE =
  /\b(shoe|shoes|sneaker|sneakers|boot|boots|loafer|sandal|slide|hat|cap|beanie|bucket|sock|socks|bag|tote|backpack|duffel|wallet|belt|glove|gloves|scarf|throw|blanket|towel|pillow|cushion|keychain|fingerboard|sticker|pin|bottle|mug|candle|fragrance|perfume|sunglass|sunglasses|watch|jewelry|ring|necklace|bracelet|earring|lemonade|drink)\b/i;

function computeWearableScore(
  title: string,
  productType: string,
  tags: string[],
  handle: string
): number | null {
  const combined = `${title} ${productType} ${tags.join(' ')} ${handle}`;
  if (EXCLUDED_PRODUCT_RE.test(combined)) {
    return null;
  }

  let score = 40;
  const primaryText = `${title} ${productType}`;

  if (NON_HANGING_ACCESSORY_RE.test(primaryText)) {
    score -= 35;
  } else if (UPPER_GARMENT_RE.test(primaryText)) {
    score += 95;
  } else if (FULL_BODY_GARMENT_RE.test(primaryText)) {
    score += 65;
  } else if (LOWER_APPAREL_RE.test(primaryText)) {
    score += 25;
  } else if (UPPER_GARMENT_RE.test(combined)) {
    score += 55;
  }

  // Slight bonus for iconic boutique hanging silhouettes (tees, sweaters, polos, jackets, hoodies, cardigans)
  if (/\b(tee|t-shirt|sweater|cardigan|polo|hoodie|jacket|shirt|longsleeve|blazer)\b/i.test(title)) {
    score += 18;
  }

  return score;
}

function scoreImageShotQuality(src: string, alt: string, index: number, width?: number, height?: number): number {
  let score = 100 - index * 5;
  const hay = `${src} ${alt}`.toLowerCase();

  if (/embroidery|swatch|detail|closeup|close-up|zoom|label|neck[-_]?tag|size[-_]?chart|diagram|banner|badge|logo/.test(hay)) {
    score -= 65;
  }
  if (/flat[-_]?lay|packshot|ghost|still[-_]?life|product[-_]?shot|[_-]front\b|ecom/.test(hay)) {
    score += 28;
  }
  if (/[_-]back\b|rear[-_]?view/.test(hay) && index > 0) {
    score -= 10; // Save rear shot for rearImageUrl rather than primary front
  }
  if (width && height && height > 0) {
    const aspect = width / height;
    if (aspect > 1.8 || width < 180 || height < 180) {
      score -= 35;
    }
  }
  return score;
}

function pickBestFrontAndRearImages(
  images: Array<{ src: string; alt?: string; width?: number; height?: number }>,
  baseOrigin: string
): { frontImageUrl: string | null; rearImageUrl?: string } {
  const valid = images
    .map((img, idx) => {
      const resolved = resolveCandidateImageUrl(img.src, baseOrigin);
      if (!resolved) return null;
      return {
        url: resolved,
        alt: img.alt ?? '',
        idx,
        frontScore: scoreImageShotQuality(resolved, img.alt ?? '', idx, img.width, img.height),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (valid.length === 0) {
    return { frontImageUrl: null };
  }

  const sortedForFront = [...valid].sort((a, b) => b.frontScore - a.frontScore);
  const front = sortedForFront[0];

  let rearImageUrl: string | undefined;
  const remaining = valid.filter((c) => c.url !== front.url);
  if (remaining.length > 0) {
    const sortedForRear = [...remaining].sort((a, b) => {
      const aBack = /[_-]back\b|rear|reverse/i.test(`${a.url} ${a.alt}`) ? 40 : 0;
      const bBack = /[_-]back\b|rear|reverse/i.test(`${b.url} ${b.alt}`) ? 40 : 0;
      return bBack + b.frontScore - (aBack + a.frontScore);
    });
    rearImageUrl = sortedForRear[0].url;
  }

  return { frontImageUrl: front.url, rearImageUrl };
}

interface ShopifyJsonProduct {
  id?: number | string;
  title?: string;
  handle?: string;
  vendor?: string;
  product_type?: string;
  tags?: string[] | string;
  variants?: Array<{
    id?: number | string;
    sku?: string;
    price?: string | number;
    title?: string;
    available?: boolean;
  }>;
  images?: Array<{
    src?: string;
    alt?: string | null;
    width?: number;
    height?: number;
  }>;
}

function parseShopifyProductsJson(
  payload: unknown,
  baseOrigin: string
): ScrapedProductCandidate[] {
  if (!payload || typeof payload !== 'object') return [];
  const obj = payload as { products?: unknown; product?: unknown };

  const rawList: ShopifyJsonProduct[] = Array.isArray(obj.products)
    ? (obj.products as ShopifyJsonProduct[])
    : obj.product && typeof obj.product === 'object'
      ? [obj.product as ShopifyJsonProduct]
      : [];

  const candidates: ScrapedProductCandidate[] = [];

  for (let i = 0; i < rawList.length; i++) {
    const p = rawList[i];
    const title = decodeHtmlEntities(String(p.title ?? '').trim());
    if (!title) continue;

    const handle = String(p.handle ?? slugify(title));
    const productType = decodeHtmlEntities(String(p.product_type ?? '').trim());
    const tags: string[] = Array.isArray(p.tags)
      ? p.tags.map((t) => String(t).trim()).filter(Boolean)
      : typeof p.tags === 'string'
        ? p.tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : [];

    const wearableScore = computeWearableScore(title, productType, tags, handle);
    if (wearableScore === null) continue;

    const rawImages = Array.isArray(p.images)
      ? p.images
          .filter((img): img is NonNullable<typeof img> & { src: string } => Boolean(img?.src))
          .map((img) => ({
            src: img.src,
            alt: img.alt ?? undefined,
            width: img.width,
            height: img.height,
          }))
      : [];

    const { frontImageUrl, rearImageUrl } = pickBestFrontAndRearImages(rawImages, baseOrigin);
    if (!frontImageUrl) continue;

    const firstVariant = Array.isArray(p.variants) && p.variants.length > 0 ? p.variants[0] : undefined;
    const price = parsePriceNumber(firstVariant?.price, 85);
    const vendor = p.vendor ? decodeHtmlEntities(String(p.vendor).trim()) : undefined;
    const skuRaw = firstVariant?.sku ? String(firstVariant.sku).trim() : '';
    const sku = skuRaw || `${slugify(vendor || 'BRD').slice(0, 4).toUpperCase()}-${String(i + 1).padStart(2, '0')}`;

    const subtitleParts = [vendor, productType || tags[0]].filter(Boolean);
    const subtitle = subtitleParts.length > 0 ? subtitleParts.join(' · ') : 'Curated Brand Capsule';

    candidates.push({
      id: `ingested-${slugify(handle)}-${i}`,
      handle,
      sku,
      title,
      subtitle,
      price,
      frontImageUrl,
      rearImageUrl,
      productType,
      tags,
      vendor,
      wearableScore: wearableScore - i * 0.4,
    });
  }

  return candidates;
}

function normalizeStyleSignature(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+(in|-\s*|\/\s*)[a-z0-9 /,&-]+$/i, '')
    .replace(/\b(black|white|navy|blue|red|green|olive|sage|cream|ecru|oat|taupe|charcoal|grey|gray|brown|tan|pink|rose|yellow|orange|multi|natural|bark|oak)\b/gi, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function selectDiverseTopCandidates(
  candidates: ScrapedProductCandidate[],
  maxCount = 4
): ScrapedProductCandidate[] {
  if (candidates.length <= maxCount) {
    return [...candidates].sort((a, b) => b.wearableScore - a.wearableScore);
  }

  const sorted = [...candidates].sort((a, b) => b.wearableScore - a.wearableScore);
  const picked: ScrapedProductCandidate[] = [];
  const seenImages = new Set<string>();
  const seenSignatures = new Set<string>();

  // Pass 1: maximize silhouette diversity across top-scoring wearable items
  for (const item of sorted) {
    if (picked.length >= maxCount) break;
    if (seenImages.has(item.frontImageUrl)) continue;
    const sig = normalizeStyleSignature(item.title);
    if (sig && seenSignatures.has(sig)) continue;
    picked.push(item);
    seenImages.add(item.frontImageUrl);
    if (sig) seenSignatures.add(sig);
  }

  // Pass 2: fill remaining slots if brand has fewer unique style bases
  for (const item of sorted) {
    if (picked.length >= maxCount) break;
    if (seenImages.has(item.frontImageUrl)) continue;
    if (picked.some((p) => p.id === item.id)) continue;
    picked.push(item);
    seenImages.add(item.frontImageUrl);
  }

  return picked;
}

function extractMetaTag(html: string, attrValuePattern: string): string {
  const re1 = new RegExp(
    `<meta[^>]+(?:property|name)=["'](?:${attrValuePattern})["'][^>]+content=["']([^"']+)["'][^>]*>`,
    'i'
  );
  const m1 = html.match(re1);
  if (m1?.[1]) return decodeHtmlEntities(m1[1]);

  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:${attrValuePattern})["'][^>]*>`,
    'i'
  );
  const m2 = html.match(re2);
  if (m2?.[1]) return decodeHtmlEntities(m2[1]);

  return '';
}

function normalizeHexColor(raw: string | undefined | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const m6 = trimmed.match(/^#([0-9a-fA-F]{6})$/);
  if (m6) return `#${m6[1].toUpperCase()}`;
  const m3 = trimmed.match(/^#([0-9a-fA-F]{3})$/);
  if (m3) {
    const [r, g, b] = m3[1].toUpperCase().split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return null;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = normalizeHexColor(hex) ?? '#F3EFE6';
  const n = Number.parseInt(clean.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

function getColorMetrics(hex: string): { lum: number; sat: number; r: number; g: number; b: number } {
  const [r, g, b] = hexToRgb(hex);
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const d = max - min;
  const lHsl = (max + min) / 2;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * lHsl - 1));
  return { lum, sat, r, g, b };
}

function mixHex(hexA: string, hexB: string, weightB: number): string {
  const [r1, g1, b1] = hexToRgb(hexA);
  const [r2, g2, b2] = hexToRgb(hexB);
  const w = Math.max(0, Math.min(1, weightB));
  return rgbToHex(r1 * (1 - w) + r2 * w, g1 * (1 - w) + g2 * w, b1 * (1 - w) + b2 * w);
}

function extractCssHexPalette(html: string, themeColor?: string): string[] {
  const scores = new Map<string, number>();

  const bump = (rawHex: string, points: number) => {
    const norm = normalizeHexColor(rawHex);
    if (!norm) return;
    // De-emphasize generic pure black/white browser resets unless strongly repeated
    const { lum, sat } = getColorMetrics(norm);
    const genericPenalty =
      norm === '#FFFFFF' || norm === '#000000'
        ? 0.2
        : lum > 0.985 || lum < 0.02
          ? 0.45
          : sat > 0.18
            ? 1.35
            : 1.0;
    scores.set(norm, (scores.get(norm) ?? 0) + points * genericPenalty);
  };

  if (themeColor) {
    bump(themeColor, 40);
  }

  // Extract inline <style> blocks + style attributes (cap scan length so giant 3MB SSR bundles parse in <5ms)
  const styleBlocks: string[] = [];
  const styleBlockRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let match: RegExpExecArray | null;
  while ((match = styleBlockRe.exec(html)) !== null && styleBlocks.length < 24) {
    styleBlocks.push(match[1].slice(0, 60000));
  }
  const combinedCss = styleBlocks.join('\n');

  // High-signal brand custom properties (--color-*, --primary*, --accent*, --bg*, --brand*)
  const varRe = /--(?:color|primary|accent|brand|bg|background|surface|theme)[a-z0-9-_]*\s*:\s*(#[0-9a-fA-F]{3,6})\b/gi;
  let vm: RegExpExecArray | null;
  while ((vm = varRe.exec(combinedCss)) !== null) {
    bump(vm[1], 18);
  }

  // Background-color & color declarations
  const bgPropRe = /(?:background-color|background)\s*:\s*(#[0-9a-fA-F]{3,6})\b/gi;
  let bm: RegExpExecArray | null;
  while ((bm = bgPropRe.exec(combinedCss)) !== null) {
    bump(bm[1], 10);
  }

  // General hex tokens across inline styles
  const anyHexRe = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
  let hm: RegExpExecArray | null;
  let count = 0;
  const cssOrHead = combinedCss || html.slice(0, 120000);
  while ((hm = anyHexRe.exec(cssOrHead)) !== null && count < 400) {
    bump(`#${hm[1]}`, 2);
    count++;
  }

  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([hex]) => hex);

  // Deduplicate perceptually very close hexes so the palette has distinct swatches
  const distinct: string[] = [];
  for (const candidate of ranked) {
    if (distinct.length >= 10) break;
    const [r1, g1, b1] = hexToRgb(candidate);
    const tooClose = distinct.some((existing) => {
      const [r2, g2, b2] = hexToRgb(existing);
      return Math.hypot(r1 - r2, g1 - g2, b1 - b2) < 24;
    });
    if (!tooClose) {
      distinct.push(candidate);
    }
  }

  return distinct;
}

function extractJsonLdProducts(html: string, baseOrigin: string): ScrapedProductCandidate[] {
  const results: ScrapedProductCandidate[] = [];
  const scriptRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  const visitNode = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visitNode(item);
      return;
    }

    const obj = node as Record<string, unknown>;
    if (obj['@graph']) visitNode(obj['@graph']);
    if (obj.mainEntity) visitNode(obj.mainEntity);

    const rawType = obj['@type'];
    const typeStr = Array.isArray(rawType) ? rawType.join(' ') : String(rawType ?? '');

    if (/ItemList/i.test(typeStr) && Array.isArray(obj.itemListElement)) {
      for (const el of obj.itemListElement) {
        if (el && typeof el === 'object' && 'item' in (el as Record<string, unknown>)) {
          visitNode((el as Record<string, unknown>).item);
        } else {
          visitNode(el);
        }
      }
    }

    if (/Product|ProductGroup/i.test(typeStr)) {
      const title = decodeHtmlEntities(String(obj.name ?? '').trim());
      if (!title) return;

      const rawImages: string[] = [];
      const collectImg = (imgVal: unknown) => {
        if (!imgVal) return;
        if (typeof imgVal === 'string') {
          rawImages.push(imgVal);
        } else if (Array.isArray(imgVal)) {
          for (const sub of imgVal) collectImg(sub);
        } else if (typeof imgVal === 'object') {
          const io = imgVal as Record<string, unknown>;
          if (typeof io.url === 'string') rawImages.push(io.url);
          if (typeof io.contentUrl === 'string') rawImages.push(io.contentUrl);
        }
      };
      collectImg(obj.image);

      const { frontImageUrl, rearImageUrl } = pickBestFrontAndRearImages(
        rawImages.map((src) => ({ src })),
        baseOrigin
      );

      if (frontImageUrl) {
        let price = 88;
        const offers = obj.offers;
        if (offers && typeof offers === 'object') {
          const offerObj = Array.isArray(offers)
            ? (offers[0] as Record<string, unknown> | undefined)
            : (offers as Record<string, unknown>);
          if (offerObj) {
            price = parsePriceNumber(offerObj.price ?? offerObj.lowPrice, 88);
          }
        }

        const category = decodeHtmlEntities(String(obj.category ?? ''));
        const brandObj = obj.brand as Record<string, unknown> | string | undefined;
        const vendor =
          typeof brandObj === 'string'
            ? decodeHtmlEntities(brandObj)
            : brandObj && typeof brandObj.name === 'string'
              ? decodeHtmlEntities(brandObj.name)
              : undefined;

        const wearableScore = computeWearableScore(title, category, [], slugify(title));
        if (wearableScore !== null) {
          results.push({
            id: `ingested-ld-${slugify(title)}-${results.length}`,
            handle: slugify(title),
            sku: typeof obj.sku === 'string' && obj.sku.trim() ? obj.sku.trim() : `LD-${results.length + 1}`,
            title,
            subtitle: [vendor, category].filter(Boolean).join(' · ') || 'Brand Edition',
            price,
            frontImageUrl,
            rearImageUrl,
            productType: category,
            tags: [],
            vendor,
            wearableScore,
          });
        }
      }

      if (Array.isArray(obj.hasVariant)) {
        for (const v of obj.hasVariant) visitNode(v);
      }
    }
  };

  while ((match = scriptRe.exec(html)) !== null) {
    const rawJson = match[1].trim();
    if (!rawJson) continue;
    try {
      const parsed = JSON.parse(rawJson);
      visitNode(parsed);
    } catch {
      // Ignore malformed third-party ld+json snippets
    }
  }

  return results;
}

function extractFallbackHtmlImages(
  html: string,
  baseOrigin: string,
  brandLabel: string,
  ogImage?: string,
  ogTitle?: string
): ScrapedProductCandidate[] {
  const candidates: ScrapedProductCandidate[] = [];
  const seenUrls = new Set<string>();
  const imgTagRe = /<img\b([^>]{1,1200})>/gi;
  let m: RegExpExecArray | null;
  let scanned = 0;

  const getAttr = (attrs: string, name: string): string => {
    const r = new RegExp(`\\b${name}=["']([^"']+)["']`, 'i');
    return attrs.match(r)?.[1] ?? '';
  };

  while ((m = imgTagRe.exec(html)) !== null && scanned < 280) {
    scanned++;
    const attrs = m[1];
    let rawSrc = getAttr(attrs, 'src') || getAttr(attrs, 'data-src') || getAttr(attrs, 'data-srcset');
    if (!rawSrc) {
      const srcset = getAttr(attrs, 'srcset');
      if (srcset) {
        const parts = srcset
          .split(',')
          .map((s) => s.trim().split(/\s+/)[0])
          .filter(Boolean);
        rawSrc = parts[parts.length - 1] ?? '';
      }
    }

    const resolved = resolveCandidateImageUrl(rawSrc, baseOrigin);
    if (!resolved || seenUrls.has(resolved)) continue;

    const alt = decodeHtmlEntities(getAttr(attrs, 'alt'));
    const lowerCheck = `${resolved} ${alt}`.toLowerCase();
    if (
      /logo|icon|sprite|avatar|flag|payment|klarna|paypal|visa|mastercard|amex|badge|spinner|arrow|close|search|cart/.test(
        lowerCheck
      )
    ) {
      continue;
    }

    const wAttr = Number.parseInt(getAttr(attrs, 'width'), 10);
    const hAttr = Number.parseInt(getAttr(attrs, 'height'), 10);
    if ((Number.isFinite(wAttr) && wAttr > 0 && wAttr < 140) || (Number.isFinite(hAttr) && hAttr > 0 && hAttr < 140)) {
      continue;
    }

    let score = 20;
    if (/\/products\/|\/files\/|product|catalog|apparel|garment|packshot|cdn\.shopify/i.test(resolved)) {
      score += 35;
    }
    if (UPPER_GARMENT_RE.test(lowerCheck)) {
      score += 55;
    } else if (FULL_BODY_GARMENT_RE.test(lowerCheck) || LOWER_APPAREL_RE.test(lowerCheck)) {
      score += 30;
    }
    if (alt.length >= 4 && alt.length <= 90) {
      score += 18;
    }

    if (score < 42) continue;

    seenUrls.add(resolved);
    const cleanTitle =
      alt && alt.length >= 3 && !/^image|^photo|^product$/i.test(alt)
        ? alt.slice(0, 72)
        : `${brandLabel} Archive Piece ${String(candidates.length + 1).padStart(2, '0')}`;

    candidates.push({
      id: `ingested-html-${slugify(cleanTitle)}-${candidates.length}`,
      handle: slugify(cleanTitle),
      sku: `WEB-${String(candidates.length + 1).padStart(2, '0')}`,
      title: cleanTitle,
      subtitle: `${brandLabel} · Live Storefront Selection`,
      price: 88 + (candidates.length % 3) * 24,
      frontImageUrl: resolved,
      productType: 'Apparel',
      tags: [],
      vendor: brandLabel,
      wearableScore: score,
    });
  }

  if (candidates.length === 0 && ogImage) {
    const resolvedOg = resolveCandidateImageUrl(ogImage, baseOrigin);
    if (resolvedOg) {
      const cleanTitle =
        ogTitle && ogTitle.length > 2 ? ogTitle.slice(0, 68) : `${brandLabel} Signature Piece`;
      candidates.push({
        id: `ingested-og-${slugify(cleanTitle)}-0`,
        handle: slugify(cleanTitle),
        sku: 'WEB-HERO-01',
        title: cleanTitle,
        subtitle: `${brandLabel} · Featured Release`,
        price: 95,
        frontImageUrl: resolvedOg,
        productType: 'Featured',
        tags: [],
        vendor: brandLabel,
        wearableScore: 50,
      });
    }
  }

  return candidates;
}

function parsePageHtml(html: string, baseOrigin: string, fallbackBrand: string): ParsedHtmlMetadata {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1] ? stripHtmlTags(titleMatch[1]).slice(0, 120) : '';
  const siteName = extractMetaTag(html, 'og:site_name|application-name');
  const ogTitle = extractMetaTag(html, 'og:title|twitter:title');
  const description =
    extractMetaTag(html, 'og:description|description|twitter:description').slice(0, 280);
  const themeColorRaw = extractMetaTag(html, 'theme-color');
  const themeColor = normalizeHexColor(themeColorRaw) ?? undefined;
  const ogImage = extractMetaTag(html, 'og:image|og:image:secure_url|twitter:image') || undefined;

  const hexPalette = extractCssHexPalette(html, themeColor);
  const jsonLdProducts = extractJsonLdProducts(html, baseOrigin);
  const brandLabel = deriveCleanBrandName(baseOrigin, siteName, title);
  const htmlImgProducts =
    jsonLdProducts.length >= 3
      ? []
      : extractFallbackHtmlImages(html, baseOrigin, brandLabel || fallbackBrand, ogImage, ogTitle || title);

  return {
    title,
    siteName,
    ogTitle,
    description,
    themeColor,
    ogImage,
    hexPalette,
    jsonLdProducts,
    htmlImgProducts,
  };
}

function deriveCleanBrandName(originOrHost: string, siteName?: string, pageTitle?: string): string {
  if (siteName && siteName.trim().length >= 2 && siteName.trim().length <= 36) {
    return siteName.trim().toUpperCase();
  }
  if (pageTitle) {
    const segments = pageTitle
      .split(/\s*[|–—•·:]\s*/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && s.length <= 32 && !/home|official|welcome|online store|shop/i.test(s));
    if (segments.length > 0) {
      // Often brand name is either the shortest clean segment or first/last segment
      const best = segments.sort((a, b) => a.length - b.length)[0];
      if (best && best.length <= 26) {
        return best.toUpperCase();
      }
    }
  }
  try {
    const host = new URL(originOrHost).hostname.replace(/^(www|shop|store|us|uk|eu)\./i, '');
    const root = host.split('.')[0] ?? 'ATELIER';
    return root.replace(/[-_]+/g, ' ').toUpperCase();
  } catch {
    return 'BRAND ATELIER';
  }
}

type BrandArchetype = 'dark_streetwear' | 'vibrant_sporty' | 'heritage_luxury' | 'warm_minimalist';

interface SynthesizedBrandDna {
  brandName: string;
  tagline: string;
  vibe: string;
  palette: StorePalette;
  metalRoughness: number;
  metalness: number;
  lightingPreset: LightingPreset;
  architectNotes: string[];
  heroItemIndices?: number[];
}

function synthesizeHeuristicBrandDna(
  targetUrl: URL,
  meta: ParsedHtmlMetadata,
  products: ScrapedProductCandidate[]
): SynthesizedBrandDna {
  const brandName = deriveCleanBrandName(
    targetUrl.origin,
    meta.siteName || products[0]?.vendor,
    meta.ogTitle || meta.title
  );

  const corpus = [
    targetUrl.hostname,
    meta.title,
    meta.description,
    ...products.slice(0, 8).map((p) => `${p.title} ${p.productType} ${p.tags.join(' ')}`),
  ]
    .join(' ')
    .toLowerCase();

  // Inspect scraped hex colors for dark backgrounds, vibrant accents, heritage deep tones, or warm earth neutrals
  const darkHex = meta.hexPalette.find((h) => {
    const m = getColorMetrics(h);
    return m.lum >= 0.04 && m.lum <= 0.24;
  });
  const vibrantHex = meta.hexPalette.find((h) => {
    const m = getColorMetrics(h);
    return m.sat >= 0.42 && m.lum >= 0.18 && m.lum <= 0.76;
  });
  const midEarthOrDeepHex = meta.hexPalette.find((h) => {
    const m = getColorMetrics(h);
    return m.sat >= 0.14 && m.lum >= 0.14 && m.lum <= 0.62;
  });
  const lightWallHex = meta.hexPalette.find((h) => {
    const m = getColorMetrics(h);
    return m.lum >= 0.82 && m.lum <= 0.97;
  });

  const streetHits = (
    corpus.match(/\b(streetwear|skate|drop|fleece|hoodie|graphic|kith|stussy|palace|supreme|concrete|tokyo|shibuya|sneaker|cargo|heavyweight)\b/g) ?? []
  ).length;
  const sportyHits = (
    corpus.match(/\b(golf|sport|track|run|running|athletic|tennis|court|active|outdoor|club|jersey|wang|color|pop|varsity)\b/g) ?? []
  ).length;
  const heritageHits = (
    corpus.match(/\b(rowing|blazer|blazers|cashmere|tailored|heritage|ivy|oxford|rugby|tweed|bespoke|savile|crest|polo|archive|merino|luxury)\b/g) ?? []
  ).length;
  const minimalHits = (
    corpus.match(/\b(organic|linen|egyptian|sustainable|minimal|minimalist|kotn|atelier|craft|natural|undyed|earth|essential|essentials|studio|knit)\b/g) ?? []
  ).length;

  let archetype: BrandArchetype = 'warm_minimalist';
  if (
    (meta.themeColor && getColorMetrics(meta.themeColor).lum < 0.2) ||
    streetHits >= Math.max(sportyHits, heritageHits, minimalHits) && streetHits >= 2
  ) {
    archetype = 'dark_streetwear';
  } else if (heritageHits >= Math.max(sportyHits, minimalHits) && heritageHits >= 2) {
    archetype = 'heritage_luxury';
  } else if (sportyHits >= minimalHits && (sportyHits >= 2 || Boolean(vibrantHex))) {
    archetype = 'vibrant_sporty';
  } else if (minimalHits >= 1) {
    archetype = 'warm_minimalist';
  } else if (vibrantHex) {
    archetype = 'vibrant_sporty';
  } else if (darkHex && !lightWallHex) {
    archetype = 'dark_streetwear';
  }

  const hostLabel = targetUrl.hostname.replace(/^www\./i, '');

  if (archetype === 'dark_streetwear') {
    const wall = darkHex ? mixHex('#282A2E', darkHex, 0.35) : '#282A2E';
    const floor = mixHex('#1B1C1F', wall, 0.2);
    const accent = vibrantHex ?? midEarthOrDeepHex ?? '#FF4D00';
    const secondaryAccent = mixHex(wall, '#52565E', 0.32);
    return {
      brandName,
      tagline: `LIVE STOREFRONT CAPSULE // ${hostLabel.toUpperCase()}`,
      vibe: 'Monolithic gallery concrete, industrial brushed chrome & high-contrast drop lighting',
      palette: {
        wall,
        floor,
        accent,
        secondaryAccent,
        rackMetal: '#D8DCE2',
        hangerWood: '#222326',
        plinth: mixHex(floor, '#2F3237', 0.45),
        rug: mixHex(floor, accent, 0.08),
        ambientLight: '#DCE5F2',
        spotLight: '#F4F7FF',
      },
      metalRoughness: 0.16,
      metalness: 0.95,
      lightingPreset: 'cool_gallery_spot',
      architectNotes: [
        `Synthesized monolithic gallery concrete (${wall}) and dark aggregate flooring (${floor}) from ${hostLabel}'s streetwear/drop profile.`,
        `Anchored the recessed hero arch with brand accent (${accent}) for crisp silhouette separation behind hanging garments.`,
        `Specified precision brushed chrome rails (#D8DCE2) and matte ebonized ash hangers (#222326) under 5000K track spots.`,
      ],
    };
  }

  if (archetype === 'vibrant_sporty') {
    const accent = vibrantHex ?? midEarthOrDeepHex ?? '#2D6A4F';
    const wall = lightWallHex ? mixHex('#F4F1EA', lightWallHex, 0.45) : mixHex('#F4F1EA', accent, 0.05);
    const floor = mixHex('#DFD8CA', wall, 0.25);
    return {
      brandName,
      tagline: `SEASONAL GRAPHIC & SPORT ARCHIVE // ${hostLabel.toUpperCase()}`,
      vibe: 'Sunlit architectural pop showroom with saturated color-blocked alcove & satin brass',
      palette: {
        wall,
        floor,
        accent,
        secondaryAccent: mixHex(wall, accent, 0.14),
        rackMetal: '#CBB279',
        hangerWood: '#A87C4F',
        plinth: mixHex('#E8E1D3', accent, 0.08),
        rug: mixHex('#D7CFC0', accent, 0.12),
        ambientLight: '#FFF9F0',
        spotLight: '#FFF4E2',
      },
      metalRoughness: 0.24,
      metalness: 0.88,
      lightingPreset: 'warm_court_sunlight',
      architectNotes: [
        `Extracted high-chroma brand accent (${accent}) from ${hostLabel} into the central fluted feature alcove against sunlit chalk plaster (${wall}).`,
        `Balanced expressive apparel graphics with honed warm stone flooring (${floor}) and sculpted beechwood hangers (#A87C4F).`,
        `Calibrated warm daylight court spots to preserve true graphic ink saturation across front and 360° back cloth shells.`,
      ],
    };
  }

  if (archetype === 'heritage_luxury') {
    const accent = midEarthOrDeepHex ?? vibrantHex ?? '#23395B';
    const wall = lightWallHex ? mixHex('#F2EDE2', lightWallHex, 0.4) : '#F2EDE2';
    const floor = '#CFC2AE';
    return {
      brandName,
      tagline: `HERITAGE CLUBHOUSE & TAILORED ARCHIVE // ${hostLabel.toUpperCase()}`,
      vibe: 'Collegiate limestone & travertine club salon with antique brass hardware and walnut',
      palette: {
        wall,
        floor,
        accent,
        secondaryAccent: mixHex(wall, '#D8CCB8', 0.5),
        rackMetal: '#C5A059',
        hangerWood: '#6B442A',
        plinth: '#E3DAC6',
        rug: '#C9BFA9',
        ambientLight: '#FFF8EE',
        spotLight: '#FFF3DF',
      },
      metalRoughness: 0.27,
      metalness: 0.86,
      lightingPreset: 'warm_court_sunlight',
      architectNotes: [
        `Translated ${hostLabel}'s tailored club sensibility into warm Venetian limestone (${wall}) and a deep ${accent} architectural arch.`,
        `Paired brushed antique brass faceout rails (#C5A059) with rich American walnut hangers (#6B442A) for Savile/Ivy warmth.`,
        `Grounded the center stand on honed Roman travertine (${floor}) under warm 3400K gallery sunlight.`,
      ],
    };
  }

  // Default: 'warm_minimalist' (Organic Linen, Earth Plaster & Hinoki Sanctuary)
  const accent = midEarthOrDeepHex ?? vibrantHex ?? '#6B705C';
  const wall = lightWallHex ? mixHex('#EAE1D3', lightWallHex, 0.4) : '#EAE1D3';
  const floor = '#C5A787';
  return {
    brandName,
    tagline: `ORGANIC TEXTILE & FORM STUDY // ${hostLabel.toUpperCase()}`,
    vibe: 'Quiet luxury tactile clay plaster, natural timber flooring & blackened bronze',
    palette: {
      wall,
      floor,
      accent,
      secondaryAccent: mixHex(wall, '#D8C8B2', 0.45),
      rackMetal: '#3A3532',
      hangerWood: '#C89F70',
      plinth: '#DACBB4',
      rug: '#D4C7B4',
      ambientLight: '#FFEBD2',
      spotLight: '#FFDCA8',
    },
    metalRoughness: 0.42,
    metalness: 0.78,
    lightingPreset: 'kyoto_golden_hour',
    architectNotes: [
      `Distilled ${hostLabel}'s tactile material palette into hand-troweled sand plaster (${wall}) and natural cedar plank flooring (${floor}).`,
      `Framed the hero garment stand with a muted ${accent} slatted alcove and hand-patinated blackened bronze rails (#3A3532).`,
      `Bathed organic knitwear and cotton weaves in 2900K golden-hour grazing light to accentuate Sobel micro-fold normals.`,
    ],
  };
}

function sanitizeStorePalette(raw: Partial<StorePalette> | undefined, fallback: StorePalette): StorePalette {
  if (!raw || typeof raw !== 'object') return fallback;
  return {
    wall: normalizeHexColor(raw.wall) ?? fallback.wall,
    floor: normalizeHexColor(raw.floor) ?? fallback.floor,
    accent: normalizeHexColor(raw.accent) ?? fallback.accent,
    secondaryAccent: normalizeHexColor(raw.secondaryAccent) ?? fallback.secondaryAccent,
    rackMetal: normalizeHexColor(raw.rackMetal) ?? fallback.rackMetal,
    hangerWood: normalizeHexColor(raw.hangerWood) ?? fallback.hangerWood,
    plinth: normalizeHexColor(raw.plinth) ?? fallback.plinth,
    rug: normalizeHexColor(raw.rug) ?? fallback.rug,
    ambientLight: normalizeHexColor(raw.ambientLight) ?? fallback.ambientLight,
    spotLight: normalizeHexColor(raw.spotLight) ?? fallback.spotLight,
  };
}

async function trySynthesizeWithGemini(
  apiKey: string,
  model: string,
  targetUrl: URL,
  meta: ParsedHtmlMetadata,
  candidates: ScrapedProductCandidate[],
  fallbackDna: SynthesizedBrandDna
): Promise<SynthesizedBrandDna | null> {
  const promptPayload = {
    websiteUrl: targetUrl.toString(),
    siteName: meta.siteName,
    pageTitle: meta.title,
    description: meta.description,
    themeColor: meta.themeColor,
    scrapedCssHexColors: meta.hexPalette,
    candidateProducts: candidates.slice(0, 10).map((c, idx) => ({
      index: idx,
      title: c.title,
      type: c.productType,
      price: c.price,
      tags: c.tags.slice(0, 5),
    })),
  };

  const systemInstruction = `You are the Gemini 4 Spatial Retail Brand Architect. Given scraped website metadata, CSS hex colors, and real catalog items, design a bespoke 3D luxury retail boutique room JSON matching this exact schema:
{
  "brandName": "UPPERCASE DISPLAY NAME",
  "tagline": "CONCISE EDITORIAL ARCHIVE TAGLINE",
  "vibe": "1-sentence architectural interior description",
  "lightingPreset": "warm_court_sunlight" | "cool_gallery_spot" | "kyoto_golden_hour",
  "metalRoughness": number between 0.14 and 0.48,
  "metalness": number between 0.74 and 0.96,
  "palette": {
    "wall": "#RRGGBB",
    "floor": "#RRGGBB",
    "accent": "#RRGGBB",
    "secondaryAccent": "#RRGGBB",
    "rackMetal": "#RRGGBB",
    "hangerWood": "#RRGGBB",
    "plinth": "#RRGGBB",
    "rug": "#RRGGBB",
    "ambientLight": "#RRGGBB",
    "spotLight": "#RRGGBB"
  },
  "architectNotes": ["3-4 concise architectural notes referencing actual brand cues & hex codes"],
  "heroItemIndices": [3 to 4 integer indices of the best wearable hanging upper-body garments from candidateProducts, hero centerpiece first]
}`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(6500),
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: `${systemInstruction}\n\nScraped Brand Data:\n${JSON.stringify(promptPayload)}` }],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.35,
      },
    }),
  });

  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) return null;

  const cleanedJson = rawText.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
  const parsed = JSON.parse(cleanedJson) as Partial<SynthesizedBrandDna>;

  const lightingPreset: LightingPreset =
    parsed.lightingPreset && VALID_LIGHTING_PRESETS.has(parsed.lightingPreset)
      ? parsed.lightingPreset
      : fallbackDna.lightingPreset;

  const metalRoughness =
    typeof parsed.metalRoughness === 'number' && Number.isFinite(parsed.metalRoughness)
      ? Math.max(0.1, Math.min(0.65, parsed.metalRoughness))
      : fallbackDna.metalRoughness;

  const metalness =
    typeof parsed.metalness === 'number' && Number.isFinite(parsed.metalness)
      ? Math.max(0.5, Math.min(0.98, parsed.metalness))
      : fallbackDna.metalness;

  const validIndices = Array.isArray(parsed.heroItemIndices)
    ? parsed.heroItemIndices.filter(
        (idx): idx is number =>
          typeof idx === 'number' && Number.isInteger(idx) && idx >= 0 && idx < candidates.length
      )
    : undefined;

  return {
    brandName:
      typeof parsed.brandName === 'string' && parsed.brandName.trim()
        ? parsed.brandName.trim().slice(0, 40)
        : fallbackDna.brandName,
    tagline:
      typeof parsed.tagline === 'string' && parsed.tagline.trim()
        ? parsed.tagline.trim().slice(0, 72)
        : fallbackDna.tagline,
    vibe:
      typeof parsed.vibe === 'string' && parsed.vibe.trim()
        ? parsed.vibe.trim().slice(0, 120)
        : fallbackDna.vibe,
    palette: sanitizeStorePalette(parsed.palette, fallbackDna.palette),
    metalRoughness,
    metalness,
    lightingPreset,
    architectNotes:
      Array.isArray(parsed.architectNotes) && parsed.architectNotes.length > 0
        ? parsed.architectNotes.map((n) => String(n).trim()).filter(Boolean).slice(0, 4)
        : fallbackDna.architectNotes,
    heroItemIndices: validIndices && validIndices.length > 0 ? validIndices : undefined,
  };
}

function toGarmentAssetSet(candidate: ScrapedProductCandidate, featured: boolean): GarmentAssetSet {
  return {
    id: candidate.id,
    sku: candidate.sku,
    title: candidate.title,
    subtitle: candidate.subtitle,
    price: candidate.price,
    featured,
    rawUrl: toProxyImageUrl(candidate.frontImageUrl),
  };
}

function readJsonBody(req: MinimalReq, maxBytes = 65536): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    let totalLen = 0;
    const decoder = new TextDecoder();

    req.on('data', (chunk: Uint8Array | string) => {
      const str = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
      totalLen += str.length;
      if (totalLen > maxBytes) {
        reject(new Error('Request payload too large'));
        return;
      }
      chunks.push(str);
    });

    req.on('end', () => {
      try {
        const raw = chunks.join('').trim();
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch {
        reject(new Error('Invalid JSON request body'));
      }
    });

    req.on('error', (err) => reject(err));
  });
}

function sendJson(res: MinimalRes, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

async function fetchJsonSafely(url: string, timeoutMs = 7000): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        Accept: 'application/json,text/javascript,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    if (!ct.includes('json') && !ct.includes('javascript')) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchHtmlSafely(
  url: string,
  timeoutMs = 7000
): Promise<{ html: string; finalOrigin: string } | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const html = await res.text();
    let finalOrigin = new URL(url).origin;
    try {
      if (res.url) finalOrigin = new URL(res.url).origin;
    } catch {
      // keep initial origin
    }
    return { html, finalOrigin };
  } catch {
    return null;
  }
}

async function handleProxyImageRequest(reqUrl: URL, res: MinimalRes): Promise<void> {
  const rawTarget = reqUrl.searchParams.get('url');
  if (!rawTarget) {
    sendJson(res, 400, { error: 'Missing required query parameter: url' });
    return;
  }

  let targetUrl: URL;
  try {
    targetUrl = normalizeExternalUrl(rawTarget);
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : 'Invalid image URL' });
    return;
  }

  const cacheKey = targetUrl.toString();
  const cached = IMAGE_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < IMAGE_CACHE_TTL_MS) {
    res.statusCode = 200;
    res.setHeader('Content-Type', cached.contentType);
    res.setHeader('Content-Length', String(cached.bytes.byteLength));
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.end(cached.bytes);
    return;
  }

  try {
    const upstream = await fetch(cacheKey, {
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: `${targetUrl.origin}/`,
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(8500),
    });

    if (!upstream.ok) {
      sendJson(res, upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502, {
        error: `Upstream image server returned HTTP ${upstream.status}`,
      });
      return;
    }

    const rawContentType = upstream.headers.get('content-type') ?? 'image/jpeg';
    if (rawContentType.toLowerCase().includes('text/html')) {
      sendJson(res, 415, { error: 'Upstream URL returned HTML instead of an image' });
      return;
    }

    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (bytes.byteLength === 0) {
      sendJson(res, 502, { error: 'Upstream image was empty' });
      return;
    }

    if (bytes.byteLength <= 4 * 1024 * 1024) {
      if (IMAGE_CACHE.size >= MAX_IMAGE_CACHE_ENTRIES) {
        const oldestKey = IMAGE_CACHE.keys().next().value;
        if (oldestKey) IMAGE_CACHE.delete(oldestKey);
      }
      IMAGE_CACHE.set(cacheKey, {
        bytes,
        contentType: rawContentType,
        cachedAt: Date.now(),
      });
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', rawContentType);
    res.setHeader('Content-Length', String(bytes.byteLength));
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.end(bytes);
  } catch (err) {
    sendJson(res, 502, {
      error: err instanceof Error ? `Image proxy failed: ${err.message}` : 'Image proxy failed',
    });
  }
}

async function handleIngestUrlRequest(
  req: MinimalReq,
  res: MinimalRes,
  viteEnv: Record<string, string>
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : 'Malformed JSON body' });
    return;
  }

  const rawUrl = typeof body.url === 'string' ? body.url : '';
  let targetUrl: URL;
  try {
    targetUrl = normalizeExternalUrl(rawUrl);
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : 'Invalid website URL' });
    return;
  }

  const collectionMatch = targetUrl.pathname.match(/\/collections\/([^/?#]+)/i);
  const collectionHandle = collectionMatch?.[1];
  const productMatch = targetUrl.pathname.match(/\/products\/([^/?#]+)/i);
  const productHandle = productMatch?.[1];

  // Probe Shopify catalog JSON endpoints & storefront HTML in parallel (7s timeout)
  const [collectionJson, singleProductJson, rootProductsJson, htmlResult] = await Promise.all([
    collectionHandle
      ? fetchJsonSafely(`${targetUrl.origin}/collections/${collectionHandle}/products.json?limit=16`, 7000)
      : Promise.resolve(null),
    productHandle
      ? fetchJsonSafely(`${targetUrl.origin}/products/${productHandle}.json`, 7000)
      : Promise.resolve(null),
    fetchJsonSafely(`${targetUrl.origin}/products.json?limit=16`, 7000),
    fetchHtmlSafely(targetUrl.toString(), 7000),
  ]);

  const effectiveOrigin = htmlResult?.finalOrigin ?? targetUrl.origin;
  const fallbackBrand = deriveCleanBrandName(effectiveOrigin);

  const parsedMeta: ParsedHtmlMetadata = htmlResult
    ? parsePageHtml(htmlResult.html, effectiveOrigin, fallbackBrand)
    : {
        title: '',
        siteName: '',
        ogTitle: '',
        description: '',
        hexPalette: [],
        jsonLdProducts: [],
        htmlImgProducts: [],
      };

  // Assemble candidate products across priority tiers: Shopify JSON -> JSON-LD -> HTML <img> / og:image
  const shopifyCandidates: ScrapedProductCandidate[] = [];
  if (singleProductJson) {
    const singleItems = parseShopifyProductsJson(singleProductJson, effectiveOrigin);
    for (const s of singleItems) {
      s.wearableScore += 200; // Pin explicitly pasted /products/<handle> item as #1 hero!
      shopifyCandidates.push(s);
    }
  }
  if (collectionJson) {
    shopifyCandidates.push(...parseShopifyProductsJson(collectionJson, effectiveOrigin));
  }
  if (rootProductsJson) {
    shopifyCandidates.push(...parseShopifyProductsJson(rootProductsJson, effectiveOrigin));
  }

  let sourceType: IngestSourceType = 'html_meta';
  let allCandidates: ScrapedProductCandidate[] = [];

  if (shopifyCandidates.length > 0) {
    sourceType = 'shopify';
    allCandidates = shopifyCandidates;
  } else if (parsedMeta.jsonLdProducts.length > 0) {
    sourceType = 'jsonld';
    allCandidates = parsedMeta.jsonLdProducts;
  } else {
    sourceType = 'html_meta';
    allCandidates = parsedMeta.htmlImgProducts;
  }

  if (allCandidates.length === 0) {
    sendJson(res, 422, {
      error: `Could not extract accessible product images from ${targetUrl.hostname}. Try a public store URL (e.g. kotn.com, rowingblazers.com, golfwang.com) or a /collections/ page.`,
    });
    return;
  }

  const rawProductCount = allCandidates.length;
  const fallbackDna = synthesizeHeuristicBrandDna(targetUrl, parsedMeta, allCandidates);

  // Optional Gemini 4 / Gemini 2.5 Flash Brand Architect synthesis with seamless fallback
  const env = readRuntimeEnv(viteEnv);
  const geminiKey = env.GEMINI_API_KEY?.trim();
  const geminiModel = env.GEMINI_ARCHITECT_MODEL?.trim() || 'gemini-2.5-flash';

  let usedGemini = false;
  let finalDna: SynthesizedBrandDna = fallbackDna;

  if (geminiKey && !/^your_|^insert_|^placeholder/i.test(geminiKey)) {
    try {
      const geminiResult = await trySynthesizeWithGemini(
        geminiKey,
        geminiModel,
        targetUrl,
        parsedMeta,
        allCandidates,
        fallbackDna
      );
      if (geminiResult) {
        finalDna = geminiResult;
        usedGemini = true;
      }
    } catch {
      // Seamless <100ms fallback to deterministic Brand DNA Synthesizer
      usedGemini = false;
    }
  }

  // Pick top 3–4 garments (either Gemini's curated indices or our diverse wearable scorer)
  let chosenProducts: ScrapedProductCandidate[] = [];
  if (finalDna.heroItemIndices && finalDna.heroItemIndices.length > 0) {
    const seen = new Set<number>();
    for (const idx of finalDna.heroItemIndices) {
      if (!seen.has(idx) && allCandidates[idx]) {
        chosenProducts.push(allCandidates[idx]);
        seen.add(idx);
      }
    }
  }
  if (chosenProducts.length < Math.min(4, allCandidates.length)) {
    const diverse = selectDiverseTopCandidates(allCandidates, 4);
    for (const d of diverse) {
      if (chosenProducts.length >= 4) break;
      if (!chosenProducts.some((c) => c.frontImageUrl === d.frontImageUrl)) {
        chosenProducts.push(d);
      }
    }
  }

  const heroGarment = toGarmentAssetSet(chosenProducts[0], true);
  const companionGarments = chosenProducts
    .slice(1, 4)
    .map((c) => toGarmentAssetSet(c, false));

  const racks: RackPlacement[] = [
    {
      id: 'ingested-hero-faceout',
      label: `${finalDna.brandName} Hero Stand`,
      position: [0, 0, 0],
      rotationY: 0,
      style: 'hero_faceout',
      items: [heroGarment],
    },
  ];

  if (companionGarments.length > 0) {
    racks.push({
      id: 'ingested-capsule-rail',
      label: `${finalDna.brandName} Capsule Rail`,
      position: [-1.58, 0, -0.58],
      rotationY: 0.34,
      style: 'capsule_rail',
      items: companionGarments,
    });
  }

  const storeConfig: StoreConfig = {
    id: `ingested-${slugify(targetUrl.hostname)}-${Date.now()}`,
    brandName: finalDna.brandName,
    tagline: finalDna.tagline,
    vibe: finalDna.vibe,
    palette: finalDna.palette,
    metalRoughness: finalDna.metalRoughness,
    metalness: finalDna.metalness,
    lightingPreset: finalDna.lightingPreset,
    textures: {},
    racks,
    architectNotes: finalDna.architectNotes,
  };

  const responsePayload: IngestUrlResponsePayload = {
    storeConfig,
    rawProductCount,
    sourceType,
    usedGemini,
  };

  sendJson(res, 200, responsePayload);
}

export function brandIngestVitePlugin(): Plugin {
  let viteEnv: Record<string, string> = {};

  const handleMiddleware = (req: MinimalReq, res: MinimalRes, next: () => void) => {
    const rawUrl = req.url ?? '';
    if (!rawUrl.startsWith('/api/proxy-image') && !rawUrl.startsWith('/api/ingest-url')) {
      next();
      return;
    }

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.end();
      return;
    }

    const parsedReqUrl = new URL(rawUrl, 'http://localhost');

    if (parsedReqUrl.pathname === '/api/proxy-image' && req.method === 'GET') {
      void handleProxyImageRequest(parsedReqUrl, res);
      return;
    }

    if (parsedReqUrl.pathname === '/api/ingest-url' && req.method === 'POST') {
      void handleIngestUrlRequest(req, res, viteEnv);
      return;
    }

    sendJson(res, 405, {
      error: `Method ${req.method ?? 'UNKNOWN'} not allowed on ${parsedReqUrl.pathname}`,
    });
  };

  return {
    name: 'gemini-boutique-brand-ingest',
    configResolved(config) {
      try {
        viteEnv = loadEnv(config.mode, config.root, '');
      } catch {
        viteEnv = {};
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        handleMiddleware(req as unknown as MinimalReq, res as unknown as MinimalRes, next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        handleMiddleware(req as unknown as MinimalReq, res as unknown as MinimalRes, next);
      });
    },
  };
}

export default brandIngestVitePlugin;
