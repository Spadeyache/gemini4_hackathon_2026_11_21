import { loadEnv, type Plugin } from 'vite';
import { GoogleGenAI } from '@google/genai';
import type {
  GarmentAssetSet,
  InventedProductSpec,
  LightingPreset,
  ProductCategory3D,
  ProductGraphicMotif,
  ProductPlacementZone,
  RackPlacement,
  StoreConfig,
  StorePalette,
  WorldArchetypeId,
} from '../src/types/storeConfig';

export type IngestSourceType = 'shopify' | 'jsonld' | 'html_meta';

export interface IngestUrlResponsePayload {
  storeConfig: StoreConfig;
  rawProductCount: number;
  sourceType: IngestSourceType;
  usedGemini: boolean;
}

type MaterialFinish = NonNullable<InventedProductSpec['materialFinish']>;

type BrandSubVertical =
  | 'software_ai'
  | 'fintech'
  | 'aerospace_science'
  | 'creative_portfolio'
  | 'coffee_culinary'
  | 'botanical_apothecary'
  | 'organic_apparel'
  | 'writer_substack'
  | 'film_cinema'
  | 'music_audio'
  | 'streetwear_drop'
  | 'editorial_press'
  | 'collegiate_club'
  | 'luxury_archive';

interface RealCatalogInspiration {
  title: string;
  handle: string;
  productType: string;
  price: number;
  tags: string[];
  vendor?: string;
  shopifyProductUrl?: string;
  shopifyVariantId?: string;
}

interface ExtractedColorProfile {
  themeColor?: string;
  isDarkWebsite: boolean;
  primaryBrandHex?: string;
  secondaryBrandHex?: string;
  darkBackgrounds: string[];
  lightBackgrounds: string[];
  vibrantAccents: string[];
  mutedAccents: string[];
  svgBrandColors: string[];
  customPropColors: Array<{ name: string; hex: string }>;
  allDistinctHexes: string[];
}

interface DeepWebsiteIdentity {
  url: string;
  origin: string;
  hostname: string;
  domainRoot: string;
  tld: string;
  brandName: string;
  monogram: string;
  pageTitle: string;
  ogTitle: string;
  description: string;
  headlines: string[];
  manifestoSentences: string[];
  navLabels: string[];
  evocativeNouns: string[];
  graphicCopyCandidates: string[];
  colorProfile: ExtractedColorProfile;
  subVertical: BrandSubVertical;
  recommendedArchetype: WorldArchetypeId;
  catalogInspirations: RealCatalogInspiration[];
  looksLikeShopify: boolean;
}

interface CreativeDirectorBlueprint {
  brandName: string;
  tagline: string;
  vibe: string;
  brandEthos: string;
  archetype: WorldArchetypeId;
  lightingPreset: LightingPreset;
  metalRoughness: number;
  metalness: number;
  palette: StorePalette;
  architectNotes: string[];
  products: InventedProductSpec[];
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

const VALID_ARCHETYPES: ReadonlySet<WorldArchetypeId> = new Set<WorldArchetypeId>([
  'heritage_arch_flagship',
  'minimalist_tech_pavilion',
  'warm_artisanal_atelier',
  'avant_garde_concrete_loft',
]);

const HANGING_APPAREL_CATEGORIES: readonly ProductCategory3D[] = [
  'heavyweight_hoodie',
  'varsity_jacket',
  'structured_tshirt',
];

const PEDESTAL_OBJECT_CATEGORIES: readonly ProductCategory3D[] = [
  'ceramic_mug',
  'structured_cap',
  'canvas_tote',
  'hardcover_book',
  'apothecary_bottle',
];

const VALID_APPAREL_SET: ReadonlySet<ProductCategory3D> = new Set(HANGING_APPAREL_CATEGORIES);
const VALID_OBJECT_SET: ReadonlySet<ProductCategory3D> = new Set(PEDESTAL_OBJECT_CATEGORIES);

const VALID_MOTIFS: ReadonlySet<ProductGraphicMotif> = new Set<ProductGraphicMotif>([
  'monogram_crest',
  'geometric_grid',
  'botanical_line',
  'minimal_typo',
  'archival_seal',
  'orbital_rings',
]);

const VALID_FINISHES: ReadonlySet<MaterialFinish> = new Set<MaterialFinish>([
  'combed_cotton',
  'brushed_fleece',
  'merino_knit',
  'matte_stoneware',
  'frosted_glass',
  'heavy_canvas',
]);

const EXCLUDED_PRODUCT_RE =
  /\b(gift[-_ ]?card|e-gift|shipping[-_ ]?protection|package[-_ ]?protection|navidium|corso|route[-_ ]?protect|donation|mystery[-_ ]?box|warranty|digital[-_ ]?download)\b/i;

const BOT_CHALLENGE_TITLE_RE =
  /\b(just a moment|attention required|access denied|403 forbidden|404 not found|page not found|security check|ddos[- ]?guard|verify you are human|are you a robot|pardon our interruption|sucuri website firewall)\b/i;

const BOILERPLATE_TEXT_RE =
  /\b(cookie|cookies|privacy policy|terms of service|terms & conditions|all rights reserved|sign in|log in|forgot password|create account|skip to content|javascript is disabled|browser does not support|unsubscribe|gdpr|ccpa|manage preferences|accept all|suggested searches|search results|shopping cart|shopping bag|your cart|filter by|sort by)\b/i;

const GENERIC_NAV_STOP_RE =
  /^(home|login|log in|sign in|sign up|register|get started|start now|try free|contact|contact us|support|help|faq|search|menu|close|cart|bag|checkout|account|privacy|terms|legal|sitemap|skip|back|next|more|view all|learn more|read more|pricing|product|products|solutions|resources|enterprise|customers|company|careers|jobs|blog|blogs|news|news releases|press|events|docs|documentation|developers|status|security|partners|integrations|download|mobile|live|podcasts|videos|multimedia)$/i;

const GENERIC_PHRASE_STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'your',
  'our',
  'into',
  'over',
  'under',
  'more',
  'most',
  'best',
  'new',
  'now',
  'how',
  'why',
  'what',
  'when',
  'where',
  'who',
  'all',
  'any',
  'every',
  'built',
  'make',
  'made',
  'get',
  'use',
  'using',
  'learn',
  'read',
  'view',
  'shop',
  'store',
  'buy',
  'free',
  'try',
  'start',
  'started',
  'welcome',
  'official',
  'website',
  'online',
  'page',
  'home',
  'click',
  'here',
  'join',
  'today',
  'discover',
  'explore',
  'about',
  'contact',
  'login',
  'signup',
  'subscribe',
  'cookie',
  'privacy',
  'pricing',
  'product',
  'products',
  'customers',
  'company',
  'careers',
  'blog',
  'blogs',
  'news',
  'releases',
  'solutions',
  'resources',
  'enterprise',
  'features',
  'tool',
  'tools',
  'platform',
  'search',
  'searches',
  'suggested',
  'filter',
  'filters',
  'results',
  'menu',
  'navigation',
  'account',
  'checkout',
]);

// Known compound brand domain normalizations so blocked/minimal SPA responses still yield crisp display names
const DOMAIN_BRAND_DISPLAY_OVERRIDES: Record<string, string> = {
  bluebottlecoffee: 'BLUE BOTTLE COFFEE',
  rowingblazers: 'ROWING BLAZERS',
  a24films: 'A24',
  nytimes: 'THE NEW YORK TIMES',
  washingtonpost: 'THE WASHINGTON POST',
  newyorker: 'THE NEW YORKER',
  golfwang: 'GOLF WANG',
  aimelondore: 'AIME LEON DORE',
  aimeleondore: 'AIME LEON DORE',
  goodshotclub: 'GOOD SHOT CLUB',
  huggingface: 'HUGGING FACE',
  hackernews: 'HACKER NEWS',
  ycombinator: 'Y COMBINATOR',
  tailwindlabs: 'TAILWIND LABS',
  tailwindcss: 'TAILWIND',
  duckduckgo: 'DUCKDUCKGO',
  intelligentsia: 'INTELLIGENTSIA COFFEE',
  stumptowncoffee: 'STUMPTOWN COFFEE',
  counterculturecoffee: 'COUNTER CULTURE',
};

// Domain-authentic fallback brand hex accents when a site serves external/obfuscated or 403 CSS
const KNOWN_DOMAIN_BRAND_COLORS: Record<string, { primary: string; bg?: string; isDark?: boolean }> = {
  linear: { primary: '#5E6AD2', bg: '#08090A', isDark: true },
  stripe: { primary: '#635BFF', bg: '#0A2540', isDark: false },
  vercel: { primary: '#EDEDED', bg: '#0A0A0A', isDark: true },
  supabase: { primary: '#3ECF8E', bg: '#121212', isDark: true },
  raycast: { primary: '#FF6363', bg: '#0D0E11', isDark: true },
  openai: { primary: '#10A37F', bg: '#0D0D0D', isDark: true },
  anthropic: { primary: '#D97757', bg: '#FAF9F5', isDark: false },
  nasa: { primary: '#0B3D91', bg: '#0B0F19', isDark: true },
  spacex: { primary: '#D0D6E0', bg: '#090B10', isDark: true },
  bluebottlecoffee: { primary: '#00A5DF', bg: '#FBF9F5', isDark: false },
  aesop: { primary: '#9E542B', bg: '#FFFEF2', isDark: false },
  kotn: { primary: '#5E6652', bg: '#F4EFE6', isDark: false },
  a24films: { primary: '#E04836', bg: '#141517', isDark: true },
  a24: { primary: '#E04836', bg: '#141517', isDark: true },
  nytimes: { primary: '#22354D', bg: '#F7F5F0', isDark: false },
  substack: { primary: '#FF6719', bg: '#FAF6F0', isDark: false },
  rowingblazers: { primary: '#23395B', bg: '#F4EFE4', isDark: false },
  golfwang: { primary: '#E07A5F', bg: '#F6F1E6', isDark: false },
};

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
    throw new Error('Please enter any website or brand URL.');
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
    throw new Error(`Invalid URL "${rawInput}". Try a domain like linear.app or bluebottlecoffee.com.`);
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
  return decodeHtmlEntities(
    input
      .replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
  );
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'item'
  );
}

function deterministicHash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function parsePriceNumber(raw: unknown, fallback = 85): number {
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

function hslToRgb(hDeg: number, sPct: number, lPct: number): [number, number, number] {
  const h = (((hDeg % 360) + 360) % 360) / 360;
  const s = Math.max(0, Math.min(1, sPct / 100));
  const l = Math.max(0, Math.min(1, lPct / 100));
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, tInput: number): number => {
    let t = tInput;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

function normalizeCssColorToken(raw: string | undefined | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || /^(none|transparent|currentcolor|inherit|initial|unset|url\()/i.test(trimmed)) {
    return null;
  }

  const m6 = trimmed.match(/^#([0-9a-fA-F]{6})$/);
  if (m6) return `#${m6[1].toUpperCase()}`;

  const m8 = trimmed.match(/^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})$/);
  if (m8) {
    const alpha = Number.parseInt(m8[2], 16);
    if (alpha < 180) return null;
    return `#${m8[1].toUpperCase()}`;
  }

  const m3 = trimmed.match(/^#([0-9a-fA-F]{3})$/);
  if (m3) {
    const [r, g, b] = m3[1].toUpperCase().split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }

  const rgbMatch = trimmed.match(
    /^rgba?\(\s*(\d{1,3})\s*(?:,|\s)\s*(\d{1,3})\s*(?:,|\s)\s*(\d{1,3})(?:\s*[,/]\s*([0-9.]+%?))?\s*\)$/i
  );
  if (rgbMatch) {
    if (rgbMatch[4]) {
      const aRaw = rgbMatch[4];
      const alpha = aRaw.endsWith('%') ? Number.parseFloat(aRaw) / 100 : Number.parseFloat(aRaw);
      if (Number.isFinite(alpha) && alpha < 0.72) return null;
    }
    return rgbToHex(Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3]));
  }

  const hslMatch = trimmed.match(
    /^hsla?\(\s*(-?[0-9.]+)(?:deg)?\s*(?:,|\s)\s*([0-9.]+)%\s*(?:,|\s)\s*([0-9.]+)%(?:\s*[,/]\s*([0-9.]+%?))?\s*\)$/i
  );
  if (hslMatch) {
    if (hslMatch[4]) {
      const aRaw = hslMatch[4];
      const alpha = aRaw.endsWith('%') ? Number.parseFloat(aRaw) / 100 : Number.parseFloat(aRaw);
      if (Number.isFinite(alpha) && alpha < 0.72) return null;
    }
    const [r, g, b] = hslToRgb(
      Number.parseFloat(hslMatch[1]),
      Number.parseFloat(hslMatch[2]),
      Number.parseFloat(hslMatch[3])
    );
    return rgbToHex(r, g, b);
  }

  return null;
}

