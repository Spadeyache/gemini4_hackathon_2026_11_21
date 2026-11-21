import fs from "node:fs";
import path from "node:path";
import { WorldSpecSchema, type WorldSpec } from "@mybrand/shared";
import { describe, expect, it } from "vitest";
import { buildColliders, resolvePlayerMovement } from "../world/collision";
import { computeRoomBounds, PLAYER_RADIUS_M } from "../world/roomLayout";

function loadDemoWorldSpec(): WorldSpec {
  const fixturePath = path.resolve(
    process.cwd(),
    "fixtures/demo-brand/world_spec.json"
  );
  const raw = JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as unknown;
  return WorldSpecSchema.parse(raw);
}

describe("collision solver", () => {
  const worldSpec = loadDemoWorldSpec();
  const bounds = computeRoomBounds(worldSpec);
  const colliders = buildColliders(worldSpec);

  it("includes hero_plinth and floor fixtures while skipping high wall-mounted fixtures", () => {
    const ids = colliders.map((c) => c.id);
    expect(ids).toContain("hero_plinth");
    expect(ids).toContain("f_kiln_shelf");
    expect(ids).toContain("f_table_display");
    expect(ids).toContain("f_gallery_case");
    expect(ids).toContain("f_gallery_plinth");
    expect(ids).not.toContain("f_kiln_poster");
    expect(ids).not.toContain("f_table_screen");
  });

  it("prevents walking through all four room walls", () => {
    const left = resolvePlayerMovement(-20, 4, PLAYER_RADIUS_M, bounds, colliders);
    expect(left.collided).toBe(true);
    expect(left.x).toBeCloseTo(bounds.minX + PLAYER_RADIUS_M, 5);

    const right = resolvePlayerMovement(20, 4, PLAYER_RADIUS_M, bounds, colliders);
    expect(right.collided).toBe(true);
    expect(right.x).toBeCloseTo(bounds.maxX - PLAYER_RADIUS_M, 5);

    const front = resolvePlayerMovement(0, -5, PLAYER_RADIUS_M, bounds, colliders);
    expect(front.collided).toBe(true);
    expect(front.z).toBeCloseTo(bounds.minZ + PLAYER_RADIUS_M, 5);

    const back = resolvePlayerMovement(0, 25, PLAYER_RADIUS_M, bounds, colliders);
    expect(back.collided).toBe(true);
    expect(back.z).toBeCloseTo(bounds.maxZ - PLAYER_RADIUS_M, 5);
  });

  it("blocks walking into the hero plinth and pushes player cleanly outside", () => {
    const res = resolvePlayerMovement(0, 3.05, PLAYER_RADIUS_M, bounds, colliders);
    expect(res.collided).toBe(true);
    // Hero plinth center is (0, 3), half extent 0.48 + player radius 0.42 = 0.90
    const distFromHero = Math.hypot(res.x - 0, res.z - 3);
    expect(distFromHero).toBeGreaterThanOrEqual(0.89);
  });

  it("blocks walking into rotated fixtures like f_gallery_plinth (225 deg) and f_table_display", () => {
    const tableHit = resolvePlayerMovement(0, 9.2, PLAYER_RADIUS_M, bounds, colliders);
    expect(tableHit.collided).toBe(true);
    expect(Math.abs(tableHit.z - 9.2)).toBeGreaterThan(0.5);

    const rotatedHit = resolvePlayerMovement(5.2, 7.4, PLAYER_RADIUS_M, bounds, colliders);
    expect(rotatedHit.collided).toBe(true);
    const distFromPlinth = Math.hypot(rotatedHit.x - 5.2, rotatedHit.z - 7.4);
    expect(distFromPlinth).toBeGreaterThan(0.75);
  });

  it("allows unobstructed movement in open floor corridors", () => {
    const free = resolvePlayerMovement(-2.0, 2.2, PLAYER_RADIUS_M, bounds, colliders);
    expect(free.collided).toBe(false);
    expect(free.x).toBeCloseTo(-2.0, 5);
    expect(free.z).toBeCloseTo(2.2, 5);
  });
});
