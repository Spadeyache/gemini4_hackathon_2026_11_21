import { loadEnv, type Plugin } from 'vite';
import { GoogleGenAI } from '@google/genai';
import { pickNextGeminiApiKey, withGeminiKeyFailover } from './geminiKeyPool';
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

export type AestheticClusterId =
  | 'cinema_streetwear'
  | 'minimal_tech'
  | 'artisanal_cafe'
  | 'heritage_club';

export interface IngestUrlResponsePayload {
  storeConfig: StoreConfig;
  rawProductCount: number;
  sourceType: IngestSourceType;
  usedGemini: boolean;
  usedDecision?: boolean;
  initialPhotoUrls?: string[];
  matchedStoreDomains?: string[];
  aestheticCluster?: AestheticClusterId;
}

type MaterialFinish = NonNullable<InventedProductSpec['materialFinish']>;

type SupportedVisionMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

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

interface DownloadedInitialPhoto {
  originalUrl: string;
  proxiedUrl: string;
  base64: string;
  mimeType: SupportedVisionMimeType;
}

interface ProductSearchKeywords {
  apparel: string[];
  objects: string[];
  colorWords: string[];
}

interface NeonVisualBrandPlan {
  brandName: string;
  tagline: string;
  vibe: string;
  brandEthos: string;
  archetype: WorldArchetypeId;
  lightingPreset: LightingPreset;
  metalRoughness: number;
  metalness: number;
  palette: StorePalette;
  aestheticCluster: AestheticClusterId;
  searchKeywords: ProductSearchKeywords;
  architectNotes: string[];
}

interface ShopifyProductImageRaw {
  id?: number | string;
  src?: string;
  url?: string;
  alt?: string | null;
  width?: number;
  height?: number;
  position?: number;
}

interface ShopifyJsonProduct {
  id?: number | string;
  title?: string;
  handle?: string;
  vendor?: string;
  product_type?: string;
  type?: string;
  tags?: string[] | string;
  images?: ShopifyProductImageRaw[];
  image?: { src?: string; url?: string; width?: number; height?: number; alt?: string } | string;
  featured_image?:
    | { url?: string; src?: string; width?: number; height?: number; alt?: string }
    | string;
  price?: string | number;
  price_min?: string | number;
  variants?: Array<{
    id?: number | string;
    sku?: string;
    price?: string | number;
    available?: boolean;
  }>;
}

interface RealInternetProductCandidate {
  key: string;
  domain: string;
  vendorName: string;
  title: string;
  handle: string;
  productType: string;
  tags: string[];
  price: number;
  productUrl: string;
  variantId?: string;
  packshotUrl: string;
  packshotScore: number;
  kind: 'apparel' | 'object';
  category: ProductCategory3D;
  isFromInputDomain: boolean;
  relevanceScore: number;
  decisionProbability?: number;
  decisionConfidence?: number;
}

interface CachedProxyImage {
  bytes: Uint8Array;
  contentType: string;
  cachedAt: number;
}

interface CachedDomainCatalog {
  fetchedAt: number;
  products: ShopifyJsonProduct[];
}

