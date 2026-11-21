import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { loadEnv, type Plugin } from 'vite';
import { GoogleGenAI } from '@google/genai';
import type { StorePalette } from '../src/types/storeConfig';

export type StudioRenderMode = 'clean_cutout' | 'commercial_showcase';

export interface StudioRenderRequest {
  imageUrl?: string;
  title: string;
  subtitle?: string;
  category?: string;
  brandName: string;
  vibe?: string;
  palette?: Partial<StorePalette>;
  mode: StudioRenderMode;
  /** Optional flag allowing explicit user re-rolls to bypass cache */
  forceRefresh?: boolean;
}

export interface StudioRenderResponse {
  dataUrl: string;
  cachedUrl?: string;
  mode: StudioRenderMode;
  modelUsed: string;
  fromCache?: boolean;
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

interface DownloadedReferenceImage {
  base64: string;
  mimeType: string;
}

interface CachedStudioRender {
  dataUrl: string;
  cachedUrl?: string;
  mode: StudioRenderMode;
  modelUsed: string;
}

const DEFAULT_STUDIO_MODEL = 'gemini-nano-banana-2.1';

// Browser-grade User-Agent; omit image/avif in Accept so Shopify/Cloudflare/Imgix serve PNG/JPEG/WebP directly
const STUDIO_FETCH_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const MEMORY_RENDER_CACHE = new Map<string, CachedStudioRender>();
const MAX_MEMORY_CACHE_ENTRIES = 96;
const IN_FLIGHT_RENDERS = new Map<string, Promise<StudioRenderResponse>>();

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

function normalizeExternalImageUrl(rawInput: string): URL {
  let trimmed = rawInput.trim();
  if (!trimmed) {
    throw new Error('Empty external image URL');
  }
  if (trimmed.startsWith('//')) {
    trimmed = `https:${trimmed}`;
  }
  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported image protocol: ${parsed.protocol}`);
  }
  if (isDisallowedHost(parsed.hostname)) {
    throw new Error('Private or local network image URLs are not permitted');
  }
  return parsed;
}

function sniffImageMimeType(bytes: Uint8Array, headerContentType?: string): string | null {
  if (bytes.length >= 8) {
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      return 'image/png';
    }
    // JPEG: FF D8 FF
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image/jpeg';
    }
    // WebP: RIFF....WEBP
    if (
      bytes.length >= 12 &&
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
    // GIF: GIF87a / GIF89a
    if (
      bytes[0] === 0x47 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x38
    ) {
      return 'image/gif';
    }
  }

  const cleaned = (headerContentType ?? '').split(';')[0].trim().toLowerCase();
  if (
    cleaned === 'image/png' ||
    cleaned === 'image/jpeg' ||
    cleaned === 'image/webp' ||
    cleaned === 'image/gif' ||
    cleaned === 'image/heic' ||
    cleaned === 'image/heif'
  ) {
    return cleaned;
  }
  if (cleaned === 'image/jpg') {
    return 'image/jpeg';
  }
  // Reject SVG / HTML / unknown non-raster payloads cleanly so caller can fall back to text-to-image
  return null;
}

function inferMimeFromExtension(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.jpg':
    case '.jpeg':
    default:
      return 'image/jpeg';
  }
}

function extensionForMime(mimeType: string): string {
  const clean = mimeType.toLowerCase();
  if (clean.includes('png')) return 'png';
  if (clean.includes('webp')) return 'webp';
  if (clean.includes('gif')) return 'gif';
  return 'jpg';
}

function isApparelCategory(category?: string, title?: string): boolean {
  const c = (category ?? '').toLowerCase();
  if (
    c === 'heavyweight_hoodie' ||
    c === 'structured_tshirt' ||
    c === 'varsity_jacket' ||
    /hoodie|tshirt|t-shirt|tee|jacket|coat|blazer|cardigan|sweater|knit|shirt|polo|pullover|crewneck|fleece|vest|jersey|apparel/.test(
      c
    )
  ) {
    return true;
  }
  if (!c && title) {
    return /\b(hoodie|t-shirt|tee|jacket|cardigan|sweater|sweatshirt|crewneck|shirt|polo|vest)\b/i.test(
      title
    );
  }
  return false;
}

function buildStudioPrompt(req: StudioRenderRequest, hasReferenceImage: boolean): string {
  const titleDesc = req.subtitle ? `${req.title} (${req.subtitle})` : req.title;
  const brand = req.brandName?.trim() || 'Atelier';
  const apparel = isApparelCategory(req.category, req.title);

  if (req.mode === 'clean_cutout') {
    if (hasReferenceImage) {
      if (apparel) {
        return `Isolate the exact main garment (${titleDesc} by ${brand}) from this reference photo, preserving its exact colors, graphic print, logos, fabric texture, and details. Re-render it as an ultra-crisp, front-facing luxury e-commerce studio photograph hanging naturally with relaxed gravity-draped sleeves (no visible hanger hook, no human model, no mannequin). Centered with full margins on a flat, uniform solid #DCDCDC neutral studio gray background with softbox lighting and zero cast shadow on the background.`;
      }
      return `Isolate this exact physical product (${titleDesc} by ${brand}), preserving its exact design, label, materials, and colors. Re-render it as a crisp, photorealistic 3/4 front-angled 3D commercial product photograph centered on a flat, uniform solid #DCDCDC neutral studio gray background with studio rim lighting, subtle specular highlights, and zero cast background shadow. Ensure the complete object and its base sit fully inside the frame with clean margins.`;
    }

    // Text-to-image fallback when no reference image URL was supplied
    if (apparel) {
      return `Ultra-crisp, front-facing luxury e-commerce studio product photograph of "${titleDesc}" designed for ${brand} (${req.vibe || 'contemporary boutique'}). Hanging naturally with relaxed gravity-draped sleeves, no visible hanger hook, no human model, no mannequin. Centered with generous margins on a flat, uniform solid #DCDCDC neutral studio gray background with softbox lighting and zero cast shadow on the background.`;
    }
    return `Crisp, photorealistic 3/4 front-angled 3D commercial product photograph of "${titleDesc}" designed for ${brand} (${req.vibe || 'contemporary boutique'}), centered with generous margins on a flat, uniform solid #DCDCDC neutral studio gray background with studio rim lighting, subtle specular highlights, and zero cast background shadow.`;
  }

  // mode === 'commercial_showcase'
  const vibeDesc = req.vibe?.trim() || 'architectural boutique';
  const wallHex = req.palette?.wall || '#EFEAE0';
  const accentHex = req.palette?.accent || '#C5A059';

  if (hasReferenceImage) {
    return `Create a breathtaking, photorealistic luxury commercial 3D product advertisement render of this exact product (${titleDesc} by ${brand}) for sale inside a ${vibeDesc} setting (palette: ${wallHex}, accent ${accentHex}). Place the product heroically on a sculpted architectural stone/metal plinth with dramatic studio key lighting, shallow depth-of-field bokeh, and crisp commercial detail. No text overlays or watermarks.`;
  }

  return `Create a breathtaking, photorealistic luxury commercial 3D product advertisement render of "${titleDesc}" by ${brand} for sale inside a ${vibeDesc} setting (palette: ${wallHex}, accent ${accentHex}). Place the product heroically on a sculpted architectural stone/metal plinth with dramatic studio key lighting, shallow depth-of-field bokeh, and crisp commercial detail. No text overlays or watermarks.`;
}

