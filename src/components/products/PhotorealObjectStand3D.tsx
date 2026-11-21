import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type {
  InventedProductSpec,
  ProductCategory3D,
  StorePalette,
} from '../../types/storeConfig';
import { PedestalProduct3D } from './Product3DFactory';

export interface PhotorealObjectStand3DProps {
  spec: InventedProductSpec;
  /** Optional explicit cutout/photo URL override (defaults to `spec.customCutoutUrl`) */
  imageUrl?: string;
  /** Anchored with base flush at `y = 0` on top of any pedestal or display table */
  position?: [number, number, number];
  rotationY?: number;
  scale?: number;
  metalColor?: string;
  metalness?: number;
  metalRoughness?: number;
  accentColor?: string;
  palette?: Partial<StorePalette>;
  cutoutTolerance?: number;
  selected?: boolean;
  onSelect?: (spec: InventedProductSpec) => void;
}

export interface ProcessedObjectCutout {
  frontTexture: THREE.CanvasTexture;
  backTexture: THREE.CanvasTexture;
  normalTexture: THREE.CanvasTexture;
  previewDataUrl: string;
  aspect: number;
  baseWidthRatio: number;
  width: number;
  height: number;
  dispose: () => void;
}

const RISER_HEIGHT = 0.022; // Exact 2.2cm brushed-metal & honed-stone museum display riser pad
const TOTAL_RELIEF_DEPTH = 0.024; // 2.4cm total volumetric extrusion depth (Front + 6 slices + Back)
const HALF_RELIEF_DEPTH = TOTAL_RELIEF_DEPTH * 0.5; // 0.012m
const SLICE_Z_OFFSETS = [-0.0086, -0.0051, -0.0017, 0.0017, 0.0051, 0.0086] as const;
const MAX_CAMERA_YAW_RAD = (35 * Math.PI) / 180; // ±35° smooth viewer-facing clamp

const NORMAL_SCALE_FRONT = new THREE.Vector2(0.72, 0.72);
const NORMAL_SCALE_SLICE = new THREE.Vector2(0.45, 0.45);
const NORMAL_SCALE_BACK = new THREE.Vector2(0.52, 0.52);

// Reusable scratch transforms so `useFrame` performs zero per-frame allocations
const _worldPos = new THREE.Vector3();
const _worldQuat = new THREE.Quaternion();
const _forwardVec = new THREE.Vector3();

// Precomputed sRGB [0..255] -> Linear [0..1] LUT for fast perceptual CIELAB conversion
const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255.0;
  SRGB_TO_LINEAR[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

// Bounded LRU cache of processed object textures so camera switches & StrictMode remounts are 0ms
const OBJECT_CUTOUT_CACHE = new Map<string, ProcessedObjectCutout>();
const MAX_OBJECT_CACHE_ENTRIES = 36;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function medianOfSorted(arr: Float32Array, count: number): number {
  if (count <= 0) return 0;
  const sub = arr.subarray(0, count);
  sub.sort();
  const mid = count >> 1;
  return count % 2 === 1 ? sub[mid] : 0.5 * (sub[mid - 1] + sub[mid]);
}

function rgbSingleToLab(r: number, g: number, b: number): [number, number, number] {
  const rl = SRGB_TO_LINEAR[clamp(Math.round(r), 0, 255)];
  const gl = SRGB_TO_LINEAR[clamp(Math.round(g), 0, 255)];
  const bl = SRGB_TO_LINEAR[clamp(Math.round(b), 0, 255)];

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

function blurFloat2D(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma <= 0.05) return new Float32Array(src);

  if (sigma <= 3.0) {
    const r = Math.max(1, Math.ceil(sigma * 2.6));
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
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let k = -r; k <= r; k++) {
          const sx = x + k < 0 ? 0 : x + k >= w ? w - 1 : x + k;
          acc += src[row + sx] * kernel[k + r];
        }
        tmp[row + x] = acc;
      }
    }

    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let k = -r; k <= r; k++) {
          const sy = y + k < 0 ? 0 : y + k >= h ? h - 1 : y + k;
          acc += tmp[sy * w + x] * kernel[k + r];
        }
        dst[row + x] = acc;
      }
    }
    return dst;
  }

  const boxR = Math.max(1, Math.round(sigma * 0.85));
  const invSpan = 1.0 / (2 * boxR + 1);
  const cur = new Float32Array(src);
  const tmp = new Float32Array(w * h);

  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = cur[row] * (boxR + 1);
      for (let x = 1; x <= boxR; x++) sum += cur[row + (x < w ? x : w - 1)];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = sum * invSpan;
        const lIdx = x - boxR < 0 ? 0 : x - boxR;
        const rIdx = x + boxR + 1 >= w ? w - 1 : x + boxR + 1;
        sum += cur[row + rIdx] - cur[row + lIdx];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = tmp[x] * (boxR + 1);
      for (let y = 1; y <= boxR; y++) sum += tmp[(y < h ? y : h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        cur[y * w + x] = sum * invSpan;
        const tIdx = y - boxR < 0 ? 0 : y - boxR;
        const bIdx = y + boxR + 1 >= h ? h - 1 : y + boxR + 1;
        sum += tmp[bIdx * w + x] - tmp[tIdx * w + x];
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
        if (cur[idx] && cur[idx - 1] && cur[idx + 1] && cur[idx - w] && cur[idx + w]) {
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

function fillSmallInteriorPinholes(fgMask: Uint8Array, w: number, h: number): Uint8Array {
  const n = w * h;
  const inv = new Uint8Array(n);
  for (let i = 0; i < n; i++) inv[i] = fgMask[i] ? 0 : 1;

  const exteriorBg = floodFillBorders(inv, w, h);
  const out = new Uint8Array(fgMask);
  // Fill small specular pinholes (<1.6% area) while preserving genuine mug/tote handle openings
  const maxHoleArea = Math.floor(n * 0.016);
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
      for (let k = 0; k < tail; k++) out[queue[k]] = 1;
    }
  }
  return out;
}

function retainPrimaryComponents(mask: Uint8Array, w: number, h: number): Uint8Array {
  const n = w * h;
  const visited = new Uint8Array(n);
  const queue = new Int32Array(n);
  const components: Int32Array[] = [];
  let maxLen = 0;

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

    const comp = queue.slice(0, tail);
    components.push(comp);
    if (tail > maxLen) maxLen = tail;
  }

  const out = new Uint8Array(n);
  const minKeep = Math.max(24, Math.floor(maxLen * 0.14));
  for (const comp of components) {
    if (comp.length >= minKeep) {
      for (let k = 0; k < comp.length; k++) {
        out[comp[k]] = 1;
      }
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

function createCanvasTexture(
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

function toCorsSafeImageUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('/')
  ) {
    return trimmed;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return `/api/proxy-image?url=${encodeURIComponent(trimmed)}`;
  }
  if (trimmed.startsWith('//')) {
    return `/api/proxy-image?url=${encodeURIComponent(`https:${trimmed}`)}`;
  }
  return trimmed;
}

function loadCorsImage(rawUrl: string): Promise<HTMLImageElement> {
  const primarySrc = toCorsSafeImageUrl(rawUrl);

  const attempt = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          resolve(img);
        } else {
          reject(new Error('Decoded zero-dimension image'));
        }
      };
      img.onerror = () => reject(new Error(`Failed to load object image: ${src}`));
      img.src = src;
    });

  return attempt(primarySrc).catch((err) => {
    if (primarySrc !== rawUrl) {
      return attempt(rawUrl);
    }
    throw err;
  });
}