function normalizeHexColor(raw: string | undefined | null): string | null {
  return normalizeCssColorToken(raw);
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = normalizeHexColor(hex) ?? '#F1ECE1';
  const n = Number.parseInt(clean.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function getColorMetrics(hex: string): {
  lum: number;
  sat: number;
  hue: number;
  lightness: number;
  r: number;
  g: number;
  b: number;
} {
  const [r, g, b] = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const lum = 0.2126 * toLinear(rn) + 0.7152 * toLinear(gn) + 0.0722 * toLinear(bn);

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  const lightness = (max + min) / 2;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * lightness - 1));

  let hue = 0;
  if (d !== 0) {
    if (max === rn) hue = ((gn - bn) / d) % 6;
    else if (max === gn) hue = (bn - rn) / d + 2;
    else hue = (rn - gn) / d + 4;
    hue = Math.round(hue * 60);
    if (hue < 0) hue += 360;
  }

  return { lum, sat, hue, lightness, r, g, b };
}

function wcagContrastRatio(hexA: string, hexB: string): number {
  const lumA = getColorMetrics(hexA).lum;
  const lumB = getColorMetrics(hexB).lum;
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

function mixHex(hexA: string, hexB: string, weightB: number): string {
  const [r1, g1, b1] = hexToRgb(hexA);
  const [r2, g2, b2] = hexToRgb(hexB);
  const w = Math.max(0, Math.min(1, weightB));
  return rgbToHex(r1 * (1 - w) + r2 * w, g1 * (1 - w) + g2 * w, b1 * (1 - w) + b2 * w);
}

/**
 * Ensures foreground/accent hex meets WCAG contrast ratio against a background hex
 * while preserving the brand color's authentic hue & saturation.
 */
function ensureWcagContrast(fgHex: string, bgHex: string, minRatio = 3.2): string {
  const cleanFg = normalizeHexColor(fgHex) ?? '#D4AF37';
  const cleanBg = normalizeHexColor(bgHex) ?? '#17191E';
  if (wcagContrastRatio(cleanFg, cleanBg) >= minRatio) {
    return cleanFg;
  }

  const bgMetrics = getColorMetrics(cleanBg);
  const fgMetrics = getColorMetrics(cleanFg);
  const brighten = bgMetrics.lum < 0.36;
  const targetPole = brighten ? '#F8F6F0' : '#141518';

  for (let step = 1; step <= 18; step++) {
    const candidate = mixHex(cleanFg, targetPole, step / 18);
    if (wcagContrastRatio(candidate, cleanBg) >= minRatio) {
      // Preserve a hint of original hue if saturation collapsed near pole
      if (fgMetrics.sat > 0.25 && getColorMetrics(candidate).sat < 0.12) {
        const [r, g, b] = hslToRgb(fgMetrics.hue, 48, brighten ? 78 : 22);
        const vividCandidate = rgbToHex(r, g, b);
        if (wcagContrastRatio(vividCandidate, cleanBg) >= minRatio) {
          return vividCandidate;
        }
      }
      return candidate;
    }
  }

  return brighten ? '#F5F2EA' : '#18191D';
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

function parseHostnameParts(url: URL): { hostname: string; domainRoot: string; tld: string; subdomain?: string } {
  const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  const parts = hostname.split('.').filter(Boolean);

  if (parts.length >= 3 && parts[parts.length - 2] === 'substack') {
    return {
      hostname,
      domainRoot: parts[0],
      tld: 'substack.com',
      subdomain: parts[0],
    };
  }

  if (
    parts.length >= 3 &&
    /^(co|com|org|gov|edu|ac|net)$/.test(parts[parts.length - 2]) &&
    parts[parts.length - 1].length === 2
  ) {
    return {
      hostname,
      domainRoot: parts[parts.length - 3],
      tld: `${parts[parts.length - 2]}.${parts[parts.length - 1]}`,
    };
  }

  if (parts.length >= 2) {
    const cleanParts = parts.filter((p, idx) => !(idx === 0 && /^(shop|store|us|uk|eu|app|get|try)$/.test(p)));
    const effective = cleanParts.length >= 2 ? cleanParts : parts;
    return {
      hostname,
      domainRoot: effective[effective.length - 2],
      tld: effective[effective.length - 1],
    };
  }

  return { hostname, domainRoot: hostname, tld: 'com' };
}

function humanizeDomainRoot(domainRoot: string): string {
  const cleanKey = domainRoot.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (DOMAIN_BRAND_DISPLAY_OVERRIDES[cleanKey]) {
    return DOMAIN_BRAND_DISPLAY_OVERRIDES[cleanKey];
  }

  let spaced = domainRoot
    .replace(/[-_]+/g, ' ')
    .replace(
      /(coffee|roasters|films|studios|studio|club|blazers|labs|lab|press|books|media|news|tech|ai|app|works|design|atelier|goods|supply|co)$/i,
      ' $1'
    )
    .replace(/\s+/g, ' ')
    .trim();

  if (!spaced) spaced = domainRoot;
  return spaced.toUpperCase();
}

function deriveCleanBrandName(
  url: URL,
  siteName?: string,
  pageTitle?: string,
  jsonLdOrgName?: string,
  shopifyVendor?: string
): string {
  const { domainRoot } = parseHostnameParts(url);
  const cleanKey = domainRoot.toLowerCase().replace(/[^a-z0-9]/g, '');

  const cleanCandidate = (raw?: string): string | null => {
    if (!raw) return null;
    const s = decodeHtmlEntities(raw).trim();
    if (s.length < 2 || s.length > 36) return null;
    if (BOT_CHALLENGE_TITLE_RE.test(s)) return null;
    if (/^(home|welcome|index|official site|online store|storefront|untitled)$/i.test(s)) return null;
    return s;
  };

  const validOrg = cleanCandidate(jsonLdOrgName);
  const validSite = cleanCandidate(siteName);
  const validVendor = cleanCandidate(shopifyVendor);

  if (validSite && validSite.length <= 30) {
    return validSite.toUpperCase();
  }
  if (validOrg && validOrg.length <= 30) {
    return validOrg.toUpperCase();
  }
  if (validVendor && validVendor.length <= 28) {
    return validVendor.toUpperCase();
  }

  if (pageTitle && !BOT_CHALLENGE_TITLE_RE.test(pageTitle)) {
    const segments = pageTitle
      .split(/\s*(?:\||–|—|•|·|:|-)\s*/)
      .map((seg) => seg.trim())
      .filter(
        (seg) =>
          seg.length >= 2 &&
          seg.length <= 30 &&
          !/^(home|official|welcome|online store|shop|products|collections)$/i.test(seg)
      );

    if (segments.length > 0) {
      // Strongly prefer the title segment whose alphanumeric stem matches domainRoot
      const domainMatched = segments.find((seg) => {
        const stem = seg.toLowerCase().replace(/[^a-z0-9]/g, '');
        return stem.length >= 2 && (cleanKey.includes(stem) || stem.includes(cleanKey));
      });
      if (domainMatched) {
        return domainMatched.toUpperCase();
      }
      // Otherwise take first concise segment (often "Linear – Plan and build products")
      if (segments[0].split(/\s+/).length <= 4) {
        return segments[0].toUpperCase();
      }
      const lastSeg = segments[segments.length - 1];
      if (lastSeg && lastSeg.split(/\s+/).length <= 3) {
        return lastSeg.toUpperCase();
      }
    }
  }

  return humanizeDomainRoot(domainRoot);
}

function deriveBrandMonogram(brandName: string): string {
  const cleaned = brandName
    .toUpperCase()
    .replace(/^THE\s+/, '')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return 'BRD';

  const compact = cleaned.replace(/\s+/g, '');
  if (compact.length >= 2 && compact.length <= 3) {
    return compact;
  }

  const words = cleaned.split(' ').filter(Boolean);
  if (words.length >= 2) {
    return words
      .slice(0, 3)
      .map((w) => w[0])
      .join('');
  }

  const word = words[0];
  const consonants = word.slice(1).replace(/[AEIOU]/g, '');
  if (consonants.length >= 2) {
    return `${word[0]}${consonants.slice(0, 2)}`;
  }
  return word.slice(0, 3);
}

/**
 * Deeply extracts CSS custom properties (--*), <meta name="theme-color">, SVG logo fills/strokes,
 * and background/accent colors, separating dark vs. light website themes and vibrant vs. muted accents.
 */
function extractDeepColorProfile(
  html: string,
  extraStylesheetCss: string,
  domainRoot: string,
  themeColorRaw?: string
): ExtractedColorProfile {
  const themeColor = normalizeCssColorToken(themeColorRaw) ?? undefined;
  const customPropColors: Array<{ name: string; hex: string }> = [];
  const svgBrandColors: string[] = [];
  const bgHints: string[] = [];
  const brandScores = new Map<string, number>();

  const addScore = (hex: string | null, points: number) => {
    if (!hex) return;
    const { lum, sat } = getColorMetrics(hex);
    const neutralPenalty =
      hex === '#FFFFFF' || hex === '#000000'
        ? 0.14
        : lum > 0.985 || lum < 0.015
          ? 0.35
          : sat > 0.22
            ? 1.45
            : 0.95;
    brandScores.set(hex, (brandScores.get(hex) ?? 0) + points * neutralPenalty);
  };

  if (themeColor) {
    addScore(themeColor, 48);
    bgHints.push(themeColor);
  }

  const tileColor = normalizeCssColorToken(extractMetaTag(html, 'msapplication-TileColor'));
  if (tileColor) {
    addScore(tileColor, 26);
  }

  // 1. Extract SVG fill & stroke brand colors from inline logos/icons (first 24 SVGs)
  const svgRe = /<svg\b[\s\S]*?<\/svg>/gi;
  let svgMatch: RegExpExecArray | null;
  let svgCount = 0;
  while ((svgMatch = svgRe.exec(html)) !== null && svgCount < 24) {
    svgCount++;
    const svgSnippet = svgMatch[0].slice(0, 8000);
    const fillStrokeRe = /\b(?:fill|stroke)=["']([^"']{3,36})["']/gi;
    let fm: RegExpExecArray | null;
    while ((fm = fillStrokeRe.exec(svgSnippet)) !== null) {
      const hex = normalizeCssColorToken(fm[1]);
      if (!hex || hex === '#FFFFFF' || hex === '#000000') continue;
      if (!svgBrandColors.includes(hex)) {
        svgBrandColors.push(hex);
      }
      addScore(hex, 24);
    }
  }

  // 2. Combine inline <style> blocks + style="..." attributes + optional external stylesheet
  const styleBlocks: string[] = [];
  const styleBlockRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = styleBlockRe.exec(html)) !== null && styleBlocks.length < 28) {
    styleBlocks.push(sm[1].slice(0, 65000));
  }

  const inlineStyleAttrRe = /\bstyle=["']([^"']{4,400})["']/gi;
  let im: RegExpExecArray | null;
  let inlineCount = 0;
  while ((im = inlineStyleAttrRe.exec(html)) !== null && inlineCount < 160) {
    inlineCount++;
    styleBlocks.push(im[1]);
  }

  if (extraStylesheetCss) {
    styleBlocks.push(extraStylesheetCss.slice(0, 140000));
  }

  const combinedCss = styleBlocks.join('\n');

  // 3. Authentic CSS custom properties (--*)
  const cssVarRe = /(--[a-zA-Z0-9-_]{2,48})\s*:\s*([^;}{"\n]{3,42})/g;
  let vm: RegExpExecArray | null;
  let varScanned = 0;
  while ((vm = cssVarRe.exec(combinedCss)) !== null && varScanned < 600) {
    varScanned++;
    const propName = vm[1].toLowerCase();
    const hex = normalizeCssColorToken(vm[2]);
    if (!hex) continue;

    // Ignore generic form-validation utility colors unless explicitly named brand/primary
    if (/^--(error|danger|destructive|warn|warning|alert|invalid|success|toast|diff)/.test(propName)) {
      continue;
    }

    if (customPropColors.length < 24 && !customPropColors.some((c) => c.hex === hex)) {
      customPropColors.push({ name: propName, hex });
    }

    if (/^--(brand|primary|accent|theme|highlight|cta|link|hero|tint)/.test(propName)) {
      addScore(hex, 34);
    } else if (/^--(bg|background|surface|canvas|page|body)/.test(propName)) {
      bgHints.push(hex);
      addScore(hex, 16);
    } else {
      addScore(hex, 8);
    }
  }

  // 4. Explicit html/body background-color declarations for accurate dark vs. light detection
  const bodyBgRe = /(?:html|body|:root)\s*\{[^}]{0,600}?(?:background-color|background)\s*:\s*([^;}{"\n]{3,36})/gi;
  let bbm: RegExpExecArray | null;
  while ((bbm = bodyBgRe.exec(combinedCss)) !== null) {
    const hex = normalizeCssColorToken(bbm[1]);
    if (hex) {
      bgHints.unshift(hex);
      addScore(hex, 20);
    }
  }

  // 5. General CSS color declarations
  const anyHexRe = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
  let hm: RegExpExecArray | null;
  let hexCount = 0;
  const scanTarget = combinedCss || html.slice(0, 120000);
  while ((hm = anyHexRe.exec(scanTarget)) !== null && hexCount < 450) {
    hexCount++;
    addScore(`#${hm[1]}`, 2);
  }

  // 6. Enrich with domain-known brand palette ONLY when page returned empty/minimal styles
  const knownDomain = KNOWN_DOMAIN_BRAND_COLORS[domainRoot.toLowerCase()];
  if (knownDomain && brandScores.size < 3) {
    addScore(knownDomain.primary, 42);
    if (knownDomain.bg) {
      bgHints.push(knownDomain.bg);
      addScore(knownDomain.bg, 22);
    }
  }

  const ranked = [...brandScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([hex]) => hex);

  const allDistinctHexes: string[] = [];
  for (const candidate of ranked) {
    if (allDistinctHexes.length >= 14) break;
    const [r1, g1, b1] = hexToRgb(candidate);
    const tooClose = allDistinctHexes.some((existing) => {
      const [r2, g2, b2] = hexToRgb(existing);
      return Math.hypot(r1 - r2, g1 - g2, b1 - b2) < 22;
    });
    if (!tooClose) {
      allDistinctHexes.push(candidate);
    }
  }

  const darkBackgrounds = allDistinctHexes.filter((h) => {
    const m = getColorMetrics(h);
    return m.lum >= 0.008 && m.lum <= 0.22 && m.sat <= 0.28;
  });

  const lightBackgrounds = allDistinctHexes.filter((h) => {
    const m = getColorMetrics(h);
    return m.lum >= 0.76 && m.lum <= 0.99 && m.sat <= 0.28;
  });

  const vibrantAccents = allDistinctHexes.filter((h) => {
    const m = getColorMetrics(h);
    return m.sat >= 0.34 && m.lum >= 0.06 && m.lum <= 0.80;
  });

  const mutedAccents = allDistinctHexes.filter((h) => {
    const m = getColorMetrics(h);
    return m.sat >= 0.12 && m.sat < 0.34 && m.lum >= 0.10 && m.lum <= 0.78;
  });

  const chromaticSvgBrand = svgBrandColors.find((h) => getColorMetrics(h).sat >= 0.2);

  // Detect dark vs. light website polarity from HTML class/attributes, color-scheme meta, or primary bg hint
  const colorSchemeMeta = extractMetaTag(html, 'color-scheme').toLowerCase();
  const htmlOpenTag = html.slice(0, 2500);
  const explicitDarkAttr =
    /\b(?:class=["'][^"']*\bdark\b|data-theme=["']dark["']|data-color-mode=["']dark["'])/i.test(htmlOpenTag) ||
    (colorSchemeMeta.includes('dark') && !colorSchemeMeta.startsWith('light'));

  let isDarkWebsite = explicitDarkAttr;
  if (!isDarkWebsite && bgHints.length > 0) {
    isDarkWebsite = getColorMetrics(bgHints[0]).lum < 0.26;
  } else if (!isDarkWebsite && knownDomain?.isDark !== undefined && bgHints.length === 0) {
    isDarkWebsite = knownDomain.isDark;
  } else if (!isDarkWebsite && darkBackgrounds.length >= 2 && lightBackgrounds.length === 0) {
    isDarkWebsite = true;
  }

  const primaryBrandHex =
    vibrantAccents[0] ??
    chromaticSvgBrand ??
    knownDomain?.primary ??
    mutedAccents[0] ??
    svgBrandColors[0];
  const secondaryBrandHex =
    vibrantAccents[1] ?? mutedAccents[0] ?? svgBrandColors[1] ?? allDistinctHexes[1];

  return {
    themeColor,
    isDarkWebsite,
    primaryBrandHex,
    secondaryBrandHex,
    darkBackgrounds,
    lightBackgrounds,
    vibrantAccents,
    mutedAccents,
    svgBrandColors,
    customPropColors,
    allDistinctHexes,
  };
}

function extractHeadlinesAndCopy(html: string): {
  headlines: string[];
  manifestoSentences: string[];
  navLabels: string[];
  jsonLdOrgName?: string;
  jsonLdInspirations: RealCatalogInspiration[];
} {
  const headlines: string[] = [];
  const manifestoSentences: string[] = [];
  const navLabels: string[] = [];
  const jsonLdInspirations: RealCatalogInspiration[] = [];
  let jsonLdOrgName: string | undefined;

  if (!html) {
    return { headlines, manifestoSentences, navLabels, jsonLdInspirations };
  }

  // 1. Extract <h1> & <h2> hero headlines
  const headingRe = /<h([12])\b[^>]*>([\s\S]{2,900}?)<\/h\1>/gi;
  let hm: RegExpExecArray | null;
  while ((hm = headingRe.exec(html)) !== null && headlines.length < 10) {
    const text = stripHtmlTags(hm[2]);
    if (text.length < 4 || text.length > 115) continue;
    if (BOT_CHALLENGE_TITLE_RE.test(text) || BOILERPLATE_TEXT_RE.test(text)) continue;
    if (!headlines.some((h) => h.toLowerCase() === text.toLowerCase())) {
      headlines.push(text);
    }
  }

  // 2. Extract key manifesto sentences from <p> & <blockquote>
  const paraRe = /<(?:p|blockquote)\b[^>]*>([\s\S]{20,1100}?)<\/(?:p|blockquote)>/gi;
  let pm: RegExpExecArray | null;
  let paraScanned = 0;
  while ((pm = paraRe.exec(html)) !== null && manifestoSentences.length < 6 && paraScanned < 65) {
    paraScanned++;
    const text = stripHtmlTags(pm[1]);
    if (text.length < 32 || text.length > 190) continue;
    if (BOILERPLATE_TEXT_RE.test(text) || BOT_CHALLENGE_TITLE_RE.test(text)) continue;
    if (/^©|\bcopyright\b|\b\d{4}\s+[a-z0-9 ]+\binc\b/i.test(text)) continue;
    if (!manifestoSentences.some((s) => s.toLowerCase() === text.toLowerCase())) {
      manifestoSentences.push(text);
    }
  }

  // 3. Extract navigation section labels from <nav> or <header>
  const navRegions: string[] = [];
  const navBlockRe = /<(?:nav|header)\b[^>]*>([\s\S]{10,18000}?)<\/(?:nav|header)>/gi;
  let nm: RegExpExecArray | null;
  while ((nm = navBlockRe.exec(html)) !== null && navRegions.length < 4) {
    navRegions.push(nm[1]);
  }
  const navHtml = navRegions.join('\n');
  const linkRe = /<(?:a|button)\b[^>]*>([\s\S]{2,240}?)<\/(?:a|button)>/gi;
  let lm: RegExpExecArray | null;
  while ((lm = linkRe.exec(navHtml)) !== null && navLabels.length < 10) {
    const label = stripHtmlTags(lm[1]);
    if (label.length < 3 || label.length > 22) continue;
    if (label.split(/\s+/).length > 3) continue;
    if (GENERIC_NAV_STOP_RE.test(label) || BOILERPLATE_TEXT_RE.test(label)) continue;
    if (!/^[a-zA-Z0-9 &/·'-]+$/.test(label)) continue;
    if (!navLabels.some((n) => n.toLowerCase() === label.toLowerCase())) {
      navLabels.push(label);
    }
  }

  // 4. Extract JSON-LD Organization/WebSite name & optional Product inspirations (no raw images!)
  const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let ldm: RegExpExecArray | null;
  const visitLd = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const sub of node) visitLd(sub);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (obj['@graph']) visitLd(obj['@graph']);
    const typeStr = Array.isArray(obj['@type'])
      ? obj['@type'].join(' ')
      : String(obj['@type'] ?? '');

    if (/Organization|Brand|WebSite|Corporation|NewsMediaOrganization/i.test(typeStr)) {
      if (!jsonLdOrgName && typeof obj.name === 'string' && obj.name.trim().length >= 2) {
        jsonLdOrgName = decodeHtmlEntities(obj.name.trim());
      }
    }

    if (/Product\b/i.test(typeStr) && jsonLdInspirations.length < 10) {
      const title = decodeHtmlEntities(String(obj.name ?? '').trim());
      if (!title || EXCLUDED_PRODUCT_RE.test(title)) return;
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
      const urlStr = typeof obj.url === 'string' ? obj.url : undefined;
      jsonLdInspirations.push({
        title,
        handle: slugify(title),
        productType: decodeHtmlEntities(String(obj.category ?? '')),
        price,
        tags: [],
        shopifyProductUrl: urlStr && /^https?:\/\//i.test(urlStr) ? urlStr : undefined,
      });
    }
  };

  while ((ldm = ldRe.exec(html)) !== null) {
    const raw = ldm[1].trim();
    if (!raw) continue;
    try {
      visitLd(JSON.parse(raw));
    } catch {
      // Ignore malformed third-party JSON-LD
    }
  }

  return {
    headlines,
    manifestoSentences,
    navLabels,
    jsonLdOrgName,
    jsonLdInspirations,
  };
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
  }>;
}

function parseShopifyCatalogInspirations(
  payload: unknown,
  effectiveOrigin: string
): RealCatalogInspiration[] {
  if (!payload || typeof payload !== 'object') return [];
  const obj = payload as { products?: unknown; product?: unknown };
  const rawList: ShopifyJsonProduct[] = Array.isArray(obj.products)
    ? (obj.products as ShopifyJsonProduct[])
    : obj.product && typeof obj.product === 'object'
      ? [obj.product as ShopifyJsonProduct]
      : [];

  const inspirations: RealCatalogInspiration[] = [];
  for (const p of rawList) {
    if (inspirations.length >= 16) break;
    const title = decodeHtmlEntities(String(p.title ?? '').trim());
    if (!title || EXCLUDED_PRODUCT_RE.test(title)) continue;
    const handle = String(p.handle ?? slugify(title)).trim();
    const productType = decodeHtmlEntities(String(p.product_type ?? '').trim());
    const tags = Array.isArray(p.tags)
      ? p.tags.map((t) => String(t).trim()).filter(Boolean)
      : typeof p.tags === 'string'
        ? p.tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : [];
    const firstVariant = Array.isArray(p.variants) && p.variants.length > 0 ? p.variants[0] : undefined;
    const price = parsePriceNumber(firstVariant?.price, 85);
    const vendor = p.vendor ? decodeHtmlEntities(String(p.vendor).trim()) : undefined;

    inspirations.push({
      title,
      handle,
      productType,
      price,
      tags,
      vendor,
      shopifyProductUrl: handle ? `${effectiveOrigin}/products/${handle}` : undefined,
      shopifyVariantId: firstVariant?.id !== undefined ? String(firstVariant.id) : undefined,
    });
  }

  return inspirations;
}

function toTitleCase(phrase: string): string {
  return phrase
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length <= 2 && w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

/**
 * Extracts evocative 1–2 word nouns/concepts and <=16-char graphic copy directly from
 * the website's <h1>/<h2> headlines, nav labels, and manifesto sentences.
 */
function extractBrandVocabulary(
  brandName: string,
  headlines: string[],
  navLabels: string[],
  description: string,
  manifestoSentences: string[]
): { evocativeNouns: string[]; graphicCopyCandidates: string[] } {
  const brandWords = new Set(
    brandName
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 2)
  );

  const evocativeNouns: string[] = [];
  const graphicCopyCandidates: string[] = [];

  // 1. Extract strong 1–2 word phrases from <h1>/<h2> hero headlines & description FIRST
  const textSources = [...headlines, description, ...manifestoSentences.slice(0, 3)];
  for (const line of textSources) {
    const clauses = line
      .split(/[.,:;!?|–—/()[\]"]+/)
      .map((c) => c.trim())
      .filter(Boolean);

    for (const clause of clauses) {
      const words = clause
        .replace(/[^a-zA-Z0-9'-]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter((w) => w.length >= 4 && w.length <= 13 && !/^\d+$/.test(w));

      for (let i = 0; i < words.length; i++) {
        const w1 = words[i];
        const l1 = w1.toLowerCase();
        if (GENERIC_PHRASE_STOPWORDS.has(l1) || brandWords.has(l1)) continue;

        // Try crisp 2-word compound if <= 16 chars
        if (i + 1 < words.length) {
          const w2 = words[i + 1];
          const l2 = w2.toLowerCase();
          if (!GENERIC_PHRASE_STOPWORDS.has(l2) && !brandWords.has(l2)) {
            const pair = `${toTitleCase(w1)} ${toTitleCase(w2)}`;
            if (pair.length <= 18 && !evocativeNouns.includes(pair)) {
              evocativeNouns.push(pair);
            }
            if (pair.length <= 16 && !graphicCopyCandidates.includes(pair.toUpperCase())) {
              graphicCopyCandidates.push(pair.toUpperCase());
            }
          }
        }

        const single = toTitleCase(w1);
        if (!evocativeNouns.includes(single)) {
          evocativeNouns.push(single);
        }
        if (single.length <= 15 && !graphicCopyCandidates.includes(single.toUpperCase())) {
          graphicCopyCandidates.push(single.toUpperCase());
        }

        if (evocativeNouns.length >= 12) break;
      }
      if (evocativeNouns.length >= 12) break;
    }
    if (evocativeNouns.length >= 12) break;
  }

  // 2. Supplement with curated distinctive nav section labels ("Changelog", "Single Origin", "Essays", "Method")
  for (const nav of navLabels) {
    const clean = nav.replace(/[^a-zA-Z0-9 &-]/g, '').trim();
    if (!clean || clean.length < 4 || clean.length > 18) continue;
    if (GENERIC_NAV_STOP_RE.test(clean)) continue;
    const lowerWords = clean.toLowerCase().split(/\s+/);
    if (lowerWords.every((w) => GENERIC_PHRASE_STOPWORDS.has(w) || brandWords.has(w))) continue;
    const titled = toTitleCase(clean);
    if (!evocativeNouns.includes(titled)) {
      evocativeNouns.push(titled);
    }
    if (clean.length <= 16 && !graphicCopyCandidates.includes(clean.toUpperCase())) {
      graphicCopyCandidates.push(clean.toUpperCase());
    }
  }

  return {
    evocativeNouns: evocativeNouns.slice(0, 12),
    graphicCopyCandidates: graphicCopyCandidates.slice(0, 10),
  };
}

function classifyVerticalAndArchetype(
  url: URL,
  domainRoot: string,
  tld: string,
  pageTitle: string,
  description: string,
  headlines: string[],
  manifestoSentences: string[],
  navLabels: string[],
  catalogInspirations: RealCatalogInspiration[],
  isDarkWebsite: boolean
): { archetype: WorldArchetypeId; subVertical: BrandSubVertical } {
  const corpus = [
    domainRoot,
    tld,
    url.pathname,
    pageTitle,
    description,
    ...headlines,
    ...manifestoSentences.slice(0, 4),
    ...navLabels,
    ...catalogInspirations.slice(0, 8).map((p) => `${p.title} ${p.productType} ${p.tags.join(' ')}`),
  ]
    .join(' ')
    .toLowerCase();

  const countHits = (re: RegExp) => (corpus.match(re) ?? []).length;

  const aerospaceHits = countHits(
    /\b(nasa|space|spacecraft|orbital|orbit|rocket|launch|astronaut|mars|lunar|moon|telescope|telemetry|aerospace|propulsion|jpl|artemis|satellite|cosmos)\b/g
  );
  const fintechHits = countHits(
    /\b(stripe|payment|payments|billing|payout|treasury|fintech|ledger|banking|checkout|invoice|invoicing|financial infrastructure|merchant|capital)\b/g
  );
  const softwareTechHits =
    countHits(
      /\b(software|developer|developers|engineering|api|sdk|cloud|deploy|deployment|workflow|issue tracking|changelog|integrations|docs|documentation|latency|open[- ]source|github|cli|terminal|autonomous|model|llm|neural|compute|saas|workspace|linear|vercel|raycast|figma|supabase|protocol|infrastructure)\b/g
    ) + (/^(app|dev|ai|io|cloud|sh|tech)$/.test(tld) ? 3 : 0);

  const coffeeCulinaryHits = countHits(
    /\b(coffee|espresso|roast|roastery|roasters|pour[- ]?over|cafe|barista|single[- ]origin|arabica|cold[- ]brew|matcha|tea|bakery|pastry|culinary|olive oil|ferment|cacao|chocolate|tasting|brew)\b/g
  );
  const botanicalHits = countHits(
    /\b(aesop|botanical|botanicals|apothecary|skincare|skin care|cleanser|serum|balm|aromatic|fragrance|herbaceous|essential oil|formulation|hand wash|body balm|ritual|wellness|ceramics|stoneware|pottery)\b/g
  );
  const organicApparelHits = countHits(
    /\b(kotn|egyptian cotton|organic cotton|linen|natural fiber|natural fibres|b[- ]corp|ethical|traceable|undyed|handwoven|artisan|artisanal|fair[- ]trade|knitwear|sustainable)\b/g
  );
  const writerSubstackHits =
    countHits(
      /\b(substack|newsletter|essays|essay|dispatches|column|reader[- ]supported|subscribers|subscribe|podcast|author|writing|notes|digest)\b/g
    ) + (tld === 'substack.com' ? 8 : 0);

  const filmCinemaHits = countHits(
    /\b(a24|a24films|film|films|cinema|movie|movies|screenplay|director|directors|trailer|box office|screening|documentary|festival|cannes|sundance|motion picture)\b/g
  );
  const musicAudioHits = countHits(
    /\b(music|vinyl|record label|album|tracklist|synth|modular|audio|tour dates|bandcamp|dj|club night|nightlife|soundtrack|sonic)\b/g
  );
  const streetwearHits = countHits(
    /\b(streetwear|skate|skateboard|drop|lookbook|fleece|heavyweight|hoodie|graphic tee|golfwang|golf wang|supreme|palace|stussy|kith|hype|sneaker|cargo|underground|brutalist|avant[- ]garde|contemporary art|zine)\b/g
  );

  const editorialPressHits = countHits(
    /\b(nytimes|new york times|newspaper|journalism|editorial|opinion|pulitzer|breaking news|correspondent|magazine|gazette|chronicle|literary|review|monograph|publishing|press)\b/g
  );
  const collegiateClubHits = countHits(
    /\b(rowing|blazer|blazers|rugby|varsity|collegiate|ivy league|oxford|regatta|clubhouse|tennis|wimbledon|polo|crest|coat of arms|country club|golf club|yacht|equestrian|tailored|savile|tweed)\b/g
  );
  const luxuryArchiveHits = countHits(
    /\b(maison|couture|cashmere|merino|bespoke|heritage|archive|flagship|leather goods|atelier|horology|fine jewelry|sartorial)\b/g
  );
  const portfolioHits =
    countHits(/\b(portfolio|selected work|case studies|product designer|design engineer|creative director|personal site)\b/g) +
    (/^(me|design|studio|work)$/.test(tld) ? 2 : 0);

  // Explicit sub-vertical lock for crisp thematic differentiation
  if (aerospaceHits >= 2 || domainRoot === 'nasa') {
    return { archetype: 'minimalist_tech_pavilion', subVertical: 'aerospace_science' };
  }
  if (fintechHits >= 3 || domainRoot === 'stripe') {
    return { archetype: 'minimalist_tech_pavilion', subVertical: 'fintech' };
  }
  if (coffeeCulinaryHits >= 2 || domainRoot.includes('coffee')) {
    return { archetype: 'warm_artisanal_atelier', subVertical: 'coffee_culinary' };
  }
  if (botanicalHits >= 2 || domainRoot === 'aesop') {
    return { archetype: 'warm_artisanal_atelier', subVertical: 'botanical_apothecary' };
  }
  if (organicApparelHits >= 3 || domainRoot === 'kotn') {
    return { archetype: 'warm_artisanal_atelier', subVertical: 'organic_apparel' };
  }
  if (writerSubstackHits >= 3) {
    return { archetype: 'warm_artisanal_atelier', subVertical: 'writer_substack' };
  }
  if (filmCinemaHits >= 2 || domainRoot.startsWith('a24')) {
    return { archetype: 'avant_garde_concrete_loft', subVertical: 'film_cinema' };
  }
  if (musicAudioHits >= 3) {
    return { archetype: 'avant_garde_concrete_loft', subVertical: 'music_audio' };
  }
  if (editorialPressHits >= 2 || domainRoot === 'nytimes') {
    return { archetype: 'heritage_arch_flagship', subVertical: 'editorial_press' };
  }
  if (collegiateClubHits >= 2 || domainRoot === 'rowingblazers') {
    return { archetype: 'heritage_arch_flagship', subVertical: 'collegiate_club' };
  }

  const techTotal = softwareTechHits + fintechHits + aerospaceHits + (isDarkWebsite ? 1.5 : 0);
  const artisanalTotal = coffeeCulinaryHits + botanicalHits + organicApparelHits + writerSubstackHits;
  const avantTotal = filmCinemaHits + musicAudioHits + streetwearHits + (isDarkWebsite && streetwearHits > 0 ? 2 : 0);
  const heritageTotal = editorialPressHits + collegiateClubHits + luxuryArchiveHits;

  const maxScore = Math.max(techTotal, artisanalTotal, avantTotal, heritageTotal);

  if (maxScore === 0) {
    if (portfolioHits > 0) {
      return {
        archetype: isDarkWebsite ? 'minimalist_tech_pavilion' : 'warm_artisanal_atelier',
        subVertical: 'creative_portfolio',
      };
    }
    return isDarkWebsite
      ? { archetype: 'minimalist_tech_pavilion', subVertical: 'software_ai' }
      : { archetype: 'heritage_arch_flagship', subVertical: 'luxury_archive' };
  }

  if (techTotal === maxScore) {
    return {
      archetype: 'minimalist_tech_pavilion',
      subVertical: portfolioHits >= 2 ? 'creative_portfolio' : 'software_ai',
    };
  }
  if (artisanalTotal === maxScore) {
    return {
      archetype: 'warm_artisanal_atelier',
      subVertical: organicApparelHits >= 2 ? 'organic_apparel' : 'coffee_culinary',
    };
  }
  if (avantTotal === maxScore) {
    return {
      archetype: 'avant_garde_concrete_loft',
      subVertical: 'streetwear_drop',
    };
  }

  return {
    archetype: 'heritage_arch_flagship',
    subVertical: collegiateClubHits > 0 ? 'collegiate_club' : 'luxury_archive',
  };
}

/**
 * Synthesizes an archetype-grounded StorePalette while blending the website's actual scraped
 * CSS/SVG primary & background hex colors with strict WCAG contrast checks.
 */
function buildBrandBlendedPalette(
  archetype: WorldArchetypeId,
  identity: DeepWebsiteIdentity
): {
  palette: StorePalette;
  lightingPreset: LightingPreset;
  metalRoughness: number;
  metalness: number;
} {
  const { colorProfile, hostname } = identity;
  const seed = deterministicHash(hostname);

  const pickFallbackAccent = (): string => {
    if (archetype === 'minimalist_tech_pavilion') {
      const hues = [226, 250, 198, 165, 14];
      const [r, g, b] = hslToRgb(hues[seed % hues.length], 68, 58);
      return rgbToHex(r, g, b);
    }
    if (archetype === 'warm_artisanal_atelier') {
      const hues = [22, 34, 98, 196, 14];
      const [r, g, b] = hslToRgb(hues[seed % hues.length], 46, 40);
      return rgbToHex(r, g, b);
    }
    if (archetype === 'avant_garde_concrete_loft') {
      const hues = [8, 42, 212, 345, 145];
      const [r, g, b] = hslToRgb(hues[seed % hues.length], 76, 54);
      return rgbToHex(r, g, b);
    }
    const hues = [216, 352, 148, 28, 265];
    const [r, g, b] = hslToRgb(hues[seed % hues.length], 48, 30);
    return rgbToHex(r, g, b);
  };

  const rawBrandAccent =
    colorProfile.primaryBrandHex ??
    colorProfile.vibrantAccents[0] ??
    colorProfile.svgBrandColors[0] ??
    colorProfile.mutedAccents[0] ??
    pickFallbackAccent();

  const rawSecondaryBrand =
    colorProfile.secondaryBrandHex ??
    colorProfile.mutedAccents[0] ??
    rawBrandAccent;

  if (archetype === 'minimalist_tech_pavilion') {
    const baseWall = '#17191E';
    const scrapedDark = colorProfile.darkBackgrounds[0];
    const wall = scrapedDark
      ? mixHex(baseWall, scrapedDark, 0.36)
      : mixHex(baseWall, rawBrandAccent, 0.08);
    const floor = mixHex('#22252C', wall, 0.3);
    const accent = ensureWcagContrast(rawBrandAccent, wall, 3.1);
    const secondaryAccent = mixHex(mixHex(wall, '#343A46', 0.55), rawSecondaryBrand, 0.22);

    return {
      palette: {
        wall,
        floor,
        accent,
        secondaryAccent,
        rackMetal: '#C8D0DC',
        hangerWood: '#1E2128',
        plinth: mixHex('#262A33', accent, 0.09),
        rug: mixHex('#1D2027', accent, 0.12),
        ambientLight: '#DCE6F7',
        spotLight: '#F2F6FF',
      },
      lightingPreset: 'cool_gallery_spot',
      metalRoughness: 0.18,
      metalness: 0.94,
    };
  }

  if (archetype === 'warm_artisanal_atelier') {
    const baseWall = '#E8DDD0';
    const scrapedLight = colorProfile.lightBackgrounds[0];
    const wall = scrapedLight
      ? mixHex(baseWall, scrapedLight, 0.34)
      : mixHex(baseWall, rawBrandAccent, 0.06);
    const floor = mixHex('#C9B39B', wall, 0.2);
    const accent = ensureWcagContrast(rawBrandAccent, wall, 3.0);
    const secondaryAccent = mixHex(mixHex(wall, '#D7C5B0', 0.52), rawSecondaryBrand, 0.18);

    return {
      palette: {
        wall,
        floor,
        accent,
        secondaryAccent,
        rackMetal: '#3E3731',
        hangerWood: '#B98B5E',
        plinth: mixHex('#DDD0BE', accent, 0.08),
        rug: mixHex('#D2C2AE', accent, 0.1),
        ambientLight: '#FFEBD2',
        spotLight: '#FFDFA8',
      },
      lightingPreset: 'kyoto_golden_hour',
      metalRoughness: 0.4,
      metalness: 0.78,
    };
  }

  if (archetype === 'avant_garde_concrete_loft') {
    const baseWall = '#323438';
    const scrapedDark = colorProfile.darkBackgrounds[0];
    const wall = scrapedDark
      ? mixHex(baseWall, scrapedDark, 0.28)
      : mixHex(baseWall, rawBrandAccent, 0.07);
    const floor = mixHex('#1E2023', wall, 0.22);
    const accent = ensureWcagContrast(rawBrandAccent, wall, 3.2);
    const secondaryAccent = mixHex(mixHex(wall, '#52565E', 0.48), rawSecondaryBrand, 0.2);

    return {
      palette: {
        wall,
        floor,
        accent,
        secondaryAccent,
        rackMetal: '#DCE0E6',
        hangerWood: '#202124',
        plinth: mixHex('#2B2D31', accent, 0.08),
        rug: mixHex('#24262A', accent, 0.12),
        ambientLight: '#DFE5F0',
        spotLight: '#F6F8FF',
      },
      lightingPreset: 'cool_gallery_spot',
      metalRoughness: 0.15,
      metalness: 0.96,
    };
  }

  // 'heritage_arch_flagship'
  const baseWall = '#F1ECE1';
  const scrapedLight = colorProfile.lightBackgrounds[0];
  const wall = scrapedLight
    ? mixHex(baseWall, scrapedLight, 0.35)
    : mixHex(baseWall, rawBrandAccent, 0.05);
  const floor = mixHex('#DDD4C5', wall, 0.22);
  const accent = ensureWcagContrast(rawBrandAccent, wall, 3.4);
  const secondaryAccent = mixHex(mixHex(wall, '#DFD5C2', 0.55), rawSecondaryBrand, 0.16);

  return {
    palette: {
      wall,
      floor,
      accent,
      secondaryAccent,
      rackMetal: '#C5A059',
      hangerWood: '#6B442A',
      plinth: mixHex('#E5DCC9', accent, 0.07),
      rug: mixHex('#CEC3AF', accent, 0.1),
      ambientLight: '#FFF8EE',
      spotLight: '#FFF4E2',
    },
    lightingPreset: 'warm_court_sunlight',
    metalRoughness: 0.26,
    metalness: 0.86,
  };
}

function defaultMaterialFinishForCategory(category: ProductCategory3D): MaterialFinish {
  switch (category) {
    case 'heavyweight_hoodie':
      return 'brushed_fleece';
    case 'varsity_jacket':
      return 'merino_knit';
    case 'structured_tshirt':
      return 'combed_cotton';
    case 'ceramic_mug':
      return 'matte_stoneware';
    case 'apothecary_bottle':
      return 'frosted_glass';
    case 'canvas_tote':
    case 'structured_cap':
    case 'hardcover_book':
      return 'heavy_canvas';
  }
}

function categorySkuCode(category: ProductCategory3D): string {
  switch (category) {
    case 'heavyweight_hoodie':
      return 'HD';
    case 'varsity_jacket':
      return 'VJ';
    case 'structured_tshirt':
      return 'TS';
    case 'ceramic_mug':
      return 'MG';
    case 'structured_cap':
      return 'CP';
    case 'canvas_tote':
      return 'TT';
    case 'hardcover_book':
      return 'BK';
    case 'apothecary_bottle':
      return 'BT';
  }
}

function clampGraphicHeadline(raw: string | undefined, fallback: string): string {
  const cleaned = (raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9 .·/&'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return fallback.slice(0, 16);
  if (cleaned.length <= 16) return cleaned;
  // Truncate cleanly on word boundary if possible
  const words = cleaned.split(' ');
  let acc = '';
  for (const w of words) {
    const next = acc ? `${acc} ${w}` : w;
    if (next.length <= 16) acc = next;
    else break;
  }
  return acc || cleaned.slice(0, 16).trim();
}

function matchShopifyInspirationForCategory(
  category: ProductCategory3D,
  inspirations: RealCatalogInspiration[],
  usedHandles: Set<string>
): RealCatalogInspiration | undefined {
  if (inspirations.length === 0) return undefined;

  const patterns: Record<ProductCategory3D, RegExp> = {
    heavyweight_hoodie: /\b(hoodie|sweatshirt|fleece|pullover|crewneck)\b/i,
    varsity_jacket: /\b(jacket|blazer|cardigan|coat|overshirt|rugby|sweater|knit)\b/i,
    structured_tshirt: /\b(tee|t-shirt|shirt|polo|jersey|longsleeve|top)\b/i,
    ceramic_mug: /\b(mug|cup|tumbler|dripper|carafe|ceramic|espresso)\b/i,
    structured_cap: /\b(cap|hat|beanie|bucket|visor)\b/i,
    canvas_tote: /\b(tote|bag|weekender|duffel|carryall|pouch)\b/i,
    hardcover_book: /\b(book|journal|magazine|zine|guide|notebook|monograph)\b/i,
    apothecary_bottle: /\b(bottle|cleanser|serum|oil|balm|fragrance|blend|beans|concentrate)\b/i,
  };

  const re = patterns[category];
  const exact = inspirations.find(
    (item) =>
      !usedHandles.has(item.handle) && re.test(`${item.title} ${item.productType} ${item.tags.join(' ')}`)
  );
  if (exact) {
    usedHandles.add(exact.handle);
    return exact;
  }

  return undefined;
}

/**
 * Domain-adaptive Deterministic Creative Director & Merch Strategist (<5ms execution).
 * Produces an authentic spatial Brand Ethos, WorldArchetypeId, WCAG-verified palette,
 * and 6 cohesive 3D products tailored to ANY website's real headlines, vocabulary, and vertical.
 */
function inventDeterministicBrandWorld(identity: DeepWebsiteIdentity): CreativeDirectorBlueprint {
  const {
    brandName,
    monogram,
    hostname,
    subVertical,
    recommendedArchetype: archetype,
    evocativeNouns,
    graphicCopyCandidates,
    headlines,
    description,
    catalogInspirations,
  } = identity;

  const { palette, lightingPreset, metalRoughness, metalness } = buildBrandBlendedPalette(
    archetype,
    identity
  );

  // Pull real site-specific nouns first, falling back to vertical-authentic lexicon
  const verticalLexicon: Record<BrandSubVertical, { nouns: string[]; graphics: string[]; sub: string }> = {
    software_ai: {
      nouns: ['Momentum', 'Cycle Zero', 'Changelog', 'Night Build', 'Kernel', 'Protocol'],
      graphics: [`${monogram} // SYS`, 'CYCLE 01', 'ZERO LATENCY', 'BUILD MODE', 'SHIP FAST', `${monogram} CORE`],
      sub: `ENGINEERED EDITION · ${hostname.toUpperCase()}`,
    },
    fintech: {
      nouns: ['Global Ledger', 'Settlement', 'Mainnet', 'Treasury', ' Clearing', 'API Core'],
      graphics: [`${monogram} LEDGER`, 'SETTLED 01', 'GLOBAL RAIL', 'UPTIME 99.99', `${monogram} INFRA`, 'BORDERLESS'],
      sub: `INFRASTRUCTURE SERIES · ${hostname.toUpperCase()}`,
    },
    aerospace_science: {
      nouns: ['Orbital Vector', 'Telemetry', 'Deep Space', 'Flight Deck', 'Apogee', 'Mission Log'],
      graphics: [`${monogram} ORBITAL`, 'FLIGHT DECK', 'APOGEE LAB', 'TELEMETRY 01', 'LOW ORBIT', `${monogram} VECTOR`],
      sub: `AEROSPACE ARCHIVE · ${hostname.toUpperCase()}`,
    },
    creative_portfolio: {
      nouns: ['Selected Work', 'Form Study', 'Grid Index', 'Prototype', ' Monograph', 'Studio Proof'],
      graphics: [`${monogram} STUDIO`, 'PROOF 01', 'FORM & CODE', 'INDEX EDITION', `${monogram} LAB`, 'ATELIER'],
      sub: `INDEPENDENT PRACTICE · ${hostname.toUpperCase()}`,
    },
    coffee_culinary: {
      nouns: ['Single Origin', 'Morning Pour', 'First Crack', 'Roastery', 'Dial-In', 'Bloom'],
      graphics: ['SINGLE ORIGIN', 'POUR OVER', `${monogram} ROAST`, 'SMALL BATCH', 'MORNING CUP', 'HARVEST LOT'],
      sub: `SMALL-BATCH ROASTERY · ${hostname.toUpperCase()}`,
    },
    botanical_apothecary: {
      nouns: ['Botanical', 'Distillate', 'Herbaceous', 'Formulation', 'Rind & Leaf', 'Lab No. 04'],
      graphics: [`${monogram} LAB 04`, 'BOTANICAL', 'AROMATIC OIL', 'SMALL BATCH', 'APOTHECARY', `${monogram} ESSENCE`],
      sub: `BOTANICAL FORMULATION · ${hostname.toUpperCase()}`,
    },
    organic_apparel: {
      nouns: ['Nile Delta', 'Raw Loom', 'Field Spun', 'Atelier', 'Earth Dye', 'Harvest Knit'],
      graphics: [`${monogram} ATELIER`, 'TRACEABLE', 'NATURAL LOOM', 'FIRST HARVEST', `${monogram} CRAFT`, 'PURE FIBER'],
      sub: `TRACEABLE NATURAL FIBERS · ${hostname.toUpperCase()}`,
    },
    writer_substack: {
      nouns: ['Sunday Issue', 'Margin Notes', 'Longform', 'Dispatch', 'Editorial', 'First Draft'],
      graphics: ['ISSUE NO. 01', 'LONGFORM', `${monogram} PRESS`, 'READERS CLUB', 'MARGINALIA', 'DISPATCH'],
      sub: `READER EDITION · ${hostname.toUpperCase()}`,
    },
    film_cinema: {
      nouns: ["Director's Cut", 'Screening Room', 'Final Draft', '35mm Print', 'Auteur', 'Night Shoot'],
      graphics: ['SCREENING 01', 'FINAL DRAFT', `${monogram} PICTURES`, '35MM ARCHIVE', 'DIRECTORS CUT', 'SCENE 24'],
      sub: `MOTION PICTURE ARCHIVE · ${hostname.toUpperCase()}`,
    },
    music_audio: {
      nouns: ['Test Pressing', 'Soundcheck', 'B-Side', 'Analog Dub', 'Late Session', 'Master Tape'],
      graphics: ['TEST PRESS', '33 1/3 RPM', `${monogram} SOUND`, 'ANALOG LAB', 'LATE SESSION', 'SIDE A'],
      sub: `LIMITED AUDIO EDITION · ${hostname.toUpperCase()}`,
    },
    streetwear_drop: {
      nouns: ['Concrete', 'Heavy Gauge', ' Syndicate', 'Block Party', 'Capsule 01', 'Deadstock'],
      graphics: [`${monogram} DROP 01`, 'HEAVY GAUGE', 'LIMITED RUN', `${monogram} CLUB`, 'ARCHIVE 01', 'WORLDWIDE'],
      sub: `SEASONAL DROP CAPSULE · ${hostname.toUpperCase()}`,
    },
    editorial_press: {
      nouns: ['Morning Desk', 'Print Run', 'Sunday Review', 'Typesetter', 'Columnist', 'Broadsheet'],
      graphics: ['MORNING EDITION', 'PRINT ARCHIVE', `${monogram} DESK`, 'LATE CITY', 'TYPESET 01', 'SUNDAY BOOK'],
      sub: `EDITORIAL ARCHIVE · ${hostname.toUpperCase()}`,
    },
    collegiate_club: {
      nouns: ['Regatta', 'Clubhouse', 'Varsity Crest', 'Boathouse', 'First VIII', 'Lawn Court'],
      graphics: [`${monogram} CLUB`, 'VARSITY XV', 'CHAMPIONSHIP', 'BOATHOUSE', `EST. ${monogram}`, 'REGATTA'],
      sub: `HERITAGE CLUBHOUSE · ${hostname.toUpperCase()}`,
    },
    luxury_archive: {
      nouns: ['Grand Salon', 'Atelier', 'Sartorial', 'First Edition', 'Archive', 'Reserve'],
      graphics: [`MAISON ${monogram}`, 'ATELIER 01', 'RESERVE', `${monogram} CREST`, 'ARCHIVE EDITION', 'BESPOKE'],
      sub: `FLAGSHIP ARCHIVE · ${hostname.toUpperCase()}`,
    },
  };

  const lex = verticalLexicon[subVertical];
  const mergedNouns = [...evocativeNouns, ...lex.nouns];
  const mergedGraphics = [...graphicCopyCandidates, ...lex.graphics];

  const nounAt = (idx: number) => mergedNouns[idx % mergedNouns.length] || lex.nouns[idx % lex.nouns.length];
  const graphicAt = (idx: number) =>
    clampGraphicHeadline(mergedGraphics[idx % mergedGraphics.length], monogram);

  // Select optimal hanging silhouettes + 3 distinct physical object categories for this sub-vertical
  let apparelOrder: [ProductCategory3D, ProductCategory3D, ProductCategory3D] = [
    'heavyweight_hoodie',
    'structured_tshirt',
    'varsity_jacket',
  ];
  let objectOrder: [ProductCategory3D, ProductCategory3D, ProductCategory3D] = [
    'hardcover_book',
    'ceramic_mug',
    'structured_cap',
  ];
  let motifs: ProductGraphicMotif[] = [
    'geometric_grid',
    'minimal_typo',
    'orbital_rings',
    'minimal_typo',
    'geometric_grid',
    'monogram_crest',
  ];

  if (subVertical === 'aerospace_science') {
    apparelOrder = ['varsity_jacket', 'heavyweight_hoodie', 'structured_tshirt'];
    objectOrder = ['hardcover_book', 'structured_cap', 'ceramic_mug'];
    motifs = ['orbital_rings', 'geometric_grid', 'minimal_typo', 'orbital_rings', 'archival_seal', 'geometric_grid'];
  } else if (subVertical === 'coffee_culinary') {
    apparelOrder = ['structured_tshirt', 'heavyweight_hoodie', 'varsity_jacket'];
    objectOrder = ['ceramic_mug', 'canvas_tote', 'apothecary_bottle'];
    motifs = ['botanical_line', 'archival_seal', 'minimal_typo', 'botanical_line', 'minimal_typo', 'archival_seal'];
  } else if (subVertical === 'botanical_apothecary') {
    apparelOrder = ['structured_tshirt', 'heavyweight_hoodie', 'varsity_jacket'];
    objectOrder = ['apothecary_bottle', 'hardcover_book', 'canvas_tote'];
    motifs = ['botanical_line', 'minimal_typo', 'archival_seal', 'minimal_typo', 'botanical_line', 'minimal_typo'];
  } else if (subVertical === 'organic_apparel') {
    apparelOrder = ['heavyweight_hoodie', 'structured_tshirt', 'varsity_jacket'];
    objectOrder = ['canvas_tote', 'apothecary_bottle', 'hardcover_book'];
    motifs = ['botanical_line', 'minimal_typo', 'monogram_crest', 'archival_seal', 'botanical_line', 'minimal_typo'];
  } else if (subVertical === 'writer_substack' || subVertical === 'editorial_press') {
    apparelOrder = ['heavyweight_hoodie', 'structured_tshirt', 'varsity_jacket'];
    objectOrder = ['hardcover_book', 'canvas_tote', 'ceramic_mug'];
    motifs = ['minimal_typo', 'archival_seal', 'monogram_crest', 'minimal_typo', 'archival_seal', 'minimal_typo'];
  } else if (subVertical === 'film_cinema' || subVertical === 'music_audio') {
    apparelOrder = ['varsity_jacket', 'heavyweight_hoodie', 'structured_tshirt'];
    objectOrder = ['hardcover_book', 'structured_cap', 'canvas_tote'];
    motifs = ['minimal_typo', 'archival_seal', 'geometric_grid', 'minimal_typo', 'monogram_crest', 'archival_seal'];
  } else if (subVertical === 'streetwear_drop') {
    apparelOrder = ['heavyweight_hoodie', 'varsity_jacket', 'structured_tshirt'];
    objectOrder = ['structured_cap', 'canvas_tote', 'ceramic_mug'];
    motifs = ['archival_seal', 'monogram_crest', 'geometric_grid', 'monogram_crest', 'minimal_typo', 'geometric_grid'];
  } else if (subVertical === 'collegiate_club' || subVertical === 'luxury_archive') {
    apparelOrder = ['varsity_jacket', 'heavyweight_hoodie', 'structured_tshirt'];
    objectOrder = ['hardcover_book', 'structured_cap', 'canvas_tote'];
    motifs = ['monogram_crest', 'archival_seal', 'minimal_typo', 'monogram_crest', 'monogram_crest', 'archival_seal'];
  }

  // Curated 6-piece capsule color story anchored by scraped brand colors + WCAG legibility
  const isDarkRoom = archetype === 'minimalist_tech_pavilion' || archetype === 'avant_garde_concrete_loft';
  const darkAnchor = isDarkRoom ? mixHex('#181A20', palette.accent, 0.12) : mixHex('#1D222B', palette.accent, 0.22);
  const lightNeutral = isDarkRoom ? '#ECE9E1' : '#F5F0E6';
  const richBrandBody = ensureWcagContrast(
    mixHex(palette.accent, '#1B1F28', 0.22),
    palette.wall,
    2.2
  );
  const canvasEcru = '#EDE5D6';
  const stonewareTone = isDarkRoom ? mixHex('#262930', palette.accent, 0.16) : mixHex('#E4DACB', palette.accent, 0.12);

  const slotConfigs: Array<{
    placement: ProductPlacementZone;
    category: ProductCategory3D;
    featured: boolean;
    primaryColor: string;
    secondaryColor: string;
    desiredAccent: string;
  }> = [
    {
      placement: 'hero_rack',
      category: apparelOrder[0],
      featured: true,
      primaryColor: darkAnchor,
      secondaryColor: mixHex(darkAnchor, lightNeutral, 0.22),
      desiredAccent: palette.accent,
    },
    {
      placement: 'capsule_rack',
      category: apparelOrder[1],
      featured: false,
      primaryColor: lightNeutral,
      secondaryColor: mixHex(lightNeutral, darkAnchor, 0.18),
      desiredAccent: palette.accent,
    },
    {
      placement: 'capsule_rack',
      category: apparelOrder[2],
      featured: false,
      primaryColor: richBrandBody,
      secondaryColor: lightNeutral,
      desiredAccent: '#F6F2E9',
    },
    {
      placement: 'center_table',
      category: objectOrder[0],
      featured: false,
      primaryColor: objectOrder[0] === 'apothecary_bottle' ? '#3B281D' : darkAnchor,
      secondaryColor: canvasEcru,
      desiredAccent: palette.accent,
    },
    {
      placement: 'left_pedestal',
      category: objectOrder[1],
      featured: false,
      primaryColor: objectOrder[1] === 'canvas_tote' ? canvasEcru : stonewareTone,
      secondaryColor: darkAnchor,
      desiredAccent: palette.accent,
    },
    {
      placement: 'right_pedestal',
      category: objectOrder[2],
      featured: false,
      primaryColor:
        objectOrder[2] === 'apothecary_bottle'
          ? '#3B281D'
          : objectOrder[2] === 'canvas_tote'
            ? canvasEcru
            : mixHex(darkAnchor, palette.accent, 0.32),
      secondaryColor: lightNeutral,
      desiredAccent: objectOrder[2] === 'canvas_tote' ? darkAnchor : '#F5F1E8',
    },
  ];

  const cleanBrandTitle = toTitleCase(brandName.replace(/^THE\s+/i, ''));
  const composeTitle = (prefix: string, suffix: string): string => {
    const suffixWords = new Set(
      suffix
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, '')
        .split(/\s+/)
    );
    const filteredPrefix = prefix
      .split(/\s+/)
      .filter((w) => !suffixWords.has(w.toLowerCase()))
      .join(' ')
      .trim();
    return `${filteredPrefix || monogram} ${suffix}`;
  };

  const categoryTemplates: Record<
    ProductCategory3D,
    (concept: string) => {
      title: string;
      subtitle: string;
      price: number;
      rationale: string;
    }
  > = {
    heavyweight_hoodie: (c) => ({
      title: composeTitle(c, '480gsm Hoodie'),
      subtitle: `${brandName} · Loopback Heavyweight French Terry`,
      price: 148,
      rationale: `Translates ${brandName}'s "${c}" ethos into a tactile daily uniform piece with gallery-grade drape and high-contrast chest typography.`,
    }),
    varsity_jacket: (c) => ({
      title: composeTitle(c, 'Wool Varsity Jacket'),
      subtitle: `${brandName} · Boiled Merino Body & Contrast Trim`,
      price: 295,
      rationale: `Positions ${brandName} as an insider cultural club with a collectible statement outerwear silhouette anchored by the ${monogram} emblem.`,
    }),
    structured_tshirt: (c) => ({
      title: composeTitle(c, 'Heavyweight Tee'),
      subtitle: `${brandName} · 275gsm Combed Organic Jersey`,
      price: 68,
      rationale: `Offers an accessible, high-margin entry point into the ${brandName} world using architectural box-cut proportions and crisp graphic ink.`,
    }),
    ceramic_mug: (c) => ({
      title: composeTitle(c, 'Stoneware Mug'),
      subtitle: `${brandName} · Hand-Glazed Matte Kiln Ceramic`,
      price: 38,
      rationale: `Brings ${brandName} onto the customer's desk and morning ritual counter with tactile matte stoneware glazed in brand tones.`,
    }),
    structured_cap: (c) => ({
      title: composeTitle(c, '6-Panel Club Cap'),
      subtitle: `${brandName} · Brushed Cotton Twill & Raised Stitch`,
      price: 48,
      rationale: `Delivers subtle everyday insider signaling for ${brandName} fans through structured crown geometry and tonal ${monogram} embroidery.`,
    }),
    canvas_tote: (c) => ({
      title: composeTitle(c, '16oz Canvas Tote'),
      subtitle: `${brandName} · Gusseted Unbleached Heavy Duck Canvas`,
      price: 54,
      rationale: `Turns ${brandName}'s editorial identity into a mobile street-level billboard sized for laptops, vinyl, and weekend market runs.`,
    }),
    hardcover_book: (c) => ({
      title: `${c}: The ${cleanBrandTitle} Monograph`,
      subtitle: `${brandName} · Foil-Stamped Clothbound Hardcover (240pp)`,
      price: 78,
      rationale: `Cements ${brandName}'s intellectual authority on the center display table as a collectible coffee-table artifact.`,
    }),
    apothecary_bottle: (c) => ({
      title: composeTitle(c, 'Botanical Elixir'),
      subtitle: `${brandName} · UV-Amber Frosted Apothecary Vessel (250ml)`,
      price: 64,
      rationale: `Extends ${brandName}'s sensory world beyond textiles with an architectural apothecary vessel designed for sculptural shelf presence.`,
    }),
  };

  const brandSlug = slugify(brandName);
  const usedShopifyHandles = new Set<string>();

  const products: InventedProductSpec[] = slotConfigs.map((slot, idx) => {
    const concept = nounAt(idx);
    const tpl = categoryTemplates[slot.category](concept);
    const matchedShopify = matchShopifyInspirationForCategory(
      slot.category,
      catalogInspirations,
      usedShopifyHandles
    );

    const accentColor = ensureWcagContrast(slot.desiredAccent, slot.primaryColor, 3.6);
    const secondaryColor =
      wcagContrastRatio(slot.secondaryColor, slot.primaryColor) >= 1.35
        ? slot.secondaryColor
        : mixHex(slot.primaryColor, accentColor, 0.28);

    const title =
      matchedShopify && matchedShopify.title.length <= 54
        ? matchedShopify.title
        : tpl.title;
    const price = matchedShopify ? matchedShopify.price : tpl.price;

    return {
      id: `inv-${brandSlug}-${idx + 1}-${slot.placement}`,
      sku: `${monogram}-${categorySkuCode(slot.category)}-0${idx + 1}`,
      title,
      subtitle: tpl.subtitle,
      category: slot.category,
      placement: slot.placement,
      price,
      primaryColor: slot.primaryColor,
      secondaryColor,
      accentColor,
      graphicHeadline: graphicAt(idx),
      graphicSubtext: lex.sub.slice(0, 38),
      graphicMotif: motifs[idx % motifs.length],
      materialFinish: defaultMaterialFinishForCategory(slot.category),
      designRationale: tpl.rationale,
      shopifyProductUrl: matchedShopify?.shopifyProductUrl,
      shopifyVariantId: matchedShopify?.shopifyVariantId,
      featured: slot.featured,
    };
  });

  const leadQuote = headlines[0] || description;
  const trimmedQuote =
    leadQuote && leadQuote.length >= 8
      ? `"${leadQuote.slice(0, 78)}${leadQuote.length > 78 ? '...' : ''}"`
      : `${hostname}'s signature digital identity`;

  const archetypeDescriptions: Record<
    WorldArchetypeId,
    { label: string; vibe: string; taglinePrefix: string }
  > = {
    minimalist_tech_pavilion: {
      label: 'Minimalist Tech Pavilion',
      vibe: 'Obsidian architectural slate, honed basalt slabs, anodized steel rails & 5200K gallery spots',
      taglinePrefix: 'PRECISION HARDWARE & APPAREL PAVILION',
    },
    warm_artisanal_atelier: {
      label: 'Warm Artisanal Atelier',
      vibe: 'Hand-troweled sand clay plaster, white oak timber, blackened bronze fixtures & Kyoto golden hour light',
      taglinePrefix: 'SMALL-BATCH ATELIER & OBJECT STUDY',
    },
    avant_garde_concrete_loft: {
      label: 'Avant-Garde Concrete Loft',
      vibe: 'Board-formed monolithic concrete, dark aggregate terrazzo, mirror chrome & high-contrast gallery beam',
      taglinePrefix: 'SCREENING ROOM & CAPSULE LOFT',
    },
    heritage_arch_flagship: {
      label: 'Heritage Arch Flagship',
      vibe: 'Venetian limewash arches, honed Roman travertine, antique brass hardware & warm afternoon court sunlight',
      taglinePrefix: 'FLAGSHIP CLUBHOUSE & ARCHIVE SALON',
    },
  };

  const archMeta = archetypeDescriptions[archetype];
  const brandEthos = `Distilled ${trimmedQuote} into a bespoke ${archMeta.label} (${palette.wall} / ${palette.accent}), pairing 3 tailored ${brandName} silhouettes with 3 tactile collector objects.`;

  const architectNotes = [
    `Selected the ${archMeta.label} archetype for ${hostname}, blending scraped brand accent (${palette.accent}) against ${palette.wall} architectural surfaces with WCAG-verified contrast.`,
    `Extracted website headline vocabulary (${evocativeNouns.slice(0, 3).join(', ') || nounAt(0)}) directly into chest graphics, hardcover monograph typography, and bespoke SKUs.`,
    `Merchandised 1 centerpiece ${products[0].category.replace('_', ' ')} on the hero faceout, 2 companion silhouettes on the capsule rail, and 3 physical 3D objects across the table and pedestals.`,
  ];

  return {
    brandName,
    tagline: `${archMeta.taglinePrefix} // ${hostname.toUpperCase()}`,
    vibe: archMeta.vibe,
    brandEthos,
    archetype,
    lightingPreset,
    metalRoughness,
    metalness,
    palette,
    architectNotes,
    products,
  };
}

function sanitizeStorePalette(
  raw: Partial<StorePalette> | undefined,
  fallback: StorePalette,
  scrapedPrimaryHex?: string
): StorePalette {
  if (!raw || typeof raw !== 'object') return fallback;
  const wall = normalizeHexColor(raw.wall) ?? fallback.wall;
  const floor = normalizeHexColor(raw.floor) ?? fallback.floor;
  let accent = normalizeHexColor(raw.accent) ?? fallback.accent;
  if (scrapedPrimaryHex) {
    accent = mixHex(accent, scrapedPrimaryHex, 0.35);
  }
  accent = ensureWcagContrast(accent, wall, 3.0);

  return {
    wall,
    floor,
    accent,
    secondaryAccent: normalizeHexColor(raw.secondaryAccent) ?? fallback.secondaryAccent,
    rackMetal: normalizeHexColor(raw.rackMetal) ?? fallback.rackMetal,
    hangerWood: normalizeHexColor(raw.hangerWood) ?? fallback.hangerWood,
    plinth: normalizeHexColor(raw.plinth) ?? fallback.plinth,
    rug: normalizeHexColor(raw.rug) ?? fallback.rug,
    ambientLight: normalizeHexColor(raw.ambientLight) ?? fallback.ambientLight,
    spotLight: normalizeHexColor(raw.spotLight) ?? fallback.spotLight,
  };
}

const CREATIVE_DIRECTOR_SCHEMA = {
  type: 'object',
  properties: {
    brandName: { type: 'string' },
    tagline: { type: 'string' },
    vibe: { type: 'string' },
    brandEthos: { type: 'string' },
    archetype: {
      type: 'string',
      enum: [
        'heritage_arch_flagship',
        'minimalist_tech_pavilion',
        'warm_artisanal_atelier',
        'avant_garde_concrete_loft',
      ],
    },
    lightingPreset: {
      type: 'string',
      enum: ['warm_court_sunlight', 'cool_gallery_spot', 'kyoto_golden_hour'],
    },
    metalRoughness: { type: 'number' },
    metalness: { type: 'number' },
    palette: {
      type: 'object',
      properties: {
        wall: { type: 'string' },
        floor: { type: 'string' },
        accent: { type: 'string' },
        secondaryAccent: { type: 'string' },
        rackMetal: { type: 'string' },
        hangerWood: { type: 'string' },
        plinth: { type: 'string' },
        rug: { type: 'string' },
        ambientLight: { type: 'string' },
        spotLight: { type: 'string' },
      },
      required: ['wall', 'floor', 'accent', 'secondaryAccent', 'rackMetal', 'hangerWood', 'plinth', 'rug', 'ambientLight', 'spotLight'],
    },
    architectNotes: {
      type: 'array',
      items: { type: 'string' },
    },
    products: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          subtitle: { type: 'string' },
          category: {
            type: 'string',
            enum: [
              'heavyweight_hoodie',
              'structured_tshirt',
              'varsity_jacket',
              'ceramic_mug',
              'structured_cap',
              'canvas_tote',
              'hardcover_book',
              'apothecary_bottle',
            ],
          },
          placement: {
            type: 'string',
            enum: ['hero_rack', 'capsule_rack', 'center_table', 'left_pedestal', 'right_pedestal'],
          },
          price: { type: 'number' },
          primaryColor: { type: 'string' },
          secondaryColor: { type: 'string' },
          accentColor: { type: 'string' },
          graphicHeadline: { type: 'string' },
          graphicSubtext: { type: 'string' },
          graphicMotif: {
            type: 'string',
            enum: [
              'monogram_crest',
              'geometric_grid',
              'botanical_line',
              'minimal_typo',
              'archival_seal',
              'orbital_rings',
            ],
          },
          materialFinish: {
            type: 'string',
            enum: [
              'combed_cotton',
              'brushed_fleece',
              'merino_knit',
              'matte_stoneware',
              'frosted_glass',
              'heavy_canvas',
            ],
          },
          designRationale: { type: 'string' },
        },
        required: [
          'title',
          'subtitle',
          'category',
          'placement',
          'price',
          'primaryColor',
          'secondaryColor',
          'accentColor',
          'graphicHeadline',
          'graphicMotif',
          'designRationale',
        ],
      },
    },
  },
  required: ['brandName', 'tagline', 'vibe', 'brandEthos', 'archetype', 'lightingPreset', 'palette', 'architectNotes', 'products'],
};

/**
 * Gemini 4 Creative Director & Merch Strategist via `@google/genai` Interactions API.
 * Enforces a tight 5.5s live-demo timeout and normalizes all 6 product slots + WCAG colors.
 */
async function tryInventWithGemini(
  apiKey: string,
  model: string,
  identity: DeepWebsiteIdentity,
  fallback: CreativeDirectorBlueprint
): Promise<CreativeDirectorBlueprint | null> {
  const promptContext = {
    websiteUrl: identity.url,
    hostname: identity.hostname,
    brandName: identity.brandName,
    monogram: identity.monogram,
    pageTitle: identity.pageTitle,
    description: identity.description,
    heroHeadlines: identity.headlines.slice(0, 6),
    manifestoSentences: identity.manifestoSentences.slice(0, 4),
    navSections: identity.navLabels.slice(0, 8),
    extractedVocabulary: identity.evocativeNouns.slice(0, 10),
    colorProfile: {
      isDarkWebsite: identity.colorProfile.isDarkWebsite,
      themeColor: identity.colorProfile.themeColor,
      primaryBrandHex: identity.colorProfile.primaryBrandHex,
      vibrantAccents: identity.colorProfile.vibrantAccents.slice(0, 5),
      darkBackgrounds: identity.colorProfile.darkBackgrounds.slice(0, 3),
      lightBackgrounds: identity.colorProfile.lightBackgrounds.slice(0, 3),
    },
    recommendedArchetype: identity.recommendedArchetype,
    realStoreInspirations: identity.catalogInspirations.slice(0, 6).map((p) => ({
      title: p.title,
      type: p.productType,
      price: p.price,
    })),
  };

  const systemInstruction = `You are a world-class Retail Creative Director, Spatial Architect, and Brand Merch Strategist.
Given any website's scraped identity, ethos, headlines, and CSS colors, invent a bespoke 3D flagship showroom AND a cohesive 6-product sellable capsule line specifically tailored to that brand:
1. Choose the exact archetype:
   - "minimalist_tech_pavilion": software, AI, fintech, developer tools, aerospace, modern hardware (obsidian/slate walls ~#17191E, basalt floor ~#22252C, anodized steel #C8D0DC, "cool_gallery_spot").
   - "warm_artisanal_atelier": coffee, food/beverage, botanicals, skincare, ceramics, organic craft, newsletters/Substacks (warm clay/sand walls ~#E8DDD0, oak/limestone floor ~#C9B39B, blackened bronze #3E3731, "kyoto_golden_hour").
   - "avant_garde_concrete_loft": film, cinema, music, streetwear, gaming, contemporary art (board-formed concrete ~#323438, dark terrazzo ~#1E2023, chrome #DCE0E6, bold accent, "cool_gallery_spot").
   - "heritage_arch_flagship": collegiate, sports clubs, newspapers/publishing, classic fashion, luxury archive (limewash ~#F1ECE1, travertine ~#DDD4C5, antique brass #C5A059, "warm_court_sunlight").
   Blend the website's real scraped hex colors into palette.accent and palette.wall!
2. Write a sharp 1-2 sentence "brandEthos" explaining the website's core ethos and spatial retail concept.
3. Invent EXACTLY 6 products in this order:
   - Product 1: placement="hero_rack", category in ["heavyweight_hoodie","varsity_jacket","structured_tshirt"] (centerpiece garment)
   - Product 2: placement="capsule_rack", category in ["heavyweight_hoodie","varsity_jacket","structured_tshirt"]
   - Product 3: placement="capsule_rack", category in ["heavyweight_hoodie","varsity_jacket","structured_tshirt"]
   - Product 4: placement="center_table", category in ["ceramic_mug","structured_cap","canvas_tote","hardcover_book","apothecary_bottle"]
   - Product 5: placement="left_pedestal", category in ["ceramic_mug","structured_cap","canvas_tote","hardcover_book","apothecary_bottle"] (distinct category)
   - Product 6: placement="right_pedestal", category in ["ceramic_mug","structured_cap","canvas_tote","hardcover_book","apothecary_bottle"] (distinct category)
   Use evocative nouns/phrases from the site's actual headlines! Keep every graphicHeadline <= 16 uppercase characters, vary primaryColor across items, ensure strong contrast between primaryColor and accentColor, and give each a 1-sentence designRationale.`;

  const ai = new GoogleGenAI({ apiKey });

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error('Gemini Creative Director timed out after 5500ms'));
    }, 5500);
  });

  let rawText: string | null | undefined;
  try {
    const interaction = await Promise.race([
      ai.interactions.create({
        model,
        system_instruction: systemInstruction,
        input: `Website Identity Data:\n${JSON.stringify(promptContext)}`,
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: CREATIVE_DIRECTOR_SCHEMA,
        },
      }),
      timeoutPromise,
    ]);
    rawText = interaction.output_text;
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }

  if (!rawText) return null;

  const cleanedJson = rawText.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
  const parsed = JSON.parse(cleanedJson) as Partial<CreativeDirectorBlueprint>;

  const archetype: WorldArchetypeId =
    parsed.archetype && VALID_ARCHETYPES.has(parsed.archetype)
      ? parsed.archetype
      : fallback.archetype;

  const archetypeBase = buildBrandBlendedPalette(archetype, identity);
  const palette = sanitizeStorePalette(
    parsed.palette,
    archetypeBase.palette,
    identity.colorProfile.primaryBrandHex
  );

  const lightingPreset: LightingPreset =
    parsed.lightingPreset && VALID_LIGHTING_PRESETS.has(parsed.lightingPreset)
      ? parsed.lightingPreset
      : archetypeBase.lightingPreset;

  const metalRoughness =
    typeof parsed.metalRoughness === 'number' && Number.isFinite(parsed.metalRoughness)
      ? Math.max(0.1, Math.min(0.6, parsed.metalRoughness))
      : archetypeBase.metalRoughness;

  const metalness =
    typeof parsed.metalness === 'number' && Number.isFinite(parsed.metalness)
      ? Math.max(0.55, Math.min(0.98, parsed.metalness))
      : archetypeBase.metalness;

  const brandName =
    typeof parsed.brandName === 'string' && parsed.brandName.trim()
      ? parsed.brandName.trim().toUpperCase().slice(0, 38)
      : fallback.brandName;

  const brandSlug = slugify(brandName);
  const rawProducts = Array.isArray(parsed.products) ? parsed.products : [];

  const rawApparel = rawProducts.filter((p) => p && VALID_APPAREL_SET.has(p.category as ProductCategory3D));
  const rawObjects = rawProducts.filter((p) => p && VALID_OBJECT_SET.has(p.category as ProductCategory3D));

  const targetSlots: ReadonlyArray<{ placement: ProductPlacementZone; isApparel: boolean; featured: boolean }> = [
    { placement: 'hero_rack', isApparel: true, featured: true },
    { placement: 'capsule_rack', isApparel: true, featured: false },
    { placement: 'capsule_rack', isApparel: true, featured: false },
    { placement: 'center_table', isApparel: false, featured: false },
    { placement: 'left_pedestal', isApparel: false, featured: false },
    { placement: 'right_pedestal', isApparel: false, featured: false },
  ];

  const usedShopifyHandles = new Set<string>();
  let apparelCursor = 0;
  let objectCursor = 0;

  const normalizedProducts: InventedProductSpec[] = targetSlots.map((slot, idx) => {
    const fb = fallback.products[idx];
    const candidate = slot.isApparel ? rawApparel[apparelCursor++] : rawObjects[objectCursor++];

    const category: ProductCategory3D =
      candidate?.category &&
      (slot.isApparel
        ? VALID_APPAREL_SET.has(candidate.category)
        : VALID_OBJECT_SET.has(candidate.category))
        ? candidate.category
        : fb.category;

    const primaryColor = normalizeHexColor(candidate?.primaryColor) ?? fb.primaryColor;
    const rawAccent = normalizeHexColor(candidate?.accentColor) ?? fb.accentColor;
    const accentColor = ensureWcagContrast(rawAccent, primaryColor, 3.5);
    const rawSecondary = normalizeHexColor(candidate?.secondaryColor) ?? fb.secondaryColor;
    const secondaryColor =
      wcagContrastRatio(rawSecondary, primaryColor) >= 1.3
        ? rawSecondary
        : mixHex(primaryColor, accentColor, 0.25);

    const graphicMotif: ProductGraphicMotif =
      candidate?.graphicMotif && VALID_MOTIFS.has(candidate.graphicMotif)
        ? candidate.graphicMotif
        : fb.graphicMotif;

    const materialFinish: MaterialFinish =
      candidate?.materialFinish && VALID_FINISHES.has(candidate.materialFinish)
        ? candidate.materialFinish
        : defaultMaterialFinishForCategory(category);

    const matchedShopify = matchShopifyInspirationForCategory(
      category,
      identity.catalogInspirations,
      usedShopifyHandles
    );

    return {
      id: `inv-${brandSlug}-${idx + 1}-${slot.placement}`,
      sku: `${identity.monogram}-${categorySkuCode(category)}-0${idx + 1}`,
      title:
        typeof candidate?.title === 'string' && candidate.title.trim().length >= 3
          ? candidate.title.trim().slice(0, 64)
          : fb.title,
      subtitle:
        typeof candidate?.subtitle === 'string' && candidate.subtitle.trim().length >= 3
          ? candidate.subtitle.trim().slice(0, 76)
          : fb.subtitle,
      category,
      placement: slot.placement,
      price: parsePriceNumber(candidate?.price, fb.price),
      primaryColor,
      secondaryColor,
      accentColor,
      graphicHeadline: clampGraphicHeadline(candidate?.graphicHeadline, fb.graphicHeadline),
      graphicSubtext:
        typeof candidate?.graphicSubtext === 'string' && candidate.graphicSubtext.trim()
          ? candidate.graphicSubtext.trim().slice(0, 40)
          : fb.graphicSubtext,
      graphicMotif,
      materialFinish,
      designRationale:
        typeof candidate?.designRationale === 'string' && candidate.designRationale.trim().length >= 8
          ? candidate.designRationale.trim().slice(0, 180)
          : fb.designRationale,
      shopifyProductUrl: matchedShopify?.shopifyProductUrl ?? fb.shopifyProductUrl,
      shopifyVariantId: matchedShopify?.shopifyVariantId ?? fb.shopifyVariantId,
      featured: slot.featured,
    };
  });

  return {
    brandName,
    tagline:
      typeof parsed.tagline === 'string' && parsed.tagline.trim()
        ? parsed.tagline.trim().slice(0, 76)
        : fallback.tagline,
    vibe:
      typeof parsed.vibe === 'string' && parsed.vibe.trim()
        ? parsed.vibe.trim().slice(0, 130)
        : fallback.vibe,
    brandEthos:
      typeof parsed.brandEthos === 'string' && parsed.brandEthos.trim()
        ? parsed.brandEthos.trim().slice(0, 240)
        : fallback.brandEthos,
    archetype,
    lightingPreset,
    metalRoughness,
    metalness,
    palette,
    architectNotes:
      Array.isArray(parsed.architectNotes) && parsed.architectNotes.length > 0
        ? parsed.architectNotes.map((n) => String(n).trim()).filter(Boolean).slice(0, 4)
        : fallback.architectNotes,
    products: normalizedProducts,
  };
}

