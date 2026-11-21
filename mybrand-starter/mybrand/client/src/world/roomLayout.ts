import type { Fixture, FixtureType, WorldSpec, Zone } from "@mybrand/shared";

export interface RoomBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  width: number;
  depth: number;
  height: number;
  centerX: number;
  centerZ: number;
}

export type OpenWallSide = "minZ" | "maxZ" | "minX" | "maxX";

export interface SpawnTransform {
  position: [number, number, number];
  yaw: number;
}

export interface FixtureDimensions {
  width: number;
  height: number;
  depth: number;
  isWallMounted: boolean;
  slotSurfaceY: number;
}

export const EYE_HEIGHT_M = 1.6;
export const PLAYER_RADIUS_M = 0.42;

const FIXTURE_DIMENSIONS: Record<FixtureType, FixtureDimensions> = {
  plinth: {
    width: 0.78,
    height: 1.0,
    depth: 0.78,
    isWallMounted: false,
    slotSurfaceY: 1.02,
  },
  rack: {
    width: 1.65,
    height: 1.6,
    depth: 0.56,
    isWallMounted: false,
    slotSurfaceY: 1.05,
  },
  wall_shelf: {
    width: 2.1,
    height: 1.55,
    depth: 0.48,
    isWallMounted: false,
    slotSurfaceY: 1.12,
  },
  table: {
    width: 2.2,
    height: 0.85,
    depth: 1.0,
    isWallMounted: false,
    slotSurfaceY: 0.87,
  },
  display_case: {
    width: 1.35,
    height: 1.55,
    depth: 0.72,
    isWallMounted: false,
    slotSurfaceY: 0.9,
  },
  poster_frame: {
    width: 1.25,
    height: 1.55,
    depth: 0.08,
    isWallMounted: true,
    slotSurfaceY: 0,
  },
  screen: {
    width: 1.9,
    height: 1.08,
    depth: 0.09,
    isWallMounted: true,
    slotSurfaceY: 0,
  },
};

export function getFixtureDimensions(type: FixtureType): FixtureDimensions {
  return FIXTURE_DIMENSIONS[type];
}

export function computeRoomBounds(worldSpec: WorldSpec): RoomBounds {
  const [nominalWidth, nominalDepth, height] = worldSpec.room.size_m;

  // Inspect actual world coordinates so we handle both centered ([-w/2, w/2]) and
  // positive-only ([0, w]) conventions on X and Z, plus minor model coordinate overflow.
  let minObservedX = Math.min(
    worldSpec.entrance.position[0],
    worldSpec.hero_plinth.position[0]
  );
  let maxObservedX = Math.max(
    worldSpec.entrance.position[0],
    worldSpec.hero_plinth.position[0]
  );
  let minObservedZ = Math.min(
    worldSpec.entrance.position[1],
    worldSpec.hero_plinth.position[1]
  );
  let maxObservedZ = Math.max(
    worldSpec.entrance.position[1],
    worldSpec.hero_plinth.position[1]
  );

  let hasNegativeZoneEdgeZ = false;
  let hasNegativeFixtureZ = false;

  for (const zone of worldSpec.zones) {
    const zMinX = zone.center[0] - zone.size[0] / 2;
    const zMaxX = zone.center[0] + zone.size[0] / 2;
    const zMinZ = zone.center[1] - zone.size[1] / 2;
    const zMaxZ = zone.center[1] + zone.size[1] / 2;

    minObservedX = Math.min(minObservedX, zMinX);
    maxObservedX = Math.max(maxObservedX, zMaxX);
    minObservedZ = Math.min(minObservedZ, zMinZ);
    maxObservedZ = Math.max(maxObservedZ, zMaxZ);

    if (zMinZ < -0.5) {
      hasNegativeZoneEdgeZ = true;
    }

    for (const fixture of zone.fixtures) {
      minObservedX = Math.min(minObservedX, fixture.position[0]);
      maxObservedX = Math.max(maxObservedX, fixture.position[0]);
      minObservedZ = Math.min(minObservedZ, fixture.position[2]);
      maxObservedZ = Math.max(maxObservedZ, fixture.position[2]);
      if (fixture.position[2] < -0.01) {
        hasNegativeFixtureZ = true;
      }
    }
  }

  // X convention: centered [-w/2, w/2] by default; shift to [0, w] if all coords are non-negative and exceed +w/2
  const usesPositiveX =
    minObservedX >= -0.01 && maxObservedX > nominalWidth / 2 + 0.25;
  let minX = usesPositiveX ? 0 : -nominalWidth / 2;
  let maxX = usesPositiveX ? nominalWidth : nominalWidth / 2;

  // Z convention: §5 default [0, d]; shift to [-d/2, d/2] if coordinates go negative
  const hasNegativeZ =
    worldSpec.entrance.position[1] < -0.01 ||
    worldSpec.hero_plinth.position[1] < -0.01 ||
    hasNegativeZoneEdgeZ ||
    hasNegativeFixtureZ;
  let minZ = hasNegativeZ ? -nominalDepth / 2 : 0;
  let maxZ = hasNegativeZ ? nominalDepth / 2 : nominalDepth;

  // Gently expand walls if an AI-generated zone or fixture spills past nominal room.size_m
  const pad = 0.6;
  if (minObservedX < minX - 0.15) minX = Math.floor((minObservedX - pad) * 2) / 2;
  if (maxObservedX > maxX + 0.15) maxX = Math.ceil((maxObservedX + pad) * 2) / 2;
  if (minObservedZ < minZ - 0.15) minZ = Math.floor((minObservedZ - pad) * 2) / 2;
  if (maxObservedZ > maxZ + 0.15) maxZ = Math.ceil((maxObservedZ + pad) * 2) / 2;

  const width = maxX - minX;
  const depth = maxZ - minZ;

  return {
    minX,
    maxX,
    minZ,
    maxZ,
    width,
    depth,
    height,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
  };
}