/**
 * Corner-sampled perceptual CIELAB background removal + halo unmixing +
 * exact bottom-edge bounding-box trim (`padBottom = 0` so object sits flush at `y = 0.022m`) +
 * silhouette-aware Sobel PBR surface normal map + un-mirrored back texture.
 */
export async function processObjectCutoutForStand(
  rawUrl: string,
  tolerance = 21
): Promise<ProcessedObjectCutout> {
  const cacheKey = `${rawUrl}|${tolerance.toFixed(1)}`;
  const hit = OBJECT_CUTOUT_CACHE.get(cacheKey);
  if (hit) {
    return hit;
  }

  const img = await loadCorsImage(rawUrl);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;

  const maxDim = 640;
  const scale = Math.min(1.0, maxDim / Math.max(srcW, srcH, 1));
  const w = Math.max(64, Math.round(srcW * scale));
  const h = Math.max(64, Math.round(srcH * scale));
  const n = w * h;

  const workCanvas = document.createElement('canvas');
  workCanvas.width = w;
  workCanvas.height = h;
  const workCtx = workCanvas.getContext('2d', { willReadFrequently: true });
  if (!workCtx) {
    throw new Error('2D canvas context unavailable for object cutout');
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

  // Sample 4 corners (up to 10x10 patches) to estimate studio background color & alpha
  const patch = Math.max(4, Math.min(10, Math.floor(w / 16), Math.floor(h / 16)));
  const maxSamples = patch * patch * 4;
  const cR = new Float32Array(maxSamples);
  const cG = new Float32Array(maxSamples);
  const cB = new Float32Array(maxSamples);
  const cA = new Float32Array(maxSamples);
  let cCnt = 0;

  const origins: [number, number][] = [
    [0, 0],
    [w - patch, 0],
    [0, h - patch],
    [w - patch, h - patch],
  ];
  for (const [ox, oy] of origins) {
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

  const outR = new Float32Array(rIn);
  const outG = new Float32Array(gIn);
  const outB = new Float32Array(bIn);
  const outAlpha = new Float32Array(aIn);

  if (bgAlphaMed >= 0.14) {
    const { L, a, b } = rgbaBufferToLab(srcData, n);
    const [bgL, bga, bgb] = rgbSingleToLab(bgR, bgG, bgB);
    const bgChroma = Math.hypot(bga, bgb);

    const lightW = bgChroma < 8.0 ? 1.55 : 2.05;
    const chromaW = bgChroma < 8.0 ? 11.2 : 4.4;
    const { gx: gxL, gy: gyL } = sobelXY(L, w, h);

    const runFloodCutout = (tol: number): Uint8Array => {
      const passable = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const dL = (L[i] - bgL) * lightW;
        const da = a[i] - bga;
        const db = b[i] - bgb;
        const gradL = Math.hypot(gxL[i], gyL[i]);
        const barrier = clamp(gradL - 1.2, 0.0, 14.0) * 1.65;
        const dEff = Math.sqrt(dL * dL + (da * da + db * db) * chromaW * chromaW) + barrier;
        if (dEff < tol) {
          passable[i] = 1;
        }
      }
      const bgFlood = floodFillBorders(passable, w, h);
      const fg = new Uint8Array(n);
      for (let i = 0; i < n; i++) fg[i] = bgFlood[i] ? 0 : 1;
      return fg;
    };

    let fgRaw = runFloodCutout(Math.max(4.0, tolerance));
    let fgCount = 0;
    for (let i = 0; i < n; i++) fgCount += fgRaw[i];

    // If white-on-white ceramic/paper object had ultra-subtle contrast, retry with tighter threshold
    if (fgCount < n * 0.035) {
      fgRaw = runFloodCutout(Math.max(3.0, tolerance * 0.48));
    }

    const fgFilled = fillSmallInteriorPinholes(fgRaw, w, h);
    let core = retainPrimaryComponents(erodeMask(fgFilled, w, h, 1), w, h);
    let hasCore = false;
    for (let i = 0; i < n; i++) {
      if (core[i]) {
        hasCore = true;
        break;
      }
    }
    if (!hasCore) {
      core = retainPrimaryComponents(fgFilled, w, h);
    }

    const dilated = dilateMask(core, w, h, 1);
    for (let i = 0; i < n; i++) dilated[i] = dilated[i] && fgFilled[i] ? 1 : 0;
    let fgOpen = fillSmallInteriorPinholes(dilated, w, h);

    // Strip pale neutral studio contact shadows under dark caps, vessels & monoliths on white seamless backgrounds
    const shadowTrimSeed = erodeMask(fgOpen, w, h, 13);
    let hasShadowSeed = false;
    for (let i = 0; i < n; i++) {
      if (shadowTrimSeed[i]) {
        hasShadowSeed = true;
        break;
      }
    }
    if (hasShadowSeed) {
      const { refR: sR, refG: sG, refB: sB } = propagateInteriorRgb(
        rIn,
        gIn,
        bIn,
        shadowTrimSeed,
        w,
        h,
        18
      );
      let strippedShadow = false;
      for (let i = 0; i < n; i++) {
        if (fgOpen[i] && !shadowTrimSeed[i]) {
          const [refL] = rgbSingleToLab(sR[i], sG[i], sB[i]);
          const pixBgChroma = Math.hypot(a[i] - bga, b[i] - bgb);
          const shadowCutoffL =
            bgL > 75.0 && bgL - refL > 35.0 && pixBgChroma < 8.5
              ? refL + (bgL - refL) * 0.40
              : bgL - 8.5;
          if (bgL - refL > 16.0 && L[i] > shadowCutoffL) {
            fgOpen[i] = 0;
            strippedShadow = true;
          }
        }
      }
      if (strippedShadow) {
        fgOpen = fillSmallInteriorPinholes(retainPrimaryComponents(fgOpen, w, h), w, h);
      }
    }

    // Sub-pixel contour smoothing to eliminate JPEG macroblock stair-steps
    const fgFloat = new Float32Array(n);
    for (let i = 0; i < n; i++) fgFloat[i] = fgOpen[i];
    const sdf = blurFloat2D(fgFloat, w, h, 1.45);
    const fgClean = new Uint8Array(n);
    for (let i = 0; i < n; i++) fgClean[i] = sdf[i] > 0.52 ? 1 : 0;

    let deepInterior = erodeMask(fgClean, w, h, 4);
    let hasDeep = false;
    for (let i = 0; i < n; i++) {
      if (deepInterior[i]) {
        hasDeep = true;
        break;
      }
    }
    if (!hasDeep) deepInterior = erodeMask(fgClean, w, h, 1);

    const { refR, refG, refB } = propagateInteriorRgb(rIn, gIn, bIn, deepInterior, w, h, 8);

    const cleanFloat = new Float32Array(n);
    for (let i = 0; i < n; i++) cleanFloat[i] = fgClean[i];
    let alpha = blurFloat2D(cleanFloat, w, h, 1.15);

    const dil2 = dilateMask(fgClean, w, h, 2);
    const ero2 = erodeMask(fgClean, w, h, 2);
    for (let i = 0; i < n; i++) {
      if (dil2[i] && !ero2[i]) {
        const vr = refR[i] - bgR;
        const vg = refG[i] - bgG;
        const vb = refB[i] - bgB;
        const denom = vr * vr + vg * vg + vb * vb + 1e-4;
        const optA = clamp(
          ((rIn[i] - bgR) * vr + (gIn[i] - bgG) * vg + (bIn[i] - bgB) * vb) / denom,
          0.0,
          1.0
        );
        const cw = clamp((Math.sqrt(denom) - 18.0) / 34.0, 0.0, 1.0);
        alpha[i] = Math.min(alpha[i], optA * cw + alpha[i] * (1.0 - cw));
      }
    }
    alpha = blurFloat2D(alpha, w, h, 0.45);

    // Halo unmixing / background color despill
    for (let i = 0; i < n; i++) {
      let aVal = ero2[i] ? 1.0 : alpha[i];
      if (aVal < 0.03) aVal = 0.0;
      outAlpha[i] = aVal;

      if (aVal === 0.0) {
        outR[i] = 0;
        outG[i] = 0;
        outB[i] = 0;
      } else if (aVal < 0.995) {
        const aSafe = Math.max(aVal, 0.45);
        const invBg = 1.0 - aVal;
        const ur = clamp((rIn[i] - invBg * bgR) / aSafe, 0.0, 255.0);
        const ug = clamp((gIn[i] - invBg * bgG) / aSafe, 0.0, 255.0);
        const ub = clamp((bIn[i] - invBg * bgB) / aSafe, 0.0, 255.0);
        const wRef = clamp(1.18 - aVal, 0.22, 0.92);
        outR[i] = ur * (1.0 - wRef) + refR[i] * wRef;
        outG[i] = ug * (1.0 - wRef) + refG[i] * wRef;
        outB[i] = ub * (1.0 - wRef) + refB[i] * wRef;
      }
    }
  }

  // Tight opaque bounding-box detection (`alpha >= 0.42`)
  let xMin = w,
    xMax = -1,
    yMin = h,
    yMax = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (outAlpha[row + x] >= 0.42) {
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }
  }

  // Fallback if image had uniform contrast across full frame
  if (xMax <= xMin || yMax <= yMin) {
    xMin = Math.floor(w * 0.08);
    xMax = Math.ceil(w * 0.92);
    yMin = Math.floor(h * 0.08);
    yMax = Math.ceil(h * 0.92);
    for (let y = yMin; y <= yMax; y++) {
      for (let x = xMin; x <= xMax; x++) {
        const idx = y * w + x;
        outAlpha[idx] = 1.0;
        outR[idx] = rIn[idx];
        outG[idx] = gIn[idx];
        outB[idx] = bIn[idx];
      }
    }
  }

  // Trim bottom row tightly to solid base (`padBottom = 0`!) so bottom of object touches y = 0.022m riser with ZERO air gap
  const fgW = Math.max(16, xMax - xMin + 1);
  const fgH = Math.max(16, yMax - yMin + 1);

  const padTop = Math.max(6, Math.round(fgH * 0.035));
  const padX = Math.max(8, Math.round(fgW * 0.045));
  const outW = fgW + padX * 2;
  const outH = fgH + padTop; // padBottom = 0: row `outH - 1` corresponds directly to `yMax`!
  const outN = outW * outH;

  const normR = new Float32Array(outN);
  const normG = new Float32Array(outN);
  const normB = new Float32Array(outN);
  const normA = new Float32Array(outN);

  for (let sy = yMin; sy <= yMax; sy++) {
    const dy = padTop + (sy - yMin);
    if (dy < 0 || dy >= outH) continue;
    const sRow = sy * w;
    const dRow = dy * outW;
    for (let sx = xMin; sx <= xMax; sx++) {
      const dx = padX + (sx - xMin);
      if (dx < 0 || dx >= outW) continue;
      const sIdx = sRow + sx;
      const dIdx = dRow + dx;
      normR[dIdx] = outR[sIdx];
      normG[dIdx] = outG[sIdx];
      normB[dIdx] = outB[sIdx];
      normA[dIdx] = outAlpha[sIdx];
    }
  }

  // Measure base contact width in bottom 12% of object for realistic riser contact shadow sizing
  const baseBandStart = Math.max(0, outH - Math.max(6, Math.round(fgH * 0.12)));
  let baseMinX = outW,
    baseMaxX = -1;
  for (let y = baseBandStart; y < outH; y++) {
    const row = y * outW;
    for (let x = 0; x < outW; x++) {
      if (normA[row + x] >= 0.42) {
        if (x < baseMinX) baseMinX = x;
        if (x > baseMaxX) baseMaxX = x;
      }
    }
  }
  const baseWidthRatio =
    baseMaxX >= baseMinX ? clamp((baseMaxX - baseMinX + 1) / outW, 0.28, 0.96) : 0.68;

  // 1. Front Cutout Canvas
  const frontCanvas = document.createElement('canvas');
  frontCanvas.width = outW;
  frontCanvas.height = outH;
  const frontCtx = frontCanvas.getContext('2d')!;
  const frontImg = frontCtx.createImageData(outW, outH);
  const fBytes = frontImg.data;

  for (let i = 0; i < outN; i++) {
    const o = i * 4;
    const aByte = clamp(Math.round(normA[i] * 255.0), 0, 255);
    if (aByte === 0) {
      fBytes[o] = 0;
      fBytes[o + 1] = 0;
      fBytes[o + 2] = 0;
      fBytes[o + 3] = 0;
    } else {
      fBytes[o] = clamp(Math.round(normR[i]), 0, 255);
      fBytes[o + 1] = clamp(Math.round(normG[i]), 0, 255);
      fBytes[o + 2] = clamp(Math.round(normB[i]), 0, 255);
      fBytes[o + 3] = aByte;
    }
  }
  frontCtx.putImageData(frontImg, 0, 0);

  // 2. Back Silhouette-Locked Canvas (horizontally flipped to align 1:1 at rotationY = Math.PI, softly diffused so text isn't backwards)
  const smoothR = blurFloat2D(normR, outW, outH, 9.0);
  const smoothG = blurFloat2D(normG, outW, outH, 9.0);
  const smoothB = blurFloat2D(normB, outW, outH, 9.0);
  const smoothW = blurFloat2D(normA, outW, outH, 9.0);

  const backCanvas = document.createElement('canvas');
  backCanvas.width = outW;
  backCanvas.height = outH;
  const backCtx = backCanvas.getContext('2d')!;
  const backImg = backCtx.createImageData(outW, outH);
  const bBytes = backImg.data;

  for (let y = 0; y < outH; y++) {
    const row = y * outW;
    for (let x = 0; x < outW; x++) {
      const srcX = outW - 1 - x; // Matches Front silhouette 1:1 when Back mesh is rotated [0, Math.PI, 0]
      const sIdx = row + srcX;
      const dOff = (row + x) * 4;
      const aByte = clamp(Math.round(normA[sIdx] * 255.0), 0, 255);
      if (aByte === 0) {
        bBytes[dOff] = 0;
        bBytes[dOff + 1] = 0;
        bBytes[dOff + 2] = 0;
        bBytes[dOff + 3] = 0;
      } else {
        const invW = smoothW[sIdx] > 0.05 ? 1.0 / smoothW[sIdx] : 1.0;
        const br = smoothR[sIdx] * invW * 0.94;
        const bg = smoothG[sIdx] * invW * 0.94;
        const bb = smoothB[sIdx] * invW * 0.94;
        bBytes[dOff] = clamp(Math.round(br), 0, 255);
        bBytes[dOff + 1] = clamp(Math.round(bg), 0, 255);
        bBytes[dOff + 2] = clamp(Math.round(bb), 0, 255);
        bBytes[dOff + 3] = aByte;
      }
    }
  }
  backCtx.putImageData(backImg, 0, 0);

  // 3. Sobel PBR Surface Normal Map + 3D Silhouette Curvature Dome
  const lum = new Float32Array(outN);
  const opaque = new Uint8Array(outN);
  for (let i = 0; i < outN; i++) {
    lum[i] = (0.2126 * normR[i] + 0.7152 * normG[i] + 0.0722 * normB[i]) / 255.0;
    if (normA[i] >= 0.42) opaque[i] = 1;
  }

  const interior = erodeMask(opaque, outW, outH, 3);
  const { refR: paddedLum } = propagateInteriorRgb(lum, lum, lum, interior, outW, outH, 6);
  const bFine = blurFloat2D(paddedLum, outW, outH, 1.2);
  const bMeso = blurFloat2D(paddedLum, outW, outH, 4.5);
  const bMacro = blurFloat2D(paddedLum, outW, outH, 14.0);

  const heightField = new Float32Array(outN);
  for (let i = 0; i < outN; i++) {
    heightField[i] = (bFine[i] - bMeso[i]) * 1.4 + (bMeso[i] - bMacro[i]) * 2.2;
  }
  const { gx, gy } = sobelXY(heightField, outW, outH);

  // Per-row horizontal bounds so cylindrical/rounded objects catch directional gallery key lights naturally
  const rowLeft = new Int32Array(outH).fill(outW);
  const rowRight = new Int32Array(outH).fill(-1);
  for (let y = 0; y < outH; y++) {
    const row = y * outW;
    for (let x = 0; x < outW; x++) {
      if (opaque[row + x]) {
        if (x < rowLeft[y]) rowLeft[y] = x;
        if (x > rowRight[y]) rowRight[y] = x;
      }
    }
  }

  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = outW;
  normalCanvas.height = outH;
  const nCtx = normalCanvas.getContext('2d')!;
  const nImg = nCtx.createImageData(outW, outH);
  const nBytes = nImg.data;

  for (let y = 0; y < outH; y++) {
    const row = y * outW;
    const rl = rowLeft[y];
    const rr = rowRight[y];
    const hasSpan = rr > rl + 4;
    const midX = 0.5 * (rl + rr);
    const halfSpan = Math.max(4.0, 0.5 * (rr - rl));
    const vNorm = 1.0 - y / Math.max(1, outH - 1);
    const verticalCrown = (vNorm - 0.5) * 0.16;

    for (let x = 0; x < outW; x++) {
      const idx = row + x;
      const o = idx * 4;
      const aVal = normA[idx];
      if (aVal < 0.05) {
        nBytes[o] = 128;
        nBytes[o + 1] = 128;
        nBytes[o + 2] = 255;
        nBytes[o + 3] = 255;
        continue;
      }

      const domeNx = hasSpan ? clamp((x - midX) / halfSpan, -1.0, 1.0) * 0.44 : 0.0;
      const nx = -gx[idx] * 16.0 * aVal + domeNx;
      const ny = gy[idx] * 16.0 * aVal + verticalCrown;
      const nz = 1.0;
      const invLen = 1.0 / Math.sqrt(nx * nx + ny * ny + nz * nz);

      nBytes[o] = clamp(Math.round((nx * invLen * 0.5 + 0.5) * 255.0), 0, 255);
      nBytes[o + 1] = clamp(Math.round((ny * invLen * 0.5 + 0.5) * 255.0), 0, 255);
      nBytes[o + 2] = clamp(Math.round((nz * invLen * 0.5 + 0.5) * 255.0), 128, 255);
      nBytes[o + 3] = 255;
    }
  }
  nCtx.putImageData(nImg, 0, 0);

  const frontTexture = createCanvasTexture(frontCanvas, true);
  const backTexture = createCanvasTexture(backCanvas, true);
  const normalTexture = createCanvasTexture(normalCanvas, false);
  const previewDataUrl = frontCanvas.toDataURL('image/png');
  const aspect = Number((outW / outH).toFixed(4));

  const processed: ProcessedObjectCutout = {
    frontTexture,
    backTexture,
    normalTexture,
    previewDataUrl,
    aspect,
    baseWidthRatio,
    width: outW,
    height: outH,
    dispose: () => {
      frontTexture.dispose();
      backTexture.dispose();
      normalTexture.dispose();
    },
  };

  if (OBJECT_CUTOUT_CACHE.size >= MAX_OBJECT_CACHE_ENTRIES) {
    const oldestKey = OBJECT_CUTOUT_CACHE.keys().next().value;
    if (oldestKey !== undefined) {
      const evicted = OBJECT_CUTOUT_CACHE.get(oldestKey);
      OBJECT_CUTOUT_CACHE.delete(oldestKey);
      evicted?.dispose();
    }
  }
  OBJECT_CUTOUT_CACHE.set(cacheKey, processed);

  return processed;
}