function productSpecToGarmentAsset(spec: InventedProductSpec, featured: boolean): GarmentAssetSet {
  return {
    id: spec.id,
    sku: spec.sku,
    title: spec.title,
    subtitle: spec.subtitle,
    price: spec.price,
    featured,
    productSpec: { ...spec, featured },
    rawUrl: '',
    dominantHex: spec.primaryColor,
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

async function fetchJsonSafely(url: string, timeoutMs = 1700): Promise<unknown | null> {
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
  timeoutMs = 3200
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
    const titleSnippet = html.match(/<title[^>]*>([\s\S]{0,180}?)<\/title>/i)?.[1] ?? '';
    if (BOT_CHALLENGE_TITLE_RE.test(stripHtmlTags(titleSnippet))) {
      return null;
    }
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

async function fetchFirstStylesheetSnippet(
  html: string,
  baseOrigin: string,
  timeoutMs = 650
): Promise<string> {
  const linkRe = /<link\b[^>]+rel=["']stylesheet["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const hrefMatch = m[0].match(/\bhref=["']([^"']+)["']/i);
    if (!hrefMatch?.[1]) continue;
    const rawHref = decodeHtmlEntities(hrefMatch[1].trim());
    if (/fonts\.googleapis\.com|use\.typekit\.net|fontawesome/i.test(rawHref)) continue;
    try {
      const cssUrl = new URL(rawHref.startsWith('//') ? `https:${rawHref}` : rawHref, baseOrigin);
      if ((cssUrl.protocol !== 'http:' && cssUrl.protocol !== 'https:') || isDisallowedHost(cssUrl.hostname)) {
        continue;
      }
      const res = await fetch(cssUrl.toString(), {
        headers: { 'User-Agent': BROWSER_USER_AGENT, Accept: 'text/css,*/*;q=0.8' },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) continue;
      const text = await res.text();
      return text.slice(0, 140000);
    } catch {
      return '';
    }
  }
  return '';
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

  const collectionHandle = targetUrl.pathname.match(/\/collections\/([^/?#]+)/i)?.[1];
  const productHandle = targetUrl.pathname.match(/\/products\/([^/?#]+)/i)?.[1];

  // Start HTML fetch & optional Shopify catalog probes concurrently, avoiding slow hangs on non-Shopify sites
  const htmlPromise = fetchHtmlSafely(targetUrl.toString(), 3200);
  const singleProductPromise = productHandle
    ? fetchJsonSafely(`${targetUrl.origin}/products/${productHandle}.json`, 1700)
    : Promise.resolve(null);
  const collectionPromise = collectionHandle
    ? fetchJsonSafely(`${targetUrl.origin}/collections/${collectionHandle}/products.json?limit=12`, 1700)
    : Promise.resolve(null);
  const rootProductsPromise = fetchJsonSafely(`${targetUrl.origin}/products.json?limit=12`, 1600);

  const htmlResult = await htmlPromise;
  const html = htmlResult?.html ?? '';
  const effectiveOrigin = htmlResult?.finalOrigin ?? targetUrl.origin;

  const looksLikeShopify =
    Boolean(productHandle || collectionHandle) ||
    !htmlResult ||
    /cdn\.shopify\.com|Shopify\.theme|\/cdn\/shop\/|myshopify\.com/i.test(html);

  const [singleProductJson, collectionJson, rootProductsJson] = looksLikeShopify
    ? await Promise.all([singleProductPromise, collectionPromise, rootProductsPromise])
    : await Promise.all([
        Promise.resolve(null),
        Promise.resolve(null),
        Promise.race([
          rootProductsPromise,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 60)),
        ]),
      ]);

  const { hostname, domainRoot, tld } = parseHostnameParts(targetUrl);

  const rawTitleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const rawTitle = rawTitleMatch?.[1] ? stripHtmlTags(rawTitleMatch[1]).slice(0, 130) : '';
  const pageTitle = BOT_CHALLENGE_TITLE_RE.test(rawTitle) ? '' : rawTitle;
  const siteName = extractMetaTag(html, 'og:site_name|application-name');
  const ogTitle = extractMetaTag(html, 'og:title|twitter:title');
  const description = extractMetaTag(html, 'og:description|description|twitter:description').slice(
    0,
    300
  );
  const themeColorRaw = extractMetaTag(html, 'theme-color');

  const { headlines, manifestoSentences, navLabels, jsonLdOrgName, jsonLdInspirations } =
    extractHeadlinesAndCopy(html);

  // Collect optional real catalog inspirations (links/pricing only — NEVER raw scraped webpage images!)
  const shopifyInspirations: RealCatalogInspiration[] = [
    ...(singleProductJson ? parseShopifyCatalogInspirations(singleProductJson, effectiveOrigin) : []),
    ...(collectionJson ? parseShopifyCatalogInspirations(collectionJson, effectiveOrigin) : []),
    ...(rootProductsJson ? parseShopifyCatalogInspirations(rootProductsJson, effectiveOrigin) : []),
  ];

  const sourceType: IngestSourceType =
    shopifyInspirations.length > 0
      ? 'shopify'
      : jsonLdInspirations.length > 0
        ? 'jsonld'
        : 'html_meta';

  const catalogInspirations =
    shopifyInspirations.length > 0 ? shopifyInspirations : jsonLdInspirations;

  // Quick external CSS sniff ONLY if inline HTML had almost no brand color declarations
  let colorProfile = extractDeepColorProfile(html, '', domainRoot, themeColorRaw);
  if (html && colorProfile.allDistinctHexes.length < 2) {
    const extCss = await fetchFirstStylesheetSnippet(html, effectiveOrigin, 620);
    if (extCss) {
      colorProfile = extractDeepColorProfile(html, extCss, domainRoot, themeColorRaw);
    }
  }

  const brandName = deriveCleanBrandName(
    targetUrl,
    siteName,
    ogTitle || pageTitle,
    jsonLdOrgName,
    shopifyInspirations[0]?.vendor
  );
  const monogram = deriveBrandMonogram(brandName);

  const { evocativeNouns, graphicCopyCandidates } = extractBrandVocabulary(
    brandName,
    headlines,
    navLabels,
    description,
    manifestoSentences
  );

  const { archetype: recommendedArchetype, subVertical } = classifyVerticalAndArchetype(
    targetUrl,
    domainRoot,
    tld,
    pageTitle,
    description,
    headlines,
    manifestoSentences,
    navLabels,
    catalogInspirations,
    colorProfile.isDarkWebsite
  );

  const identity: DeepWebsiteIdentity = {
    url: targetUrl.toString(),
    origin: effectiveOrigin,
    hostname,
    domainRoot,
    tld,
    brandName,
    monogram,
    pageTitle,
    ogTitle,
    description,
    headlines,
    manifestoSentences,
    navLabels,
    evocativeNouns,
    graphicCopyCandidates,
    colorProfile,
    subVertical,
    recommendedArchetype,
    catalogInspirations,
    looksLikeShopify,
  };

  // Instant <5ms deterministic Creative Director baseline & fallback
  const deterministicBlueprint = inventDeterministicBrandWorld(identity);

  // Optional Gemini 4 Creative Director (`gemini-4-argon` or `gemini-4-carbon`, 5.5s max budget)
  const env = readRuntimeEnv(viteEnv);
  const geminiKey = (env.GEMINI_API_KEY || env.GOOGLE_API_KEY)?.trim();
  const geminiModel = env.GEMINI_ARCHITECT_MODEL?.trim() || 'gemini-4-argon';

  let usedGemini = false;
  let finalBlueprint: CreativeDirectorBlueprint = deterministicBlueprint;

  if (geminiKey && !/^your_|^insert_|^placeholder/i.test(geminiKey)) {
    try {
      const geminiBlueprint = await tryInventWithGemini(
        geminiKey,
        geminiModel,
        identity,
        deterministicBlueprint
      );
      if (geminiBlueprint) {
        finalBlueprint = geminiBlueprint;
        usedGemini = true;
      }
    } catch {
      usedGemini = false;
    }
  }

  const heroSpec = finalBlueprint.products.find((p) => p.placement === 'hero_rack') ?? finalBlueprint.products[0];
  const capsuleSpecs = finalBlueprint.products
    .filter((p) => p.placement === 'capsule_rack' && p.id !== heroSpec.id)
    .slice(0, 2);

  const heroGarmentAsset = productSpecToGarmentAsset(heroSpec, true);
  const capsuleGarmentAssets = capsuleSpecs.map((spec) => productSpecToGarmentAsset(spec, false));

  const racks: RackPlacement[] = [
    {
      id: 'ingested-hero-faceout',
      label: `${finalBlueprint.brandName} Hero Stand`,
      position: [0, 0, 0],
      rotationY: 0,
      style: 'hero_faceout',
      items: [heroGarmentAsset],
    },
  ];

  if (capsuleGarmentAssets.length > 0) {
    racks.push({
      id: 'ingested-capsule-rail',
      label: `${finalBlueprint.brandName} Capsule Rail`,
      position: [-1.58, 0, -0.58],
      rotationY: 0.34,
      style: 'capsule_rail',
      items: capsuleGarmentAssets,
    });
  }

  const storeConfig: StoreConfig = {
    id: `ingested-${slugify(hostname)}-${Date.now()}`,
    brandName: finalBlueprint.brandName,
    tagline: finalBlueprint.tagline,
    vibe: finalBlueprint.vibe,
    archetype: finalBlueprint.archetype,
    sourceUrl: targetUrl.toString(),
    brandEthos: finalBlueprint.brandEthos,
    palette: finalBlueprint.palette,
    metalRoughness: finalBlueprint.metalRoughness,
    metalness: finalBlueprint.metalness,
    lightingPreset: finalBlueprint.lightingPreset,
    textures: {},
    racks,
    products: finalBlueprint.products,
    architectNotes: finalBlueprint.architectNotes,
  };

  const responsePayload: IngestUrlResponsePayload = {
    storeConfig,
    rawProductCount:
      catalogInspirations.length > 0
        ? catalogInspirations.length
        : finalBlueprint.products.length,
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
