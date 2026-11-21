import type { BrandCore, WorldSpec } from "@mybrand/shared";
import type { BoxPart, BrandPalette } from "./geometryUtils";
import type { OpenWallSide, RoomBounds } from "./roomLayout";

export type WorldArchetype =
  | "coastal"
  | "aviation"
  | "botanical"
  | "urban"
  | "gallery";

export interface WorldThemeAtmosphere {
  archetype: WorldArchetype;
  skyZenith: string;
  skyHorizon: string;
  skyGround: string;
  fogColor: string;
  sunColor: string;
  sunIntensity: number;
  ambientColor: string;
  ambientIntensity: number;
  hemiSkyColor: string;
  hemiGroundColor: string;
  surroundNear: string;
  surroundFar: string;
  waterShimmer: boolean;
  deckTrimColor: string;
  railColor: string;
  accentGlowColor: string;
  deckElevationM: number;
}

const COASTAL_RE =
  /\b(ocean|sea|coast|coastal|pier|tide|tidepool|kelp|surf|beach|cove|lighthouse|marine|wave|waves|harbor|harbour|boardwalk|pacific|atlantic|salt\s*air|nautical|sail|island)\b/i;
const AVIATION_RE =
  /\b(airport|flight|flights|aviation|runway|tarmac|jet|jets|airline|aircraft|plane|planes|terminal|hangar|cockpit|pilot|departure|boarding|aero|aerospace)\b/i;
const BOTANICAL_RE =
  /\b(forest|botanical|garden|greenhouse|moss|alpine|mountain|meadow|fern|orchard|floral|flower|flowers|trail|wilderness|cabins?|pine|redwood|tea\s*house)\b/i;
const URBAN_RE =
  /\b(neon|cyber|nightclub|club|synth|vinyl|record\s*shop|streetwear|sneaker|arcade|rooftop|metro|subway|nocturn|midnight|loft|industrial|tokyo|underground)\b/i;

function parseHexRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixHex(aHex: string, bHex: string, weightB: number): string {
  const a = parseHexRgb(aHex);
  const b = parseHexRgb(bHex);
  if (!a || !b) return aHex;
  const t = Math.max(0, Math.min(1, weightB));
  const toHex = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return (
    "#" +
    toHex(a[0] * (1 - t) + b[0] * t) +
    toHex(a[1] * (1 - t) + b[1] * t) +
    toHex(a[2] * (1 - t) + b[2] * t)
  ).toUpperCase();
}

export function detectWorldArchetype(
  brandCore: BrandCore,
  worldSpec?: WorldSpec
): WorldArchetype {
  const corpus = [
    brandCore.positioning,
    brandCore.strategy,
    brandCore.visual.lighting_mood,
    ...brandCore.visual.materials,
    ...brandCore.visual.motifs,
    ...brandCore.story_beats.map((b) => b.beat),
    worldSpec?.entrance.greeting ?? "",
    ...(worldSpec?.zones.map((z) => `${z.beat} ${z.signage}`) ?? []),
  ].join(" ");

  if (COASTAL_RE.test(corpus)) return "coastal";
  if (AVIATION_RE.test(corpus)) return "aviation";
  if (BOTANICAL_RE.test(corpus)) return "botanical";
  if (URBAN_RE.test(corpus)) return "urban";
  return "gallery";
}