function getTargetObjectHeight(category: ProductCategory3D, aspect: number): number {
  let baseH = 0.34;
  switch (category) {
    case 'canvas_tote':
      baseH = 0.38;
      break;
    case 'hardcover_book':
      baseH = 0.35;
      break;
    case 'apothecary_bottle':
      baseH = 0.34;
      break;
    case 'structured_cap':
      baseH = 0.305;
      break;
    case 'ceramic_mug':
      baseH = 0.305;
      break;
    default:
      baseH = 0.34;
      break;
  }
  // Keep extra-wide landscape objects comfortably proportioned on pedestals while staying in 0.30m..0.38m
  if (aspect > 1.28) {
    return clamp(baseH / Math.pow(aspect / 1.2, 0.26), 0.3, 0.38);
  }
  return clamp(baseH, 0.3, 0.38);
}

/**
 * Builds a subdivided 3D curved relief plane whose bottom edge (`v = 0`) sits flush at `y = 0`
 * so mounting at `y = RISER_HEIGHT` (`0.022m`) anchors the product base directly on the riser.
 */
function buildReliefPlaneGeometry(
  width: number,
  height: number,
  convexDepth: number
): THREE.BufferGeometry {
  const segX = 24;
  const segY = 24;
  const geo = new THREE.PlaneGeometry(width, height, segX, segY);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;

  for (let i = 0; i < pos.count; i++) {
    const u = uv.getX(i); // 0..1
    const v = uv.getY(i); // 0 bottom .. 1 top
    const nx = (u - 0.5) * 2; // -1..1

    const x = (u - 0.5) * width;
    const y = v * height; // Bottom row v = 0 sits at exact y = 0.000m!
    // Gentle 3D horizontal pillowed relief tapering smoothly at the base contact line
    const baseTaper = clamp(v / 0.08, 0.15, 1.0);
    const z = Math.cos(nx * Math.PI * 0.5) * convexDepth * baseTaper;

    pos.setXYZ(i, x, y, z);
  }

  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * High-DPI museum spec tag (`Title · $Price · Click for 3D Studio Render`)
 */
function createStudioPlacardTexture(
  title: string,
  price: number | undefined,
  accentHex: string,
  metalHex: string
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 672;
  canvas.height = 168;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#FAF7F0';
  ctx.fillRect(0, 0, 672, 168);

  ctx.strokeStyle = metalHex;
  ctx.lineWidth = 4;
  ctx.strokeRect(8, 8, 656, 152);

  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 2;
  ctx.strokeRect(16, 16, 640, 136);

  ctx.fillStyle = '#191B19';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 25px Georgia, "Times New Roman", serif';
  const cleanTitle = title.trim().toUpperCase();
  const displayTitle = cleanTitle.length > 34 ? `${cleanTitle.slice(0, 33)}…` : cleanTitle;
  ctx.fillText(displayTitle, 336, 58);

  ctx.fillStyle = accentHex;
  ctx.font = '600 19.5px system-ui, -apple-system, sans-serif';
  const pricePrefix = price !== undefined ? `$${price.toFixed(0)} · ` : '';
  ctx.fillText(`${pricePrefix}CLICK FOR 3D STUDIO RENDER`, 336, 108);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Soft radial contact occlusion texture under the object's base on top of the stone riser
 */
let SHARED_AO_DISC_TEX: THREE.CanvasTexture | null = null;
function getContactOcclusionTexture(): THREE.CanvasTexture {
  if (SHARED_AO_DISC_TEX) return SHARED_AO_DISC_TEX;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(12, 12, 14, 0.52)');
  grad.addColorStop(0.55, 'rgba(12, 12, 14, 0.24)');
  grad.addColorStop(1, 'rgba(12, 12, 14, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  SHARED_AO_DISC_TEX = tex;
  return tex;
}

const CameraFacingStudioTag: React.FC<{
  position: [number, number, number];
  texture: THREE.Texture;
  width?: number;
  height?: number;
}> = ({ position, texture, width = 0.31, height = 0.078 }) => {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ camera }) => {
    if (ref.current) {
      ref.current.quaternion.copy(camera.quaternion);
    }
  });

  return (
    <group ref={ref} position={position}>
      <mesh renderOrder={12}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial map={texture} transparent depthTest={false} />
      </mesh>
    </group>
  );
};

