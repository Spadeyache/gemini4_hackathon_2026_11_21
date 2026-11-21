import fs from "node:fs";
import path from "node:path";
import {
  BrandCoreSchema,
  WorldSpecSchema,
  type BrandCore,
  type WorldSpec,
} from "@mybrand/shared";
import { describe, expect, it } from "vitest";
import {
  clampDioramaPose,
  computeDioramaLimits,
  computeDioramaOverview,
  computeDioramaZoneFocus,
  dioramaPoseToCameraPosition,
} from "../world/dioramaCamera";
import {
  contrastRatio,
  extractBrandPalette,
  relativeLuminance,
  resolveAssetUrl,
} from "../world/geometryUtils";
import {
  buildGuidePathPoints,
  computeRoomBounds,
  detectOpenFrontWall,
} from "../world/roomLayout";
import {
  buildStageAccentLightParts,
  buildStageArchitectureParts,
  buildWorldThemeAtmosphere,
  detectWorldArchetype,
} from "../world/themeAtmosphere";

function loadDemoFixtures(): { brandCore: BrandCore; worldSpec: WorldSpec } {
  const root = path.resolve(process.cwd(), "fixtures/demo-brand");
  const brandCore = BrandCoreSchema.parse(
    JSON.parse(fs.readFileSync(path.join(root, "brand_core.json"), "utf-8"))
  );
  const worldSpec = WorldSpecSchema.parse(
    JSON.parse(fs.readFileSync(path.join(root, "world_spec.json"), "utf-8"))
  );
  return { brandCore, worldSpec };
}

