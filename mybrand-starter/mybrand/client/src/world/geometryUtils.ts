import type { BrandCore } from "@mybrand/shared";
import * as THREE from "three";

export interface BoxPart {
  size: [number, number, number];
  position: [number, number, number];
}

export interface BrandPalette {
  floor: string;
  accent: string;
  dark: string;
  wood: string;
  secondary: string;
  wall: string;
}

export interface SkyGradientColors {
  zenith: string;
  horizon: string;
  ground: string;
}

const DEFAULT_PALETTE: BrandPalette = {
  floor: "#D9C9B8",
  accent: "#C46D4E",
  dark: "#2E2B28",
  wood: "#8A7968",
  secondary: "#5B6B5C",
  wall: "#F2EAE0",
};

function parseHexRgb(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return null;
  const num = parseInt(match[1], 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (
    "#" +
    [clampByte(r), clampByte(g), clampByte(b)]
      .map((c) => c.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

export function relativeLuminance(hex: string): number {
  const rgb = parseHexRgb(hex);
  if (!rgb) return 0.5;
  const linear = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

function colorSaturation(hex: string): number {
  const rgb = parseHexRgb(hex);
  if (!rgb) return 0;
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const l = (max + min) / 2;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

function mixHex(hexA: string, hexB: string, weightB: number): string {
  const a = parseHexRgb(hexA);
  const b = parseHexRgb(hexB);
  if (!a || !b) return hexA;
  const t = Math.max(0, Math.min(1, weightB));
  return rgbToHex(
    a[0] * (1 - t) + b[0] * t,
    a[1] * (1 - t) + b[1] * t,
    a[2] * (1 - t) + b[2] * t
  );
}

/**
 * Extracts a contrast-safe 6-role boutique palette from any brand's palette_hex
 * (whether 1 color or 8 colors, in any light/dark ordering).
 * Preserves the exact 6-slot ordering when hex[2] (dark) and hex[5] (wall)
 * already have strong dark-vs-light contrast (such as demo-brand).
 */
export function extractBrandPalette(brandCore: BrandCore): BrandPalette {
  const validHex = brandCore.visual.palette_hex.filter(
    (c) => parseHexRgb(c) !== null
  );
  if (validHex.length === 0) {
    return { ...DEFAULT_PALETTE };
  }

  // Fast path: preserve canonical 6-slot order when dark vs wall contrast is already clean
  if (
    validHex.length >= 6 &&
    relativeLuminance(validHex[2]) < relativeLuminance(validHex[5]) &&
    contrastRatio(validHex[2], validHex[5]) >= 4.5
  ) {
    return {
      floor: validHex[0],
      accent: validHex[1],
      dark: validHex[2],
      wood: validHex[3],
      secondary: validHex[4],
      wall: validHex[5],
    };
  }

  const byLuminanceAsc = [...validHex].sort(
    (a, b) => relativeLuminance(a) - relativeLuminance(b)
  );
  const darkestRaw = byLuminanceAsc[0];
  const lightestRaw = byLuminanceAsc[byLuminanceAsc.length - 1];

  // Guarantee high-contrast dark ink & light surface for 3D signage + HUD readability
  let dark =
    relativeLuminance(darkestRaw) <= 0.16
      ? darkestRaw
      : mixHex(darkestRaw, "#1A1918", 0.72);
  let wall =
    relativeLuminance(lightestRaw) >= 0.62
      ? lightestRaw
      : mixHex(lightestRaw, "#F5F0E8", 0.78);

  if (contrastRatio(dark, wall) < 5.0) {
    dark = mixHex(dark, "#161514", 0.65);
    wall = mixHex(wall, "#F7F3EC", 0.65);
  }

  // Pick the most chromatic color that isn't near-black or near-white as accent
  const accentCandidates = [...validHex].sort((a, b) => {
    const score = (hex: string) => {
      const sat = colorSaturation(hex);
      const lum = relativeLuminance(hex);
      const midBonus = lum > 0.06 && lum < 0.8 ? 0.25 : 0;
      return sat + midBonus;
    };
    return score(b) - score(a);
  });
  const accent = accentCandidates[0] ?? DEFAULT_PALETTE.accent;

  const remaining = validHex.filter(
    (c) => c !== dark && c !== wall && c !== accent
  );
  const remainingByLum = [...remaining].sort(
    (a, b) => relativeLuminance(b) - relativeLuminance(a)
  );

  const floor =
    remainingByLum[0] ?? mixHex(wall, dark, 0.14);
  const wood =
    remainingByLum[1] ?? mixHex(dark, floor, 0.42);
  const secondary =
    remainingByLum[2] ?? mixHex(accent, dark, 0.35);

  return {
    floor,
    accent,
    dark,
    wood,
    secondary,
    wall,
  };
}

/**
 * Resolves either an asset ID present in world_spec.assets OR a direct asset URL
 * (/data/..., /fixtures/..., http://..., https://...) so AI-generated world specs
 * work even when a model writes a URL directly into floor_asset / wall_asset / image_asset_ids.
 */
export function resolveAssetUrl(
  idOrUrl: string | null | undefined,
  assetUrlById: ReadonlyMap<string, string>
): string | null {
  if (!idOrUrl) return null;
  const trimmed = idOrUrl.trim();
  if (!trimmed) return null;

  const mapped = assetUrlById.get(trimmed);
  if (mapped) return mapped;

  if (
    trimmed.startsWith("/data/") ||
    trimmed.startsWith("/fixtures/") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("data:image/")
  ) {
    return trimmed;
  }

  return null;
}

/**
 * Computes a harmonious 3-stop atmospheric horizon backdrop (zenith → horizon → ground)
 * driven by brand palette and lighting mood for the cutaway 2.5D diorama stage.
 */
export function computeSkyGradientColors(
  brandCore: BrandCore,
  palette: BrandPalette
): SkyGradientColors {
  const mood = brandCore.visual.lighting_mood.toLowerCase();

  if (
    mood.includes("night") ||
    mood.includes("neon") ||
    mood.includes("nocturn") ||
    mood.includes("midnight") ||
    mood.includes("club")
  ) {
    return {
      zenith: mixHex(palette.dark, "#0E1324", 0.65),
      horizon: mixHex(palette.accent, palette.dark, 0.55),
      ground: mixHex(palette.dark, "#121114", 0.5),
    };
  }

  if (
    mood.includes("sunset") ||
    mood.includes("dusk") ||
    mood.includes("golden") ||
    mood.includes("amber")
  ) {
    return {
      zenith: mixHex(palette.secondary, "#4D6282", 0.45),
      horizon: mixHex(palette.accent, "#F7D9B9", 0.62),
      ground: mixHex(palette.floor, palette.dark, 0.25),
    };
  }

  if (
    mood.includes("ocean") ||
    mood.includes("coastal") ||
    mood.includes("sky") ||
    mood.includes("daylight") ||
    mood.includes("crisp") ||
    mood.includes("runway")
  ) {
    return {
      zenith: mixHex(palette.secondary, "#8EB8D8", 0.58),
      horizon: mixHex(palette.wall, "#EEF4F8", 0.55),
      ground: mixHex(palette.floor, palette.wood, 0.28),
    };
  }

  // Default warm gallery studio atmosphere tinted gently by the brand's palette
  return {
    zenith: mixHex(palette.wall, palette.secondary, 0.28),
    horizon: mixHex(palette.wall, palette.accent, 0.14),
    ground: mixHex(palette.floor, palette.dark, 0.2),
  };
}

/**
 * Merges multiple axis-aligned BoxGeometries into a single BufferGeometry so
 * multi-part fixtures (tables, racks, shelves, stepped plinths) draw in 1 mesh.
 */
export function mergeBoxGeometries(
  parts: readonly BoxPart[]
): THREE.BufferGeometry {
  const boxes = parts.map((part) => {
    const geom = new THREE.BoxGeometry(part.size[0], part.size[1], part.size[2]);
    geom.translate(part.position[0], part.position[1], part.position[2]);
    return geom;
  });

  let totalVertices = 0;
  let totalIndices = 0;
  for (const geom of boxes) {
    totalVertices += geom.attributes.position.count;
    totalIndices += geom.index
      ? geom.index.count
      : geom.attributes.position.count;
  }

  const positions = new Float32Array(totalVertices * 3);
  const normals = new Float32Array(totalVertices * 3);
  const uvs = new Float32Array(totalVertices * 2);
  const indices = new Uint32Array(totalIndices);

  let vertexOffset = 0;
  let indexOffset = 0;

  for (const geom of boxes) {
    const posAttr = geom.attributes.position;
    const normAttr = geom.attributes.normal;
    const uvAttr = geom.attributes.uv;

    positions.set(posAttr.array as Float32Array, vertexOffset * 3);
    normals.set(normAttr.array as Float32Array, vertexOffset * 3);
    uvs.set(uvAttr.array as Float32Array, vertexOffset * 2);

    if (geom.index) {
      const srcIdx = geom.index.array;
      for (let i = 0; i < srcIdx.length; i++) {
        indices[indexOffset + i] = srcIdx[i] + vertexOffset;
      }
      indexOffset += srcIdx.length;
    } else {
      for (let i = 0; i < posAttr.count; i++) {
        indices[indexOffset + i] = vertexOffset + i;
      }
      indexOffset += posAttr.count;
    }

    vertexOffset += posAttr.count;
    geom.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  merged.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.computeBoundingSphere();
  merged.computeBoundingBox();

  return merged;
}