export const PhotorealObjectStand3D: React.FC<PhotorealObjectStand3DProps> = ({
  spec,
  imageUrl,
  position = [0, 0, 0],
  rotationY = 0,
  scale = 1,
  metalColor,
  metalness = 0.86,
  metalRoughness = 0.26,
  accentColor,
  palette,
  cutoutTolerance = 21,
  selected = false,
  onSelect,
}) => {
  const effectiveUrl = (imageUrl ?? spec.customCutoutUrl ?? '').trim();

  const rootGroupRef = useRef<THREE.Group>(null);
  const yawGroupRef = useRef<THREE.Group>(null);
  const currentYawRef = useRef(0);
  const hoverEaseRef = useRef(0);

  const [hovered, setHovered] = useState(false);
  const [processed, setProcessed] = useState<ProcessedObjectCutout | null>(() => {
    if (!effectiveUrl) return null;
    return OBJECT_CUTOUT_CACHE.get(`${effectiveUrl}|${cutoutTolerance.toFixed(1)}`) ?? null;
  });
  const [loadFailed, setLoadFailed] = useState(false);

  const hwMetal = metalColor ?? palette?.rackMetal ?? '#C5A059';
  const badgeAccent = accentColor ?? palette?.accent ?? spec.accentColor ?? '#C5A059';
  const riserStoneColor = palette?.plinth ?? '#E7E0D2';

  useEffect(() => {
    if (!effectiveUrl) {
      setProcessed(null);
      setLoadFailed(false);
      return;
    }

    let cancelled = false;
    setLoadFailed(false);

    processObjectCutoutForStand(effectiveUrl, cutoutTolerance)
      .then((res) => {
        if (!cancelled) {
          setProcessed(res);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProcessed(null);
          setLoadFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [effectiveUrl, cutoutTolerance]);

  useEffect(() => {
    if (!hovered) return;
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = 'pointer';
    return () => {
      document.body.style.cursor = prevCursor;
    };
  }, [hovered]);

  const aspect = clamp(processed?.aspect ?? 0.88, 0.38, 1.85);
  const displayHeight = useMemo(
    () => getTargetObjectHeight(spec.category, aspect),
    [spec.category, aspect]
  );
  const displayWidth = useMemo(
    () => clamp(displayHeight * aspect, 0.14, 0.43),
    [displayHeight, aspect]
  );

  // Riser radius adapts cleanly to the real cut-out object's width
  const riserRadius = useMemo(
    () => clamp(displayWidth * 0.56, 0.108, 0.185),
    [displayWidth]
  );
  const haloOuterRadius = riserRadius + 0.022;

  const geometries = useMemo(() => {
    const shellGeo = buildReliefPlaneGeometry(displayWidth, displayHeight, 0.0042);
    const sliceGeo = buildReliefPlaneGeometry(displayWidth, displayHeight, 0.0016);
    return { shellGeo, sliceGeo };
  }, [displayWidth, displayHeight]);

  useEffect(() => {
    return () => {
      geometries.shellGeo.dispose();
      geometries.sliceGeo.dispose();
    };
  }, [geometries]);

  const customDepthMaterial = useMemo(() => {
    if (!processed) return undefined;
    return new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: processed.frontTexture,
      alphaTest: 0.38,
      side: THREE.DoubleSide,
    });
  }, [processed]);

  useEffect(() => {
    return () => {
      customDepthMaterial?.dispose();
    };
  }, [customDepthMaterial]);

  const placardTexture = useMemo(
    () => createStudioPlacardTexture(spec.title, spec.price, badgeAccent, hwMetal),
    [spec.title, spec.price, badgeAccent, hwMetal]
  );

  useEffect(() => {
    return () => {
      placardTexture.dispose();
    };
  }, [placardTexture]);

  const contactAoTex = useMemo(() => getContactOcclusionTexture(), []);

  // Smooth camera-facing yaw clamping within ±35° of fixture rotationY so object never appears edge-on paper-thin
  useFrame(({ camera }, delta) => {
    if (!rootGroupRef.current || !yawGroupRef.current) return;

    rootGroupRef.current.getWorldPosition(_worldPos);
    rootGroupRef.current.getWorldQuaternion(_worldQuat);
    _forwardVec.set(0, 0, 1).applyQuaternion(_worldQuat);

    const fixtureWorldYaw = Math.atan2(_forwardVec.x, _forwardVec.z);
    const camDx = camera.position.x - _worldPos.x;
    const camDz = camera.position.z - _worldPos.z;
    const desiredWorldYaw = Math.atan2(camDx, camDz);

    const rawDelta = Math.atan2(
      Math.sin(desiredWorldYaw - fixtureWorldYaw),
      Math.cos(desiredWorldYaw - fixtureWorldYaw)
    );
    const clampedYaw = clamp(rawDelta, -MAX_CAMERA_YAW_RAD, MAX_CAMERA_YAW_RAD);

    const dt = Math.min(delta, 0.05);
    hoverEaseRef.current += ((hovered ? 1 : 0) - hoverEaseRef.current) * Math.min(1, dt * 10);
    const targetYaw = clampedYaw + hoverEaseRef.current * 0.035;

    currentYawRef.current += (targetYaw - currentYawRef.current) * Math.min(1, dt * 8.5);
    yawGroupRef.current.rotation.y = currentYawRef.current;
  });

  // Graceful fallback to procedural 3D object only when no cutout URL exists or remote image failed completely
  if (!effectiveUrl || loadFailed) {
    return (
      <PedestalProduct3D
        spec={spec}
        position={position}
        rotationY={rotationY}
        scale={scale}
        metalColor={metalColor}
        metalness={metalness}
        metalRoughness={metalRoughness}
        accentColor={accentColor}
        palette={palette}
        selected={selected}
        onSelect={onSelect}
      />
    );
  }

  const contactShadowWidth = clamp(
    displayWidth * (processed?.baseWidthRatio ?? 0.68) * 1.08,
    0.09,
    riserRadius * 1.75
  );

  return (
    <group
      ref={rootGroupRef}
      position={position}
      rotation={[0, rotationY, 0]}
      scale={scale}
      name={`photoreal-object-stand-3d-${spec.id}`}
      onPointerEnter={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerLeave={(e) => {
        e.stopPropagation();
        setHovered(false);
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.(spec);
      }}
    >
      {/* Museum Hover / Active Selection Ring resting flush at y = 0.0016m */}
      {(hovered || selected) && (
        <mesh position={[0, 0.0016, 0]} rotation={[-Math.PI * 0.5, 0, 0]}>
          <ringGeometry args={[haloOuterRadius - 0.006, haloOuterRadius, 56]} />
          <meshBasicMaterial
            color={badgeAccent}
            transparent
            opacity={selected ? 0.88 : 0.62}
          />
        </mesh>
      )}

      {/* =====================================================================
          1. SLEEK 2.2cm (`0.022m`) BRUSHED-METAL & HONED-STONE MUSEUM RISER PAD
             Base flush at y = 0.000m -> Top Platen flush at exact y = 0.022m
         ===================================================================== */}
      <group name="museum-display-riser-22mm">
        {/* Lower Brushed Architectural Metal Base Collar (y = 0.000 .. 0.007m) */}
        <mesh position={[0, 0.0035, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[riserRadius * 0.985, riserRadius, 0.007, 48]} />
          <meshStandardMaterial
            color={hwMetal}
            metalness={metalness}
            roughness={metalRoughness}
          />
        </mesh>

        {/* Precision Accent Reveal Inlay Ring (y = 0.007 .. 0.009m) */}
        <mesh position={[0, 0.008, 0]}>
          <cylinderGeometry args={[riserRadius * 0.965, riserRadius * 0.965, 0.002, 48]} />
          <meshStandardMaterial
            color={badgeAccent}
            metalness={0.55}
            roughness={0.32}
            emissive={badgeAccent}
            emissiveIntensity={selected || hovered ? 0.2 : 0.04}
          />
        </mesh>

        {/* Upper Honed Stone Display Riser Platen (y = 0.009 .. 0.022m -> exact top at 0.022m!) */}
        <mesh position={[0, 0.0155, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[riserRadius * 0.95, riserRadius * 0.975, 0.013, 48]} />
          <meshPhysicalMaterial
            color={riserStoneColor}
            roughness={0.62}
            metalness={0.04}
            clearcoat={0.14}
            clearcoatRoughness={0.48}
          />
        </mesh>
      </group>

      {/* =====================================================================
          2. MULTI-LAYER 3D VOLUMETRIC RELIEF DISPLAY (Anchored flush at y = 0.022m)
             Clamped smoothly within ±35° toward the viewer
         ===================================================================== */}
      <group ref={yawGroupRef} position={[0, RISER_HEIGHT, 0]}>
        {/* Grounded Contact Ambient Occlusion Pad at y = +0.0003m on top of the 2.2cm riser */}
        <mesh
          position={[0, 0.0003, 0]}
          rotation={[-Math.PI * 0.5, 0, 0]}
          scale={[contactShadowWidth, 0.075, 1]}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            map={contactAoTex}
            transparent
            depthWrite={false}
            opacity={processed ? 0.85 : 0.35}
          />
        </mesh>

        {processed && (
          <group name="volumetric-relief-slices">
            {/* FRONT HERO PBR SHELL (+0.012m) */}
            <mesh
              position={[0, 0, HALF_RELIEF_DEPTH]}
              geometry={geometries.shellGeo}
              customDepthMaterial={customDepthMaterial}
              castShadow
              receiveShadow
            >
              <meshPhysicalMaterial
                color="#FFFFFF"
                map={processed.frontTexture}
                normalMap={processed.normalTexture}
                normalScale={NORMAL_SCALE_FRONT}
                roughness={0.42}
                metalness={0.04}
                clearcoat={0.22}
                clearcoatRoughness={0.28}
                side={THREE.FrontSide}
                alphaTest={0.38}
                alphaToCoverage
              />
            </mesh>

            {/* 6 CLOSELY-SPACED EXTRUDED VOLUMETRIC RELIEF SLICES (totalDepth = 0.024m) */}
            {SLICE_Z_OFFSETS.map((zOff, idx) => {
              const edgeShade = idx === 0 || idx === SLICE_Z_OFFSETS.length - 1 ? '#ECE9E2' : '#DFDBD3';
              const isCenterShadowCaster = idx === 2 || idx === 3;
              return (
                <mesh
                  key={idx}
                  position={[0, 0, zOff]}
                  geometry={geometries.sliceGeo}
                  customDepthMaterial={isCenterShadowCaster ? customDepthMaterial : undefined}
                  castShadow={isCenterShadowCaster}
                  receiveShadow
                >
                  <meshPhysicalMaterial
                    color={edgeShade}
                    map={processed.frontTexture}
                    normalMap={processed.normalTexture}
                    normalScale={NORMAL_SCALE_SLICE}
                    roughness={0.42}
                    metalness={0.03}
                    clearcoat={0.22}
                    clearcoatRoughness={0.34}
                    side={THREE.DoubleSide}
                    alphaTest={0.38}
                    alphaToCoverage
                  />
                </mesh>
              );
            })}

            {/* BACK SILHOUETTE-LOCKED PBR SHELL (-0.012m, rotated 180° for true outward normals) */}
            <mesh
              position={[0, 0, -HALF_RELIEF_DEPTH]}
              rotation={[0, Math.PI, 0]}
              geometry={geometries.shellGeo}
              customDepthMaterial={customDepthMaterial}
              castShadow
              receiveShadow
            >
              <meshPhysicalMaterial
                color="#F5F3EE"
                map={processed.backTexture}
                normalMap={processed.normalTexture}
                normalScale={NORMAL_SCALE_BACK}
                roughness={0.42}
                metalness={0.03}
                clearcoat={0.22}
                clearcoatRoughness={0.32}
                side={THREE.FrontSide}
                alphaTest={0.38}
                alphaToCoverage
              />
            </mesh>
          </group>
        )}
      </group>

      {/* Clean Museum Spec Tag (`Title · $Price · Click for 3D Studio Render`) */}
      {(hovered || selected) && (
        <CameraFacingStudioTag
          position={[0, RISER_HEIGHT + displayHeight + 0.056, 0]}
          texture={placardTexture}
          width={0.315}
          height={0.079}
        />
      )}
    </group>
  );
};

export default PhotorealObjectStand3D;