interface CachedNeonPlanEntry {
  cachedAt: number;
  plan: NeonVisualBrandPlan;
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
const MAX_IMAGE_CACHE_ENTRIES = 160;
const IMAGE_CACHE_TTL_MS = 60 * 60 * 1000;

// 15-minute in-memory cache per Shopify domain / suggest query so repeat & demo runs take <100ms
const INTERNET_CATALOG_CACHE = new Map<string, CachedDomainCatalog>();
const INTERNET_SUGGEST_CACHE = new Map<string, CachedDomainCatalog>();
const INTERNET_PRODUCT_HANDLE_CACHE = new Map<string, { fetchedAt: number; product: ShopifyJsonProduct | null }>();
const NEON_VISUAL_PLAN_CACHE = new Map<string, CachedNeonPlanEntry>();
const CATALOG_CACHE_TTL_MS = 15 * 60 * 1000;

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

const VALID_AESTHETIC_CLUSTERS: ReadonlySet<AestheticClusterId> = new Set<AestheticClusterId>([
  'cinema_streetwear',
  'minimal_tech',
  'artisanal_cafe',
  'heritage_club',
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

interface CuratedShopifyStore {
  domain: string;
  vendorDisplay: string;
}

// Curated pools of live, active public Shopify stores verified for studio packshot photography
const CLUSTER_SHOPIFY_STORES: Record<AestheticClusterId, readonly CuratedShopifyStore[]> = {
  cinema_streetwear: [
    { domain: 'actualsource.org', vendorDisplay: 'Actual Source' },
    { domain: 'noahny.com', vendorDisplay: 'Noah NY' },
    { domain: 'corridornyc.com', vendorDisplay: 'Corridor NYC' },
    { domain: 'marketstudios.com', vendorDisplay: 'Market Studios' },
    { domain: 'honorthegift.co', vendorDisplay: 'Honor The Gift' },
    { domain: 'topodesigns.com', vendorDisplay: 'Topo Designs' },
    { domain: 'onlyny.com', vendorDisplay: 'Only NY' },
  ],
  minimal_tech: [
    { domain: 'kotn.com', vendorDisplay: 'Kotn' },
    { domain: 'reigningchamp.com', vendorDisplay: 'Reigning Champ' },
    { domain: 'ladywhiteco.com', vendorDisplay: 'Lady White Co.' },
    { domain: 'kinto-usa.com', vendorDisplay: 'KINTO' },
    { domain: 'fellowproducts.com', vendorDisplay: 'Fellow' },
    { domain: 'ugmonk.com', vendorDisplay: 'Ugmonk' },
    { domain: 'areaware.com', vendorDisplay: 'Areaware' },
  ],
  artisanal_cafe: [
    { domain: 'fellowproducts.com', vendorDisplay: 'Fellow' },
    { domain: 'kinto-usa.com', vendorDisplay: 'KINTO' },
    { domain: 'malinandgoetz.com', vendorDisplay: 'Malin+Goetz' },
    { domain: 'kotn.com', vendorDisplay: 'Kotn' },
    { domain: 'taylorstitch.com', vendorDisplay: 'Taylor Stitch' },
    { domain: 'ugmonk.com', vendorDisplay: 'Ugmonk' },
    { domain: 'vervecoffee.com', vendorDisplay: 'Verve Coffee' },
  ],
  heritage_club: [
    { domain: 'rowingblazers.com', vendorDisplay: 'Rowing Blazers' },
    { domain: 'noahny.com', vendorDisplay: 'Noah NY' },
    { domain: 'corridornyc.com', vendorDisplay: 'Corridor NYC' },
    { domain: 'actualsource.org', vendorDisplay: 'Actual Source' },
    { domain: 'ebbets.com', vendorDisplay: 'Ebbets Field Flannels' },
    { domain: 'jpressonline.com', vendorDisplay: 'J. Press' },
  ],
};

const DEFAULT_CLUSTER_KEYWORDS: Record<AestheticClusterId, ProductSearchKeywords> = {
  cinema_streetwear: {
    apparel: ['hoodie', 'tee', 'jacket', 'sweatshirt'],
    objects: ['book', 'hat', 'tote', 'vinyl'],
    colorWords: ['black', 'charcoal', 'white', 'washed'],
  },
  minimal_tech: {
    apparel: ['hoodie', 'tee', 'sweatshirt', 'overshirt'],
    objects: ['mug', 'tote', 'tumbler', 'book'],
    colorWords: ['black', 'slate', 'charcoal', 'white', 'grey'],
  },
  artisanal_cafe: {
    apparel: ['shirt', 'hoodie', 'sweater', 'jacket'],
    objects: ['mug', 'candle', 'tote', 'carafe'],
    colorWords: ['natural', 'cream', 'matte', 'sage', 'sand'],
  },
  heritage_club: {
    apparel: ['sweater', 'rugby', 'blazer', 'hoodie'],
    objects: ['book', 'cap', 'tote', 'mug'],
    colorWords: ['navy', 'forest', 'cream', 'burgundy'],
  },
};

const EXCLUDED_PRODUCT_RE =
  /\b(gift[-_ ]?card|e-gift|shipping[-_ ]?protection|package[-_ ]?protection|navidium|corso|route[-_ ]?protect|donation|mystery[-_ ]?box|warranty|digital[-_ ]?download|replacement|spare[-_ ]?part|paper[-_ ]?filter|filters[-_ ]?pack|sticker|keychain|lapel[-_ ]?pin|enamel[-_ ]?pin)\b/i;

// Strictly exclude lower-body bottoms, socks, underwear, footwear, and non-hanging items from apparel racks
const STRICT_NON_UPPER_APPAREL_RE =
  /\b(pant|pants|trouser|trousers|chino|jean|jeans|short|shorts|boardshort|trunk|trunks|brief|briefs|boxer|boxers|underwear|bra|bralette|bikini|swimsuit|legging|leggings|tight|tights|jogger|joggers|sweatpant|sweatpants|skirt|skort|dress|gown|jumpsuit|romper|overall|overalls|sock|socks|anklet|shoe|shoes|sneaker|sneakers|boot|boots|loafer|loafers|mule|sandal|slipper|belt|scarf|bandana|glove|gloves|mitten|beanie|hat|cap|ballcap|visor|beret|bucket[-_ ]?hat|tote|bag|backpack|duffel|pack|pouch|wallet|cardholder|mug|cup|tumbler|kettle|carafe|bottle|candle|fragrance|perfume|cleanser|serum|wash|lotion|balm|soap|deodorant|acne|book|zine|magazine|journal|notebook|vinyl|cassette|throw|blanket|towel|pillow|cushion|rug|mat|umbrella|watch|sunglass|sunglasses|eyeglasses)\b/i;

// Strictly exclude clothing & footwear when classifying table/pedestal hard-goods & accessories
const STRICT_CLOTHING_FOR_OBJECTS_RE =
  /\b(hoodie|sweatshirt|crewneck|pullover|sweater|cardigan|jacket|blazer|coat|parka|anorak|overshirt|vest|tee|t-shirt|tshirt|shirt|polo|henley|jersey|tank|pant|pants|trouser|trousers|jean|jeans|short|shorts|sweatpant|jogger|legging|skirt|dress|sock|socks|underwear|boxer|brief|bra|shoe|shoes|sneaker|boot|loafer|sandal|throw|blanket|pajama)\b/i;

const BOT_CHALLENGE_TITLE_RE =
  /\b(just a moment|attention required|access denied|403 forbidden|404 not found|page not found|security check|ddos[- ]?guard|verify you are human|are you a robot|pardon our interruption|sucuri website firewall)\b/i;

const BOILERPLATE_TEXT_RE =
  /\b(cookie|cookies|privacy policy|terms of service|terms & conditions|all rights reserved|sign in|log in|forgot password|create account|skip to content|javascript is disabled|browser does not support|unsubscribe|gdpr|ccpa|manage preferences|accept all|suggested searches|search results|shopping cart|shopping bag|your cart|filter by|sort by)\b/i;

const GENERIC_NAV_STOP_RE =
  /^(home|login|log in|sign in|sign up|register|get started|start now|try free|contact|contact us|support|help|faq|search|menu|close|cart|bag|checkout|account|privacy|terms|legal|sitemap|skip|back|next|more|view all|learn more|read more|pricing|product|products|solutions|resources|enterprise|customers|company|careers|jobs|blog|blogs|news|news releases|press|events|docs|documentation|developers|status|security|partners|integrations|download|mobile|live|podcasts|videos|multimedia)$/i;

const GENERIC_PHRASE_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'your', 'our', 'into', 'over', 'under',
  'more', 'most', 'best', 'new', 'now', 'how', 'why', 'what', 'when', 'where', 'who', 'all',
  'any', 'every', 'built', 'make', 'made', 'get', 'use', 'using', 'learn', 'read', 'view',
  'shop', 'store', 'buy', 'free', 'try', 'start', 'started', 'welcome', 'official', 'website',
  'online', 'page', 'home', 'click', 'here', 'join', 'today', 'discover', 'explore', 'about',
  'contact', 'login', 'signup', 'subscribe', 'cookie', 'privacy', 'pricing', 'product', 'products',
  'customers', 'company', 'careers', 'blog', 'blogs', 'news', 'releases', 'solutions', 'resources',
  'enterprise', 'features', 'tool', 'tools', 'platform', 'search', 'searches', 'suggested',
  'filter', 'filters', 'results', 'menu', 'navigation', 'account', 'checkout',
]);

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

function toProxiedImageUrl(externalUrl: string): string {
  return `/api/proxy-image?url=${encodeURIComponent(externalUrl)}`;
}

function putInImageCache(url: string, bytes: Uint8Array, contentType: string): void {
  if (bytes.byteLength === 0 || bytes.byteLength > 4 * 1024 * 1024) return;
  if (!IMAGE_CACHE.has(url) && IMAGE_CACHE.size >= MAX_IMAGE_CACHE_ENTRIES) {
    const oldestKey = IMAGE_CACHE.keys().next().value;
    if (oldestKey) IMAGE_CACHE.delete(oldestKey);
  }
  IMAGE_CACHE.set(url, {
    bytes,
    contentType,
    cachedAt: Date.now(),
  });
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

// ============================================================================
// 1. INITIAL WEBSITE PHOTO EXTRACTION & MULTIMODAL DOWNLOADER
// ============================================================================

function normalizeSitePhotoCandidateUrl(rawSrc: string, baseOrigin: string): string | null {
  const decoded = decodeHtmlEntities(rawSrc).trim();
  if (!decoded || decoded.startsWith('data:') || decoded.startsWith('blob:')) {
    return null;
  }

  let resolved: URL;
  try {
    resolved = new URL(decoded.startsWith('//') ? `https:${decoded}` : decoded, baseOrigin);
  } catch {
    return null;
  }

  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
    return null;
  }
  if (isDisallowedHost(resolved.hostname)) {
    return null;
  }

  // Upgrade http -> https for public CDN assets
  if (resolved.protocol === 'http:') {
    resolved.protocol = 'https:';
  }

  const lowerPath = resolved.pathname.toLowerCase();
  if (/\.(svg|ico|gif|avif|mp4|webm|woff2?)(\?|$)/i.test(lowerPath)) {
    return null;
  }
  if (
    /\b(favicon|apple-touch-icon|sprite|spacer|pixel|tracker|analytics|1x1|badge|payment|arrow|chevron|spinner|loader)\b/i.test(
      `${resolved.pathname} ${resolved.search}`
    )
  ) {
    return null;
  }

  // Unwrap Next.js `/_next/image?url=...` when wrapping an external HTTPS asset, or cap width to 1080
  if (resolved.pathname.startsWith('/_next/image')) {
    const innerUrl = resolved.searchParams.get('url');
    if (innerUrl && /^https?:\/\//i.test(innerUrl)) {
      try {
        const innerParsed = new URL(innerUrl);
        if (!isDisallowedHost(innerParsed.hostname)) {
          return innerParsed.toString();
        }
      } catch {
        // Keep Next.js optimizer URL below
      }
    }
    const wParam = Number(resolved.searchParams.get('w') ?? '0');
    if (wParam > 1200) {
      resolved.searchParams.set('w', '1080');
    }
    return resolved.toString();
  }

  // Upgrade tiny blur-up placeholders (`&width=20`) on Shopify / modern CDNs
  const widthQuery = Number(resolved.searchParams.get('width') ?? '0');
  if (widthQuery > 0 && widthQuery < 200) {
    resolved.searchParams.set('width', '960');
  } else if (widthQuery > 1400) {
    resolved.searchParams.set('width', '1080');
  }

  // Cap Cloudflare Image Delivery width=2560 -> width=1080 for fast multimodal fetch
  if (resolved.pathname.includes('/cdn-cgi/imagedelivery/')) {
    resolved.pathname = resolved.pathname.replace(/width=\d+/i, 'width=1080');
  }

  return resolved.toString();
}

function pickBestSrcFromSrcset(srcsetRaw: string): string | null {
  const entries = decodeHtmlEntities(srcsetRaw)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  let bestUrl: string | null = null;
  let bestScore = -1;

  for (const entry of entries) {
    const tokens = entry.split(/\s+/);
    const urlPart = tokens[0];
    if (!urlPart) continue;
    const widthMatch = tokens[1]?.match(/^(\d+)w$/i);
    const widthVal = widthMatch ? Number(widthMatch[1]) : 800;
    if (widthVal < 220) continue;
    // Prefer 640px..1280px crisp hero images without 4K download bloat
    const score = widthVal >= 600 && widthVal <= 1400 ? 1000 - Math.abs(960 - widthVal) : 400;
    if (score > bestScore) {
      bestScore = score;
      bestUrl = urlPart;
    }
  }

  return bestUrl;
}

/**
 * Extracts 1 to 3 best initial visual/brand photos from the input website's HTML
 * (`og:image`, `twitter:image`, and hero `<img src>` >200px that aren't icons/SVGs/avatars).
 */
function extractInitialWebsitePhotoUrls(
  html: string,
  baseOrigin: string,
  fallbackShopifyProducts: ShopifyJsonProduct[] = []
): string[] {
  const collected: string[] = [];
  const seenKeys = new Set<string>();

  const pushCandidate = (rawUrl: string | null | undefined) => {
    if (!rawUrl || collected.length >= 5) return;
    const normalized = normalizeSitePhotoCandidateUrl(rawUrl, baseOrigin);
    if (!normalized) return;
    const dedupeKey = normalized.replace(/\?.*$/, '');
    if (seenKeys.has(dedupeKey) || seenKeys.has(normalized)) return;
    seenKeys.add(dedupeKey);
    seenKeys.add(normalized);
    collected.push(normalized);
  };

  if (html) {
    // 1. Primary OpenGraph & Twitter card visual brand imagery
    const ogSecure = extractMetaTag(html, 'og:image:secure_url');
    const ogImage = extractMetaTag(html, 'og:image');
    const twitterImage = extractMetaTag(html, 'twitter:image|twitter:image:src');
    pushCandidate(ogSecure);
    pushCandidate(ogImage);
    pushCandidate(twitterImage);

    // 2. Hero <img> tags >200px (skipping hidden elements, tiny avatars, nav icons, and SVGs)
    const imgTagRe = /<img\b[^>]*>/gi;
    let match: RegExpExecArray | null;
    let scanned = 0;

    while ((match = imgTagRe.exec(html)) !== null && scanned < 45 && collected.length < 5) {
      scanned++;
      const tag = match[0];

      if (/\bdisplay\s*:\s*none\b/i.test(tag)) continue;

      const alt = tag.match(/\balt=["']([^"']*)["']/i)?.[1] ?? '';
      const cls = tag.match(/\bclass=["']([^"']*)["']/i)?.[1] ?? '';
      if (/\b(avatar|icon|logo|arrow|Flag|badge|payment|emoji|spinner)\b/i.test(`${alt} ${cls}`)) {
        continue;
      }

      const widthAttr = Number(tag.match(/\bwidth=["']?(\d+)["']?/i)?.[1] ?? '0');
      const heightAttr = Number(tag.match(/\bheight=["']?(\d+)["']?/i)?.[1] ?? '0');
      const styleWidth = Number(tag.match(/\bwidth\s*:\s*(\d+)px/i)?.[1] ?? '0');

      if (
        (widthAttr > 0 && widthAttr <= 200) ||
        (heightAttr > 0 && heightAttr <= 160) ||
        (styleWidth > 0 && styleWidth <= 200)
      ) {
        continue;
      }

      const srcsetRaw =
        tag.match(/\b(?:srcset|data-srcset)=["']([^"']+)["']/i)?.[1] ?? '';
      const srcFromSet = srcsetRaw ? pickBestSrcFromSrcset(srcsetRaw) : null;
      const directSrc =
        tag.match(/\b(?:data-src|src)=["']([^"']+)["']/i)?.[1] ?? null;

      // Prefer a clean 640-1200w srcset entry when direct src is a 20px blur-up or 3840px giant
      const chosenRaw = srcFromSet ?? directSrc;
      if (!chosenRaw) continue;

      // Require explicit >200px dimensions OR known hero/media class/srcset so tiny 16px icons never slip in
      const hasHeroSignal =
        widthAttr > 200 ||
        heightAttr > 200 ||
        Boolean(srcFromSet) ||
        /\b(hero|banner|media|poster|cover|feature|editorial|lookbook|gallery)\b/i.test(
          `${cls} ${chosenRaw}`
        );

      if (hasHeroSignal) {
        pushCandidate(chosenRaw);
      }
    }
  }

  // 3. Fallback to input store's own featured product photos if HTML blocked scraping
  if (collected.length === 0 && fallbackShopifyProducts.length > 0) {
    for (const prod of fallbackShopifyProducts.slice(0, 3)) {
      const bestShot = pickCleanestPackshotImage(extractProductImagesList(prod));
      if (bestShot) {
        pushCandidate(bestShot.url);
      }
      if (collected.length >= 2) break;
    }
  }

  return collected.slice(0, 3);
}

function sniffSupportedVisionMime(
  bytes: Uint8Array,
  headerContentType: string
): SupportedVisionMimeType | null {
  const lowerCt = headerContentType.toLowerCase();
  if (lowerCt.includes('image/jpeg') || lowerCt.includes('image/jpg')) return 'image/jpeg';
  if (lowerCt.includes('image/png')) return 'image/png';
  if (lowerCt.includes('image/webp')) return 'image/webp';

  if (bytes.byteLength >= 12) {
    // JPEG magic: FF D8 FF
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image/jpeg';
    }
    // PNG magic: 89 50 4E 47
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return 'image/png';
    }
    // WEBP magic: "RIFF" .... "WEBP"
    if (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return 'image/webp';
    }
  }

  return null;
}

/**
 * Downloads up to 2 initial website photos (`<= 1.5s` timeout) into base64 for `gemini-4-neon`
 * and warms `IMAGE_CACHE` so `/api/proxy-image` serves them to the browser HUD instantly.
 */
async function downloadInitialPhotosForVision(
  candidateUrls: string[],
  timeoutMs = 1500
): Promise<DownloadedInitialPhoto[]> {
  if (candidateUrls.length === 0) return [];

  const attempts = await Promise.all(
    candidateUrls.slice(0, 3).map(async (photoUrl): Promise<DownloadedInitialPhoto | null> => {
      try {
        const parsed = new URL(photoUrl);
        const res = await fetch(photoUrl, {
          headers: {
            'User-Agent': BROWSER_USER_AGENT,
            // Explicitly omit image/avif so CDNs (Cloudflare/Shopify/Next) serve webp/jpeg/png
            Accept: 'image/jpeg,image/png,image/webp;q=0.95,*/*;q=0.4',
            Referer: `${parsed.origin}/`,
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return null;

        const ct = res.headers.get('content-type') ?? '';
        if (ct.toLowerCase().includes('text/html') || ct.toLowerCase().includes('image/svg')) {
          return null;
        }

        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength < 400 || bytes.byteLength > 3.5 * 1024 * 1024) {
          return null;
        }

        const mimeType = sniffSupportedVisionMime(bytes, ct);
        if (!mimeType) return null;

        putInImageCache(photoUrl, bytes, mimeType);

        return {
          originalUrl: photoUrl,
          proxiedUrl: toProxiedImageUrl(photoUrl),
          base64: Buffer.from(bytes).toString('base64'),
          mimeType,
        };
      } catch {
        return null;
      }
    })
  );

  return attempts.filter((p): p is DownloadedInitialPhoto => p !== null).slice(0, 2);
}

// ============================================================================
// 2. BRAND IDENTITY, COLOR EXTRACTION & DETERMINISTIC BASELINE
// ============================================================================

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
      const domainMatched = segments.find((seg) => {
        const stem = seg.toLowerCase().replace(/[^a-z0-9]/g, '');
        return stem.length >= 2 && (cleanKey.includes(stem) || stem.includes(cleanKey));
      });
      if (domainMatched) {
        return domainMatched.toUpperCase();
      }
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

  const cssVarRe = /(--[a-zA-Z0-9-_]{2,48})\s*:\s*([^;}{"\n]{3,42})/g;
  let vm: RegExpExecArray | null;
  let varScanned = 0;
  while ((vm = cssVarRe.exec(combinedCss)) !== null && varScanned < 600) {
    varScanned++;
    const propName = vm[1].toLowerCase();
    const hex = normalizeCssColorToken(vm[2]);
    if (!hex) continue;

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

  const bodyBgRe = /(?:html|body|:root)\s*\{[^}]{0,600}?(?:background-color|background)\s*:\s*([^;}{"\n]{3,36})/gi;
  let bbm: RegExpExecArray | null;
  while ((bbm = bodyBgRe.exec(combinedCss)) !== null) {
    const hex = normalizeCssColorToken(bbm[1]);
    if (hex) {
      bgHints.unshift(hex);
      addScore(hex, 20);
    }
  }

  const anyHexRe = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
  let hm: RegExpExecArray | null;
  let hexCount = 0;
  const scanTarget = combinedCss || html.slice(0, 120000);
  while ((hm = anyHexRe.exec(scanTarget)) !== null && hexCount < 450) {
    hexCount++;
    addScore(`#${hm[1]}`, 2);
  }

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

function extractRawShopifyProductArray(payload: unknown): ShopifyJsonProduct[] {
  if (!payload || typeof payload !== 'object') return [];
  const obj = payload as {
    products?: unknown;
    product?: unknown;
    resources?: { results?: { products?: unknown } };
  };
  if (Array.isArray(obj.products)) {
    return obj.products as ShopifyJsonProduct[];
  }
  if (obj.product && typeof obj.product === 'object') {
    return [obj.product as ShopifyJsonProduct];
  }
  if (Array.isArray(obj.resources?.results?.products)) {
    return obj.resources.results.products as ShopifyJsonProduct[];
  }
  return [];
}

function parseShopifyCatalogInspirations(
  payload: unknown,
  effectiveOrigin: string
): RealCatalogInspiration[] {
  const rawList = extractRawShopifyProductArray(payload);
  const inspirations: RealCatalogInspiration[] = [];
  for (const p of rawList) {
    if (inspirations.length >= 16) break;
    const title = decodeHtmlEntities(String(p.title ?? '').trim());
    if (!title || EXCLUDED_PRODUCT_RE.test(title)) continue;
    const handle = String(p.handle ?? slugify(title)).trim();
    const productType = decodeHtmlEntities(String(p.product_type ?? p.type ?? '').trim());
    const tags = normalizeProductTags(p.tags);
    const firstVariant = Array.isArray(p.variants) && p.variants.length > 0 ? p.variants[0] : undefined;
    const price = parsePriceNumber(firstVariant?.price ?? p.price ?? p.price_min, 85);
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
    /\b(stripe|payment|payments|payout|treasury|fintech|ledger|banking|invoice|invoicing|financial infrastructure|merchant|capital)\b/g
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

function mapArchetypeToAestheticCluster(
  archetype: WorldArchetypeId,
  subVertical: BrandSubVertical
): AestheticClusterId {
  if (
    archetype === 'avant_garde_concrete_loft' ||
    subVertical === 'film_cinema' ||
    subVertical === 'music_audio' ||
    subVertical === 'streetwear_drop'
  ) {
    return 'cinema_streetwear';
  }
  if (archetype === 'minimalist_tech_pavilion') {
    return 'minimal_tech';
  }
  if (archetype === 'warm_artisanal_atelier') {
    return 'artisanal_cafe';
  }
  return 'heritage_club';
}

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
  const words = cleaned.split(' ');
  let acc = '';
  for (const w of words) {
    const next = acc ? `${acc} ${w}` : w;
    if (next.length <= 16) acc = next;
    else break;
  }
  return acc || cleaned.slice(0, 16).trim();
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

function inventDeterministicBrandWorld(identity: DeepWebsiteIdentity): CreativeDirectorBlueprint {
  const {
    brandName,
    monogram,
    hostname,
    recommendedArchetype: archetype,
    evocativeNouns,
    headlines,
    description,
  } = identity;

  const { palette, lightingPreset, metalRoughness, metalness } = buildBrandBlendedPalette(
    archetype,
    identity
  );

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
  const leadQuote = headlines[0] || description;
  const trimmedQuote =
    leadQuote && leadQuote.length >= 8
      ? `"${leadQuote.slice(0, 78)}${leadQuote.length > 78 ? '...' : ''}"`
      : `${hostname}'s visual identity`;

  const brandEthos = `Distilled ${trimmedQuote} into a ${archMeta.label} (${palette.wall} / ${palette.accent}), curating real internet apparel & physical collector objects matched to ${brandName}'s visual DNA.`;

  const fallbackSlots: Array<{ placement: ProductPlacementZone; category: ProductCategory3D; price: number }> = [
    { placement: 'hero_rack', category: 'heavyweight_hoodie', price: 148 },
    { placement: 'capsule_rack', category: 'structured_tshirt', price: 68 },
    { placement: 'capsule_rack', category: 'varsity_jacket', price: 245 },
    { placement: 'center_table', category: 'hardcover_book', price: 64 },
    { placement: 'left_pedestal', category: 'ceramic_mug', price: 36 },
    { placement: 'right_pedestal', category: 'canvas_tote', price: 48 },
  ];

  const brandSlug = slugify(brandName);
  const products: InventedProductSpec[] = fallbackSlots.map((slot, idx) => ({
    id: `matched-${brandSlug}-${idx + 1}-${slot.placement}`,
    sku: `${monogram}-${categorySkuCode(slot.category)}-0${idx + 1}`,
    title: `${brandName} ${slot.category.replace('_', ' ')}`,
    subtitle: `${brandName} · Matched Capsule Selection`,
    category: slot.category,
    placement: slot.placement,
    price: slot.price,
    primaryColor: idx % 2 === 0 ? '#1C1E24' : '#EFECE4',
    secondaryColor: palette.plinth,
    accentColor: ensureWcagContrast(palette.accent, '#1C1E24', 3.4),
    graphicHeadline: clampGraphicHeadline(evocativeNouns[idx] || monogram, monogram),
    graphicSubtext: hostname.toUpperCase().slice(0, 32),
    graphicMotif: 'minimal_typo',
    materialFinish: defaultMaterialFinishForCategory(slot.category),
    designRationale: `Curated to echo ${brandName}'s visual palette and spatial retail atmosphere.`,
    featured: idx === 0,
  }));

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
    architectNotes: [
      `Selected ${archMeta.label} (${palette.wall} / ${palette.accent}) from ${hostname}'s visual identity.`,
      `Curated 3 real upper-body studio garments on hero & capsule rails alongside 3 physical objects across the table and plinths.`,
    ],
    products,
  };
}

// ============================================================================
// 3. MULTIMODAL `gemini-4-neon` INITIAL PHOTO ANALYZER & QUERY PLANNER
// ============================================================================

async function planBrandAndQueriesWithGeminiNeon(
  apiKey: string,
  model: string,
  identity: DeepWebsiteIdentity,
  initialPhotos: DownloadedInitialPhoto[],
  fallbackBlueprint: CreativeDirectorBlueprint,
  heuristicCluster: AestheticClusterId
): Promise<NeonVisualBrandPlan | null> {
  const cacheKey = `${identity.url}::${model}`;
  const cached = NEON_VISUAL_PLAN_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CATALOG_CACHE_TTL_MS) {
    return cached.plan;
  }

  const ai = new GoogleGenAI({ apiKey });

  // CRITICAL SDK SYNTAX: Always wrap multimodal content inside `[{ type: 'user_input', content: [...] }]`!
  const userContentParts: Array<
    | {
        type: 'image';
        data: string;
        mime_type: SupportedVisionMimeType;
        resolution: 'low';
      }
    | { type: 'text'; text: string }
  > = [];

  for (const photo of initialPhotos) {
    userContentParts.push({
      type: 'image',
      data: photo.base64,
      mime_type: photo.mimeType,
      resolution: 'low',
    });
  }

  const compactSiteContext = {
    url: identity.url,
    hostname: identity.hostname,
    brandName: identity.brandName,
    title: identity.pageTitle || identity.ogTitle,
    description: identity.description.slice(0, 180),
    headlines: identity.headlines.slice(0, 4),
    scrapedColors: {
      isDark: identity.colorProfile.isDarkWebsite,
      primaryHex: identity.colorProfile.primaryBrandHex,
      accents: identity.colorProfile.vibrantAccents.slice(0, 3),
    },
    initialPhotoCount: initialPhotos.length,
  };

  userContentParts.push({
    type: 'text',
    text: `Website & Initial Photo Context:\n${JSON.stringify(compactSiteContext)}\n\nAnalyze the attached initial website photo(s) (or brand identity if 0 photos) for color palette, lighting mood, and cultural aesthetic. Output ONLY raw compact JSON (no markdown fences) matching this exact structure:
{"brandName":"...","tagline":"...","vibe":"...","brandEthos":"1-2 sentences tying the initial site visuals to a physical flagship concept","archetype":"minimalist_tech_pavilion|warm_artisanal_atelier|avant_garde_concrete_loft|heritage_arch_flagship","lightingPreset":"warm_court_sunlight|cool_gallery_spot|kyoto_golden_hour","aestheticCluster":"cinema_streetwear|minimal_tech|artisanal_cafe|heritage_club","palette":{"wall":"#RRGGBB","floor":"#RRGGBB","accent":"#RRGGBB","secondaryAccent":"#RRGGBB","rackMetal":"#RRGGBB","hangerWood":"#RRGGBB","plinth":"#RRGGBB","rug":"#RRGGBB","ambientLight":"#RRGGBB","spotLight":"#RRGGBB"},"searchKeywords":{"apparel":["3-4 specific upper-body search terms like hoodie, heavyweight tee, chore jacket, sweater"],"objects":["3-4 specific object search terms like ceramic mug, tote, cap, book, candle"],"colorWords":["2-3 color words matching the initial photos"]},"architectNotes":["note 1","note 2"]}`,
  });

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error('gemini-4-neon visual planner timed out'));
    }, 12500);
  });

  let rawText: string | null | undefined;
  try {
    const interaction = await Promise.race([
      ai.interactions.create({
        model,
        system_instruction:
          'You are a Retail Spatial Architect & Visual Merchandiser. Be direct, concise, and emit valid compact JSON immediately using #RRGGBB hex codes.',
        generation_config: {
          thinking_level: 'low',
        },
        input: [
          {
            type: 'user_input',
            content: userContentParts,
          },
        ],
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

  const cleanedJson = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const firstBrace = cleanedJson.indexOf('{');
  const lastBrace = cleanedJson.lastIndexOf('}');
  const jsonSlice =
    firstBrace >= 0 && lastBrace > firstBrace
      ? cleanedJson.slice(firstBrace, lastBrace + 1)
      : cleanedJson;

  const parsed = JSON.parse(jsonSlice) as {
    brandName?: string;
    tagline?: string;
    vibe?: string;
    brandEthos?: string;
    archetype?: WorldArchetypeId;
    lightingPreset?: LightingPreset;
    aestheticCluster?: AestheticClusterId;
    palette?: Partial<StorePalette>;
    searchKeywords?: Partial<ProductSearchKeywords>;
    architectNotes?: string[];
  };

  const archetype: WorldArchetypeId =
    parsed.archetype && VALID_ARCHETYPES.has(parsed.archetype)
      ? parsed.archetype
      : fallbackBlueprint.archetype;

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

  const aestheticCluster: AestheticClusterId =
    parsed.aestheticCluster && VALID_AESTHETIC_CLUSTERS.has(parsed.aestheticCluster)
      ? parsed.aestheticCluster
      : mapArchetypeToAestheticCluster(archetype, identity.subVertical) || heuristicCluster;

  const defaultKw = DEFAULT_CLUSTER_KEYWORDS[aestheticCluster];
  const sanitizeKwList = (arr: unknown, fb: string[]): string[] => {
    if (!Array.isArray(arr)) return fb;
    const cleaned = arr
      .map((item) => String(item ?? '').trim().toLowerCase())
      .filter((s) => s.length >= 2 && s.length <= 36);
    return cleaned.length > 0 ? cleaned.slice(0, 5) : fb;
  };

  const plan: NeonVisualBrandPlan = {
    brandName:
      typeof parsed.brandName === 'string' && parsed.brandName.trim().length >= 2
        ? parsed.brandName.trim().toUpperCase().slice(0, 38)
        : fallbackBlueprint.brandName,
    tagline:
      typeof parsed.tagline === 'string' && parsed.tagline.trim().length >= 3
        ? parsed.tagline.trim().slice(0, 84)
        : fallbackBlueprint.tagline,
    vibe:
      typeof parsed.vibe === 'string' && parsed.vibe.trim().length >= 4
        ? parsed.vibe.trim().slice(0, 140)
        : fallbackBlueprint.vibe,
    brandEthos:
      typeof parsed.brandEthos === 'string' && parsed.brandEthos.trim().length >= 10
        ? parsed.brandEthos.trim().slice(0, 260)
        : fallbackBlueprint.brandEthos,
    archetype,
    lightingPreset,
    metalRoughness: archetypeBase.metalRoughness,
    metalness: archetypeBase.metalness,
    palette,
    aestheticCluster,
    searchKeywords: {
      apparel: sanitizeKwList(parsed.searchKeywords?.apparel, defaultKw.apparel),
      objects: sanitizeKwList(parsed.searchKeywords?.objects, defaultKw.objects),
      colorWords: sanitizeKwList(parsed.searchKeywords?.colorWords, defaultKw.colorWords),
    },
    architectNotes:
      Array.isArray(parsed.architectNotes) && parsed.architectNotes.length > 0
        ? parsed.architectNotes.map((n) => String(n).trim()).filter(Boolean).slice(0, 4)
        : fallbackBlueprint.architectNotes,
  };

  NEON_VISUAL_PLAN_CACHE.set(cacheKey, {
    cachedAt: Date.now(),
    plan,
  });

  return plan;
}

// ============================================================================
// 4. REAL INTERNET SHOPIFY CATALOG SEARCH, PACKSHOT SELECTOR & DECISION-1 RANKING
// ============================================================================

function normalizeProductTags(tagsRaw: string[] | string | undefined): string[] {
  if (Array.isArray(tagsRaw)) {
    return tagsRaw.map((t) => String(t).trim()).filter(Boolean);
  }
  if (typeof tagsRaw === 'string') {
    return tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

function optimizeShopifyImageUrl(rawUrl: string): string {
  const trimmed = decodeHtmlEntities(rawUrl).trim();
  const withProto = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
  try {
    const parsed = new URL(withProto);
    if (parsed.protocol === 'http:') parsed.protocol = 'https:';
    if (
      parsed.hostname.includes('shopify.com') ||
      parsed.pathname.includes('/cdn/shop/')
    ) {
      const existingW = Number(parsed.searchParams.get('width') ?? '0');
      if (!existingW || existingW > 1080 || existingW < 300) {
        parsed.searchParams.set('width', '960');
      }
    }
    return parsed.toString();
  } catch {
    return withProto;
  }
}

function extractProductImagesList(p: ShopifyJsonProduct): ShopifyProductImageRaw[] {
  const list: ShopifyProductImageRaw[] = [];
  if (Array.isArray(p.images) && p.images.length > 0) {
    for (const im of p.images) {
      if (im && (typeof im.src === 'string' || typeof im.url === 'string')) {
        list.push(im);
      }
    }
  }
  if (list.length === 0) {
    if (typeof p.featured_image === 'string' && p.featured_image) {
      list.push({ src: p.featured_image });
    } else if (p.featured_image && typeof p.featured_image === 'object') {
      const src = p.featured_image.url ?? p.featured_image.src;
      if (src) {
        list.push({
          src,
          width: p.featured_image.width,
          height: p.featured_image.height,
          alt: p.featured_image.alt,
        });
      }
    }
    if (typeof p.image === 'string' && p.image) {
      list.push({ src: p.image });
    } else if (p.image && typeof p.image === 'object') {
      const src = p.image.src ?? p.image.url;
      if (src) {
        list.push({
          src,
          width: p.image.width,
          height: p.image.height,
          alt: p.image.alt,
        });
      }
    }
  }
  return list;
}

/**
 * Inspects all images of a Shopify product and picks the cleanest isolated studio packshot
 * (avoiding human models, lifestyle street shots, detail zooms, back views, and size charts).
 */
export function pickCleanestPackshotImage(
  images: ShopifyProductImageRaw[]
): { url: string; score: number } | null {
  if (!Array.isArray(images) || images.length === 0) return null;

  let bestUrl: string | null = null;
  let bestScore = -9999;
  const total = images.length;

  for (let idx = 0; idx < total; idx++) {
    const img = images[idx];
    const rawSrc = (img.src ?? img.url ?? '').trim();
    if (!rawSrc) continue;

    const cleanPath = rawSrc.split('?')[0];
    const fileName = cleanPath.split('/').pop() ?? cleanPath;
    const altText = String(img.alt ?? '');
    const signalText = `${fileName} ${altText}`.toLowerCase();

    if (/\.(svg|gif)(\b|$)/i.test(fileName)) continue;

    let score = 0;

    // Hard disqualifiers: size charts, fabric guides, care labels, holiday promo banners
    if (
      /\b(sizechart|size[-_ ]?chart|fabric[-_ ]?guide|measurement|dimensions|care[-_ ]?guide|spec[-_ ]?sheet|banner|holiday[-_ ]?\d+)\b/i.test(
        signalText
      )
    ) {
      score -= 260;
    }

    // Penalize macro close-ups / embroidery / swatch zooms
    if (
      /(?:^|[-_ .])(embroidery|closeup|close[-_ ]?up|detail|macro|zoom|swatch|collar[-_ ]?detail|sleeve[-_ ]?detail|pocket[-_ ]?detail|label|tag)(?:[-_ .]|$)/i.test(
        signalText
      )
    ) {
      score -= 105;
    }

    // Penalize human model / lifestyle / lookbook / portrait / on-body shots
    if (
      /(?:^|[-_ .])(portrait|model|on[-_ ]?body|on[-_ ]?\d+|worn|lookbook|look[-_ ]?\d+|lifestyle|ls|campaign|editorial|street|outdoor|action|fit|wearing|man[-_ ]?pictured|woman[-_ ]?pictured)(?:[-_ .]|$)/i.test(
        signalText
      )
    ) {
      score -= 115;
    }

    // Penalize rear/back/interior views so our front garment/object is always front-facing
    if (/(?:^|[-_ .])(back|rear|reverse|inside|interior|bottom|side)(?:[-_ .]|$)/i.test(signalText)) {
      score -= 78;
    }

    // Strong positive signals for isolated studio flat-lay / ghost mannequin / off-body packshots
    if (
      /(?:^|[-_ .])(flat|flatlay|flat[-_ ]?lay|packshot|pack[-_ ]?shot|ghost|mannequin|off[-_ ]?body|off[-_ ]?jp|off[-_ ]?\d+|noshadow|no[-_ ]?shadow|isolated|cutout|still|front[-_ ]?flat|pdp|ecom|product)(?:[-_ .]|$)/i.test(
        signalText
      )
    ) {
      score += 72;
    }

    if (/(?:^|[-_ .])front(?:[-_ .]|$)/i.test(signalText)) {
      score += 34;
    }

    // Transparent or clean white-studio PNGs
    if (/\.png$/i.test(fileName)) {
      score += 26;
    }

    // Numbered `_01` / `-001` / `-1` / `01_` primary studio shot (when not `on_1` or `detail_1`)
    if (
      (/(?:^|[-_])0*1\.(?:jpg|jpeg|png|webp)$/i.test(fileName) || /^0*1[-_]/i.test(fileName)) &&
      !/(?:on|detail|ls|look)[-_ ]?0*1\./i.test(fileName)
    ) {
      score += 38;
    }

    // Square 1:1 studio aspect ratio (brands frequently shoot 4:5 lookbook models + 1:1 isolated packshots)
    const w = Number(img.width ?? 0);
    const h = Number(img.height ?? 0);
    if (w >= 500 && h >= 500) {
      const ratio = w / h;
      if (ratio >= 0.93 && ratio <= 1.07) {
        score += 24;
      } else if (ratio > 1.45) {
        // Very wide landscape product image is often a lifestyle banner or size chart
        score -= 22;
      }
    }

    // Positional tie-breaker favoring lead/second/final packshot slot
    if (idx === 0) score += 14;
    else if (idx === 1) score += 11;
    else if (idx === total - 1 && total >= 3) score += 7;
    else score += Math.max(0, 8 - idx * 2);

    if (score > bestScore) {
      bestScore = score;
      bestUrl = optimizeShopifyImageUrl(rawSrc);
    }
  }

  if (!bestUrl || bestScore <= -140) {
    return null;
  }

  return { url: bestUrl, score: bestScore };
}

/**
 * Classifies a real Shopify product strictly into Hanging Upper-Body Apparel OR Table/Pedestal Object.
 */
function classifyRealShopifyProduct(
  title: string,
  productType: string,
  tags: string[]
): { kind: 'apparel' | 'object'; category: ProductCategory3D } | null {
  const primaryText = `${title} ${productType}`.toLowerCase();
  const fullCorpus = `${title} ${productType} ${tags.slice(0, 10).join(' ')}`.toLowerCase();

  if (EXCLUDED_PRODUCT_RE.test(fullCorpus)) {
    return null;
  }

  // 1. Check Physical Table & Pedestal Objects FIRST when title/type clearly names an object
  const isClearObjectInTitle =
    /\b(mug|cup|tumbler|kettle|carafe|dripper|server|teaware|cap|ballcap|hat|beanie|tote|carryall|backpack|duffel|bag|book|monograph|screenplay|magazine|zine|journal|notebook|vinyl|lp|candle|fragrance|perfume|eau de|bottle|vessel|cleanser|serum|body wash|hand wash|balm)\b/i.test(
      primaryText
    );

  if (isClearObjectInTitle && !STRICT_CLOTHING_FOR_OBJECTS_RE.test(title.toLowerCase())) {
    if (/\b(mug|cup|tumbler|kettle|carafe|dripper|server|teaware|espresso)\b/i.test(primaryText)) {
      return { kind: 'object', category: 'ceramic_mug' };
    }
    if (/\b(cap|ballcap|hat|beanie|visor)\b/i.test(primaryText)) {
      return { kind: 'object', category: 'structured_cap' };
    }
    if (/\b(tote|carryall|backpack|duffel|bag|pack)\b/i.test(primaryText)) {
      return { kind: 'object', category: 'canvas_tote' };
    }
    if (/\b(book|monograph|screenplay|magazine|zine|journal|notebook|vinyl|record|lp)\b/i.test(primaryText)) {
      return { kind: 'object', category: 'hardcover_book' };
    }
    if (
      /\b(candle|fragrance|perfume|eau de|bottle|vessel|cleanser|serum|wash|balm|mist|incense)\b/i.test(
        primaryText
      )
    ) {
      return { kind: 'object', category: 'apothecary_bottle' };
    }
  }

  // 2. Check Hanging Upper-Body Apparel (strictly excluding bottoms, socks, underwear, shoes, bags, hats)
  if (!STRICT_NON_UPPER_APPAREL_RE.test(primaryText)) {
    if (/\b(hoodie|sweatshirt|crewneck|pullover|fleece)\b/i.test(primaryText)) {
      return { kind: 'apparel', category: 'heavyweight_hoodie' };
    }
    if (
      /\b(jacket|varsity|bomber|blazer|cardigan|coat|overshirt|chore|anorak|parka|sweater|knit|quarter[- ]?zip|half[- ]?zip|rugby)\b/i.test(
        primaryText
      )
    ) {
      return { kind: 'apparel', category: 'varsity_jacket' };
    }
    if (/\b(tee|t-shirt|tshirt|shirt|polo|jersey|henley|long[- ]?sleeve)\b/i.test(primaryText)) {
      return { kind: 'apparel', category: 'structured_tshirt' };
    }
  }

  return null;
}

const INFLIGHT_CATALOG_PROMISES = new Map<string, Promise<ShopifyJsonProduct[]>>();

async function fetchCachedDomainProducts(domain: string, timeoutMs = 2600): Promise<ShopifyJsonProduct[]> {
  const cleanDomain = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const cached = INTERNET_CATALOG_CACHE.get(cleanDomain);
  if (cached && Date.now() - cached.fetchedAt < CATALOG_CACHE_TTL_MS) {
    return cached.products;
  }

  const inflight = INFLIGHT_CATALOG_PROMISES.get(cleanDomain);
  if (inflight) {
    return inflight;
  }

  const reqPromise = (async () => {
    try {
      const payload = await fetchJsonSafely(`https://${cleanDomain}/products.json?limit=48`, timeoutMs);
      const products = extractRawShopifyProductArray(payload);
      if (products.length > 0) {
        INTERNET_CATALOG_CACHE.set(cleanDomain, {
          fetchedAt: Date.now(),
          products,
        });
      }
      return products;
    } finally {
      INFLIGHT_CATALOG_PROMISES.delete(cleanDomain);
    }
  })();

  INFLIGHT_CATALOG_PROMISES.set(cleanDomain, reqPromise);
  return reqPromise;
}

async function fetchCachedDomainSuggest(
  domain: string,
  query: string,
  timeoutMs = 1500
): Promise<ShopifyJsonProduct[]> {
  const cleanDomain = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const cleanQ = query.trim().toLowerCase();
  if (!cleanQ) return [];

  const cacheKey = `${cleanDomain}::${cleanQ}`;
  const cached = INTERNET_SUGGEST_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CATALOG_CACHE_TTL_MS) {
    return cached.products;
  }

  const url = `https://${cleanDomain}/search/suggest.json?q=${encodeURIComponent(cleanQ)}&resources[type]=product&resources[limit]=6`;
  const payload = await fetchJsonSafely(url, timeoutMs);
  const products = extractRawShopifyProductArray(payload);
  INTERNET_SUGGEST_CACHE.set(cacheKey, {
    fetchedAt: Date.now(),
    products,
  });
  return products;
}

async function fetchCachedSingleProductByHandle(
  domain: string,
  handle: string,
  timeoutMs = 1050
): Promise<ShopifyJsonProduct | null> {
  const cleanHandle = handle.split('?')[0].trim();
  if (!cleanHandle) return null;
  const cacheKey = `${domain}::${cleanHandle}`;
  const cached = INTERNET_PRODUCT_HANDLE_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CATALOG_CACHE_TTL_MS) {
    return cached.product;
  }

  const payload = await fetchJsonSafely(`https://${domain}/products/${cleanHandle}.json`, timeoutMs);
  const arr = extractRawShopifyProductArray(payload);
  const product = arr[0] ?? null;
  INTERNET_PRODUCT_HANDLE_CACHE.set(cacheKey, {
    fetchedAt: Date.now(),
    product,
  });
  return product;
}

function inferProductHexFromTitleAndTags(
  title: string,
  tags: string[],
  fallbackHex: string
): string {
  const text = `${title} ${tags.slice(0, 6).join(' ')}`.toLowerCase();
  if (/\b(black|obsidian|onyx|jet|noir|ink|pitch)\b/.test(text)) return '#181A1E';
  if (/\b(charcoal|graphite|slate|ash|carbon|smoke)\b/.test(text)) return '#3A3E45';
  if (/\b(heather|grey|gray|silver|mist|cement)\b/.test(text)) return '#9A9EA4';
  if (/\b(white|chalk|ivory|optic|milk|snow)\b/.test(text)) return '#F4F2EC';
  if (/\b(natural|ecru|cream|oat|oatmeal|bone|off-white|canvas|parchment)\b/.test(text)) return '#EAE2D3';
  if (/\b(tan|sand|khaki|camel|beige|taupe|stone|wheat|field tan)\b/.test(text)) return '#C5AE8E';
  if (/\b(brown|espresso|chocolate|walnut|amber|cognac|tobacco|rust|terracotta)\b/.test(text)) return '#5C3D28';
  if (/\b(navy|indigo|abyss|midnight|cobalt|maritime)\b/.test(text)) return '#20304A';
  if (/\b(blue|sky|cerulean|denim|ocean)\b/.test(text)) return '#3B6E9C';
  if (/\b(sage|olive|moss|cedar|eucalyptus|pistachio)\b/.test(text)) return '#66755E';
  if (/\b(forest|emerald|pine|hunter|green|racing green)\b/.test(text)) return '#254736';
  if (/\b(burgundy|wine|oxblood|maroon|crimson|merlot)\b/.test(text)) return '#6B222B';
  if (/\b(red|scarlet|vermilion|tomato|coral)\b/.test(text)) return '#C83E32';
  if (/\b(yellow|mustard|ochre|gold|marigold|sun)\b/.test(text)) return '#D4A438';
  return fallbackHex;
}

/**
 * Searches real public Shopify stores across the matched aesthetic cluster (plus the input URL's own
 * catalog if it is a Shopify store), extracts clean studio packshots, and builds shortlisted candidates.
 */
async function gatherRealInternetProductCandidates(
  cluster: AestheticClusterId,
  keywords: ProductSearchKeywords,
  inputHostname: string,
  inputBrandName: string,
  ownShopifyRawProducts: ShopifyJsonProduct[]
): Promise<{
  apparelShortlist: RealInternetProductCandidate[];
  objectShortlist: RealInternetProductCandidate[];
  totalRawScanned: number;
}> {
  const clusterStores = CLUSTER_SHOPIFY_STORES[cluster];
  const vendorDisplayByDomain = new Map<string, string>(
    clusterStores.map((s) => [s.domain, s.vendorDisplay])
  );

  // 1. Fetch `/products.json?limit=48` across cluster stores + surgical `/search/suggest.json` probes
  const topApparelKw = keywords.apparel[0];
  const topObjectKw = keywords.objects[0];

  const catalogPromises = clusterStores.map(async (store) => ({
    domain: store.domain,
    source: 'catalog' as const,
    products: await fetchCachedDomainProducts(store.domain, 2600),
  }));

  const suggestPromises: Array<
    Promise<{ domain: string; source: 'suggest'; products: ShopifyJsonProduct[] }>
  > = [];

  if (topApparelKw && clusterStores[0]) {
    const coreTerms = topApparelKw.split(/\s+/).filter(Boolean);
    const queryTerm = coreTerms[coreTerms.length - 1] || topApparelKw;
    suggestPromises.push(
      fetchCachedDomainSuggest(clusterStores[0].domain, queryTerm, 1500).then((products) => ({
        domain: clusterStores[0].domain,
        source: 'suggest' as const,
        products,
      }))
    );
  }
  if (topObjectKw && clusterStores[1]) {
    const coreTerms = topObjectKw.split(/\s+/).filter(Boolean);
    const queryTerm = coreTerms[coreTerms.length - 1] || topObjectKw;
    suggestPromises.push(
      fetchCachedDomainSuggest(clusterStores[1].domain, queryTerm, 1500).then((products) => ({
        domain: clusterStores[1].domain,
        source: 'suggest' as const,
        products,
      }))
    );
  }

  // Guarantee iconic object categories (mug, book, tote, cap, candle) are probed on specialist stores
  const specialistProbes: Array<[string, string]> =
    cluster === 'cinema_streetwear'
      ? [
          ['actualsource.org', 'book'],
          ['actualsource.org', 'tote'],
          ['noahny.com', 'hat'],
        ]
      : cluster === 'minimal_tech'
        ? [
            ['fellowproducts.com', 'mug'],
            ['ugmonk.com', 'tote'],
            ['ladywhiteco.com', 'hoodie'],
          ]
        : cluster === 'artisanal_cafe'
          ? [
              ['fellowproducts.com', 'mug'],
              ['malinandgoetz.com', 'candle'],
              ['kinto-usa.com', 'mug'],
            ]
          : [
              ['rowingblazers.com', 'cap'],
              ['actualsource.org', 'book'],
              ['ebbets.com', 'ballcap'],
            ];

  for (const [specDomain, specQ] of specialistProbes) {
    suggestPromises.push(
      fetchCachedDomainSuggest(specDomain, specQ, 1450).then((products) => ({
        domain: specDomain,
        source: 'suggest' as const,
        products,
      }))
    );
  }

  const allBatches = await Promise.all([...catalogPromises, ...suggestPromises]);

  // Merge full `/products.json` records by `domain::handle` so suggest hits inherit full `images[]` when present
  const mergedByKey = new Map<
    string,
    { domain: string; raw: ShopifyJsonProduct; fromSuggestOnly: boolean; isFromInputDomain: boolean }
  >();

  let totalRawScanned = ownShopifyRawProducts.length;

  const cleanInputHost = inputHostname.toLowerCase().replace(/^www\./, '');
  if (ownShopifyRawProducts.length > 0) {
    vendorDisplayByDomain.set(cleanInputHost, toTitleCase(inputBrandName));
    for (const p of ownShopifyRawProducts) {
      const handle = String(p.handle ?? '').split('?')[0].trim();
      if (!handle) continue;
      mergedByKey.set(`${cleanInputHost}::${handle}`, {
        domain: cleanInputHost,
        raw: p,
        fromSuggestOnly: false,
        isFromInputDomain: true,
      });
    }
  }

  for (const batch of allBatches) {
    totalRawScanned += batch.products.length;
    for (const p of batch.products) {
      const rawHandle =
        String(p.handle ?? '') ||
        (typeof (p as { url?: string }).url === 'string'
          ? ((p as { url?: string }).url!.match(/\/products\/([^/?#]+)/)?.[1] ?? '')
          : '');
      const handle = rawHandle.split('?')[0].trim();
      if (!handle) continue;

      const key = `${batch.domain}::${handle}`;
      const existing = mergedByKey.get(key);
      if (!existing) {
        mergedByKey.set(key, {
          domain: batch.domain,
          raw: p,
          fromSuggestOnly: batch.source === 'suggest',
          isFromInputDomain: batch.domain === cleanInputHost,
        });
      } else if (existing.fromSuggestOnly && batch.source === 'catalog') {
        // Upgrade suggest-only entry with full catalog entry containing all `images[]` & `variants[]`
        mergedByKey.set(key, {
          domain: batch.domain,
          raw: p,
          fromSuggestOnly: false,
          isFromInputDomain: existing.isFromInputDomain,
        });
      }
    }
  }

  // Upgrade up to 10 high-value suggest-only items via `/products/<handle>.json` so `pickCleanestPackshotImage`
  // inspects every product's complete studio image gallery (e.g. picking `_01.jpg` flat-lay over `_02.jpg` model!)
  const suggestOnlyEntries = [...mergedByKey.values()].filter((entry) => {
    if (!entry.fromSuggestOnly) return false;
    const title = decodeHtmlEntities(String(entry.raw.title ?? ''));
    const pType = decodeHtmlEntities(String(entry.raw.product_type ?? entry.raw.type ?? ''));
    return classifyRealShopifyProduct(title, pType, normalizeProductTags(entry.raw.tags)) !== null;
  });

  if (suggestOnlyEntries.length > 0) {
    await Promise.all(
      suggestOnlyEntries.slice(0, 4).map(async (entry) => {
        const handle = String(entry.raw.handle ?? '').split('?')[0].trim();
        const fullProd = await fetchCachedSingleProductByHandle(entry.domain, handle, 1050);
        if (fullProd) {
          entry.raw = fullProd;
          entry.fromSuggestOnly = false;
        }
      })
    );
  }

  const apparelCandidates: RealInternetProductCandidate[] = [];
  const objectCandidates: RealInternetProductCandidate[] = [];

  const allSearchTerms = [
    ...keywords.apparel,
    ...keywords.objects,
    ...keywords.colorWords,
  ].map((s) => s.toLowerCase());

  for (const [key, entry] of mergedByKey.entries()) {
    const { domain, raw, isFromInputDomain } = entry;
    const title = decodeHtmlEntities(String(raw.title ?? '').trim());
    if (!title || title.length < 3) continue;

    const handle = String(raw.handle ?? slugify(title)).split('?')[0].trim();
    if (!handle) continue;

    const productType = decodeHtmlEntities(String(raw.product_type ?? raw.type ?? '').trim());
    const tags = normalizeProductTags(raw.tags);

    const classified = classifyRealShopifyProduct(title, productType, tags);
    if (!classified) continue;

    const packshot = pickCleanestPackshotImage(extractProductImagesList(raw));
    if (!packshot) continue;

    const firstVariant =
      Array.isArray(raw.variants) && raw.variants.length > 0 ? raw.variants[0] : undefined;
    const price = parsePriceNumber(firstVariant?.price ?? raw.price ?? raw.price_min, 68);
    if (price < 12 || price > 950) continue;

    const rawVendor = raw.vendor ? decodeHtmlEntities(String(raw.vendor).trim()) : '';
    const vendorName =
      vendorDisplayByDomain.get(domain) ||
      (rawVendor ? toTitleCase(rawVendor) : humanizeDomainRoot(domain.split('.')[0]));

    const textLower = `${title} ${productType} ${tags.slice(0, 8).join(' ')}`.toLowerCase();
    let kwScore = 0;
    for (const term of allSearchTerms) {
      if (term.length >= 3 && textLower.includes(term)) {
        kwScore += 16;
      } else {
        for (const word of term.split(/\s+/)) {
          if (word.length >= 3 && textLower.includes(word)) {
            kwScore += 7;
          }
        }
      }
    }

    const relevanceScore =
      packshot.score +
      kwScore +
      (isFromInputDomain ? 42 : 0);

    const candidate: RealInternetProductCandidate = {
      key,
      domain,
      vendorName,
      title,
      handle,
      productType,
      tags,
      price,
      productUrl: `https://${domain}/products/${handle}`,
      variantId: firstVariant?.id !== undefined ? String(firstVariant.id) : undefined,
      packshotUrl: packshot.url,
      packshotScore: packshot.score,
      kind: classified.kind,
      category: classified.category,
      isFromInputDomain,
      relevanceScore,
    };

    if (classified.kind === 'apparel') {
      apparelCandidates.push(candidate);
    } else {
      objectCandidates.push(candidate);
    }
  }

  // Pick a diverse top-6 shortlist for apparel & top-6 shortlist for objects across categories & stores
  const pickDiverseShortlist = (
    pool: RealInternetProductCandidate[],
    targetCategories: readonly ProductCategory3D[],
    limit: number
  ): RealInternetProductCandidate[] => {
    const sorted = [...pool].sort((a, b) => b.relevanceScore - a.relevanceScore);
    const chosen: RealInternetProductCandidate[] = [];
    const chosenKeys = new Set<string>();
    const perDomainCount = new Map<string, number>();

    // Pass 1: ensure at least one strong candidate from each category across distinct stores
    for (const cat of targetCategories) {
      const match = sorted.find(
        (c) =>
          c.category === cat &&
          !chosenKeys.has(c.key) &&
          (perDomainCount.get(c.domain) ?? 0) < 2
      );
      if (match && chosen.length < limit) {
        chosen.push(match);
        chosenKeys.add(match.key);
        perDomainCount.set(match.domain, (perDomainCount.get(match.domain) ?? 0) + 1);
      }
    }

    // Pass 2: fill remaining shortlist slots with highest-scoring diverse candidates
    for (const c of sorted) {
      if (chosen.length >= limit) break;
      if (chosenKeys.has(c.key)) continue;
      if ((perDomainCount.get(c.domain) ?? 0) >= 2) continue;
      chosen.push(c);
      chosenKeys.add(c.key);
      perDomainCount.set(c.domain, (perDomainCount.get(c.domain) ?? 0) + 1);
    }

    // Pass 3: relax domain cap if needed
    for (const c of sorted) {
      if (chosen.length >= limit) break;
      if (chosenKeys.has(c.key)) continue;
      chosen.push(c);
      chosenKeys.add(c.key);
    }

    return chosen;
  };

  return {
    apparelShortlist: pickDiverseShortlist(apparelCandidates, HANGING_APPAREL_CATEGORIES, 6),
    objectShortlist: pickDiverseShortlist(objectCandidates, PEDESTAL_OBJECT_CATEGORIES, 6),
    totalRawScanned,
  };
}

/**
 * Scores up to 12 candidate internet products (6 apparel + 6 objects) in ONE single ~230ms call
 * to `gemini-decision-1` (`v1beta`) to select the calibrated top 3 apparel + top 3 objects.
 */
async function scoreShortlistWithGeminiDecision1(
  apiKey: string,
  decisionsModel: string,
  brandName: string,
  vibe: string,
  brandEthos: string,
  archetype: WorldArchetypeId,
  cluster: AestheticClusterId,
  palette: StorePalette,
  shortlist: RealInternetProductCandidate[]
): Promise<boolean> {
  if (shortlist.length === 0) return false;

  const aiBeta = new GoogleGenAI({ apiKey, apiVersion: 'v1beta' });
  const questions: Record<string, { type: 'noul'; instructions: string }> = {};

  shortlist.forEach((cand, idx) => {
    questions[`cand_${idx}`] = {
      type: 'noul',
      instructions: `Candidate #${idx + 1}: "${cand.title}" by ${cand.vendorName} ($${cand.price}, category=${cand.category}, store=${cand.domain}, type="${cand.productType || cand.kind}"). Does this real product's style, color, and category strongly fit ${brandName}'s visual aesthetic and 3D flagship store concept?`,
    };
  });

  const sharedInput = `Target Brand Storefront Concept:
Brand: ${brandName}
Archetype: ${archetype} (Cluster: ${cluster})
Visual Vibe: ${vibe}
Ethos: ${brandEthos}
Store Palette: wall=${palette.wall}, floor=${palette.floor}, accent=${palette.accent}`;

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error('gemini-decision-1 ranking timed out'));
    }, 3400);
  });

  try {
    const decisionRes = await Promise.race([
      aiBeta.decisions.create({
        model: decisionsModel,
        input: sharedInput,
        questions,
      }),
      timeoutPromise,
    ]);

    let anyScored = false;
    shortlist.forEach((cand, idx) => {
      const ans = decisionRes.answers?.[`cand_${idx}`];
      if (ans && ans.type === 'noul' && typeof ans.noul === 'number') {
        cand.decisionProbability = ans.noul;
        cand.decisionConfidence = ans.confidence;
        anyScored = true;
      }
    });
    return anyScored;
  } catch {
    return false;
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

function selectWinningProducts(
  apparelShortlist: RealInternetProductCandidate[],
  objectShortlist: RealInternetProductCandidate[]
): {
  winningApparel: RealInternetProductCandidate[];
  winningObjects: RealInternetProductCandidate[];
} {
  const compositeScore = (c: RealInternetProductCandidate): number => {
    const decisionTerm =
      typeof c.decisionProbability === 'number' ? c.decisionProbability * 100 : 50;
    const packshotTerm = Math.min(40, Math.max(-20, c.packshotScore * 0.25));
    const homeBonus = c.isFromInputDomain ? 18 : 0;
    return decisionTerm + packshotTerm + homeBonus;
  };

  const rankedApparel = [...apparelShortlist].sort((a, b) => compositeScore(b) - compositeScore(a));
  const winningApparel: RealInternetProductCandidate[] = [];
  const usedApparelCategories = new Set<ProductCategory3D>();

  for (const cand of rankedApparel) {
    if (winningApparel.length >= 3) break;
    if (winningApparel.length === 0 || !usedApparelCategories.has(cand.category)) {
      winningApparel.push(cand);
      usedApparelCategories.add(cand.category);
    }
  }
  for (const cand of rankedApparel) {
    if (winningApparel.length >= 3) break;
    if (!winningApparel.some((w) => w.key === cand.key)) {
      winningApparel.push(cand);
    }
  }

  // Re-sort winning apparel so the highest calibrated piece takes the Hero Faceout Stand (index 0)
  winningApparel.sort((a, b) => compositeScore(b) - compositeScore(a));

  const rankedObjects = [...objectShortlist].sort((a, b) => compositeScore(b) - compositeScore(a));
  const winningObjects: RealInternetProductCandidate[] = [];
  const usedObjectCategories = new Set<ProductCategory3D>();

  // Strongly prefer 3 distinct physical object categories across center_table, left_pedestal & right_pedestal
  for (const cand of rankedObjects) {
    if (winningObjects.length >= 3) break;
    if (!usedObjectCategories.has(cand.category)) {
      winningObjects.push(cand);
      usedObjectCategories.add(cand.category);
    }
  }
  for (const cand of rankedObjects) {
    if (winningObjects.length >= 3) break;
    if (!winningObjects.some((w) => w.key === cand.key)) {
      winningObjects.push(cand);
    }
  }

  return { winningApparel, winningObjects };
}

function buildRealProductSpecFromCandidate(
  cand: RealInternetProductCandidate,
  placement: ProductPlacementZone,
  featured: boolean,
  slotIndex: number,
  brandName: string,
  monogram: string,
  vibe: string,
  palette: StorePalette,
  hadInitialPhotos: boolean
): InventedProductSpec {
  const brandSlug = slugify(brandName);
  const proxiedImageUrl = toProxiedImageUrl(cand.packshotUrl);

  const fallbackBodyHex = slotIndex % 2 === 0 ? '#1C1E24' : '#EFEBE2';
  const primaryColor = inferProductHexFromTitleAndTags(cand.title, cand.tags, fallbackBodyHex);
  const accentColor = ensureWcagContrast(palette.accent, primaryColor, 3.4);
  const secondaryColor = mixHex(primaryColor, palette.plinth, 0.35);

  const fitPct =
    typeof cand.decisionProbability === 'number'
      ? ` (${Math.round(Math.max(0.62, cand.decisionProbability) * 100)}% Decision-1 visual fit)`
      : '';

  const photoAnchorPhrase = hadInitialPhotos
    ? `${brandName}'s initial website photography and ${palette.accent} palette`
    : `${brandName}'s "${vibe.slice(0, 56)}" visual identity`;

  const designRationale = `Sourced live from ${cand.vendorName} (${cand.domain})${fitPct} — pairs clean ${cand.category.replace('_', ' ')} proportions with ${photoAnchorPhrase}.`;

  return {
    id: `matched-${brandSlug}-${slotIndex + 1}-${placement}`,
    sku: `${monogram}-${categorySkuCode(cand.category)}-0${slotIndex + 1}`,
    title: cand.title.slice(0, 68),
    subtitle: `${cand.vendorName} · Matched via Gemini 4`,
    category: cand.category,
    placement,
    price: cand.price,
    primaryColor,
    secondaryColor,
    accentColor,
    graphicHeadline: clampGraphicHeadline(cand.vendorName, monogram),
    graphicSubtext: cand.domain.toUpperCase().slice(0, 36),
    graphicMotif: 'minimal_typo',
    materialFinish: defaultMaterialFinishForCategory(cand.category),
    designRationale,
    shopifyProductUrl: cand.productUrl,
    shopifyVariantId: cand.variantId,
    featured,
    customCutoutUrl: proxiedImageUrl,
  };
}

/**
 * Builds a `GarmentAssetSet` for `BoutiqueRack` WITHOUT `productSpec` so `BoutiqueRack` renders
 * our photorealistic CIELAB studio cutout `<HangingGarment>` (never parametric clay tubes!).
 */
function buildPhotorealisticRackGarmentAsset(
  spec: InventedProductSpec,
  featured: boolean
): GarmentAssetSet {
  const proxiedUrl = spec.customCutoutUrl ?? '';
  return {
    id: spec.id,
    sku: spec.sku,
    title: spec.title,
    subtitle: spec.subtitle,
    price: spec.price,
    featured,
    // Intentionally omit `productSpec` so BoutiqueRack + App render `<HangingGarment>` cutout!
    rawUrl: proxiedUrl,
    frontCutoutUrl: proxiedUrl,
    dominantHex: spec.primaryColor,
  };
}

// ============================================================================
// 5. HTTP HELPERS, IMAGE PROXY & MAIN `/api/ingest-url` HANDLER
// ============================================================================

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

async function fetchJsonSafely(url: string, timeoutMs = 1700, allowRetry429 = true): Promise<unknown | null> {
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
    if (res.status === 429 && allowRetry429) {
      await new Promise((r) => setTimeout(r, 950));
      return fetchJsonSafely(url, timeoutMs, false);
    }
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
  timeoutMs = 3000
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
  timeoutMs = 620
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
        // Request standard canvas-decodable formats (webp/png/jpeg)
        Accept: 'image/webp,image/png,image/jpeg,image/*;q=0.9,*/*;q=0.5',
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

    putInImageCache(cacheKey, bytes, rawContentType);

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

const INGEST_RESPONSE_CACHE = new Map<
  string,
  { cachedAt: number; payload: IngestUrlResponsePayload }
>();

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

  const normalizedUrlKey = targetUrl.toString();
  const cachedIngest = INGEST_RESPONSE_CACHE.get(normalizedUrlKey);
  if (
    cachedIngest &&
    Date.now() - cachedIngest.cachedAt < CATALOG_CACHE_TTL_MS &&
    body.forceRefresh !== true
  ) {
    const freshClone: IngestUrlResponsePayload = {
      ...cachedIngest.payload,
      storeConfig: {
        ...cachedIngest.payload.storeConfig,
        id: `ingested-${slugify(targetUrl.hostname)}-${Date.now()}`,
      },
    };
    sendJson(res, 200, freshClone);
    return;
  }

  const collectionHandle = targetUrl.pathname.match(/\/collections\/([^/?#]+)/i)?.[1];
  const productHandle = targetUrl.pathname.match(/\/products\/([^/?#]+)/i)?.[1];

  // 1. Fetch input website HTML & optional own Shopify catalog concurrently
  const htmlPromise = fetchHtmlSafely(targetUrl.toString(), 3000);
  const singleProductPromise = productHandle
    ? fetchJsonSafely(`${targetUrl.origin}/products/${productHandle}.json`, 1600)
    : Promise.resolve(null);
  const collectionPromise = collectionHandle
    ? fetchJsonSafely(`${targetUrl.origin}/collections/${collectionHandle}/products.json?limit=24`, 1600)
    : Promise.resolve(null);
  const rootProductsPromise = fetchJsonSafely(`${targetUrl.origin}/products.json?limit=24`, 1500);

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

  const ownShopifyRawProducts: ShopifyJsonProduct[] = [
    ...extractRawShopifyProductArray(singleProductJson),
    ...extractRawShopifyProductArray(collectionJson),
    ...extractRawShopifyProductArray(rootProductsJson),
  ];

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

  let colorProfile = extractDeepColorProfile(html, '', domainRoot, themeColorRaw);
  if (html && colorProfile.allDistinctHexes.length < 2) {
    const extCss = await fetchFirstStylesheetSnippet(html, effectiveOrigin, 580);
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

  const deterministicBlueprint = inventDeterministicBrandWorld(identity);
  const heuristicCluster = mapArchetypeToAestheticCluster(recommendedArchetype, subVertical);

  // 2. Extract 1–3 initial website photos & download up to 2 (`<= 1.5s`) while pre-warming cluster catalogs!
  const candidateInitialPhotoUrls = extractInitialWebsitePhotoUrls(
    html,
    effectiveOrigin,
    ownShopifyRawProducts
  );

  const prewarmPromise = Promise.all(
    CLUSTER_SHOPIFY_STORES[heuristicCluster].map((s) => fetchCachedDomainProducts(s.domain, 2400))
  );

  const downloadedInitialPhotos = await downloadInitialPhotosForVision(
    candidateInitialPhotoUrls,
    1500
  );

  // Build proxied `initialPhotoUrls` (downloaded verified photos first, then remaining extracted candidates)
  const initialPhotoUrls: string[] = [];
  for (const dl of downloadedInitialPhotos) {
    if (!initialPhotoUrls.includes(dl.proxiedUrl)) {
      initialPhotoUrls.push(dl.proxiedUrl);
    }
  }
  for (const rawCandidate of candidateInitialPhotoUrls) {
    if (initialPhotoUrls.length >= 3) break;
    const proxied = toProxiedImageUrl(rawCandidate);
    if (!initialPhotoUrls.includes(proxied)) {
      initialPhotoUrls.push(proxied);
    }
  }

  // 3. Run Multimodal `gemini-4-neon` Visual Brand & Product Query Planner
  const env = readRuntimeEnv(viteEnv);
  const geminiKey = pickNextGeminiApiKey(env) || (env.GEMINI_API_KEY || env.GOOGLE_API_KEY)?.trim();
  const neonModel = env.GEMINI_VISION_MODEL?.trim() || 'gemini-4-neon';
  const decisionsModel = env.GEMINI_DECISIONS_MODEL?.trim() || 'gemini-decision-1';
  const hasValidGeminiKey = Boolean(geminiKey && !/^your_|^insert_|^placeholder/i.test(geminiKey));

  let usedNeon = false;
  let neonPlan: NeonVisualBrandPlan | null = null;

  if (hasValidGeminiKey && geminiKey) {
    try {
      neonPlan = await withGeminiKeyFailover(env, (activeKey) =>
        planBrandAndQueriesWithGeminiNeon(
          activeKey,
          neonModel,
          identity,
          downloadedInitialPhotos,
          deterministicBlueprint,
          heuristicCluster
        )
      );
      if (neonPlan) {
        usedNeon = true;
      }
    } catch {
      usedNeon = false;
    }
  }

  await prewarmPromise.catch(() => null);

  const activeCluster: AestheticClusterId = neonPlan?.aestheticCluster ?? heuristicCluster;
  const activeKeywords: ProductSearchKeywords =
    neonPlan?.searchKeywords ?? DEFAULT_CLUSTER_KEYWORDS[activeCluster];

  const finalBrandName = neonPlan?.brandName ?? deterministicBlueprint.brandName;
  const finalTagline = neonPlan?.tagline ?? deterministicBlueprint.tagline;
  const finalVibe = neonPlan?.vibe ?? deterministicBlueprint.vibe;
  const finalBrandEthos = neonPlan?.brandEthos ?? deterministicBlueprint.brandEthos;
  const finalArchetype = neonPlan?.archetype ?? deterministicBlueprint.archetype;
  const finalLighting = neonPlan?.lightingPreset ?? deterministicBlueprint.lightingPreset;
  const finalPalette = neonPlan?.palette ?? deterministicBlueprint.palette;
  const finalMetalRoughness = neonPlan?.metalRoughness ?? deterministicBlueprint.metalRoughness;
  const finalMetalness = neonPlan?.metalness ?? deterministicBlueprint.metalness;

  // 4. Pull REAL matching products from live multi-store Shopify catalogs across the internet
  const { apparelShortlist, objectShortlist, totalRawScanned } =
    await gatherRealInternetProductCandidates(
      activeCluster,
      activeKeywords,
      hostname,
      finalBrandName,
      ownShopifyRawProducts
    );

  // 5. Calibrated single-pass ranking via `gemini-decision-1` (`v1beta`, ~230ms!)
  const combinedShortlist = [...apparelShortlist, ...objectShortlist];
  let usedDecision = false;
  if (hasValidGeminiKey && geminiKey && combinedShortlist.length > 0) {
    usedDecision = await scoreShortlistWithGeminiDecision1(
      geminiKey,
      decisionsModel,
      finalBrandName,
      finalVibe,
      finalBrandEthos,
      finalArchetype,
      activeCluster,
      finalPalette,
      combinedShortlist
    );
  }

  const { winningApparel, winningObjects } = selectWinningProducts(
    apparelShortlist,
    objectShortlist
  );

  // 6. Populate `StoreConfig.products` (all 6 real internet products) & `StoreConfig.racks[0..1]`
  const targetSlots: ReadonlyArray<{
    placement: ProductPlacementZone;
    isApparel: boolean;
    featured: boolean;
  }> = [
    { placement: 'hero_rack', isApparel: true, featured: true },
    { placement: 'capsule_rack', isApparel: true, featured: false },
    { placement: 'capsule_rack', isApparel: true, featured: false },
    { placement: 'center_table', isApparel: false, featured: false },
    { placement: 'left_pedestal', isApparel: false, featured: false },
    { placement: 'right_pedestal', isApparel: false, featured: false },
  ];

  let appIdx = 0;
  let objIdx = 0;
  const matchedDomainsSet = new Set<string>();
  const hadInitialPhotos = initialPhotoUrls.length > 0;

  const finalProducts: InventedProductSpec[] = targetSlots.map((slot, slotIdx) => {
    const realCand = slot.isApparel ? winningApparel[appIdx++] : winningObjects[objIdx++];
    if (realCand) {
      matchedDomainsSet.add(realCand.domain);
      return buildRealProductSpecFromCandidate(
        realCand,
        slot.placement,
        slot.featured,
        slotIdx,
        finalBrandName,
        monogram,
        finalVibe,
        finalPalette,
        hadInitialPhotos
      );
    }
    return deterministicBlueprint.products[slotIdx];
  });

  const heroSpec = finalProducts[0];
  const capsuleSpecs = finalProducts.slice(1, 3);

  const heroRackItem: GarmentAssetSet = heroSpec.customCutoutUrl
    ? buildPhotorealisticRackGarmentAsset(heroSpec, true)
    : {
        id: heroSpec.id,
        sku: heroSpec.sku,
        title: heroSpec.title,
        subtitle: heroSpec.subtitle,
        price: heroSpec.price,
        featured: true,
        rawUrl: '',
        dominantHex: heroSpec.primaryColor,
      };

  const capsuleRackItems: GarmentAssetSet[] = capsuleSpecs.map((spec) =>
    spec.customCutoutUrl
      ? buildPhotorealisticRackGarmentAsset(spec, false)
      : {
          id: spec.id,
          sku: spec.sku,
          title: spec.title,
          subtitle: spec.subtitle,
          price: spec.price,
          featured: false,
          rawUrl: '',
          dominantHex: spec.primaryColor,
        }
  );

  const racks: RackPlacement[] = [
    {
      id: 'ingested-hero-faceout',
      label: `${finalBrandName} Hero Stand`,
      position: [0, 0, 0],
      rotationY: 0,
      style: 'hero_faceout',
      items: [heroRackItem],
    },
  ];

  if (capsuleRackItems.length > 0) {
    racks.push({
      id: 'ingested-capsule-rail',
      label: `${finalBrandName} Capsule Rail`,
      position: [-1.58, 0, -0.58],
      rotationY: 0.34,
      style: 'capsule_rail',
      items: capsuleRackItems,
    });
  }

  const matchedStoreDomains = [...matchedDomainsSet];
  const baseArchitectNotes = neonPlan?.architectNotes ?? deterministicBlueprint.architectNotes;
  const provenanceNote =
    matchedStoreDomains.length > 0
      ? `Matched 6 real internet products across ${matchedStoreDomains.join(', ')} using Gemini 4 Neon initial-photo vision + Gemini Decision 1 calibrated ranking.`
      : undefined;

  const architectNotes = provenanceNote
    ? [...baseArchitectNotes.slice(0, 3), provenanceNote]
    : baseArchitectNotes;

  const storeConfig: StoreConfig = {
    id: `ingested-${slugify(hostname)}-${Date.now()}`,
    brandName: finalBrandName,
    tagline: finalTagline,
    vibe: finalVibe,
    archetype: finalArchetype,
    sourceUrl: targetUrl.toString(),
    brandEthos: finalBrandEthos,
    palette: finalPalette,
    metalRoughness: finalMetalRoughness,
    metalness: finalMetalness,
    lightingPreset: finalLighting,
    textures: {},
    racks,
    products: finalProducts,
    architectNotes,
  };

  const responsePayload: IngestUrlResponsePayload = {
    storeConfig,
    rawProductCount: totalRawScanned > 0 ? totalRawScanned : finalProducts.length,
    sourceType: matchedStoreDomains.length > 0 ? 'shopify' : sourceType,
    usedGemini: usedNeon || usedDecision,
    usedDecision,
    initialPhotoUrls,
    matchedStoreDomains,
    aestheticCluster: activeCluster,
  };

  if (matchedStoreDomains.length > 0) {
    INGEST_RESPONSE_CACHE.set(normalizedUrlKey, {
      cachedAt: Date.now(),
      payload: responsePayload,
    });
  }

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
