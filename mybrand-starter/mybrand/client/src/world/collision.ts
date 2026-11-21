import type { WorldSpec } from "@mybrand/shared";
import {
  getFixtureDimensions,
  type RoomBounds,
} from "./roomLayout";

export interface BoxCollider2D {
  id: string;
  cx: number;
  cz: number;
  halfW: number;
  halfD: number;
  rotationRad: number;
}

export interface MovementResolution {
  x: number;
  z: number;
  collided: boolean;
}

const HERO_PLINTH_HALF_EXTENT = 0.48;

export function buildColliders(worldSpec: WorldSpec): BoxCollider2D[] {
  const colliders: BoxCollider2D[] = [
    {
      id: "hero_plinth",
      cx: worldSpec.hero_plinth.position[0],
      cz: worldSpec.hero_plinth.position[1],
      halfW: HERO_PLINTH_HALF_EXTENT,
      halfD: HERO_PLINTH_HALF_EXTENT,
      rotationRad: 0,
    },
  ];

  for (const zone of worldSpec.zones) {
    for (const fixture of zone.fixtures) {
      const dims = getFixtureDimensions(fixture.type);
      // Wall-mounted frames and elevated screens should not block floor walking
      if (dims.isWallMounted && fixture.position[1] >= 1.0) {
        continue;
      }

      colliders.push({
        id: fixture.id,
        cx: fixture.position[0],
        cz: fixture.position[2],
        halfW: dims.width / 2,
        halfD: dims.depth / 2,
        rotationRad: (fixture.rotation_deg * Math.PI) / 180,
      });
    }
  }

  return colliders;
}

function resolveCircleVsObb(
  px: number,
  pz: number,
  radius: number,
  box: BoxCollider2D
): { x: number; z: number; hit: boolean } {
  const dx = px - box.cx;
  const dz = pz - box.cz;

  const cos = Math.cos(box.rotationRad);
  const sin = Math.sin(box.rotationRad);

  // Inverse of Three.js Y-rotation (x' = x*cos + z*sin, z' = -x*sin + z*cos):
  // lx = dx * cos - dz * sin
  // lz = dx * sin + dz * cos
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;

  const clampedX = Math.max(-box.halfW, Math.min(box.halfW, lx));
  const clampedZ = Math.max(-box.halfD, Math.min(box.halfD, lz));

  const diffX = lx - clampedX;
  const diffZ = lz - clampedZ;
  const distSq = diffX * diffX + diffZ * diffZ;

  if (distSq >= radius * radius) {
    return { x: px, z: pz, hit: false };
  }

  let pushedLx = lx;
  let pushedLz = lz;

  if (distSq > 1e-8) {
    const dist = Math.sqrt(distSq);
    const overlap = radius - dist;
    pushedLx = lx + (diffX / dist) * overlap;
    pushedLz = lz + (diffZ / dist) * overlap;
  } else {
    // Center is inside the box; push out along the nearest face
    const penX = box.halfW - Math.abs(lx) + radius;
    const penZ = box.halfD - Math.abs(lz) + radius;
    if (penX < penZ) {
      pushedLx = lx >= 0 ? box.halfW + radius : -(box.halfW + radius);
    } else {
      pushedLz = lz >= 0 ? box.halfD + radius : -(box.halfD + radius);
    }
  }

  // Rotate back to world XZ
  const worldX = box.cx + pushedLx * cos + pushedLz * sin;
  const worldZ = box.cz - pushedLx * sin + pushedLz * cos;

  return { x: worldX, z: worldZ, hit: true };
}

export function resolvePlayerMovement(
  desiredX: number,
  desiredZ: number,
  radius: number,
  bounds: RoomBounds,
  colliders: readonly BoxCollider2D[]
): MovementResolution {
  let x = desiredX;
  let z = desiredZ;
  let collided = false;

  const minX = bounds.minX + radius;
  const maxX = bounds.maxX - radius;
  const minZ = bounds.minZ + radius;
  const maxZ = bounds.maxZ - radius;

  // Two iterations resolve corner overlaps cleanly and allow smooth sliding along walls/fixtures
  for (let iteration = 0; iteration < 2; iteration++) {
    for (const box of colliders) {
      const result = resolveCircleVsObb(x, z, radius, box);
      if (result.hit) {
        x = result.x;
        z = result.z;
        collided = true;
      }
    }

    const clampedX = Math.max(minX, Math.min(maxX, x));
    const clampedZ = Math.max(minZ, Math.min(maxZ, z));
    if (clampedX !== x || clampedZ !== z) {
      x = clampedX;
      z = clampedZ;
      collided = true;
    }
  }

  return { x, z, collided };
}