export function buildWorldThemeAtmosphere(
  brandCore: BrandCore,
  palette: BrandPalette,
  worldSpec?: WorldSpec
): WorldThemeAtmosphere {
  const archetype = detectWorldArchetype(brandCore, worldSpec);
  const mood = brandCore.visual.lighting_mood.toLowerCase();
  const isDuskOrDawn =
    mood.includes("dawn") ||
    mood.includes("dusk") ||
    mood.includes("sunset") ||
    mood.includes("golden") ||
    mood.includes("amber");

  switch (archetype) {
    case "coastal":
      return {
        archetype,
        skyZenith: isDuskOrDawn
          ? mixHex(palette.secondary, "#5B7FA3", 0.55)
          : mixHex(palette.secondary, "#7BAFD4", 0.65),
        skyHorizon: isDuskOrDawn
          ? mixHex(palette.wall, "#F4D4BE", 0.52)
          : mixHex(palette.wall, "#DDEBF2", 0.55),
        skyGround: mixHex(palette.accent, "#11415C", 0.62),
        fogColor: isDuskOrDawn
          ? mixHex(palette.wall, "#E8DDD4", 0.55)
          : mixHex(palette.wall, "#D8E6EE", 0.55),
        sunColor: isDuskOrDawn ? "#FFD8B0" : "#FFF3E0",
        sunIntensity: 1.45,
        ambientColor: "#EEF6FA",
        ambientIntensity: 0.52,
        hemiSkyColor: isDuskOrDawn ? "#F8DEC8" : "#DDF0FA",
        hemiGroundColor: mixHex(palette.accent, "#1D4A5E", 0.5),
        surroundNear: mixHex(palette.accent, "#0E4864", 0.55),
        surroundFar: mixHex(palette.secondary, "#2E6D86", 0.48),
        waterShimmer: true,
        deckTrimColor: mixHex(palette.wood, "#5B4A3B", 0.45),
        railColor: mixHex(palette.wood, "#7A6652", 0.35),
        accentGlowColor: "#F2BC74",
        deckElevationM: 0.46,
      };

    case "aviation":
      return {
        archetype,
        skyZenith: mixHex(palette.dark, "#1B2E4E", 0.62),
        skyHorizon: mixHex(palette.accent, "#E6B896", 0.55),
        skyGround: mixHex(palette.dark, "#252B34", 0.65),
        fogColor: mixHex(palette.wall, "#CFD7E2", 0.52),
        sunColor: "#FFE2C2",
        sunIntensity: 1.35,
        ambientColor: "#EBF1F8",
        ambientIntensity: 0.5,
        hemiSkyColor: "#DCE8F6",
        hemiGroundColor: "#38414C",
        surroundNear: "#2D343D",
        surroundFar: "#5A6778",
        waterShimmer: false,
        deckTrimColor: "#363E49",
        railColor: "#788596",
        accentGlowColor: "#4EC5FF",
        deckElevationM: 0.24,
      };

    case "botanical":
      return {
        archetype,
        skyZenith: mixHex(palette.secondary, "#7DA68C", 0.5),
        skyHorizon: mixHex(palette.wall, "#EBF0DE", 0.55),
        skyGround: mixHex(palette.secondary, "#3D523E", 0.55),
        fogColor: mixHex(palette.wall, "#E3E8DC", 0.55),
        sunColor: "#FFF1CE",
        sunIntensity: 1.45,
        ambientColor: "#F7FAF0",
        ambientIntensity: 0.55,
        hemiSkyColor: "#F3F8E6",
        hemiGroundColor: mixHex(palette.secondary, "#4D6048", 0.5),
        surroundNear: mixHex(palette.secondary, "#3F543F", 0.58),
        surroundFar: mixHex(palette.floor, "#7A8C72", 0.52),
        waterShimmer: false,
        deckTrimColor: mixHex(palette.wood, "#5F4936", 0.42),
        railColor: mixHex(palette.wood, "#7A6048", 0.3),
        accentGlowColor: "#F5D08A",
        deckElevationM: 0.26,
      };

    case "urban":
      return {
        archetype,
        skyZenith: mixHex(palette.dark, "#0F1322", 0.72),
        skyHorizon: mixHex(palette.accent, "#3A274A", 0.55),
        skyGround: "#121318",
        fogColor: mixHex(palette.dark, "#1B1E2A", 0.6),
        sunColor: mixHex(palette.accent, "#FFE0C2", 0.55),
        sunIntensity: 1.15,
        ambientColor: "#CFD5EB",
        ambientIntensity: 0.45,
        hemiSkyColor: mixHex(palette.accent, "#4B5678", 0.55),
        hemiGroundColor: "#171820",
        surroundNear: "#1A1C24",
        surroundFar: "#2B3040",
        waterShimmer: false,
        deckTrimColor: "#242731",
        railColor: "#464C5E",
        accentGlowColor: palette.accent,
        deckElevationM: 0.22,
      };

    case "gallery":
    default:
      return {
        archetype: "gallery",
        skyZenith: mixHex(palette.wall, palette.secondary, 0.28),
        skyHorizon: mixHex(palette.wall, "#FAF3E8", 0.5),
        skyGround: mixHex(palette.floor, palette.wood, 0.35),
        fogColor: mixHex(palette.wall, "#EFE6DA", 0.55),
        sunColor: "#FFF0DA",
        sunIntensity: 1.35,
        ambientColor: "#FFF9F2",
        ambientIntensity: 0.58,
        hemiSkyColor: "#FFF7EC",
        hemiGroundColor: mixHex(palette.floor, palette.wood, 0.3),
        surroundNear: mixHex(palette.floor, palette.wood, 0.25),
        surroundFar: mixHex(palette.wall, palette.floor, 0.45),
        waterShimmer: false,
        deckTrimColor: mixHex(palette.wood, palette.dark, 0.28),
        railColor: mixHex(palette.wood, palette.wall, 0.22),
        accentGlowColor: palette.accent,
        deckElevationM: 0.22,
      };
  }
}

