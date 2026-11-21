import { useEffect, useState } from "react";
import * as THREE from "three";

const MAX_TEXTURE_DIM = 1024;
const MAX_CACHED_TEXTURES = 11; // Keeps <= 12 total GPU textures including font atlas

interface CacheEntry {
  key: string;
  texture: THREE.Texture;
  refCount: number;
  lastUsed: number;
}

const textureCache = new Map<string, CacheEntry>();
const inflightLoads = new Map<string, Promise<THREE.Texture | null>>();

function makeCacheKey(
  url: string,
  repeatX: number,
  repeatY: number,
  panoramicWallAspect?: number
): string {
  const pano =
    typeof panoramicWallAspect === "number"
      ? `|p${panoramicWallAspect.toFixed(2)}`
      : "";
  return `${url}|${repeatX}x${repeatY}${pano}`;
}

function evictIfNeeded(): void {
  if (textureCache.size <= MAX_CACHED_TEXTURES) return;

  const now = Date.now();
  const candidates = Array.from(textureCache.values())
    // Never evict an entry currently referenced or freshly loaded within the last 2s
    .filter((entry) => entry.refCount <= 0 && now - entry.lastUsed > 2000)
    .sort((a, b) => a.lastUsed - b.lastUsed);

  for (const entry of candidates) {
    if (textureCache.size <= MAX_CACHED_TEXTURES) break;
    entry.texture.dispose();
    textureCache.delete(entry.key);
  }
}

function createCanvasTextureFromImage(
  img: HTMLImageElement,
  repeatX: number,
  repeatY: number,
  panoramicWallAspect?: number
): THREE.Texture {
  const naturalW = img.naturalWidth || img.width || 512;
  const naturalH = img.naturalHeight || img.height || 512;
  const scale = Math.min(1, MAX_TEXTURE_DIM / Math.max(naturalW, naturalH));
  const width = Math.max(1, Math.round(naturalW * scale));
  const height = Math.max(1, Math.round(naturalH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.drawImage(img, 0, 0, width, height);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const imgAspect = naturalW / Math.max(1, naturalH);

  // If this is a wall texture and the generated artwork is wide/scenic (>= 1.35 aspect),
  // preserve its aspect ratio as a seamless panoramic backdrop instead of tiling it repeatedly.
  if (
    typeof panoramicWallAspect === "number" &&
    panoramicWallAspect > 0 &&
    imgAspect >= 1.35
  ) {
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;

    if (panoramicWallAspect > imgAspect) {
      // Gently crop vertical span to preserve scenic proportions without losing too much sky/ground
      const spanV = Math.max(0.62, Math.min(1, imgAspect / panoramicWallAspect));
      texture.repeat.set(1, spanV);
      texture.offset.set(0, (1 - spanV) / 2);
    } else {
      const spanU = Math.max(0.62, Math.min(1, panoramicWallAspect / imgAspect));
      texture.repeat.set(spanU, 1);
      texture.offset.set((1 - spanU) / 2, 0);
    }
  } else if (repeatX > 1 || repeatY > 1) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
  } else {
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
  }

  texture.needsUpdate = true;
  return texture;
}

function loadTextureAsync(
  url: string,
  repeatX: number,
  repeatY: number,
  panoramicWallAspect?: number
): Promise<THREE.Texture | null> {
  const key = makeCacheKey(url, repeatX, repeatY, panoramicWallAspect);
  const existing = textureCache.get(key);
  if (existing) {
    existing.lastUsed = Date.now();
    return Promise.resolve(existing.texture);
  }

  const inflight = inflightLoads.get(key);
  if (inflight) return inflight;

  const promise = new Promise<THREE.Texture | null>((resolve) => {
    const img = new Image();
    if (!url.startsWith("/")) {
      img.crossOrigin = "anonymous";
    }

    img.onload = () => {
      try {
        const texture = createCanvasTextureFromImage(
          img,
          repeatX,
          repeatY,
          panoramicWallAspect
        );
        textureCache.set(key, {
          key,
          texture,
          refCount: 0,
          lastUsed: Date.now(),
        });
        evictIfNeeded();
        resolve(texture);
      } catch {
        resolve(null);
      } finally {
        inflightLoads.delete(key);
      }
    };

    img.onerror = () => {
      inflightLoads.delete(key);
      resolve(null);
    };

    img.src = url;
  });

  inflightLoads.set(key, promise);
  return promise;
}

export function getCachedTextureCount(): number {
  return textureCache.size;
}

export function useCachedTexture(
  url: string | null | undefined,
  repeatX = 1,
  repeatY = 1,
  panoramicWallAspect?: number
): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(() => {
    if (!url) return null;
    const hit = textureCache.get(
      makeCacheKey(url, repeatX, repeatY, panoramicWallAspect)
    );
    return hit ? hit.texture : null;
  });

  useEffect(() => {
    if (!url) {
      setTexture(null);
      return;
    }

    let cancelled = false;
    const key = makeCacheKey(url, repeatX, repeatY, panoramicWallAspect);
    let acquired = false;

    const acquire = () => {
      const entry = textureCache.get(key);
      if (entry && !acquired) {
        entry.refCount += 1;
        entry.lastUsed = Date.now();
        acquired = true;
      }
    };

    const cached = textureCache.get(key);
    if (cached) {
      acquire();
      setTexture(cached.texture);
    } else {
      void loadTextureAsync(
        url,
        repeatX,
        repeatY,
        panoramicWallAspect
      ).then((loaded) => {
        if (cancelled) return;
        if (loaded) {
          acquire();
        }
        setTexture(loaded);
      });
    }

    return () => {
      cancelled = true;
      if (acquired) {
        const entry = textureCache.get(key);
        if (entry) {
          entry.refCount = Math.max(0, entry.refCount - 1);
          entry.lastUsed = Date.now();
          evictIfNeeded();
        }
      }
    };
  }, [url, repeatX, repeatY, panoramicWallAspect]);

  return texture;
}