/**
 * Determines which room wall is nearest to the entrance so 2.5D diorama mode
 * opens the front cutaway wall cleanly toward the entrance side.
 */
export function detectOpenFrontWall(
  worldSpec: WorldSpec,
  bounds: RoomBounds
): OpenWallSide {
  const [ex, ez] = worldSpec.entrance.position;
  const distances: Array<{ side: OpenWallSide; dist: number }> = [
    { side: "minZ", dist: Math.abs(ez - bounds.minZ) },
    { side: "maxZ", dist: Math.abs(bounds.maxZ - ez) },
    { side: "minX", dist: Math.abs(ex - bounds.minX) },
    { side: "maxX", dist: Math.abs(bounds.maxX - ex) },
  ];
  distances.sort((a, b) => a.dist - b.dist);
  return distances[0].side;
}

export function computeInitialSpawn(
  worldSpec: WorldSpec,
  bounds: RoomBounds
): SpawnTransform {
  const margin = PLAYER_RADIUS_M + 0.35;
  const rawX = worldSpec.entrance.position[0];
  const rawZ = worldSpec.entrance.position[1];

  const x = Math.min(bounds.maxX - margin, Math.max(bounds.minX + margin, rawX));
  const z = Math.min(bounds.maxZ - margin, Math.max(bounds.minZ + margin, rawZ));

  const dx = worldSpec.hero_plinth.position[0] - x;
  const dz = worldSpec.hero_plinth.position[1] - z;
  // Camera default forward is -Z; rotating by yaw around Y yields (-sin(yaw), -cos(yaw)).
  const yaw =
    Math.abs(dx) < 1e-4 && Math.abs(dz) < 1e-4
      ? Math.PI
      : Math.atan2(-dx, -dz);

  return {
    position: [x, EYE_HEIGHT_M, z],
    yaw,
  };
}

export function isPointInZone(zone: Zone, x: number, z: number): boolean {
  const halfW = zone.size[0] / 2;
  const halfD = zone.size[1] / 2;
  return (
    x >= zone.center[0] - halfW &&
    x <= zone.center[0] + halfW &&
    z >= zone.center[1] - halfD &&
    z <= zone.center[1] + halfD
  );
}

