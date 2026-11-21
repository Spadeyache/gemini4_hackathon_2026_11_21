import fs from "node:fs";
import path from "node:path";
import { FixtureTypeSchema, WorldSpecSchema, type WorldSpec } from "@mybrand/shared";
import { describe, expect, it } from "vitest";
import { kelvinToHex, kelvinToRgb, resolveLightingPreset } from "../world/lightingUtils";
import {
  buildGuidePathPoints,
  computeInitialSpawn,
  computeRoomBounds,
  findZoneAtPosition,
  getFixtureDimensions,
  getFixtureSlotLocalPositions,
  localToWorldPoint,
} from "../world/roomLayout";

function loadDemoWorldSpec(): WorldSpec {
  const fixturePath = path.resolve(
    process.cwd(),
    "fixtures/demo-brand/world_spec.json"
  );
  return WorldSpecSchema.parse(JSON.parse(fs.readFileSync(fixturePath, "utf-8")));
}

describe("roomLayout & lightingUtils", () => {
  const worldSpec = loadDemoWorldSpec();
  const bounds = computeRoomBounds(worldSpec);

  it("derives exact 16x12x4 room bounds for demo-brand", () => {
    expect(bounds.minX).toBe(-8);
    expect(bounds.maxX).toBe(8);
    expect(bounds.minZ).toBe(0);
    expect(bounds.maxZ).toBe(12);
    expect(bounds.height).toBe(4);
  });

  it("spawns player inside entrance wall facing the hero plinth along +Z", () => {
    const spawn = computeInitialSpawn(worldSpec, bounds);
    expect(spawn.position[0]).toBeCloseTo(0, 5);
    expect(spawn.position[1]).toBeCloseTo(1.6, 5);
    expect(spawn.position[2]).toBeGreaterThan(0.5);
    expect(spawn.position[2]).toBeLessThan(2.0);
    // Forward direction (-sin(yaw), -cos(yaw)) should point toward +Z (0, 1)
    expect(-Math.sin(spawn.yaw)).toBeCloseTo(0, 5);
    expect(-Math.cos(spawn.yaw)).toBeCloseTo(1, 5);
  });

  it("detects zones accurately and returns null in entrance corridor", () => {
    expect(findZoneAtPosition(worldSpec.zones, 0, 1.5)).toBeNull();
    expect(findZoneAtPosition(worldSpec.zones, -5, 6)?.id).toBe("zone_kiln");
    expect(findZoneAtPosition(worldSpec.zones, 0, 9)?.id).toBe("zone_table");
    expect(findZoneAtPosition(worldSpec.zones, 5, 6)?.id).toBe("zone_gallery");
  });

  it("supports dimensions and slot layouts for all 7 §5 fixture types", () => {
    for (const type of FixtureTypeSchema.options) {
      const dims = getFixtureDimensions(type);
      expect(dims.width).toBeGreaterThan(0);
      expect(dims.height).toBeGreaterThan(0);
      expect(dims.depth).toBeGreaterThan(0);

      const twoSlots = getFixtureSlotLocalPositions(type, 2);
      expect(twoSlots).toHaveLength(2);
      expect(twoSlots[0][0]).toBeLessThan(twoSlots[1][0]);
    }
  });

  it("rotates fixture local coordinates into world space accurately", () => {
    // Rotating local +Z (0, 1, 1) by +90 deg around Y lands on +X
    const worldPt = localToWorldPoint(
      { position: [-7.2, 0, 6], rotation_deg: 90 },
      [0, 1.1, 1]
    );
    expect(worldPt[0]).toBeCloseTo(-6.2, 5);
    expect(worldPt[1]).toBeCloseTo(1.1, 5);
    expect(worldPt[2]).toBeCloseTo(6.0, 5);
  });

  it("builds a smooth guide path ending at the target zone center", () => {
    const pts = buildGuidePathPoints(worldSpec, "zone_gallery");
    expect(pts.length).toBeGreaterThanOrEqual(4);
    const last = pts[pts.length - 1];
    expect(last[0]).toBeCloseTo(5, 5);
    expect(last[2]).toBeCloseTo(6, 5);
  });

  it("converts Kelvin color temperatures cleanly (warm < daylight blue channel)", () => {
    const warm = kelvinToRgb(2700);
    const daylight = kelvinToRgb(4600);
    expect(warm.r).toBeGreaterThan(warm.b);
    expect(daylight.b).toBeGreaterThan(warm.b);
    expect(kelvinToHex(3000)).toMatch(/^#[0-9a-f]{6}$/);
    expect(resolveLightingPreset(worldSpec, "gallery_spot").spot).toBe(true);
  });
});