function computeCacheHash(req: StudioRenderRequest, modelName: string): string {
  const rawImage = req.imageUrl?.trim() ?? '';
  const imageKey =
    rawImage.length > 512
      ? crypto.createHash('sha256').update(rawImage).digest('hex')
      : rawImage;

  const payload = JSON.stringify({
    v: 1,
    model: modelName,
    mode: req.mode,
    imageKey,
    title: req.title.trim(),
    subtitle: req.subtitle?.trim() ?? '',
    category: req.category?.trim() ?? '',
    brandName: req.brandName.trim(),
    vibe: req.vibe?.trim() ?? '',
    wall: req.palette?.wall ?? '',
    accent: req.palette?.accent ?? '',
  });

  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 28);
}

function setMemoryCache(hash: string, value: CachedStudioRender): void {
  if (MEMORY_RENDER_CACHE.size >= MAX_MEMORY_CACHE_ENTRIES) {
    const oldestKey = MEMORY_RENDER_CACHE.keys().next().value;
    if (oldestKey !== undefined) {
      MEMORY_RENDER_CACHE.delete(oldestKey);
    }
  }
  MEMORY_RENDER_CACHE.set(hash, value);
}

async function tryReadDiskCache(
  cacheDir: string,
  hash: string,
  mode: StudioRenderMode,
  modelUsed: string
): Promise<CachedStudioRender | null> {
  const candidates: Array<{ ext: string; mime: string }> = [
    { ext: 'jpg', mime: 'image/jpeg' },
    { ext: 'png', mime: 'image/png' },
    { ext: 'webp', mime: 'image/webp' },
  ];

  for (const c of candidates) {
    const fileName = `${hash}.${c.ext}`;
    const fullPath = path.join(cacheDir, fileName);
    try {
      const stat = await fs.promises.stat(fullPath);
      if (stat.isFile() && stat.size > 128) {
        const buf = await fs.promises.readFile(fullPath);
        const base64 = buf.toString('base64');
        const entry: CachedStudioRender = {
          dataUrl: `data:${c.mime};base64,${base64}`,
          cachedUrl: `/assets/studio-cache/${fileName}`,
          mode,
          modelUsed,
        };
        setMemoryCache(hash, entry);
        return entry;
      }
    } catch {
      // File does not exist for this extension
    }
  }
  return null;
}