describe("M1/M3 world compatibility & 2.5D diorama math", () => {
  const { brandCore, worldSpec } = loadDemoFixtures();

  it("preserves exact demo-brand 6-slot palette while hardening arbitrary AI palettes", () => {
    const demoPalette = extractBrandPalette(brandCore);
    expect(demoPalette).toEqual({
      floor: "#D9C9B8",
      accent: "#C46D4E",
      dark: "#2E2B28",
      wood: "#8A7968",
      secondary: "#5B6B5C",
      wall: "#F2EAE0",
    });

    // 4-color dark-first palette (previously caused light-on-light signage!)
    const darkFirstBrand: BrandCore = {
      ...brandCore,
      visual: {
        ...brandCore.visual,
        palette_hex: ["#121417", "#E63946", "#F4F7F5", "#457B9D"],
      },
    };
    const p1 = extractBrandPalette(darkFirstBrand);
    expect(relativeLuminance(p1.dark)).toBeLessThan(relativeLuminance(p1.wall));
    expect(contrastRatio(p1.dark, p1.wall)).toBeGreaterThanOrEqual(4.5);
    expect(p1.accent).toBe("#E63946");

    // 1-color light-only palette still yields legible dark/wall contrast
    const singleLightBrand: BrandCore = {
      ...brandCore,
      visual: {
        ...brandCore.visual,
        palette_hex: ["#FAF3E0"],
      },
    };
    const p2 = extractBrandPalette(singleLightBrand);
    expect(contrastRatio(p2.dark, p2.wall)).toBeGreaterThanOrEqual(4.5);
  });

  it("resolves both asset IDs and direct /data/... URLs safely", () => {
    const map = new Map<string, string>([
      ["asset_floor", "/data/boot_1/assets/floor.png"],
    ]);
    expect(resolveAssetUrl("asset_floor", map)).toBe(
      "/data/boot_1/assets/floor.png"
    );
    expect(resolveAssetUrl("/data/boot_1/assets/wall.png", map)).toBe(
      "/data/boot_1/assets/wall.png"
    );
    expect(resolveAssetUrl("missing_id", map)).toBeNull();
  });

  it("handles positive-X 5-zone rooms and slight fixture overflow cleanly", () => {
    const fiveZoneSpec: WorldSpec = {
      ...worldSpec,
      room: { ...worldSpec.room, size_m: [20, 14, 4.5] },
      entrance: { ...worldSpec.entrance, position: [10, 0] },
      hero_plinth: { ...worldSpec.hero_plinth, position: [10, 3] },
      zones: [
        { ...worldSpec.zones[0], id: "z1", center: [3, 4], size: [4, 4], fixtures: [] },
        { ...worldSpec.zones[0], id: "z2", center: [17, 4], size: [4, 4], fixtures: [] },
        { ...worldSpec.zones[0], id: "z3", center: [3, 10], size: [4, 4], fixtures: [] },
        { ...worldSpec.zones[0], id: "z4", center: [10, 10], size: [4, 4], fixtures: [] },
        { ...worldSpec.zones[0], id: "z5", center: [18.5, 11], size: [4, 4], fixtures: [] },
      ],
    };

    const bounds = computeRoomBounds(fiveZoneSpec);
    expect(bounds.minX).toBe(0);
    // Zone z5 reaches x = 20.5, so bounds expand gently to enclose it
    expect(bounds.maxX).toBeGreaterThanOrEqual(20.5);
    expect(bounds.minZ).toBe(0);
    expect(bounds.maxZ).toBe(14);
    expect(detectOpenFrontWall(fiveZoneSpec, bounds)).toBe("minZ");

    const guidePts = buildGuidePathPoints(fiveZoneSpec, "z5");
    expect(guidePts[0][0]).toBeCloseTo(10, 4);
    expect(guidePts[0][2]).toBeGreaterThan(0.5);
    expect(guidePts[guidePts.length - 1][0]).toBeCloseTo(18.5, 4);
  });

  it("positions 2.5D diorama camera outside the open cutaway wall and clamps orbit/zoom", () => {
    const bounds = computeRoomBounds(worldSpec);
    const limits = computeDioramaLimits(worldSpec, bounds);
    const overview = computeDioramaOverview(worldSpec, bounds);
    const [camX, camY, camZ] = dioramaPoseToCameraPosition(overview, limits);

    // Entrance is on minZ (z=0), so diorama camera sits elevated on -Z side looking into +Z
    expect(camY).toBeGreaterThan(4);
    expect(camZ).toBeLessThan(bounds.minZ);
    expect(Math.abs(camX - bounds.centerX)).toBeLessThan(bounds.width);

    // Focusing a zone pulls camera closer and centers target on that zone
    const targetZone = worldSpec.zones[0];
    const focusPose = computeDioramaZoneFocus(targetZone, bounds);
    expect(focusPose.targetX).toBe(targetZone.center[0]);
    expect(focusPose.targetZ).toBe(targetZone.center[1]);
    expect(focusPose.distance).toBeLessThan(overview.distance);

    // Clamping prevents orbiting behind solid walls or zooming through the floor
    const clamped = clampDioramaPose(
      {
        targetX: 999,
        targetY: -5,
        targetZ: -999,
        orbitYawOffset: 5,
        elevation: 0.01,
        distance: 0.5,
      },
      bounds,
      limits
    );
    expect(clamped.orbitYawOffset).toBe(limits.maxOrbitOffset);
    expect(clamped.elevation).toBe(limits.minElevation);
    expect(clamped.distance).toBe(limits.minDistance);
    expect(clamped.targetX).toBeLessThan(bounds.maxX);
    expect(clamped.targetZ).toBeGreaterThan(bounds.minZ);
  });

  it("detects themed world archetypes and generates merged stage architecture", () => {
    const { brandCore, worldSpec } = loadDemoFixtures();
    const bounds = computeRoomBounds(worldSpec);
    const palette = extractBrandPalette(brandCore);

    // Kestrel & Clay is a ceramic gallery studio
    expect(detectWorldArchetype(brandCore, worldSpec)).toBe("gallery");

    // Ocean / coastal brand
    const oceanCore: BrandCore = {
      ...brandCore,
      positioning: "Pacific ocean tide logs and coastal pier photography",
      visual: { ...brandCore.visual, lighting_mood: "Misty Pacific dawn" },
    };
    const oceanTheme = buildWorldThemeAtmosphere(oceanCore, palette);
    expect(oceanTheme.archetype).toBe("coastal");
    expect(oceanTheme.waterShimmer).toBe(true);
    expect(
      buildStageArchitectureParts("coastal", bounds, "minZ", oceanTheme.deckElevationM).length
    ).toBeGreaterThan(10);
    expect(buildStageAccentLightParts("coastal", bounds, "minZ").length).toBeGreaterThan(0);

    // Aviation / airport brand
    const aviationCore: BrandCore = {
      ...brandCore,
      positioning: "Departure terminal luggage built for frequent flyers and runway views",
    };
    const aviationTheme = buildWorldThemeAtmosphere(aviationCore, palette);
    expect(aviationTheme.archetype).toBe("aviation");
    expect(aviationTheme.waterShimmer).toBe(false);
    expect(
      buildStageArchitectureParts("aviation", bounds, "minZ", aviationTheme.deckElevationM).length
    ).toBeGreaterThan(8);
  });
});
