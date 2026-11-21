import * as THREE from 'three';

export interface ProcessedGarmentTextures {
  frontTexture: THREE.CanvasTexture;
  backTexture: THREE.CanvasTexture;
  normalTexture: THREE.CanvasTexture;
  aspect: number;
  dominantHex: string;
  accentHex: string;
  previewDataUrl: string;
  backPreviewDataUrl: string;
  width: number;
  height: number;
  collarTopPct: number;
  dispose: () => void;
}

// Precomputed sRGB [0..255] -> Linear [0..1] LUT for ultra-fast CIELAB conversion in V8
const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255.0;
  SRGB_TO_LINEAR[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

// Cache loaded HTMLImageElements by URL so live tolerance slider drags never re-fetch over HTTP
const IMAGE_CACHE = new Map<string, HTMLImageElement>();

function loadImageElement(source: HTMLImageElement | Blob | string): Promise<HTMLImageElement> {
  if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
    if (source.complete && source.naturalWidth > 0) {
      return Promise.resolve(source);
    }
    return new Promise((resolve, reject) => {
      source.addEventListener('load', () => resolve(source), { once: true });
      source.addEventListener('error', () => reject(new Error('Failed to decode HTMLImageElement')), {
        once: true,
      });
    });
  }

  if (typeof Blob !== 'undefined' && source instanceof Blob) {
    const objectUrl = URL.createObjectURL(source);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Failed to decode uploaded garment Blob/File'));
      };
      img.src = objectUrl;
    });
  }

  const url = String(source);
  const cached = IMAGE_CACHE.get(url);
  if (cached && cached.complete && cached.naturalWidth > 0) {
    return Promise.resolve(cached);
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!url.startsWith('blob:') && url.length < 4096) {
        IMAGE_CACHE.set(url, img);
      }
      resolve(img);
    };
    img.onerror = () => reject(new Error(`Failed to load garment image: ${url}`));
    img.src = url;
  });
}

function rgbSingleToLab(r: number, g: number, b: number): [number, number, number] {
  const rl = SRGB_TO_LINEAR[Math.max(0, Math.min(255, Math.round(r)))];
  const gl = SRGB_TO_LINEAR[Math.max(0, Math.min(255, Math.round(g)))];
  const bl = SRGB_TO_LINEAR[Math.max(0, Math.min(255, Math.round(b)))];

  const x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047;
  const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175;
  const z = (rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041) / 1.08883;

  const eps = 216.0 / 24389.0;
  const kap = 24389.0 / 27.0;

  const fx = x > eps ? Math.cbrt(x) : (kap * x + 16.0) / 116.0;
  const fy = y > eps ? Math.cbrt(y) : (kap * y + 16.0) / 116.0;
  const fz = z > eps ? Math.cbrt(z) : (kap * z + 16.0) / 116.0;

  return [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)];
}

