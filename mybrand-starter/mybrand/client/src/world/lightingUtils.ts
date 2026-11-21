import type { LightingPreset, WorldSpec } from "@mybrand/shared";

export interface RgbTuple {
  r: number;
  g: number;
  b: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Converts a color temperature in Kelvin (1000K–12000K) to normalized sRGB [0..1]
 * using Tanner Helland's blackbody approximation.
 */
export function kelvinToRgb(kelvin: number): RgbTuple {
  const temp = Math.min(12000, Math.max(1000, kelvin)) / 100;

  let r: number;
  let g: number;
  let b: number;

  if (temp <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(temp) - 161.1195681661;
    b =
      temp <= 19
        ? 0
        : 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
    b = 255;
  }

  return {
    r: clamp01(r / 255),
    g: clamp01(g / 255),
    b: clamp01(b / 255),
  };
}

export function kelvinToHex(kelvin: number): string {
  const { r, g, b } = kelvinToRgb(kelvin);
  const toHex = (c: number) =>
    Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const DEFAULT_LIGHTING_PRESET: LightingPreset = {
  id: "default_warm",
  color_temp_k: 3200,
  intensity: 0.85,
  spot: false,
};

export function resolveLightingPreset(
  worldSpec: WorldSpec,
  presetId: string
): LightingPreset {
  return (
    worldSpec.variant_pools.lighting.find((preset) => preset.id === presetId) ??
    worldSpec.variant_pools.lighting[0] ??
    DEFAULT_LIGHTING_PRESET
  );
}