export function findZoneAtPosition(
  zones: readonly Zone[],
  x: number,
  z: number
): Zone | null {
  for (const zone of zones) {
    if (isPointInZone(zone, x, z)) {
      return zone;
    }
  }
  return null;
}

export function getFixtureSlotLocalPositions(
  type: FixtureType,
  slotCount: number
): Array<[number, number, number]> {
  if (slotCount <= 0) return [];
  const dims = getFixtureDimensions(type);
  const y = dims.slotSurfaceY;

  if (slotCount === 1) {
    return [[0, y, 0]];
  }

  const usableWidth = Math.max(0.4, dims.width - 0.52);
  const step = usableWidth / (slotCount - 1);
  const startX = -usableWidth / 2;
  const zOffset = type === "wall_shelf" ? 0.04 : 0;

  return Array.from({ length: slotCount }, (_, index) => [
    startX + index * step,
    y,
    zOffset,
  ]);
}

export function localToWorldPoint(
  fixture: Pick<Fixture, "position" | "rotation_deg">,
  localOffset: [number, number, number]
): [number, number, number] {
  const rad = (fixture.rotation_deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const [lx, ly, lz] = localOffset;

  // Standard Three.js right-handed rotation around +Y:
  // x' = x * cos + z * sin
  // z' = -x * sin + z * cos
  const wx = fixture.position[0] + lx * cos + lz * sin;
  const wy = fixture.position[1] + ly;
  const wz = fixture.position[2] - lx * sin + lz * cos;

  return [wx, wy, wz];
}

export function buildGuidePathPoints(
  worldSpec: WorldSpec,
  targetZoneId: string
): Array<[number, number, number]> {
  const targetZone =
    worldSpec.zones.find((z) => z.id === targetZoneId) ?? worldSpec.zones[0];
  if (!targetZone) return [];

  const bounds = computeRoomBounds(worldSpec);
  const [ex, ez] = worldSpec.entrance.position;
  const [heroX, heroZ] = worldSpec.hero_plinth.position;
  const [endX, endZ] = targetZone.center;

  // Step 0.65m inward from entrance toward the hero plinth (clamped inside room bounds)
  const toHeroX = heroX - ex;
  const toHeroZ = heroZ - ez;
  const toHeroLen = Math.hypot(toHeroX, toHeroZ);
  const dirX = toHeroLen > 1e-4 ? toHeroX / toHeroLen : 0;
  const dirZ = toHeroLen > 1e-4 ? toHeroZ / toHeroLen : 1;

  const clampX = (v: number) =>
    Math.min(bounds.maxX - 0.65, Math.max(bounds.minX + 0.65, v));
  const clampZ = (v: number) =>
    Math.min(bounds.maxZ - 0.65, Math.max(bounds.minZ + 0.65, v));

  const startX = clampX(ex + dirX * 0.65);
  const startZ = clampZ(ez + dirZ * 0.65);

  // Perpendicular right vector relative to entrance -> hero axis to arc smoothly around hero plinth
  const perpX = dirZ;
  const perpZ = -dirX;
  const toEndRelPerp = (endX - heroX) * perpX + (endZ - heroZ) * perpZ;
  const sideSign = toEndRelPerp < -0.35 ? -1 : 1;

  const preBypassX = clampX(heroX - dirX * 0.95 + perpX * sideSign * 0.95);
  const preBypassZ = clampZ(heroZ - dirZ * 0.95 + perpZ * sideSign * 0.95);
  const bypassX = clampX(heroX + dirX * 0.4 + perpX * sideSign * 1.45);
  const bypassZ = clampZ(heroZ + dirZ * 0.4 + perpZ * sideSign * 1.45);

  const approachX = clampX(bypassX * 0.4 + endX * 0.6);
  const approachZ = clampZ(bypassZ * 0.4 + endZ * 0.6);

  return [
    [startX, 0.025, startZ],
    [preBypassX, 0.025, preBypassZ],
    [bypassX, 0.025, bypassZ],
    [approachX, 0.025, approachZ],
    [endX, 0.025, endZ],
  ];
}