function rgbaBufferToLab(
  rgba: Uint8ClampedArray,
  nPixels: number
): { L: Float32Array; a: Float32Array; b: Float32Array } {
  const L = new Float32Array(nPixels);
  const a = new Float32Array(nPixels);
  const b = new Float32Array(nPixels);

  const eps = 216.0 / 24389.0;
  const kap = 24389.0 / 27.0;

  for (let i = 0; i < nPixels; i++) {
    const o = i * 4;
    const rl = SRGB_TO_LINEAR[rgba[o]];
    const gl = SRGB_TO_LINEAR[rgba[o + 1]];
    const bl = SRGB_TO_LINEAR[rgba[o + 2]];

    const x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047;
    const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175;
    const z = (rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041) / 1.08883;

    const fx = x > eps ? Math.cbrt(x) : (kap * x + 16.0) / 116.0;
    const fy = y > eps ? Math.cbrt(y) : (kap * y + 16.0) / 116.0;
    const fz = z > eps ? Math.cbrt(z) : (kap * z + 16.0) / 116.0;

    L[i] = 116.0 * fy - 16.0;
    a[i] = 500.0 * (fx - fy);
    b[i] = 200.0 * (fy - fz);
  }
  return { L, a, b };
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`.toUpperCase();
}

function medianOfSorted(arr: Float32Array, count: number): number {
  if (count <= 0) return 0;
  const sub = arr.subarray(0, count);
  sub.sort();
  const mid = count >> 1;
  return count % 2 === 1 ? sub[mid] : 0.5 * (sub[mid - 1] + sub[mid]);
}

/**
 * High-speed float32 2D Gaussian blur:
 * - Uses exact separable 1D Gaussian convolution for small sub-pixel sigmas (<= 3.0)
 * - Uses O(1)-per-pixel 3-pass running-sum box blur for wide radii (> 3.0)
 */
function blurFloat2D(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma <= 0.05) {
    return new Float32Array(src);
  }

  if (sigma <= 3.0) {
    const r = Math.max(1, Math.ceil(sigma * 2.75));
    const kLen = 2 * r + 1;
    const kernel = new Float32Array(kLen);
    let kSum = 0;
    for (let i = -r; i <= r; i++) {
      const kv = Math.exp(-0.5 * (i / sigma) * (i / sigma));
      kernel[i + r] = kv;
      kSum += kv;
    }
    for (let i = 0; i < kLen; i++) kernel[i] /= kSum;

    const tmp = new Float32Array(w * h);
    const dst = new Float32Array(w * h);

    for (let y = 0; y < h; y++) {
      const rowOff = y * w;
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let k = -r; k <= r; k++) {
          const sx = x + k < 0 ? 0 : x + k >= w ? w - 1 : x + k;
          acc += src[rowOff + sx] * kernel[k + r];
        }
        tmp[rowOff + x] = acc;
      }
    }

    for (let y = 0; y < h; y++) {
      const rowOff = y * w;
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let k = -r; k <= r; k++) {
          const sy = y + k < 0 ? 0 : y + k >= h ? h - 1 : y + k;
          acc += tmp[sy * w + x] * kernel[k + r];
        }
        dst[rowOff + x] = acc;
      }
    }
    return dst;
  }

  // O(1) 3-pass separable sliding-window box blur for large radii
  const boxR = Math.max(1, Math.round(sigma * 0.85));
  const invSpan = 1.0 / (2 * boxR + 1);
  let cur = new Float32Array(src);
  const tmp = new Float32Array(w * h);

  for (let pass = 0; pass < 3; pass++) {
    // Horizontal sliding sum
    for (let y = 0; y < h; y++) {
      const rowOff = y * w;
      let sum = cur[rowOff] * (boxR + 1);
      for (let x = 1; x <= boxR; x++) {
        sum += cur[rowOff + (x < w ? x : w - 1)];
      }
      for (let x = 0; x < w; x++) {
        tmp[rowOff + x] = sum * invSpan;
        const leftIdx = x - boxR < 0 ? 0 : x - boxR;
        const rightIdx = x + boxR + 1 >= w ? w - 1 : x + boxR + 1;
        sum += cur[rowOff + rightIdx] - cur[rowOff + leftIdx];
      }
    }
    // Vertical sliding sum
    for (let x = 0; x < w; x++) {
      let sum = tmp[x] * (boxR + 1);
      for (let y = 1; y <= boxR; y++) {
        sum += tmp[(y < h ? y : h - 1) * w + x];
      }
      for (let y = 0; y < h; y++) {
        cur[y * w + x] = sum * invSpan;
        const topIdx = y - boxR < 0 ? 0 : y - boxR;
        const botIdx = y + boxR + 1 >= h ? h - 1 : y + boxR + 1;
        sum += tmp[botIdx * w + x] - tmp[topIdx * w + x];
      }
    }
  }
  return cur;
}

function erodeMask(mask: Uint8Array, w: number, h: number, iterations: number): Uint8Array {
  let cur = new Uint8Array(mask);
  let nxt = new Uint8Array(w * h);
  for (let it = 0; it < iterations; it++) {
    nxt.fill(0);
    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      for (let x = 1; x < w - 1; x++) {
        const idx = row + x;
        if (
          cur[idx] &&
          cur[idx - 1] &&
          cur[idx + 1] &&
          cur[idx - w] &&
          cur[idx + w]
        ) {
          nxt[idx] = 1;
        }
      }
    }
    const swap = cur;
    cur = nxt;
    nxt = swap;
  }
  return cur;
}

function dilateMask(mask: Uint8Array, w: number, h: number, iterations: number): Uint8Array {
  let cur = new Uint8Array(mask);
  let nxt = new Uint8Array(w * h);
  for (let it = 0; it < iterations; it++) {
    nxt.set(cur);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const idx = row + x;
        if (cur[idx]) continue;
        if (
          (x > 0 && cur[idx - 1]) ||
          (x + 1 < w && cur[idx + 1]) ||
          (y > 0 && cur[idx - w]) ||
          (y + 1 < h && cur[idx + w])
        ) {
          nxt[idx] = 1;
        }
      }
    }
    const swap = cur;
    cur = nxt;
    nxt = swap;
  }
  return cur;
}

function floodFillBorders(passable: Uint8Array, w: number, h: number): Uint8Array {
  const visited = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;

  for (let x = 0; x < w; x++) {
    if (passable[x] && !visited[x]) {
      visited[x] = 1;
      queue[tail++] = x;
    }
    const bot = (h - 1) * w + x;
    if (passable[bot] && !visited[bot]) {
      visited[bot] = 1;
      queue[tail++] = bot;
    }
  }
  for (let y = 1; y < h - 1; y++) {
    const left = y * w;
    if (passable[left] && !visited[left]) {
      visited[left] = 1;
      queue[tail++] = left;
    }
    const right = left + w - 1;
    if (passable[right] && !visited[right]) {
      visited[right] = 1;
      queue[tail++] = right;
    }
  }

  while (head < tail) {
    const idx = queue[head++];
    const x = idx % w;
    const y = (idx - x) / w;

    if (y > 0) {
      const n = idx - w;
      if (passable[n] && !visited[n]) {
        visited[n] = 1;
        queue[tail++] = n;
      }
    }
    if (y + 1 < h) {
      const n = idx + w;
      if (passable[n] && !visited[n]) {
        visited[n] = 1;
        queue[tail++] = n;
      }
    }
    if (x > 0) {
      const n = idx - 1;
      if (passable[n] && !visited[n]) {
        visited[n] = 1;
        queue[tail++] = n;
      }
    }
    if (x + 1 < w) {
      const n = idx + 1;
      if (passable[n] && !visited[n]) {
        visited[n] = 1;
        queue[tail++] = n;
      }
    }
  }
  return visited;
}

function fillInteriorPinholes(fgMask: Uint8Array, w: number, h: number): Uint8Array {
  const n = w * h;
  const inv = new Uint8Array(n);
  for (let i = 0; i < n; i++) inv[i] = fgMask[i] ? 0 : 1;

  const exteriorBg = floodFillBorders(inv, w, h);
  const out = new Uint8Array(fgMask);
  const maxHoleArea = Math.floor(n * 0.08);
  const visited = new Uint8Array(n);
  const queue = new Int32Array(n);

  for (let i = 0; i < n; i++) {
    if (fgMask[i] || exteriorBg[i] || visited[i]) continue;
    let head = 0;
    let tail = 0;
    visited[i] = 1;
    queue[tail++] = i;

    while (head < tail) {
      const cur = queue[head++];
      const x = cur % w;
      const y = (cur - x) / w;
      if (y > 0) {
        const nb = cur - w;
        if (!fgMask[nb] && !exteriorBg[nb] && !visited[nb]) {
          visited[nb] = 1;
          queue[tail++] = nb;
        }
      }
      if (y + 1 < h) {
        const nb = cur + w;
        if (!fgMask[nb] && !exteriorBg[nb] && !visited[nb]) {
          visited[nb] = 1;
          queue[tail++] = nb;
        }
      }
      if (x > 0) {
        const nb = cur - 1;
        if (!fgMask[nb] && !exteriorBg[nb] && !visited[nb]) {
          visited[nb] = 1;
          queue[tail++] = nb;
        }
      }
      if (x + 1 < w) {
        const nb = cur + 1;
        if (!fgMask[nb] && !exteriorBg[nb] && !visited[nb]) {
          visited[nb] = 1;
          queue[tail++] = nb;
        }
      }
    }

    if (tail <= maxHoleArea) {
      for (let k = 0; k < tail; k++) {
        out[queue[k]] = 1;
      }
    }
  }
  return out;
}

function largestConnectedComponent(mask: Uint8Array, w: number, h: number): Uint8Array {
  const n = w * h;
  const visited = new Uint8Array(n);
  const queue = new Int32Array(n);
  let bestComp: Int32Array | null = null;

  for (let i = 0; i < n; i++) {
    if (!mask[i] || visited[i]) continue;
    let head = 0;
    let tail = 0;
    visited[i] = 1;
    queue[tail++] = i;

    while (head < tail) {
      const cur = queue[head++];
      const x = cur % w;
      const y = (cur - x) / w;
      if (y > 0) {
        const nb = cur - w;
        if (mask[nb] && !visited[nb]) {
          visited[nb] = 1;
          queue[tail++] = nb;
        }
      }
      if (y + 1 < h) {
        const nb = cur + w;
        if (mask[nb] && !visited[nb]) {
          visited[nb] = 1;
          queue[tail++] = nb;
        }
      }
      if (x > 0) {
        const nb = cur - 1;
        if (mask[nb] && !visited[nb]) {
          visited[nb] = 1;
          queue[tail++] = nb;
        }
      }
      if (x + 1 < w) {
        const nb = cur + 1;
        if (mask[nb] && !visited[nb]) {
          visited[nb] = 1;
          queue[tail++] = nb;
        }
      }
    }

    if (!bestComp || tail > bestComp.length) {
      bestComp = queue.slice(0, tail);
    }
  }

  const out = new Uint8Array(n);
  if (bestComp) {
    for (let k = 0; k < bestComp.length; k++) {
      out[bestComp[k]] = 1;
    }
  }
  return out;
}

function propagateInteriorRgb(
  rCh: Float32Array,
  gCh: Float32Array,
  bCh: Float32Array,
  knownMask: Uint8Array,
  w: number,
  h: number,
  iterations: number
): { refR: Float32Array; refG: Float32Array; refB: Float32Array } {
  const n = w * h;
  const refR = new Float32Array(rCh);
  const refG = new Float32Array(gCh);
  const refB = new Float32Array(bCh);
  const known = new Uint8Array(knownMask);
  const nextKnown = new Uint8Array(knownMask);

  for (let it = 0; it < iterations; it++) {
    let anyFilled = false;
    nextKnown.set(known);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      const y0 = y > 0 ? y - 1 : 0;
      const y1 = y + 1 < h ? y + 1 : h - 1;
      for (let x = 0; x < w; x++) {
        const idx = row + x;
        if (known[idx]) continue;
        let sr = 0,
          sg = 0,
          sb = 0,
          cnt = 0;
        const x0 = x > 0 ? x - 1 : 0;
        const x1 = x + 1 < w ? x + 1 : w - 1;
        for (let ny = y0; ny <= y1; ny++) {
          const nrow = ny * w;
          for (let nx = x0; nx <= x1; nx++) {
            const nIdx = nrow + nx;
            if (known[nIdx]) {
              sr += refR[nIdx];
              sg += refG[nIdx];
              sb += refB[nIdx];
              cnt++;
            }
          }
        }
        if (cnt > 0) {
          const inv = 1.0 / cnt;
          refR[idx] = sr * inv;
          refG[idx] = sg * inv;
          refB[idx] = sb * inv;
          nextKnown[idx] = 1;
          anyFilled = true;
        }
      }
    }
    known.set(nextKnown);
    if (!anyFilled) break;
  }

  return { refR, refG, refB };
}

function sobelXY(
  field: Float32Array,
  w: number,
  h: number
): { gx: Float32Array; gy: Float32Array } {
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    const ym = y > 0 ? y - 1 : 0;
    const yp = y + 1 < h ? y + 1 : h - 1;
    const rM = ym * w;
    const rC = y * w;
    const rP = yp * w;

    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x + 1 < w ? x + 1 : w - 1;

      const tl = field[rM + xm];
      const tc = field[rM + x];
      const tr = field[rM + xp];
      const ml = field[rC + xm];
      const mr = field[rC + xp];
      const bl = field[rP + xm];
      const bc = field[rP + x];
      const br = field[rP + xp];

      const idx = rC + x;
      gx[idx] = (tr + 2.0 * mr + br - (tl + 2.0 * ml + bl)) * 0.125;
      gy[idx] = (bl + 2.0 * bc + br - (tl + 2.0 * tc + tr)) * 0.125;
    }
  }
  return { gx, gy };
}

function createConfiguredCanvasTexture(
  canvas: HTMLCanvasElement,
  isColorData: boolean
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = isColorData ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Synchronous real-time browser garment processor for instant live tolerance updates.
 */
export function processGarmentImageSync(
  img: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
  tolerance = 22
): ProcessedGarmentTextures {
  const srcW = 'naturalWidth' in img && img.naturalWidth > 0 ? img.naturalWidth : img.width;
  const srcH = 'naturalHeight' in img && img.naturalHeight > 0 ? img.naturalHeight : img.height;

  // Cap working resolution to 720px max side for crisp detail at <40ms execution time
  const maxDim = 720;
  const scale = Math.min(1.0, maxDim / Math.max(srcW, srcH, 1));
  const w = Math.max(64, Math.round(srcW * scale));
  const h = Math.max(64, Math.round(srcH * scale));
  const n = w * h;

  const workCanvas = document.createElement('canvas');
  workCanvas.width = w;
  workCanvas.height = h;
  const workCtx = workCanvas.getContext('2d', { willReadFrequently: true });
  if (!workCtx) {
    throw new Error('2D canvas context unavailable for garment processing');
  }
  workCtx.clearRect(0, 0, w, h);
  workCtx.drawImage(img, 0, 0, w, h);
  const srcData = workCtx.getImageData(0, 0, w, h).data;

  const rIn = new Float32Array(n);
  const gIn = new Float32Array(n);
  const bIn = new Float32Array(n);
  const aIn = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    rIn[i] = srcData[o];
    gIn[i] = srcData[o + 1];
    bIn[i] = srcData[o + 2];
    aIn[i] = srcData[o + 3] / 255.0;
  }

  // Sample 4 corners (up to 12x12 patches) to estimate background RGB & alpha
  const patch = Math.max(4, Math.min(12, Math.floor(w / 16), Math.floor(h / 16)));
  const maxCornerSamples = patch * patch * 4;
  const cR = new Float32Array(maxCornerSamples);
  const cG = new Float32Array(maxCornerSamples);
  const cB = new Float32Array(maxCornerSamples);
  const cA = new Float32Array(maxCornerSamples);
  let cCnt = 0;

  const cornerOrigins: [number, number][] = [
    [0, 0],
    [w - patch, 0],
    [0, h - patch],
    [w - patch, h - patch],
  ];
  for (const [ox, oy] of cornerOrigins) {
    for (let dy = 0; dy < patch; dy++) {
      for (let dx = 0; dx < patch; dx++) {
        const idx = (oy + dy) * w + (ox + dx);
        cR[cCnt] = rIn[idx];
        cG[cCnt] = gIn[idx];
        cB[cCnt] = bIn[idx];
        cA[cCnt] = aIn[idx];
        cCnt++;
      }
    }
  }

  const bgR = medianOfSorted(new Float32Array(cR), cCnt);
  const bgG = medianOfSorted(new Float32Array(cG), cCnt);
  const bgB = medianOfSorted(new Float32Array(cB), cCnt);
  const bgAlphaMed = medianOfSorted(new Float32Array(cA), cCnt);

  let outR = new Float32Array(rIn);
  let outG = new Float32Array(gIn);
  let outB = new Float32Array(bIn);
  let outAlpha = new Float32Array(aIn);

  if (bgAlphaMed >= 0.15) {
    // Perceptual CIELAB cutout with neutral-studio chroma boost & edge-gradient barrier
    const { L, a, b } = rgbaBufferToLab(srcData, n);
    const [bgL, bga, bgb] = rgbSingleToLab(bgR, bgG, bgB);
    const bgChroma = Math.hypot(bga, bgb);

    const lightW = bgChroma < 8.0 ? 1.55 : 2.1;
    const chromaW = bgChroma < 8.0 ? 10.8 : 4.2;
    const { gx: gxL, gy: gyL } = sobelXY(L, w, h);

    const passable = new Uint8Array(n);
    const tolVal = Math.max(2.0, tolerance);

    for (let i = 0; i < n; i++) {
      const dL = (L[i] - bgL) * lightW;
      const da = a[i] - bga;
      const db = b[i] - bgb;
      const gradL = Math.hypot(gxL[i], gyL[i]);
      const barrier = Math.max(0.0, Math.min(12.0, gradL - 1.5)) * 1.35;
      const dEff = Math.sqrt(dL * dL + (da * da + db * db) * chromaW * chromaW) + barrier;
      if (dEff < tolVal) {
        passable[i] = 1;
      }
    }

    const bgFlood = floodFillBorders(passable, w, h);
    const fgRaw = new Uint8Array(n);
    for (let i = 0; i < n; i++) fgRaw[i] = bgFlood[i] ? 0 : 1;

    const fgFilled = fillInteriorPinholes(fgRaw, w, h);
    let core = largestConnectedComponent(erodeMask(fgFilled, w, h, 2), w, h);
    let hasCore = false;
    for (let i = 0; i < n; i++) {
      if (core[i]) {
        hasCore = true;
        break;
      }
    }
    if (!hasCore) {
      core = largestConnectedComponent(fgFilled, w, h);
    }

    const dilatedCore = dilateMask(core, w, h, 2);
    for (let i = 0; i < n; i++) dilatedCore[i] = dilatedCore[i] && fgFilled[i] ? 1 : 0;
    let fgOpen = fillInteriorPinholes(dilatedCore, w, h);

    // Punch out enclosed studio-background armpit/sleeve-gap triangles on dark long-sleeve garments
    if (bgL > 78.0) {
      let fgLsum = 0;
      let fgLcnt = 0;
      for (let i = 0; i < n; i += 4) {
        if (core[i]) {
          fgLsum += L[i];
          fgLcnt++;
        }
      }
      const meanGarmentL = fgLcnt > 0 ? fgLsum / fgLcnt : bgL;
      if (bgL - meanGarmentL > 40.0) {
        const visitedGap = new Uint8Array(n);
        const gapQueue = new Int32Array(n);
        for (let i = 0; i < n; i++) {
          if (!fgOpen[i] || !passable[i] || bgFlood[i] || visitedGap[i]) continue;
          let head = 0;
          let tail = 0;
          let sumX = 0;
          let sumY = 0;
          visitedGap[i] = 1;
          gapQueue[tail++] = i;

          while (head < tail) {
            const cur = gapQueue[head++];
            const gx = cur % w;
            const gy = (cur - gx) / w;
            sumX += gx;
            sumY += gy;
            if (gy > 0) {
              const nb = cur - w;
              if (fgOpen[nb] && passable[nb] && !bgFlood[nb] && !visitedGap[nb]) {
                visitedGap[nb] = 1;
                gapQueue[tail++] = nb;
              }
            }
            if (gy + 1 < h) {
              const nb = cur + w;
              if (fgOpen[nb] && passable[nb] && !bgFlood[nb] && !visitedGap[nb]) {
                visitedGap[nb] = 1;
                gapQueue[tail++] = nb;
              }
            }
            if (gx > 0) {
              const nb = cur - 1;
              if (fgOpen[nb] && passable[nb] && !bgFlood[nb] && !visitedGap[nb]) {
                visitedGap[nb] = 1;
                gapQueue[tail++] = nb;
              }
            }
            if (gx + 1 < w) {
              const nb = cur + 1;
              if (fgOpen[nb] && passable[nb] && !bgFlood[nb] && !visitedGap[nb]) {
                visitedGap[nb] = 1;
                gapQueue[tail++] = nb;
              }
            }
          }

          const cx = sumX / tail;
          const cy = sumY / tail;
          const isLateralArmpitSlit =
            tail >= 16 &&
            tail <= Math.floor(n * 0.04) &&
            cy > h * 0.28 &&
            (cx < w * 0.36 || cx > w * 0.64);
          if (isLateralArmpitSlit) {
            for (let k = 0; k < tail; k++) {
              fgOpen[gapQueue[k]] = 0;
            }
          }
        }
      }
    }

    // Slice off bright JPEG 4:2:0 chroma-ringing halos AND pale neutral studio drop-shadows under dark hems/cuffs
    const deepTrimSeed = erodeMask(fgOpen, w, h, 16);
    let hasDeepTrim = false;
    for (let i = 0; i < n; i++) {
      if (deepTrimSeed[i]) {
        hasDeepTrim = true;
        break;
      }
    }
    if (hasDeepTrim) {
      const { refR: tR, refG: tG, refB: tB } = propagateInteriorRgb(
        rIn,
        gIn,
        bIn,
        deepTrimSeed,
        w,
        h,
        22
      );
      let removedHalo = false;
      for (let i = 0; i < n; i++) {
        if (fgOpen[i] && !deepTrimSeed[i]) {
          const [refL] = rgbSingleToLab(tR[i], tG[i], tB[i]);
          const pixBgChroma = Math.hypot(a[i] - bga, b[i] - bgb);
          const shadowCutoffL =
            bgL > 75.0 && bgL - refL > 35.0 && pixBgChroma < 8.5
              ? refL + (bgL - refL) * 0.40
              : bgL - 9.0;
          if (bgL - refL > 15.0 && L[i] > shadowCutoffL) {
            fgOpen[i] = 0;
            removedHalo = true;
          }
        }
      }
      if (removedHalo) {
        fgOpen = largestConnectedComponent(fgOpen, w, h);
      }
    }

    // Level-set contour smoothing eliminates 8x8 JPEG macroblock stair-steps
    const fgFloat = new Float32Array(n);
    for (let i = 0; i < n; i++) fgFloat[i] = fgOpen[i];
    const sdf = blurFloat2D(fgFloat, w, h, 2.1);
    const sdfThresh = new Uint8Array(n);
    for (let i = 0; i < n; i++) sdfThresh[i] = sdf[i] > 0.56 ? 1 : 0;
    const fgClean = largestConnectedComponent(sdfThresh, w, h);

    let deepInterior = erodeMask(fgClean, w, h, 5);
    let hasDeep = false;
    for (let i = 0; i < n; i++) {
      if (deepInterior[i]) {
        hasDeep = true;
        break;
      }
    }
    if (!hasDeep) deepInterior = erodeMask(fgClean, w, h, 2);

    const { refR, refG, refB } = propagateInteriorRgb(rIn, gIn, bIn, deepInterior, w, h, 9);

    // 1.5px smooth anti-aliased alpha feather + optical coverage modulation
    const cleanFloat = new Float32Array(n);
    for (let i = 0; i < n; i++) cleanFloat[i] = fgClean[i];
    let alpha = blurFloat2D(cleanFloat, w, h, 1.4);

    const dil2 = dilateMask(fgClean, w, h, 2);
    const ero3 = erodeMask(fgClean, w, h, 3);
    for (let i = 0; i < n; i++) {
      if (dil2[i] && !ero3[i]) {
        const vr = refR[i] - bgR;
        const vg = refG[i] - bgG;
        const vb = refB[i] - bgB;
        const denom = vr * vr + vg * vg + vb * vb + 1e-4;
        const optA = Math.max(
          0.0,
          Math.min(1.0, ((rIn[i] - bgR) * vr + (gIn[i] - bgG) * vg + (bIn[i] - bgB) * vb) / denom)
        );
        const cw = Math.max(0.0, Math.min(1.0, (Math.sqrt(denom) - 20.0) / 35.0));
        alpha[i] = Math.min(alpha[i], optA * cw + alpha[i] * (1.0 - cw));
      }
    }
    alpha = blurFloat2D(alpha, w, h, 0.55);

    // Edge color decontamination (despill background gray/white completely)
    for (let i = 0; i < n; i++) {
      let aVal = ero3[i] ? 1.0 : alpha[i];
      if (aVal < 0.025) aVal = 0.0;
      outAlpha[i] = aVal;

      if (aVal === 0.0) {
        outR[i] = 0;
        outG[i] = 0;
        outB[i] = 0;
      } else if (aVal < 0.995) {
        const aSafe = Math.max(aVal, 0.42);
        const invBg = 1.0 - aVal;
        const ur = Math.max(0.0, Math.min(255.0, (rIn[i] - invBg * bgR) / aSafe));
        const ug = Math.max(0.0, Math.min(255.0, (gIn[i] - invBg * bgG) / aSafe));
        const ub = Math.max(0.0, Math.min(255.0, (bIn[i] - invBg * bgB) / aSafe));
        const wRef = Math.max(0.22, Math.min(0.94, 1.2 - aVal));
        outR[i] = ur * (1.0 - wRef) + refR[i] * wRef;
        outG[i] = ug * (1.0 - wRef) + refG[i] * wRef;
        outB[i] = ub * (1.0 - wRef) + refB[i] * wRef;
      }
    }
  }

  // Find opaque bounding box and normalize canvas so top collar sits at 3.0% from top!
  let xMin = w,
    xMax = -1,
    yMin = h,
    yMax = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (outAlpha[row + x] >= 0.5) {
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }
  }

  // Graceful fallback if extreme slider tolerance wiped foreground
  if (xMax < xMin || yMax < yMin) {
    xMin = Math.floor(w * 0.15);
    xMax = Math.ceil(w * 0.85);
    yMin = Math.floor(h * 0.15);
    yMax = Math.ceil(h * 0.85);
    for (let y = yMin; y <= yMax; y++) {
      for (let x = xMin; x <= xMax; x++) {
        outAlpha[y * w + x] = 1.0;
        outR[y * w + x] = rIn[y * w + x];
        outG[y * w + x] = gIn[y * w + x];
        outB[y * w + x] = bIn[y * w + x];
      }
    }
  }

  const fgW = xMax - xMin + 1;
  const fgH = yMax - yMin + 1;

  const collarBandY1 = Math.min(h, yMin + Math.max(6, Math.floor(0.08 * fgH)));
  let colMinX = w,
    colMaxX = -1;
  for (let y = yMin; y < collarBandY1; y++) {
    const row = y * w;
    for (let x = xMin; x <= xMax; x++) {
      if (outAlpha[row + x] >= 0.5) {
        if (x < colMinX) colMinX = x;
        if (x > colMaxX) colMaxX = x;
      }
    }
  }

  const collarCx = colMaxX >= colMinX ? 0.5 * (colMinX + colMaxX) : 0.5 * (xMin + xMax);
  const bboxCx = 0.5 * (xMin + xMax);
  const centerX = 0.75 * collarCx + 0.25 * bboxCx;

  const collarTopPctTarget = 0.03;
  const bottomPct = 0.035;
  let outH = Math.max(64, Math.round(fgH / (1.0 - collarTopPctTarget - bottomPct)));
  const padTop = Math.max(2, Math.round(collarTopPctTarget * outH));
  const exactOutH = Math.round(padTop / collarTopPctTarget);
  if (exactOutH >= fgH + padTop + 6) {
    outH = exactOutH;
  }

  const padX = Math.max(8, Math.round(0.035 * fgW));
  const halfW = Math.ceil(Math.max(centerX - xMin, xMax - centerX)) + padX;
  const outW = Math.max(64, 2 * halfW);
  const outN = outW * outH;

  const normR = new Float32Array(outN);
  const normG = new Float32Array(outN);
  const normB = new Float32Array(outN);
  const normA = new Float32Array(outN);

  const shiftY = padTop - yMin;
  const shiftX = Math.round(outW * 0.5 - centerX);

  const sY0 = Math.max(0, -shiftY);
  const sY1 = Math.min(h, outH - shiftY);
  const sX0 = Math.max(0, -shiftX);
  const sX1 = Math.min(w, outW - shiftX);

  for (let sy = sY0; sy < sY1; sy++) {
    const dy = sy + shiftY;
    const sRow = sy * w;
    const dRow = dy * outW;
    for (let sx = sX0; sx < sX1; sx++) {
      const dx = sx + shiftX;
      const sIdx = sRow + sx;
      const dIdx = dRow + dx;
      normR[dIdx] = outR[sIdx];
      normG[dIdx] = outG[sIdx];
      normB[dIdx] = outB[sIdx];
      normA[dIdx] = outAlpha[sIdx];
    }
  }

  // Write normalized front cutout to HTMLCanvasElement
  const frontCanvas = document.createElement('canvas');
  frontCanvas.width = outW;
  frontCanvas.height = outH;
  const frontCtx = frontCanvas.getContext('2d')!;
  const frontImgData = frontCtx.createImageData(outW, outH);
  const fBytes = frontImgData.data;

  let actualTopY = outH;
  for (let i = 0; i < outN; i++) {
    const o = i * 4;
    const aByte = Math.max(0, Math.min(255, Math.round(normA[i] * 255.0)));
    if (aByte === 0) {
      fBytes[o] = 0;
      fBytes[o + 1] = 0;
      fBytes[o + 2] = 0;
      fBytes[o + 3] = 0;
    } else {
      fBytes[o] = Math.max(0, Math.min(255, Math.round(normR[i])));
      fBytes[o + 1] = Math.max(0, Math.min(255, Math.round(normG[i])));
      fBytes[o + 2] = Math.max(0, Math.min(255, Math.round(normB[i])));
      fBytes[o + 3] = aByte;
      if (normA[i] >= 0.5) {
        const y = Math.floor(i / outW);
        if (y < actualTopY) actualTopY = y;
      }
    }
  }
  frontCtx.putImageData(frontImgData, 0, 0);

  // -------------------------------------------------------------------------
  // Stage 2: Synthesize Clean Un-Mirrored Crew-Neck Back Cutout + Palette
  // -------------------------------------------------------------------------
  const {
    backCanvas,
    cleanR,
    cleanG,
    cleanB,
    dominantHex,
    accentHex,
  } = synthesizeBackAndCleanBody(normR, normG, normB, normA, fBytes, outW, outH);

  // -------------------------------------------------------------------------
  // Stage 3: Generate Tangent-Space Sobel + Micro-Weave PBR Normal Map
  // -------------------------------------------------------------------------
  const normalCanvas = buildFabricNormalCanvas(
    normR,
    normG,
    normB,
    cleanR,
    cleanG,
    cleanB,
    normA,
    outW,
    outH
  );

  const frontTexture = createConfiguredCanvasTexture(frontCanvas, true);
  const backTexture = createConfiguredCanvasTexture(backCanvas, true);
  const normalTexture = createConfiguredCanvasTexture(normalCanvas, false);

  const previewDataUrl = frontCanvas.toDataURL('image/png');
  const backPreviewDataUrl = backCanvas.toDataURL('image/png');
  const collarTopPct = Number(((actualTopY / outH) * 100.0).toFixed(2));
  const aspect = Number((outW / outH).toFixed(4));

  return {
    frontTexture,
    backTexture,
    normalTexture,
    aspect,
    dominantHex,
    accentHex,
    previewDataUrl,
    backPreviewDataUrl,
    width: outW,
    height: outH,
    collarTopPct,
    dispose: () => {
      frontTexture.dispose();
      backTexture.dispose();
      normalTexture.dispose();
    },
  };
}

function synthesizeBackAndCleanBody(
  frontR: Float32Array,
  frontG: Float32Array,
  frontB: Float32Array,
  frontA: Float32Array,
  frontBytes: Uint8ClampedArray,
  w: number,
  h: number
): {
  backCanvas: HTMLCanvasElement;
  cleanR: Float32Array;
  cleanG: Float32Array;
  cleanB: Float32Array;
  dominantHex: string;
  accentHex: string;
} {
  const n = w * h;
  const opaque = new Uint8Array(n);
  let xMin = w,
    xMax = 0,
    yMin = h,
    yMax = 0;

  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (frontA[row + x] >= 0.5) {
        opaque[row + x] = 1;
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }
  }

  const fw = Math.max(1, xMax - xMin + 1);
  const fh = Math.max(1, yMax - yMin + 1);
  const interior = erodeMask(opaque, w, h, 5);

  // Sample unprinted side flanks + lower hem to find dominant base fabric color
  const sR = new Float32Array(n);
  const sG = new Float32Array(n);
  const sB = new Float32Array(n);
  let sCnt = 0;

  const accR = new Float32Array(n);
  const accG = new Float32Array(n);
  const accB = new Float32Array(n);
  let accCnt = 0;

  const yFlank0 = yMin + Math.floor(0.2 * fh);
  const yFlank1 = yMin + Math.floor(0.92 * fh);
  const yLow0 = yMin + Math.floor(0.75 * fh);
  const xL0 = xMin + Math.floor(0.2 * fw);
  const xL1 = xMin + Math.floor(0.32 * fw);
  const xR0 = xMin + Math.floor(0.68 * fw);
  const xR1 = xMin + Math.floor(0.8 * fw);
  const xMid0 = xMin + Math.floor(0.25 * fw);
  const xMid1 = xMin + Math.floor(0.75 * fw);

  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const idx = row + x;
      if (!interior[idx]) continue;

      const r = frontR[idx];
      const g = frontG[idx];
      const b = frontB[idx];

      if (
        y >= yFlank0 &&
        y <= yFlank1 &&
        ((x >= xL0 && x <= xL1) || (x >= xR0 && x <= xR1) || (y >= yLow0 && x >= xMid0 && x <= xMid1))
      ) {
        sR[sCnt] = r;
        sG[sCnt] = g;
        sB[sCnt] = b;
        sCnt++;
      }

      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const sat = maxC > 35 ? (maxC - minC) / maxC : 0;
      if (sat > 0.14 && maxC > 45 && minC < 215) {
        accR[accCnt] = r;
        accG[accCnt] = g;
        accB[accCnt] = b;
        accCnt++;
      }
    }
  }

  if (sCnt < 40) {
    sCnt = 0;
    for (let i = 0; i < n; i++) {
      if (interior[i]) {
        sR[sCnt] = frontR[i];
        sG[sCnt] = frontG[i];
        sB[sCnt] = frontB[i];
        sCnt++;
      }
    }
  }

  const baseR = sCnt > 0 ? medianOfSorted(sR, sCnt) : 243;
  const baseG = sCnt > 0 ? medianOfSorted(sG, sCnt) : 239;
  const baseB = sCnt > 0 ? medianOfSorted(sB, sCnt) : 230;
  const dominantHex = rgbToHex(baseR, baseG, baseB);

  const accentHex =
    accCnt > 20
      ? rgbToHex(
          medianOfSorted(accR, accCnt),
          medianOfSorted(accG, accCnt),
          medianOfSorted(accB, accCnt)
        )
      : rgbToHex(baseR * 0.65, baseG * 0.65, baseB * 0.65);

  const { L, a, b } = rgbaBufferToLab(frontBytes, n);
  const [baseL, baseA, baseB_lab] = rgbSingleToLab(baseR, baseG, baseB);
  const dEBase = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const dL = L[i] - baseL;
    const da = a[i] - baseA;
    const db = b[i] - baseB_lab;
    dEBase[i] = Math.sqrt(dL * dL + 2.2 * (da * da + db * db));
  }

  // Locate top collar shoulder corners & per-column top edge
  let colXLeft = w,
    colXRight = -1;
  const topPeakY1 = Math.min(h, yMin + Math.max(4, Math.floor(0.02 * fh)));
  for (let y = yMin; y < topPeakY1; y++) {
    const row = y * w;
    for (let x = xMin; x <= xMax; x++) {
      if (opaque[row + x]) {
        if (x < colXLeft) colXLeft = x;
        if (x > colXRight) colXRight = x;
      }
    }
  }
  if (colXRight <= colXLeft) {
    colXLeft = Math.round(0.5 * (xMin + xMax) - 0.1 * fw);
    colXRight = Math.round(0.5 * (xMin + xMax) + 0.1 * fw);
  }

  const yTopCol = new Int32Array(w).fill(yMax);
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      if (opaque[y * w + x]) {
        yTopCol[x] = y;
        break;
      }
    }
  }

  const collarBandH = Math.max(11, Math.round(0.034 * fh));
  const collarPadX = Math.max(6, Math.floor(0.022 * fw));
  const topCollarBand = new Uint8Array(n);

  for (let x = Math.max(0, colXLeft - collarPadX); x <= Math.min(w - 1, colXRight + collarPadX); x++) {
    const yt = yTopCol[x];
    if (yt < yMin + Math.floor(0.1 * fh)) {
      let t = 1.0;
      if (x < colXLeft) t = Math.max(0.0, 1.0 - (colXLeft - x) / collarPadX);
      else if (x > colXRight) t = Math.max(0.0, 1.0 - (x - colXRight) / collarPadX);
      const bhX = Math.round(collarBandH * t);
      for (let y = yt; y < Math.min(h, yt + bhX); y++) {
        topCollarBand[y * w + x] = 1;
      }
    }
  }

  const innerGuard = erodeMask(opaque, w, h, Math.max(8, Math.floor(0.05 * Math.min(fw, fh))));
  const inkOutliers = new Uint8Array(n);
  const xInk0 = xMin + Math.floor(0.24 * fw);
  const xInk1 = xMin + Math.floor(0.76 * fw);
  const yInk0 = yMin + Math.floor(0.02 * fh);
  const yInk1 = yMin + Math.floor(0.78 * fh);

  for (let y = yInk0; y <= Math.min(h - 1, yInk1); y++) {
    const row = y * w;
    for (let x = xInk0; x <= Math.min(w - 1, xInk1); x++) {
      const idx = row + x;
      if (dEBase[idx] > 7.0 && !topCollarBand[idx]) {
        inkOutliers[idx] = 1;
      }
    }
  }
  const dilInk = dilateMask(inkOutliers, w, h, 5);

  const replaceMask = new Uint8Array(n);
  const midX = 0.5 * (xMin + xMax);
  const invRx = 1.0 / (0.25 * fw + 1e-5);
  const chestCy = yMin + 0.44 * fh;
  const invRy = 1.0 / (0.27 * fh + 1e-5);

  for (let y = 0; y < h; y++) {
    const row = y * w;
    const dyChest = (y - chestCy) * invRy;
    for (let x = 0; x < w; x++) {
      const idx = row + x;
      if (!opaque[idx] || topCollarBand[idx]) continue;

      const inNeckCols =
        x >= colXLeft - collarPadX - 6 &&
        x <= colXRight + collarPadX + 6 &&
        y <= yMin + Math.floor(0.24 * fh);

      if (!innerGuard[idx] && !inNeckCols) continue;

      const dxChest = (x - midX) * invRx;
      const inChest = dxChest * dxChest + dyChest * dyChest <= 1.0;
      const inScoop =
        inNeckCols && y >= yTopCol[x] + collarBandH - 2 && y <= yMin + Math.floor(0.23 * fh);

      if (inChest || inScoop || dilInk[idx]) {
        replaceMask[idx] = 1;
      }
    }
  }

  // Extract vertical drape fold profile from unprinted lower torso strip
  const lowY0 = yMin + Math.floor(0.7 * fh);
  const lowY1 = Math.min(h, yMin + Math.floor(0.9 * fh));
  const colDeltaR = new Float32Array(w);
  const colDeltaG = new Float32Array(w);
  const colDeltaB = new Float32Array(w);
  const tmpCol = new Float32Array(Math.max(1, lowY1 - lowY0));

  for (let x = 0; x < w; x++) {
    let cnt = 0;
    for (let y = lowY0; y < lowY1; y++) {
      const idx = y * w + x;
      if (opaque[idx] && dEBase[idx] < 9.0) {
        tmpCol[cnt++] = y;
      }
    }
    if (cnt >= 4) {
      const rVals = new Float32Array(cnt);
      const gVals = new Float32Array(cnt);
      const bVals = new Float32Array(cnt);
      for (let k = 0; k < cnt; k++) {
        const idx = tmpCol[k] * w + x;
        rVals[k] = frontR[idx];
        gVals[k] = frontG[idx];
        bVals[k] = frontB[idx];
      }
      colDeltaR[x] = medianOfSorted(rVals, cnt) - baseR;
      colDeltaG[x] = medianOfSorted(gVals, cnt) - baseG;
      colDeltaB[x] = medianOfSorted(bVals, cnt) - baseB;
    }
  }

  const foldR = blurFloat2D(colDeltaR, w, 1, 2.8);
  const foldRdc = blurFloat2D(colDeltaR, w, 1, 24.0);
  const foldG = blurFloat2D(colDeltaG, w, 1, 2.8);
  const foldGdc = blurFloat2D(colDeltaG, w, 1, 24.0);
  const foldB = blurFloat2D(colDeltaB, w, 1, 2.8);
  const foldBdc = blurFloat2D(colDeltaB, w, 1, 24.0);
  for (let x = 0; x < w; x++) {
    colDeltaR[x] = foldR[x] - foldRdc[x];
    colDeltaG[x] = foldG[x] - foldGdc[x];
    colDeltaB[x] = foldB[x] - foldBdc[x];
  }

  // Normalized float32 multi-scale convolution fill across replaceMask
  const wKnown = new Float32Array(n);
  const srcKR = new Float32Array(n);
  const srcKG = new Float32Array(n);
  const srcKB = new Float32Array(n);
  let validCount = 0;
  for (let i = 0; i < n; i++) {
    if (opaque[i] && !replaceMask[i] && dEBase[i] < 10.0) {
      wKnown[i] = 1.0;
      srcKR[i] = frontR[i];
      srcKG[i] = frontG[i];
      srcKB[i] = frontB[i];
      validCount++;
    }
  }
  if (validCount < 80) {
    for (let i = 0; i < n; i++) {
      if (opaque[i] && !replaceMask[i]) {
        wKnown[i] = 1.0;
        srcKR[i] = frontR[i];
        srcKG[i] = frontG[i];
        srcKB[i] = frontB[i];
      }
    }
  }

  const denCoarse = blurFloat2D(wKnown, w, h, 38.0);
  const numCR = blurFloat2D(srcKR, w, h, 38.0);
  const numCG = blurFloat2D(srcKG, w, h, 38.0);
  const numCB = blurFloat2D(srcKB, w, h, 38.0);

  const seedR = new Float32Array(n);
  const seedG = new Float32Array(n);
  const seedB = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (wKnown[i] > 0.5) {
      seedR[i] = frontR[i];
      seedG[i] = frontG[i];
      seedB[i] = frontB[i];
    } else if (denCoarse[i] > 1e-4) {
      const inv = 1.0 / denCoarse[i];
      seedR[i] = numCR[i] * inv;
      seedG[i] = numCG[i] * inv;
      seedB[i] = numCB[i] * inv;
    } else {
      seedR[i] = baseR;
      seedG[i] = baseG;
      seedB[i] = baseB;
    }
  }

  let illumR = blurFloat2D(seedR, w, h, 12.0);
  let illumG = blurFloat2D(seedG, w, h, 12.0);
  let illumB = blurFloat2D(seedB, w, h, 12.0);
  for (let i = 0; i < n; i++) {
    if (wKnown[i] > 0.5) {
      illumR[i] = frontR[i];
      illumG[i] = frontG[i];
      illumB[i] = frontB[i];
    }
  }
  illumR = blurFloat2D(illumR, w, h, 4.5);
  illumG = blurFloat2D(illumG, w, h, 4.5);
  illumB = blurFloat2D(illumB, w, h, 4.5);

  const repFloat = new Float32Array(n);
  for (let i = 0; i < n; i++) repFloat[i] = replaceMask[i];
  let blendW = blurFloat2D(repFloat, w, h, 6.0);
  for (let i = 0; i < n; i++) {
    blendW[i] = topCollarBand[i] ? 0.0 : Math.min(1.0, blendW[i] * 1.35);
  }
  blendW = blurFloat2D(blendW, w, h, 2.0);
  for (let i = 0; i < n; i++) {
    if (topCollarBand[i]) blendW[i] = 0.0;
  }

  const synthR = new Float32Array(n);
  const synthG = new Float32Array(n);
  const synthB = new Float32Array(n);
  const cleanR = new Float32Array(n);
  const cleanG = new Float32Array(n);
  const cleanB = new Float32Array(n);

  for (let y = 0; y < h; y++) {
    const row = y * w;
    const yRel = Math.max(0.2, Math.min(1.0, (y - (yMin + 0.14 * fh)) / (0.35 * fh)));
    for (let x = 0; x < w; x++) {
      const idx = row + x;
      // Deterministic cotton micro-grain hash
      const hash = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      const grain = ((hash - Math.floor(hash)) - 0.5) * 1.4;
      const fScale = 0.72 * yRel;

      const sr = Math.max(0.0, Math.min(255.0, illumR[idx] + colDeltaR[x] * fScale + grain));
      const sg = Math.max(0.0, Math.min(255.0, illumG[idx] + colDeltaG[x] * fScale + grain));
      const sb = Math.max(0.0, Math.min(255.0, illumB[idx] + colDeltaB[x] * fScale + grain));
      synthR[idx] = sr;
      synthG[idx] = sg;
      synthB[idx] = sb;

      const bw = blendW[idx];
      const inv = 1.0 - bw;
      cleanR[idx] = frontR[idx] * inv + sr * bw;
      cleanG[idx] = frontG[idx] * inv + sg * bw;
      cleanB[idx] = frontB[idx] * inv + sb * bw;
    }
  }

  const backR = new Float32Array(cleanR);
  const backG = new Float32Array(cleanG);
  const backB = new Float32Array(cleanB);
  const backA = new Float32Array(frontA);

  // Reconstruct raised crew-neck back collar rib arch
  const collarMidX = Math.round(0.5 * (colXLeft + colXRight));
  const sX0 = Math.max(colXLeft, collarMidX - Math.max(8, Math.floor(0.05 * fw)));
  const sX1 = Math.min(colXRight, collarMidX + Math.max(8, Math.floor(0.05 * fw)));
  const cSampleR = new Float32Array((sX1 - sX0 + 1) * collarBandH);
  const cSampleG = new Float32Array((sX1 - sX0 + 1) * collarBandH);
  const cSampleB = new Float32Array((sX1 - sX0 + 1) * collarBandH);
  let csCnt = 0;

  for (let sx = sX0; sx <= sX1; sx++) {
    const yt = yTopCol[sx];
    if (yt < yMin + Math.floor(0.1 * fh)) {
      const yEnd = Math.min(h, yt + collarBandH - 2);
      for (let sy = yt + 2; sy < yEnd; sy++) {
        const idx = sy * w + sx;
        cSampleR[csCnt] = frontR[idx];
        cSampleG[csCnt] = frontG[idx];
        cSampleB[csCnt] = frontB[idx];
        csCnt++;
      }
    }
  }

  const colTrimR = csCnt > 0 ? medianOfSorted(cSampleR, csCnt) : baseR;
  const colTrimG = csCnt > 0 ? medianOfSorted(cSampleG, csCnt) : baseG;
  const colTrimB = csCnt > 0 ? medianOfSorted(cSampleB, csCnt) : baseB;

  const centerDip = yTopCol[Math.max(0, Math.min(w - 1, collarMidX))] - yMin;
  const collarSpan = Math.max(1, colXRight - colXLeft);

  if (centerDip >= 2 && centerDip <= Math.floor(0.09 * fh) && collarSpan >= 20) {
    const targetDip = Math.max(2.0, centerDip * 0.45);
    const yLeftPeak = yTopCol[colXLeft];
    const yRightPeak = yTopCol[colXRight];

    for (let x = colXLeft - 4; x <= colXRight + 4; x++) {
      if (x < 0 || x >= w) continue;
      const u = Math.max(0.0, Math.min(1.0, (x - colXLeft) / collarSpan));
      const baselineY = (1.0 - u) * yLeftPeak + u * yRightPeak;
      const ytNew = baselineY + targetDip * Math.sin(Math.PI * u);

      const edgeDist = Math.min(x - colXLeft, colXRight - x);
      const taper = Math.max(0.0, Math.min(1.0, (edgeDist + 4.0) / 8.0));
      if (taper <= 0.0) continue;

      const bandThick = collarBandH * (0.78 + 0.22 * Math.sin(Math.PI * u));
      const ybNew = ytNew + bandThick;

      const yStart = Math.max(0, Math.floor(ytNew) - 2);
      const yEnd = Math.min(h, Math.ceil(ybNew) + 12);
      for (let y = yStart; y < yEnd; y++) {
        const topCov = Math.max(0.0, Math.min(1.0, (y - ytNew + 0.8) / 1.6));
        if (topCov <= 0.0) continue;
        const idx = y * w + x;
        backA[idx] = Math.max(backA[idx], topCov * taper + backA[idx] * (1.0 - taper));

        if (y <= ybNew + 2.0) {
          const botBlend = Math.max(0.0, Math.min(1.0, (ybNew - y + 1.0) / 2.0));
          const ribW = botBlend * taper;
          const vCol = (y - ytNew) / Math.max(1.0, bandThick);
          const rollShade =
            1.04 - 0.22 * (vCol - 0.38) * (vCol - 0.38) + 0.018 * Math.sin((2.0 * Math.PI * x) / 2.5);
          const seamDip = -4.5 * Math.exp(-Math.pow((vCol - 0.96) / 0.1, 2));

          const rr = Math.max(0.0, Math.min(255.0, colTrimR * rollShade + seamDip));
          const rg = Math.max(0.0, Math.min(255.0, colTrimG * rollShade + seamDip));
          const rb = Math.max(0.0, Math.min(255.0, colTrimB * rollShade + seamDip));

          backR[idx] = rr * ribW + synthR[idx] * (1.0 - ribW);
          backG[idx] = rg * ribW + synthG[idx] * (1.0 - ribW);
          backB[idx] = rb * ribW + synthB[idx] * (1.0 - ribW);
        } else {
          backR[idx] = synthR[idx] * taper + backR[idx] * (1.0 - taper);
          backG[idx] = synthG[idx] * taper + backG[idx] * (1.0 - taper);
          backB[idx] = synthB[idx] * taper + backB[idx] * (1.0 - taper);
        }
      }
    }
  }

  const backCanvas = document.createElement('canvas');
  backCanvas.width = w;
  backCanvas.height = h;
  const backCtx = backCanvas.getContext('2d')!;
  const backImg = backCtx.createImageData(w, h);
  const bBytes = backImg.data;

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const aByte = Math.max(0, Math.min(255, Math.round(backA[i] * 255.0)));
    if (aByte === 0) {
      bBytes[o] = 0;
      bBytes[o + 1] = 0;
      bBytes[o + 2] = 0;
      bBytes[o + 3] = 0;
    } else {
      bBytes[o] = Math.max(0, Math.min(255, Math.round(backR[i])));
      bBytes[o + 1] = Math.max(0, Math.min(255, Math.round(backG[i])));
      bBytes[o + 2] = Math.max(0, Math.min(255, Math.round(backB[i])));
      bBytes[o + 3] = aByte;
    }
  }
  backCtx.putImageData(backImg, 0, 0);

  return { backCanvas, cleanR, cleanG, cleanB, dominantHex, accentHex };
}

function buildFabricNormalCanvas(
  frontR: Float32Array,
  frontG: Float32Array,
  frontB: Float32Array,
  cleanR: Float32Array,
  cleanG: Float32Array,
  cleanB: Float32Array,
  alpha: Float32Array,
  w: number,
  h: number
): HTMLCanvasElement {
  const n = w * h;
  const opaque = new Uint8Array(n);
  const lumClean = new Float32Array(n);
  const lumFront = new Float32Array(n);
  const medSamples = new Float32Array(n);
  let mCnt = 0;

  for (let i = 0; i < n; i++) {
    lumFront[i] = (0.2126 * frontR[i] + 0.7152 * frontG[i] + 0.0722 * frontB[i]) / 255.0;
    lumClean[i] = (0.2126 * cleanR[i] + 0.7152 * cleanG[i] + 0.0722 * cleanB[i]) / 255.0;
    if (alpha[i] >= 0.5) {
      opaque[i] = 1;
      medSamples[mCnt++] = lumClean[i];
    }
  }

  const medLum = mCnt > 0 ? medianOfSorted(medSamples, mCnt) : 0.9;
  const baseLum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    baseLum[i] = alpha[i] > 0.1 ? 0.9 * lumClean[i] + 0.1 * lumFront[i] : medLum;
  }

  const interior = erodeMask(opaque, w, h, 4);
  const { refR: paddedLum } = propagateInteriorRgb(baseLum, baseLum, baseLum, interior, w, h, 8);

  const b1 = blurFloat2D(paddedLum, w, h, 1.5);
  const b5 = blurFloat2D(paddedLum, w, h, 4.8);
  const b14 = blurFloat2D(paddedLum, w, h, 14.0);
  const b30 = blurFloat2D(paddedLum, w, h, 30.0);

  const totalHeight = new Float32Array(n);
  const foldStrength = 3.0;
  const weaveStrength = 0.2;

  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const idx = row + x;
      const hFine = b1[idx] - b5[idx];
      const hMeso = b5[idx] - b14[idx];
      const hMacro = b14[idx] - b30[idx];
      const folds = 0.5 * hFine + 1.4 * hMeso + 1.8 * hMacro;

      const wale = Math.sin((2.0 * Math.PI * x) / 3.0);
      const course = Math.sin((2.0 * Math.PI * y) / 2.6 + 0.85 * wale);
      const slub = Math.sin((2.0 * Math.PI * y) / 11.0 + 0.3 * Math.cos((2.0 * Math.PI * x) / 17.0));
      const weave = (0.55 * wale + 0.35 * course + 0.1 * slub) * 0.004;

      totalHeight[idx] = folds * foldStrength + weave * weaveStrength;
    }
  }

  const { gx, gy } = sobelXY(totalHeight, w, h);

  const maskEro = erodeMask(opaque, w, h, 2);
  const eroFloat = new Float32Array(n);
  for (let i = 0; i < n; i++) eroFloat[i] = maskEro[i];
  const maskTaper = blurFloat2D(eroFloat, w, h, 2.0);

  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = w;
  normalCanvas.height = h;
  const nCtx = normalCanvas.getContext('2d')!;
  const nImg = nCtx.createImageData(w, h);
  const nBytes = nImg.data;

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const taper = maskTaper[i] * Math.max(0.0, Math.min(1.0, alpha[i]));
    if (taper < 0.01) {
      nBytes[o] = 128;
      nBytes[o + 1] = 128;
      nBytes[o + 2] = 255;
      nBytes[o + 3] = 255;
      continue;
    }
    const nx = -gx[i] * 20.0 * taper;
    const ny = gy[i] * 20.0 * taper;
    const nz = 1.0;
    const invLen = 1.0 / Math.sqrt(nx * nx + ny * ny + nz * nz);

    nBytes[o] = Math.max(0, Math.min(255, Math.round((nx * invLen * 0.5 + 0.5) * 255.0)));
    nBytes[o + 1] = Math.max(0, Math.min(255, Math.round((ny * invLen * 0.5 + 0.5) * 255.0)));
    nBytes[o + 2] = Math.max(128, Math.min(255, Math.round((nz * invLen * 0.5 + 0.5) * 255.0)));
    nBytes[o + 3] = 255;
  }

  nCtx.putImageData(nImg, 0, 0);
  return normalCanvas;
}

/**
 * Real-time browser HTML5 `<canvas>` garment vision pipeline:
 *  - Corner-sampled perceptual CIELAB flood-fill cutout + Sobel seam barrier
 *  - Auto-trims & normalizes framing so top collar sits at 3% from top (matching 3D hanger!)
 *  - Performs edge color decontamination (zero gray halo) + 1.5px anti-aliased feathering
 *  - Synthesizes a clean un-mirrored crew-neck back texture (`THREE.CanvasTexture`)
 *  - Generates a Sobel + jersey micro-weave tangent-space normal map (`THREE.CanvasTexture`)
 */
export async function processGarmentInBrowser(
  imageSource: HTMLImageElement | string | Blob,
  tolerance = 22
): Promise<ProcessedGarmentTextures> {
  const img = await loadImageElement(imageSource);
  return processGarmentImageSync(img, tolerance);
}