/**
 * Builds merged architectural stage geometry (1 mesh) matching the brand's
 * world archetype: raised deck apron + pilings/rails (coastal), cantilevered
 * terminal ribs (aviation), timber pergola (botanical), gallery piers, etc.
 * Keeps the open cutaway wall completely unobstructed for the 2.5D camera.
 */
export function buildStageArchitectureParts(
  archetype: WorldArchetype,
  bounds: RoomBounds,
  openFrontWall: OpenWallSide,
  deckElevationM: number
): BoxPart[] {
  const { width, depth, height, centerX, centerZ, minX, maxX, minZ, maxZ } =
    bounds;
  const parts: BoxPart[] = [];

  // 1. Solid raised platform / pier deck plinth beneath floor y=0
  parts.push({
    size: [width + 0.36, deckElevationM, depth + 0.36],
    position: [centerX, -deckElevationM / 2 - 0.008, centerZ],
  });

  // Helper to add a post/railing run along any non-open edge
  const edges: Array<{
    side: OpenWallSide;
    x0: number;
    z0: number;
    x1: number;
    z1: number;
  }> = [
    { side: "minZ", x0: minX, z0: minZ, x1: maxX, z1: minZ },
    { side: "maxZ", x0: minX, z0: maxZ, x1: maxX, z1: maxZ },
    { side: "minX", x0: minX, z0: minZ, x1: minX, z1: maxZ },
    { side: "maxX", x0: maxX, z0: minZ, x1: maxX, z1: maxZ },
  ];

  const backSide: OpenWallSide =
    openFrontWall === "minZ"
      ? "maxZ"
      : openFrontWall === "maxZ"
        ? "minZ"
        : openFrontWall === "minX"
          ? "maxX"
          : "minX";

  if (archetype === "coastal") {
    // Weathered cedar pier pilings plunging into water + low timber coastal railings
    const railH = 0.92;
    for (const edge of edges) {
      if (edge.side === openFrontWall) continue;
      const dx = edge.x1 - edge.x0;
      const dz = edge.z1 - edge.z0;
      const len = Math.hypot(dx, dz);
      const steps = Math.max(3, Math.round(len / 3.2));
      const isXRun = Math.abs(dx) > Math.abs(dz);

      // Top & mid horizontal timber rails (open back center slightly so ocean shines through)
      parts.push({
        size: isXRun ? [len + 0.14, 0.075, 0.1] : [0.1, 0.075, len + 0.14],
        position: [(edge.x0 + edge.x1) / 2, railH, (edge.z0 + edge.z1) / 2],
      });
      parts.push({
        size: isXRun ? [len + 0.1, 0.045, 0.06] : [0.06, 0.045, len + 0.1],
        position: [
          (edge.x0 + edge.x1) / 2,
          railH * 0.52,
          (edge.z0 + edge.z1) / 2,
        ],
      });

      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const px = edge.x0 + dx * t;
        const pz = edge.z0 + dz * t;
        // Pier piling extending below waterline up to railing cap
        const postH = railH + deckElevationM + 0.45;
        parts.push({
          size: [0.18, postH, 0.18],
          position: [px, postH / 2 - deckElevationM - 0.35, pz],
        });
      }
    }
  } else if (archetype === "aviation") {
    // Sleek airport departure lounge steel columns & cantilevered terminal canopy ribs
    const backEdge = edges.find((e) => e.side === backSide)!;
    const dx = backEdge.x1 - backEdge.x0;
    const dz = backEdge.z1 - backEdge.z0;
    const isBackX = Math.abs(dx) > Math.abs(dz);
    const len = Math.hypot(dx, dz);
    const colH = Math.min(height + 0.3, 4.1);

    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      const px = backEdge.x0 + dx * t;
      const pz = backEdge.z0 + dz * t;
      parts.push({
        size: [0.16, colH, 0.22],
        position: [px, colH / 2, pz],
      });
      // Short cantilevered canopy rib extending 2.2 m inward from back glass line
      const inwardX = backSide === "maxX" ? -1.1 : backSide === "minX" ? 1.1 : 0;
      const inwardZ = backSide === "maxZ" ? -1.1 : backSide === "minZ" ? 1.1 : 0;
      parts.push({
        size: isBackX ? [0.14, 0.14, 2.3] : [2.3, 0.14, 0.14],
        position: [px + inwardX, colH, pz + inwardZ],
      });
    }
    // Terminal fascia beam
    parts.push({
      size: isBackX ? [len + 0.4, 0.2, 0.26] : [0.26, 0.2, len + 0.4],
      position: [(backEdge.x0 + backEdge.x1) / 2, colH + 0.08, (backEdge.z0 + backEdge.z1) / 2],
    });
    // Low lounge glass-rail curb along sides
    for (const edge of edges) {
      if (edge.side === openFrontWall || edge.side === backSide) continue;
      const edx = edge.x1 - edge.x0;
      const edz = edge.z1 - edge.z0;
      const elen = Math.hypot(edx, edz);
      const isX = Math.abs(edx) > Math.abs(edz);
      parts.push({
        size: isX ? [elen, 0.16, 0.18] : [0.18, 0.16, elen],
        position: [(edge.x0 + edge.x1) / 2, 0.08, (edge.z0 + edge.z1) / 2],
      });
    }
  } else if (archetype === "botanical") {
    // Open cedar pergola columns & slim overhead sun slats along back edge
    const backEdge = edges.find((e) => e.side === backSide)!;
    const dx = backEdge.x1 - backEdge.x0;
    const dz = backEdge.z1 - backEdge.z0;
    const isBackX = Math.abs(dx) > Math.abs(dz);
    const colH = Math.min(height, 3.7);
    for (let i = 0; i <= 3; i++) {
      const t = i / 3;
      parts.push({
        size: [0.2, colH, 0.2],
        position: [backEdge.x0 + dx * t, colH / 2, backEdge.z0 + dz * t],
      });
    }
    const len = Math.hypot(dx, dz);
    parts.push({
      size: isBackX ? [len + 0.4, 0.16, 0.24] : [0.24, 0.16, len + 0.4],
      position: [(backEdge.x0 + backEdge.x1) / 2, colH + 0.06, (backEdge.z0 + backEdge.z1) / 2],
    });
  } else {
    // Sculpted gallery / urban architectural stage: clean perimeter curb + corner architectural piers
    for (const edge of edges) {
      if (edge.side === openFrontWall) continue;
      const edx = edge.x1 - edge.x0;
      const edz = edge.z1 - edge.z0;
      const elen = Math.hypot(edx, edz);
      const isX = Math.abs(edx) > Math.abs(edz);
      const curbH = edge.side === backSide ? 0.34 : 0.22;
      parts.push({
        size: isX ? [elen + 0.28, curbH, 0.18] : [0.18, curbH, elen + 0.28],
        position: [(edge.x0 + edge.x1) / 2, curbH / 2, (edge.z0 + edge.z1) / 2],
      });
    }
    const backEdge = edges.find((e) => e.side === backSide)!;
    const colH = Math.min(height, 3.8);
    parts.push({
      size: [0.26, colH, 0.26],
      position: [backEdge.x0, colH / 2, backEdge.z0],
    });
    parts.push({
      size: [0.26, colH, 0.26],
      position: [backEdge.x1, colH / 2, backEdge.z1],
    });
    const isBackX = Math.abs(backEdge.x1 - backEdge.x0) > Math.abs(backEdge.z1 - backEdge.z0);
    const backLen = Math.hypot(backEdge.x1 - backEdge.x0, backEdge.z1 - backEdge.z0);
    parts.push({
      size: isBackX ? [backLen + 0.3, 0.16, 0.22] : [0.22, 0.16, backLen + 0.3],
      position: [
        (backEdge.x0 + backEdge.x1) / 2,
        colH + 0.06,
        (backEdge.z0 + backEdge.z1) / 2,
      ],
    });
  }

  return parts;
}