async function writeDiskCacheSafely(
  cacheDir: string,
  hash: string,
  base64Data: string,
  mimeType: string
): Promise<string | undefined> {
  try {
    await fs.promises.mkdir(cacheDir, { recursive: true });
    const ext = extensionForMime(mimeType);
    const fileName = `${hash}.${ext}`;
    const fullPath = path.join(cacheDir, fileName);
    const bytes = Buffer.from(base64Data, 'base64');
    if (bytes.byteLength < 64) return undefined;
    await fs.promises.writeFile(fullPath, bytes);
    return `/assets/studio-cache/${fileName}`;
  } catch {
    return undefined;
  }
}

async function resolveReferenceImage(
  rawImageUrl: string | undefined,
  projectRoot: string
): Promise<DownloadedReferenceImage | null> {
  if (!rawImageUrl || typeof rawImageUrl !== 'string') {
    return null;
  }
  const trimmed = rawImageUrl.trim();
  if (!trimmed) {
    return null;
  }

  // 1. Inline data:image/...;base64,... URL
  const dataMatch = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (dataMatch) {
    const mime = dataMatch[1].toLowerCase();
    if (mime.includes('svg')) return null;
    const base64 = dataMatch[2].replace(/\s+/g, '');
    return base64.length > 32 ? { base64, mimeType: mime === 'image/jpg' ? 'image/jpeg' : mime } : null;
  }

  // Parse relative or absolute URL to inspect /api/proxy-image or local /assets/
  let parsedLocalOrRemote: URL | null = null;
  try {
    parsedLocalOrRemote = new URL(
      trimmed.startsWith('//') ? `https:${trimmed}` : trimmed,
      'http://localhost'
    );
  } catch {
    return null;
  }

  const isRelativeInput = trimmed.startsWith('/') || (!/^https?:\/\//i.test(trimmed) && !trimmed.startsWith('//'));
  const isLocalOrigin =
    isRelativeInput ||
    parsedLocalOrRemote.hostname === 'localhost' ||
    parsedLocalOrRemote.hostname === '127.0.0.1';

  // 2. Unwrap `/api/proxy-image?url=...` directly on the server without loopback HTTP hop
  let effectiveExternalTarget: string | null = null;
  if (isLocalOrigin && parsedLocalOrRemote.pathname === '/api/proxy-image') {
    const unwrapped = parsedLocalOrRemote.searchParams.get('url');
    if (!unwrapped) return null;
    effectiveExternalTarget = unwrapped;
  } else if (isLocalOrigin) {
    // 3. Local static file inside `public/` (e.g. `/assets/raw-shirt.jpg` or `/assets/garments/...`)
    const publicDir = path.resolve(projectRoot, 'public');
    const relAssetPath = decodeURIComponent(parsedLocalOrRemote.pathname).replace(/^\/+/, '');
    const candidatePath = path.resolve(publicDir, relAssetPath);

    if (
      candidatePath.startsWith(publicDir + path.sep) ||
      candidatePath === publicDir
    ) {
      try {
        const buf = await fs.promises.readFile(candidatePath);
        const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        const mime = sniffImageMimeType(bytes, inferMimeFromExtension(candidatePath));
        if (mime && buf.byteLength > 64) {
          return {
            base64: buf.toString('base64'),
            mimeType: mime,
          };
        }
      } catch {
        return null;
      }
    }
    return null;
  } else {
    effectiveExternalTarget = trimmed;
  }

  // 4. Remote HTTPS/HTTP product image download
  if (!effectiveExternalTarget) return null;

  try {
    const externalUrl = normalizeExternalImageUrl(effectiveExternalTarget);
    const upstream = await fetch(externalUrl.toString(), {
      headers: {
        'User-Agent': STUDIO_FETCH_USER_AGENT,
        Accept: 'image/png,image/jpeg,image/webp;q=0.95,image/*;q=0.7,*/*;q=0.4',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: `${externalUrl.origin}/`,
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(9500),
    });

    if (!upstream.ok) return null;
    const contentType = upstream.headers.get('content-type') ?? '';
    if (contentType.toLowerCase().includes('text/html')) return null;

    const arrayBuf = await upstream.arrayBuffer();
    if (arrayBuf.byteLength < 64 || arrayBuf.byteLength > 10 * 1024 * 1024) {
      return null;
    }

    const bytes = new Uint8Array(arrayBuf);
    const mime = sniffImageMimeType(bytes, contentType);
    if (!mime) return null;

    return {
      base64: Buffer.from(arrayBuf).toString('base64'),
      mimeType: mime,
    };
  } catch {
    return null;
  }
}

function extractImageFromInteraction(
  interaction: unknown
): { base64: string; mimeType: string } | null {
  if (!interaction || typeof interaction !== 'object') return null;
  const record = interaction as {
    output_image?: { data?: string; mime_type?: string };
    steps?: Array<{
      type?: string;
      content?: Array<{ type?: string; data?: string; mime_type?: string }>;
    }>;
  };

  if (
    record.output_image &&
    typeof record.output_image.data === 'string' &&
    record.output_image.data.length > 32
  ) {
    return {
      base64: record.output_image.data,
      mimeType: record.output_image.mime_type || 'image/jpeg',
    };
  }

  if (Array.isArray(record.steps)) {
    for (let sIdx = record.steps.length - 1; sIdx >= 0; sIdx--) {
      const step = record.steps[sIdx];
      if (step?.type !== 'model_output' || !Array.isArray(step.content)) continue;
      for (const part of step.content) {
        if (part?.type === 'image' && typeof part.data === 'string' && part.data.length > 32) {
          return {
            base64: part.data,
            mimeType: part.mime_type || 'image/jpeg',
          };
        }
      }
    }
  }

  return null;
}

function readJsonBody(req: MinimalReq, maxBytes = 12 * 1024 * 1024): Promise<Record<string, unknown>> {
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

function resolveApiKey(viteEnv: Record<string, string>, projectRoot: string): string {
  const direct = (
    viteEnv.GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    viteEnv.GOOGLE_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    ''
  ).trim();
  if (direct && !/^your_|^insert_|^placeholder/i.test(direct)) {
    return direct;
  }

  try {
    const diskEnv = loadEnv('development', projectRoot, '');
    const fromDisk = (diskEnv.GEMINI_API_KEY || diskEnv.GOOGLE_API_KEY || '').trim();
    if (fromDisk && !/^your_|^insert_|^placeholder/i.test(fromDisk)) {
      return fromDisk;
    }
  } catch {
    // Ignore env read errors
  }

  return '';
}

async function executeStudioRender(
  reqBody: StudioRenderRequest,
  apiKey: string,
  modelUsed: string,
  projectRoot: string
): Promise<StudioRenderResponse> {
  const cacheDir = path.resolve(projectRoot, 'public', 'assets', 'studio-cache');
  const cacheHash = computeCacheHash(reqBody, modelUsed);

  if (!reqBody.forceRefresh) {
    const memHit = MEMORY_RENDER_CACHE.get(cacheHash);
    if (memHit) {
      return {
        dataUrl: memHit.dataUrl,
        cachedUrl: memHit.cachedUrl,
        mode: memHit.mode,
        modelUsed: memHit.modelUsed,
        fromCache: true,
      };
    }

    const diskHit = await tryReadDiskCache(cacheDir, cacheHash, reqBody.mode, modelUsed);
    if (diskHit) {
      return {
        dataUrl: diskHit.dataUrl,
        cachedUrl: diskHit.cachedUrl,
        mode: diskHit.mode,
        modelUsed: diskHit.modelUsed,
        fromCache: true,
      };
    }

    const inflight = IN_FLIGHT_RENDERS.get(cacheHash);
    if (inflight) {
      return inflight;
    }
  }

  const job = (async (): Promise<StudioRenderResponse> => {
    const ai = new GoogleGenAI({ apiKey });
    const refImage = await resolveReferenceImage(reqBody.imageUrl, projectRoot);

    let extracted: { base64: string; mimeType: string } | null = null;

    if (refImage) {
      const studioPrompt = buildStudioPrompt(reqBody, true);
      try {
        // v1 Interactions API: wrap multimodal [image, text] inside user_input, never pass response_modalities
        const r = await ai.interactions.create({
          model: modelUsed,
          input: [
            {
              type: 'user_input',
              content: [
                {
                  type: 'image',
                  data: refImage.base64,
                  mime_type: refImage.mimeType,
                },
                {
                  type: 'text',
                  text: studioPrompt,
                },
              ],
            },
          ],
        });
        extracted = extractImageFromInteraction(r);
      } catch (multimodalErr) {
        // Fallback to text-to-image studio synthesis if upstream reference image had corrupted bytes
        const fallbackPrompt = buildStudioPrompt(reqBody, false);
        try {
          const fallbackRes = await ai.interactions.create({
            model: modelUsed,
            input: fallbackPrompt,
          });
          extracted = extractImageFromInteraction(fallbackRes);
        } catch {
          throw multimodalErr;
        }
      }
    } else {
      const studioPrompt = buildStudioPrompt(reqBody, false);
      const r = await ai.interactions.create({
        model: modelUsed,
        input: studioPrompt,
      });
      extracted = extractImageFromInteraction(r);
    }

    if (!extracted) {
      throw new Error(`${modelUsed} completed without returning an output image`);
    }

    const dataUrl = `data:${extracted.mimeType};base64,${extracted.base64}`;
    const cachedUrl = await writeDiskCacheSafely(
      cacheDir,
      cacheHash,
      extracted.base64,
      extracted.mimeType
    );

    const cacheRecord: CachedStudioRender = {
      dataUrl,
      cachedUrl,
      mode: reqBody.mode,
      modelUsed,
    };
    setMemoryCache(cacheHash, cacheRecord);

    return {
      dataUrl,
      cachedUrl,
      mode: reqBody.mode,
      modelUsed,
      fromCache: false,
    };
  })();

  if (!reqBody.forceRefresh) {
    IN_FLIGHT_RENDERS.set(cacheHash, job);
  }

  try {
    return await job;
  } finally {
    IN_FLIGHT_RENDERS.delete(cacheHash);
  }
}

export function studioRenderVitePlugin(): Plugin {
  let viteEnv: Record<string, string> = {};
  let projectRoot = process.cwd();

  const handleMiddleware = (req: MinimalReq, res: MinimalRes, next: () => void) => {
    const rawUrl = req.url ?? '';
    if (!rawUrl.startsWith('/api/studio-render')) {
      next();
      return;
    }

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.end();
      return;
    }

    const parsedUrl = new URL(rawUrl, 'http://localhost');
    if (parsedUrl.pathname !== '/api/studio-render') {
      next();
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { error: `Method ${req.method ?? 'UNKNOWN'} not allowed` });
      return;
    }

    void (async () => {
      let rawBody: Record<string, unknown>;
      try {
        rawBody = await readJsonBody(req);
      } catch (err) {
        sendJson(res, 400, {
          error: err instanceof Error ? err.message : 'Invalid JSON body',
        });
        return;
      }

      const title = typeof rawBody.title === 'string' ? rawBody.title.trim() : '';
      const brandName =
        typeof rawBody.brandName === 'string' && rawBody.brandName.trim()
          ? rawBody.brandName.trim()
          : 'Boutique';
      const modeRaw = rawBody.mode;
      const mode: StudioRenderMode =
        modeRaw === 'clean_cutout' ? 'clean_cutout' : 'commercial_showcase';

      if (!title) {
        sendJson(res, 400, { error: 'Missing required field: title' });
        return;
      }

      const apiKey = resolveApiKey(viteEnv, projectRoot);
      if (!apiKey) {
        sendJson(res, 503, {
          error: 'GEMINI_API_KEY is not configured in .env for gemini-nano-banana-2.1 studio rendering.',
        });
        return;
      }

      const modelUsed =
        (viteEnv.GEMINI_STUDIO_IMAGE_MODEL || process.env.GEMINI_STUDIO_IMAGE_MODEL || '').trim() ||
        DEFAULT_STUDIO_MODEL;

      const paletteInput =
        rawBody.palette && typeof rawBody.palette === 'object'
          ? (rawBody.palette as Partial<StorePalette>)
          : undefined;

      const renderReq: StudioRenderRequest = {
        imageUrl: typeof rawBody.imageUrl === 'string' ? rawBody.imageUrl : undefined,
        title,
        subtitle: typeof rawBody.subtitle === 'string' ? rawBody.subtitle : undefined,
        category: typeof rawBody.category === 'string' ? rawBody.category : undefined,
        brandName,
        vibe: typeof rawBody.vibe === 'string' ? rawBody.vibe : undefined,
        palette: paletteInput,
        mode,
        forceRefresh: Boolean(rawBody.forceRefresh),
      };

      try {
        const responsePayload = await executeStudioRender(
          renderReq,
          apiKey,
          modelUsed,
          projectRoot
        );
        sendJson(res, 200, responsePayload);
      } catch (err) {
        sendJson(res, 502, {
          error:
            err instanceof Error
              ? `Studio render failed: ${err.message}`
              : 'Studio render failed',
        });
      }
    })();
  };

  return {
    name: 'gemini-boutique-studio-render',
    configResolved(config) {
      projectRoot = config.root || process.cwd();
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

export default studioRenderVitePlugin;
