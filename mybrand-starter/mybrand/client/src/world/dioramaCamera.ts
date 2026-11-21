import type { WorldSpec, Zone } from "@mybrand/shared";
import {
  detectOpenFrontWall,
  type OpenWallSide,
  type RoomBounds,
} from "./roomLayout";

export interface DioramaCameraPose {
  targetX: number;
  targetY: number;
  targetZ: number;
  /** Offset angle in radians relative to the open-front outward normal */
  orbitYawOffset: number;
  /** Pitch elevation above the floor plane in radians */
  elevation: number;
  /** Distance from target along the viewing ray */
  distance: number;
}

export interface DioramaCameraLimits {
  baseOutwardAngle: number;
  minOrbitOffset: number;
  maxOrbitOffset: number;
  minElevation: number;
  maxElevation: number;
  minDistance: number;
  maxDistance: number;
}

export const DIORAMA_DEFAULT_ELEVATION = 0.34; // ~19.5 deg cinematic 2.5D vantage looking across deck into horizon
export const DIORAMA_MIN_ELEVATION = 0.16; // ~9 deg low scenic vista
export const DIORAMA_MAX_ELEVATION = 1.05; // ~60 deg overhead plan
export const DIORAMA_MAX_ORBIT_OFFSET = 0.86; // ±49 deg around open front so horizon stays framed

/**
 * Angle in the XZ plane pointing from the room center OUT through the open cutaway wall.
 * (offsetX = sin(angle), offsetZ = cos(angle))
 */
export function getOpenWallOutwardAngle(openWall: OpenWallSide): number {
  switch (openWall) {
    case "minZ":
      return Math.PI; // (0, -1): camera stands on -Z side looking toward +Z
    case "maxZ":
      return 0; // (0, +1): camera stands on +Z side looking toward -Z
    case "minX":
      return -Math.PI / 2; // (-1, 0): camera stands on -X side looking toward +X
    case "maxX":
      return Math.PI / 2; // (+1, 0): camera stands on +X side looking toward -X
  }
}

export function computeDioramaLimits(
  worldSpec: WorldSpec,
  bounds: RoomBounds
): DioramaCameraLimits {
  const openWall = detectOpenFrontWall(worldSpec, bounds);
  const span = Math.max(bounds.width, bounds.depth);
  return {
    baseOutwardAngle: getOpenWallOutwardAngle(openWall),
    minOrbitOffset: -DIORAMA_MAX_ORBIT_OFFSET,
    maxOrbitOffset: DIORAMA_MAX_ORBIT_OFFSET,
    minElevation: DIORAMA_MIN_ELEVATION,
    maxElevation: DIORAMA_MAX_ELEVATION,
    minDistance: 3.8,
    maxDistance: Math.max(16, span * 1.45),
  };
}

export function computeDioramaOverview(
  worldSpec: WorldSpec,
  bounds: RoomBounds
): DioramaCameraPose {
  const span = Math.max(bounds.width, bounds.depth);
  // Intimate 2.5D framing: panoramic horizon fills upper frame while every zone & product stays clickable
  const distance = Math.max(9.4, span * 0.78);

  return {
    targetX: bounds.centerX,
    targetY: 1.35,
    targetZ: bounds.centerZ,
    orbitYawOffset: 0.1, // subtle architectural 3/4 perspective
    elevation: DIORAMA_DEFAULT_ELEVATION,
    distance,
  };
}

export function computeDioramaZoneFocus(
  zone: Zone,
  bounds: RoomBounds
): DioramaCameraPose {
  const zoneSpan = Math.max(zone.size[0], zone.size[1]);
  const distance = Math.max(4.6, Math.min(8.4, zoneSpan * 1.18));

  // Slightly angle camera from room center toward the focused zone for natural depth
  const dx = zone.center[0] - bounds.centerX;
  const subtleOffset = Math.max(-0.32, Math.min(0.32, -dx * 0.04));

  return {
    targetX: zone.center[0],
    targetY: 1.15,
    targetZ: zone.center[1],
    orbitYawOffset: subtleOffset,
    elevation: 0.3, // cinematic low-angle focus keeping horizon behind the zone
    distance,
  };
}

export function clampDioramaPose(
  pose: DioramaCameraPose,
  bounds: RoomBounds,
  limits: DioramaCameraLimits
): DioramaCameraPose {
  const marginX = Math.min(0.8, bounds.width * 0.12);
  const marginZ = Math.min(0.8, bounds.depth * 0.12);

  return {
    targetX: Math.max(
      bounds.minX + marginX,
      Math.min(bounds.maxX - marginX, pose.targetX)
    ),
    targetY: Math.max(0.4, Math.min(2.2, pose.targetY)),
    targetZ: Math.max(
      bounds.minZ + marginZ,
      Math.min(bounds.maxZ - marginZ, pose.targetZ)
    ),
    orbitYawOffset: Math.max(
      limits.minOrbitOffset,
      Math.min(limits.maxOrbitOffset, pose.orbitYawOffset)
    ),
    elevation: Math.max(
      limits.minElevation,
      Math.min(limits.maxElevation, pose.elevation)
    ),
    distance: Math.max(
      limits.minDistance,
      Math.min(limits.maxDistance, pose.distance)
    ),
  };
}

export function dioramaPoseToCameraPosition(
  pose: DioramaCameraPose,
  limits: DioramaCameraLimits
): [number, number, number] {
  const angle = limits.baseOutwardAngle + pose.orbitYawOffset;
  const horiz = pose.distance * Math.cos(pose.elevation);
  const vert = pose.distance * Math.sin(pose.elevation);

  return [
    pose.targetX + Math.sin(angle) * horiz,
    pose.targetY + vert,
    pose.targetZ + Math.cos(angle) * horiz,
  ];
}