/**
 * Builds subtle emissive architectural accent pieces (1 merged mesh):
 * warm pier brass bollards, aviation apron edge beacons, or gallery edge cove strips.
 */
export function buildStageAccentLightParts(
  archetype: WorldArchetype,
  bounds: RoomBounds,
  openFrontWall: OpenWallSide
): BoxPart[] {
  const { minX, maxX, minZ, maxZ, centerX, centerZ, width, depth } = bounds;
  const parts: BoxPart[] = [];

  if (archetype === "coastal") {
    // Warm aged-brass pier lantern caps atop deck corners & mid-sides
    const corners: Array<[number, number]> = [
      [minX, minZ],
      [maxX, minZ],
      [minX, maxZ],
      [maxX, maxZ],
      [minX, centerZ],
      [maxX, centerZ],
    ];
    for (const [x, z] of corners) {
      parts.push({
        size: [0.16, 0.18, 0.16],
        position: [x, 1.06, z],
      });
    }
    return parts;
  }

  if (archetype === "aviation") {
    // Glowing apron / taxiway edge beacons along left & right runway edges extending outward
    for (let i = 0; i < 6; i++) {
      const z = minZ + (depth / 5) * i;
      parts.push({ size: [0.14, 0.14, 0.14], position: [minX - 0.35, 0.08, z] });
      parts.push({ size: [0.14, 0.14, 0.14], position: [maxX + 0.35, 0.08, z] });
    }
    return parts;
  }

  // Subtle recessed architectural cove light strip along the back edge
  const backSide: OpenWallSide =
    openFrontWall === "minZ"
      ? "maxZ"
      : openFrontWall === "maxZ"
        ? "minZ"
        : openFrontWall === "minX"
          ? "maxX"
          : "minX";

  if (backSide === "maxZ") {
    parts.push({ size: [width - 0.6, 0.04, 0.05], position: [centerX, 0.36, maxZ - 0.1] });
  } else if (backSide === "minZ") {
    parts.push({ size: [width - 0.6, 0.04, 0.05], position: [centerX, 0.36, minZ + 0.1] });
  } else if (backSide === "maxX") {
    parts.push({ size: [0.05, 0.04, depth - 0.6], position: [maxX - 0.1, 0.36, centerZ] });
  } else {
    parts.push({ size: [0.05, 0.04, depth - 0.6], position: [minX + 0.1, 0.36, centerZ] });
  }
  return parts;
}
