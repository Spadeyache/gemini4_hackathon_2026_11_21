import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, RoundedBox } from '@react-three/drei';
import type { GarmentAssetSet, StoreConfig, StorePalette } from '../../types/storeConfig';

export type PlayerPovMode = 'third_person' | 'first_person';

export interface RobloxPlayerControllerProps {
  /** Active store configuration providing palette, racks, and garment metadata */
  config: StoreConfig;
  /** Whether the walkable controller is active (defaults to true) */
  enabled?: boolean;
  /** Optional spawn coordinates [x, y, z] (defaults to [0, 0, 3.05] facing the hero rack) */
  initialPosition?: [number, number, number];
  /** Optional initial yaw in radians (0 = looking toward -Z hero stand) */
  initialYaw?: number;
  /** Optional controlled POV mode; also toggleable anytime with [V] */
  povMode?: PlayerPovMode;
  /** Optional callback fired when POV mode toggles */
  onPovModeChange?: (mode: PlayerPovMode) => void;
  /** Fired when the player presses [E] (or clicks the floating prompt) within 1.55m of a garment */
  onInteractGarment?: (garmentId: string, garment: GarmentAssetSet) => void;
  /** Optional flag matching App layout (defaults to true so all racks in config.racks are active) */
  showSecondaryRack?: boolean;
  /** Optional callback broadcasting live player world position for external HUD/minimap/NPCs */
  onPlayerMove?: (position: [number, number, number], yaw: number) => void;
}

export interface RobloxControlsHintProps {
  povMode?: PlayerPovMode;
  onTogglePov?: () => void;
  nearbyGarmentTitle?: string | null;
  style?: React.CSSProperties;
}

interface ObstacleBox2D {
  id: string;
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  rotY: number;
}

interface WorldGarmentTarget {
  id: string;
  rackId: string;
  rackLabel: string;
  asset: GarmentAssetSet;
  worldX: number;
  worldY: number;
  worldZ: number;
}

// Boutique room collision & camera safety constants calibrated to BoutiqueWorld.tsx
const ROOM_PLAYER_BOUNDS = {
  minX: -4.35,
  maxX: 4.35,
  minZ: -1.45,
  maxZ: 7.1,
};

const ROOM_CAMERA_SAFE_BOUNDS = {
  minX: -4.52,
  maxX: 4.52,
  minY: 0.28,
  maxY: 4.25,
  minZ: -1.68,
  maxZ: 7.52,
};

const PLAYER_RADIUS = 0.27;
const WALK_SPEED = 3.1;
const SPRINT_SPEED = 5.0;
const JUMP_VELOCITY = 5.2;
const GRAVITY = -14.5;
const INTERACT_RADIUS = 1.55;

const THIRD_PERSON_DISTANCE = 2.6;
const THIRD_PERSON_PIVOT_HEIGHT = 1.28; // With default pitch ~0.145 rad, camera height sits right around ~1.65m
const THIRD_PERSON_SHOULDER_OFFSET = 0.16;
const FIRST_PERSON_EYE_HEIGHT = 1.44;

function isEditableElementActive(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(el.isContentEditable);
}

function lerpAngleShortest(current: number, target: number, alpha: number): number {
  let delta = (target - current + Math.PI) % (Math.PI * 2);
  if (delta < 0) delta += Math.PI * 2;
  delta -= Math.PI;
  return current + delta * alpha;
}

function shiftColorHex(hex: string, lightnessDelta: number): string {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, lightnessDelta);
  return `#${c.getHexString()}`;
}

/**
 * Smooth 2D Circle-vs-Oriented-Bounding-Box (OBB) collision resolver on XZ plane.
 * Allows sliding cleanly along angled racks, plinths, pedestals, and benches.
 */
function resolveCircleObb2D(
  px: number,
  pz: number,
  radius: number,
  box: ObstacleBox2D
): [number, number] {
  const dx = px - box.cx;
  const dz = pz - box.cz;
  const cosR = Math.cos(box.rotY);
  const sinR = Math.sin(box.rotY);

  // Transform world delta into box local coordinates (inverse of Three.js Y rotation)
  let lx = dx * cosR - dz * sinR;
  let lz = dx * sinR + dz * cosR;

  const clampedX = Math.max(-box.hx, Math.min(box.hx, lx));
  const clampedZ = Math.max(-box.hz, Math.min(box.hz, lz));

  const nx = lx - clampedX;
  const nz = lz - clampedZ;
  const distSq = nx * nx + nz * nz;

  if (distSq >= radius * radius) {
    return [px, pz];
  }

  if (distSq > 1e-8) {
    const dist = Math.sqrt(distSq);
    const push = radius - dist;
    lx += (nx / dist) * push;
    lz += (nz / dist) * push;
  } else {
    // Player center is inside OBB: push out along shallowest penetration axis
    const penX = box.hx - Math.abs(lx);
    const penZ = box.hz - Math.abs(lz);
    if (penX < penZ) {
      lx = (lx >= 0 ? 1 : -1) * (box.hx + radius);
    } else {
      lz = (lz >= 0 ? 1 : -1) * (box.hz + radius);
    }
  }

  // Transform back to world coordinates
  const wx = box.cx + lx * cosR + lz * sinR;
  const wz = box.cz - lx * sinR + lz * cosR;
  return [wx, wz];
}

/**
 * Ray-clamps the 3rd-person camera along the pivot -> desiredCam segment
 * so the camera pulls forward cleanly (Roblox PopperCam style) instead of clipping outside walls.
 */
function clampCameraAlongSpringArm(
  pivot: THREE.Vector3,
  desired: THREE.Vector3,
  out: THREE.Vector3
): THREE.Vector3 {
  const dirX = desired.x - pivot.x;
  const dirY = desired.y - pivot.y;
  const dirZ = desired.z - pivot.z;

  let maxT = 1.0;

  if (dirX < -1e-5 && desired.x < ROOM_CAMERA_SAFE_BOUNDS.minX) {
    maxT = Math.min(maxT, (ROOM_CAMERA_SAFE_BOUNDS.minX - pivot.x) / dirX);
  } else if (dirX > 1e-5 && desired.x > ROOM_CAMERA_SAFE_BOUNDS.maxX) {
    maxT = Math.min(maxT, (ROOM_CAMERA_SAFE_BOUNDS.maxX - pivot.x) / dirX);
  }

  if (dirZ < -1e-5 && desired.z < ROOM_CAMERA_SAFE_BOUNDS.minZ) {
    maxT = Math.min(maxT, (ROOM_CAMERA_SAFE_BOUNDS.minZ - pivot.z) / dirZ);
  } else if (dirZ > 1e-5 && desired.z > ROOM_CAMERA_SAFE_BOUNDS.maxZ) {
    maxT = Math.min(maxT, (ROOM_CAMERA_SAFE_BOUNDS.maxZ - pivot.z) / dirZ);
  }

  if (dirY < -1e-5 && desired.y < ROOM_CAMERA_SAFE_BOUNDS.minY) {
    maxT = Math.min(maxT, (ROOM_CAMERA_SAFE_BOUNDS.minY - pivot.y) / dirY);
  } else if (dirY > 1e-5 && desired.y > ROOM_CAMERA_SAFE_BOUNDS.maxY) {
    maxT = Math.min(maxT, (ROOM_CAMERA_SAFE_BOUNDS.maxY - pivot.y) / dirY);
  }

  const safeT = Math.max(0.14, Math.min(1.0, maxT));
  out.set(
    THREE.MathUtils.clamp(
      pivot.x + dirX * safeT,
      ROOM_CAMERA_SAFE_BOUNDS.minX,
      ROOM_CAMERA_SAFE_BOUNDS.maxX
    ),
    THREE.MathUtils.clamp(
      pivot.y + dirY * safeT,
      ROOM_CAMERA_SAFE_BOUNDS.minY,
      ROOM_CAMERA_SAFE_BOUNDS.maxY
    ),
    THREE.MathUtils.clamp(
      pivot.z + dirZ * safeT,
      ROOM_CAMERA_SAFE_BOUNDS.minZ,
      ROOM_CAMERA_SAFE_BOUNDS.maxZ
    )
  );
  return out;
}

/**
 * Builds the obstacle list from StoreConfig racks + fixed BoutiqueWorld merchandising furniture
 */
export function buildBoutiqueObstacles(
  config: StoreConfig,
  showSecondaryRack = true
): ObstacleBox2D[] {
  const obstacles: ObstacleBox2D[] = [];

  config.racks.forEach((rack, idx) => {
    if (idx > 0 && !showSecondaryRack) return;
    if (!rack.items || rack.items.length === 0) return;

    const isCapsule = rack.style === 'capsule_rail';
    // Tightly match BoutiqueRack travertine plinth footprint so player can step close to garments
    const hx = isCapsule ? 0.68 : rack.items.length >= 2 ? 0.94 : 0.66;
    const hz = isCapsule ? 0.31 : 0.34;

    obstacles.push({
      id: `rack-${rack.id}`,
      cx: rack.position[0],
      cz: rack.position[2],
      hx,
      hz,
      rotY: rack.rotationY ?? 0,
    });
  });

  // Right-side low fluted travertine display pedestal ([2.1, 0, -0.8], rotY = -0.24)
  obstacles.push({
    id: 'right-pedestal',
    cx: 2.1,
    cz: -0.8,
    hx: 0.46,
    hz: 0.3,
    rotY: -0.24,
  });

  // Left-side architectural gallery bench ([-2.35, 0, 0.82], rotY = 0.38)
  obstacles.push({
    id: 'left-bench',
    cx: -2.35,
    cz: 0.82,
    hx: 0.58,
    hz: 0.22,
    rotY: 0.38,
  });

  return obstacles;
}

/**
 * Computes exact world coordinates for every hanging garment across StoreConfig.racks
 */
function buildGarmentTargets(
  config: StoreConfig,
  showSecondaryRack = true
): WorldGarmentTarget[] {
  const targets: WorldGarmentTarget[] = [];

  config.racks.forEach((rack, rIdx) => {
    if (rIdx > 0 && !showSecondaryRack) return;
    const items = rack.items ?? [];
    if (items.length === 0) return;

    const cosR = Math.cos(rack.rotationY ?? 0);
    const sinR = Math.sin(rack.rotationY ?? 0);

    items.forEach((asset, idx) => {
      let localX = 0;
      let localZ = 0;

      if (rack.style === 'capsule_rail') {
        if (items.length === 1) {
          localX = 0;
        } else {
          localX = idx === 0 ? -0.3 : 0.3;
        }
        localZ = 0;
      } else {
        if (idx === 0) {
          localX = 0;
          localZ = items.length >= 2 ? 0.13 : 0.03;
        } else {
          localX = idx === 1 ? -0.63 : 0.63;
          localZ = -0.08;
        }
      }

      const worldX = rack.position[0] + localX * cosR + localZ * sinR;
      const worldZ = rack.position[2] - localX * sinR + localZ * cosR;

      targets.push({
        id: asset.id,
        rackId: rack.id,
        rackLabel: rack.label,
        asset,
        worldX,
        worldY: 1.48,
        worldZ,
      });
    });
  });

  return targets;
}

interface StylizedPlayerAvatarProps {
  palette: StorePalette;
  visible: boolean;
  bodyBobRef: React.RefObject<THREE.Group>;
  headGroupRef: React.RefObject<THREE.Group>;
  leftArmRef: React.RefObject<THREE.Group>;
  rightArmRef: React.RefObject<THREE.Group>;
  leftLegRef: React.RefObject<THREE.Group>;
  rightLegRef: React.RefObject<THREE.Group>;
  leftEyeRef: React.RefObject<THREE.Mesh>;
  rightEyeRef: React.RefObject<THREE.Mesh>;
  interactPulse: number;
}

/**
 * Stylized Articulated Roblox-Inspired Boutique Avatar (total height ≈ 1.55m, soles at y = 0, facing +Z)
 */
const StylizedPlayerAvatar: React.FC<StylizedPlayerAvatarProps> = ({
  palette,
  visible,
  bodyBobRef,
  headGroupRef,
  leftArmRef,
  rightArmRef,
  leftLegRef,
  rightLegRef,
  leftEyeRef,
  rightEyeRef,
  interactPulse,
}) => {
  const skinColor = '#F3CFB3';
  const creamTrim = '#F6F2E8';
  const denimTrouser = '#262B34';
  const jacketBody = palette.accent;
  const jacketDark = useMemo(() => shiftColorHex(palette.accent, -0.1), [palette.accent]);

  return (
    <group visible={visible} name="roblox-stylized-player-avatar">
      {/* Subtle Brand-Tinted Ground Presence Ring */}
      <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.22, 0.275 + interactPulse * 0.12, 32]} />
        <meshBasicMaterial
          color={palette.accent}
          transparent
          opacity={0.42 + interactPulse * 0.35}
        />
      </mesh>

      {/* Animated Upper/Full Body Bob Group */}
      <group ref={bodyBobRef}>
        {/* =========================================================
            LEFT & RIGHT ARTICULATED LEGS (Hip Pivot at y = 0.64)
           ========================================================= */}
        <group ref={leftLegRef} position={[-0.115, 0.64, 0]}>
          <RoundedBox
            args={[0.195, 0.54, 0.205]}
            radius={0.042}
            smoothness={3}
            position={[0, -0.27, 0]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={denimTrouser} roughness={0.78} />
          </RoundedBox>
          {/* Turned Selvedge Cuff */}
          <RoundedBox
            args={[0.202, 0.05, 0.212]}
            radius={0.015}
            smoothness={2}
            position={[0, -0.52, 0]}
            castShadow
          >
            <meshStandardMaterial color={creamTrim} roughness={0.72} />
          </RoundedBox>
          {/* Chunky Court Sneaker (Sole sits right at y = 0) */}
          <RoundedBox
            args={[0.205, 0.095, 0.265]}
            radius={0.032}
            smoothness={3}
            position={[0, -0.592, 0.024]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={creamTrim} roughness={0.58} />
          </RoundedBox>
          <mesh position={[0, -0.58, 0.03]} castShadow>
            <boxGeometry args={[0.208, 0.026, 0.14]} />
            <meshStandardMaterial color={jacketBody} roughness={0.6} />
          </mesh>
        </group>

        <group ref={rightLegRef} position={[0.115, 0.64, 0]}>
          <RoundedBox
            args={[0.195, 0.54, 0.205]}
            radius={0.042}
            smoothness={3}
            position={[0, -0.27, 0]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={denimTrouser} roughness={0.78} />
          </RoundedBox>
          {/* Turned Selvedge Cuff */}
          <RoundedBox
            args={[0.202, 0.05, 0.212]}
            radius={0.015}
            smoothness={2}
            position={[0, -0.52, 0]}
            castShadow
          >
            <meshStandardMaterial color={creamTrim} roughness={0.72} />
          </RoundedBox>
          {/* Chunky Court Sneaker */}
          <RoundedBox
            args={[0.205, 0.095, 0.265]}
            radius={0.032}
            smoothness={3}
            position={[0, -0.592, 0.024]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={creamTrim} roughness={0.58} />
          </RoundedBox>
          <mesh position={[0, -0.58, 0.03]} castShadow>
            <boxGeometry args={[0.208, 0.026, 0.14]} />
            <meshStandardMaterial color={jacketBody} roughness={0.6} />
          </mesh>
        </group>

        {/* =========================================================
            TORSO: STYLISH BOUTIQUE VARSITY JACKET (y = 0.64 .. 1.16)
           ========================================================= */}
        <group position={[0, 0.9, 0]}>
          {/* Main Varsity Jacket Block */}
          <RoundedBox
            args={[0.46, 0.5, 0.24]}
            radius={0.055}
            smoothness={4}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={jacketBody} roughness={0.62} metalness={0.05} />
          </RoundedBox>

          {/* Cream Ribbed Waistband Hem Trim */}
          <RoundedBox
            args={[0.468, 0.065, 0.248]}
            radius={0.022}
            smoothness={3}
            position={[0, -0.22, 0]}
            castShadow
          >
            <meshStandardMaterial color={creamTrim} roughness={0.7} />
          </RoundedBox>

          {/* Cream Layered Crewneck Tee + Center Placket */}
          <mesh position={[0, 0.13, 0.121]}>
            <planeGeometry args={[0.16, 0.19]} />
            <meshStandardMaterial color={creamTrim} roughness={0.85} />
          </mesh>
          <mesh position={[0, -0.02, 0.122]}>
            <boxGeometry args={[0.042, 0.44, 0.008]} />
            <meshStandardMaterial color={creamTrim} roughness={0.68} />
          </mesh>

          {/* Varsity Metallic Snap Buttons */}
          {[-0.14, -0.04, 0.06].map((by, idx) => (
            <mesh key={idx} position={[0, by, 0.128]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.011, 0.011, 0.006, 12]} />
              <meshStandardMaterial
                color={palette.rackMetal}
                metalness={0.85}
                roughness={0.25}
              />
            </mesh>
          ))}

          {/* Boutique Woven Chest Crest Patch */}
          <RoundedBox
            args={[0.082, 0.082, 0.01]}
            radius={0.016}
            smoothness={2}
            position={[0.13, 0.09, 0.122]}
          >
            <meshStandardMaterial color={creamTrim} roughness={0.6} />
          </RoundedBox>
          <mesh position={[0.13, 0.09, 0.129]}>
            <planeGeometry args={[0.046, 0.046]} />
            <meshStandardMaterial color={jacketDark} roughness={0.5} />
          </mesh>

          {/* Varsity Ribbed Shawl Collar */}
          <RoundedBox
            args={[0.25, 0.055, 0.23]}
            radius={0.022}
            smoothness={3}
            position={[0, 0.255, -0.005]}
          >
            <meshStandardMaterial color={creamTrim} roughness={0.68} />
          </RoundedBox>
        </group>

        {/* =========================================================
            LEFT & RIGHT ARTICULATED ARMS (Shoulder Pivot at y = 1.11)
           ========================================================= */}
        <group ref={leftArmRef} position={[-0.325, 1.11, 0]}>
          {/* Cream Contrast Varsity Sleeve */}
          <RoundedBox
            args={[0.165, 0.42, 0.175]}
            radius={0.048}
            smoothness={3}
            position={[0, -0.18, 0]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={creamTrim} roughness={0.66} />
          </RoundedBox>
          {/* Accent Shoulder Cap Stripe */}
          <RoundedBox
            args={[0.172, 0.09, 0.182]}
            radius={0.035}
            smoothness={2}
            position={[0, -0.03, 0]}
          >
            <meshStandardMaterial color={jacketBody} roughness={0.62} />
          </RoundedBox>
          {/* Striped Cuff + Stylized Rounded Roblox Hand */}
          <RoundedBox
            args={[0.155, 0.045, 0.165]}
            radius={0.018}
            smoothness={2}
            position={[0, -0.38, 0]}
          >
            <meshStandardMaterial color={jacketBody} roughness={0.65} />
          </RoundedBox>
          <RoundedBox
            args={[0.145, 0.11, 0.15]}
            radius={0.045}
            smoothness={3}
            position={[0, -0.445, 0]}
            castShadow
          >
            <meshStandardMaterial color={skinColor} roughness={0.68} />
          </RoundedBox>
        </group>

        <group ref={rightArmRef} position={[0.325, 1.11, 0]}>
          {/* Cream Contrast Varsity Sleeve */}
          <RoundedBox
            args={[0.165, 0.42, 0.175]}
            radius={0.048}
            smoothness={3}
            position={[0, -0.18, 0]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={creamTrim} roughness={0.66} />
          </RoundedBox>
          {/* Accent Shoulder Cap Stripe */}
          <RoundedBox
            args={[0.172, 0.09, 0.182]}
            radius={0.035}
            smoothness={2}
            position={[0, -0.03, 0]}
          >
            <meshStandardMaterial color={jacketBody} roughness={0.62} />
          </RoundedBox>
          {/* Striped Cuff + Stylized Rounded Roblox Hand */}
          <RoundedBox
            args={[0.155, 0.045, 0.165]}
            radius={0.018}
            smoothness={2}
            position={[0, -0.38, 0]}
          >
            <meshStandardMaterial color={jacketBody} roughness={0.65} />
          </RoundedBox>
          <RoundedBox
            args={[0.145, 0.11, 0.15]}
            radius={0.045}
            smoothness={3}
            position={[0, -0.445, 0]}
            castShadow
          >
            <meshStandardMaterial color={skinColor} roughness={0.68} />
          </RoundedBox>
        </group>

        {/* =========================================================
            CLASSIC ROBLOX ROUNDED HEAD + EXPRESSIVE FACE + COURT CAP
            (Head top + cap reaches y ≈ 1.55m!)
           ========================================================= */}
        <group ref={headGroupRef} position={[0, 1.19, 0]}>
          {/* Rounded Blocky-Cylindrical Head */}
          <RoundedBox
            args={[0.31, 0.3, 0.295]}
            radius={0.088}
            smoothness={4}
            position={[0, 0.165, 0]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={skinColor} roughness={0.64} />
          </RoundedBox>

          {/* Expressive Minimalist Face on +Z */}
          <group position={[0, 0.162, 0.149]}>
            {/* Left & Right Pill Eyes */}
            <mesh ref={leftEyeRef} position={[-0.058, 0.018, 0]}>
              <boxGeometry args={[0.032, 0.048, 0.006]} />
              <meshBasicMaterial color="#18191C" />
            </mesh>
            <mesh position={[-0.051, 0.03, 0.004]}>
              <planeGeometry args={[0.011, 0.011]} />
              <meshBasicMaterial color="#FFFFFF" />
            </mesh>

            <mesh ref={rightEyeRef} position={[0.058, 0.018, 0]}>
              <boxGeometry args={[0.032, 0.048, 0.006]} />
              <meshBasicMaterial color="#18191C" />
            </mesh>
            <mesh position={[0.065, 0.03, 0.004]}>
              <planeGeometry args={[0.011, 0.011]} />
              <meshBasicMaterial color="#FFFFFF" />
            </mesh>

            {/* Friendly Minimalist Confident Smile */}
            <mesh position={[0, -0.042, 0]} rotation={[0, 0, Math.PI]}>
              <torusGeometry args={[0.03, 0.0055, 8, 16, Math.PI * 0.85]} />
              <meshBasicMaterial color="#2C221E" />
            </mesh>
          </group>

          {/* Subtle Hair Fringe Framing Temple/Back */}
          <RoundedBox
            args={[0.322, 0.095, 0.305]}
            radius={0.04}
            smoothness={3}
            position={[0, 0.265, -0.012]}
            castShadow
          >
            <meshStandardMaterial color="#362821" roughness={0.82} />
          </RoundedBox>

          {/* Tailored Boutique Court Cap (brings total avatar height to 1.55m) */}
          <group position={[0, 0.305, 0]}>
            <RoundedBox
              args={[0.326, 0.095, 0.312]}
              radius={0.046}
              smoothness={4}
              position={[0, 0.012, -0.005]}
              castShadow
            >
              <meshStandardMaterial color={jacketBody} roughness={0.6} />
            </RoundedBox>
            {/* Cream Cap Band */}
            <RoundedBox
              args={[0.33, 0.022, 0.316]}
              radius={0.01}
              smoothness={2}
              position={[0, -0.022, -0.005]}
            >
              <meshStandardMaterial color={creamTrim} roughness={0.65} />
            </RoundedBox>
            {/* Curved Forward Cap Visor (+Z) */}
            <RoundedBox
              args={[0.26, 0.022, 0.135]}
              radius={0.01}
              smoothness={3}
              position={[0, -0.02, 0.18]}
              rotation={[0.1, 0, 0]}
              castShadow
            >
              <meshStandardMaterial color={jacketDark} roughness={0.58} />
            </RoundedBox>
            {/* Top Cap Button */}
            <mesh position={[0, 0.062, -0.005]}>
              <sphereGeometry args={[0.018, 12, 12]} />
              <meshStandardMaterial color={creamTrim} roughness={0.6} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
};

export const RobloxPlayerController: React.FC<RobloxPlayerControllerProps> = ({
  config,
  enabled = true,
  initialPosition = [0, 0, 3.05],
  initialYaw = 0,
  povMode: controlledPovMode,
  onPovModeChange,
  onInteractGarment,
  showSecondaryRack = true,
  onPlayerMove,
}) => {
  const { camera, gl, controls } = useThree();

  const [internalPov, setInternalPov] = useState<PlayerPovMode>('third_person');
  const activePov: PlayerPovMode = controlledPovMode ?? internalPov;
  const activePovRef = useRef<PlayerPovMode>(activePov);
  activePovRef.current = activePov;

  const [nearbyTarget, setNearbyTarget] = useState<WorldGarmentTarget | null>(null);
  const nearbyTargetRef = useRef<WorldGarmentTarget | null>(null);
  const [interactPulse, setInteractPulse] = useState<number>(0);

  // Mutable physics & input state (60-120fps zero-allocation in useFrame)
  const playerPos = useRef(
    new THREE.Vector3(initialPosition[0], initialPosition[1], initialPosition[2])
  );
  const velocityY = useRef<number>(0);
  const isGrounded = useRef<boolean>(true);
  const avatarYaw = useRef<number>(Math.PI); // Facing -Z toward hero rack on spawn
  const cameraYaw = useRef<number>(initialYaw); // 0 = looking toward -Z
  const cameraPitch = useRef<number>(0.145); // Slight elevated over-the-shoulder angle (~1.65m height)
  const walkPhase = useRef<number>(0);
  const swingAmp = useRef<number>(0);

  const pressedKeys = useRef<Set<string>>(new Set());
  const isDraggingLook = useRef<boolean>(false);
  const lastPointer = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Avatar rig refs
  const avatarRootRef = useRef<THREE.Group>(null);
  const bodyBobRef = useRef<THREE.Group>(null);
  const headGroupRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const leftLegRef = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);
  const leftEyeRef = useRef<THREE.Mesh>(null);
  const rightEyeRef = useRef<THREE.Mesh>(null);

  // Reusable scratch vectors to avoid GC pressure in useFrame
  const scratchPivot = useRef(new THREE.Vector3());
  const scratchDesiredCam = useRef(new THREE.Vector3());
  const scratchClampedCam = useRef(new THREE.Vector3());
  const scratchLookTarget = useRef(new THREE.Vector3());

  const obstacles = useMemo(
    () => buildBoutiqueObstacles(config, showSecondaryRack),
    [config, showSecondaryRack]
  );

  const garmentTargets = useMemo(
    () => buildGarmentTargets(config, showSecondaryRack),
    [config, showSecondaryRack]
  );

  const togglePov = useCallback(() => {
    const next: PlayerPovMode =
      activePovRef.current === 'third_person' ? 'first_person' : 'third_person';
    if (controlledPovMode === undefined) {
      setInternalPov(next);
    }
    onPovModeChange?.(next);
  }, [controlledPovMode, onPovModeChange]);

  const triggerGarmentInteract = useCallback(
    (target: WorldGarmentTarget | null) => {
      if (!target) return;
      setInteractPulse(1);
      onInteractGarment?.(target.id, target.asset);
    },
    [onInteractGarment]
  );

  // Decay interaction visual pulse smoothly
  useEffect(() => {
    if (interactPulse <= 0) return;
    const timer = window.setTimeout(() => setInteractPulse(0), 340);
    return () => window.clearTimeout(timer);
  }, [interactPulse]);

  // Temporarily disable any default OrbitControls if mounted alongside controller
  useEffect(() => {
    if (!enabled || !controls) return;
    const ctrl = controls as unknown as { enabled?: boolean };
    const prevEnabled = ctrl.enabled;
    if (typeof ctrl.enabled === 'boolean') {
      ctrl.enabled = false;
    }
    return () => {
      if (typeof prevEnabled === 'boolean') {
        ctrl.enabled = prevEnabled;
      }
    };
  }, [enabled, controls]);

  // Keyboard & Mouse-Drag Roblox Camera + Movement Listeners
  useEffect(() => {
    if (!enabled) {
      pressedKeys.current.clear();
      isDraggingLook.current = false;
      return;
    }

    const canvasEl = gl.domElement;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableElementActive()) return;

      const code = e.code;
      if (
        code === 'Space' ||
        code === 'ArrowUp' ||
        code === 'ArrowDown' ||
        code === 'ArrowLeft' ||
        code === 'ArrowRight'
      ) {
        e.preventDefault();
      }

      if (!e.repeat) {
        if (code === 'KeyV') {
          togglePov();
          return;
        }
        if (code === 'KeyE' && nearbyTargetRef.current) {
          triggerGarmentInteract(nearbyTargetRef.current);
          return;
        }
        if (code === 'Space' && isGrounded.current) {
          velocityY.current = JUMP_VELOCITY;
          isGrounded.current = false;
        }
      }

      pressedKeys.current.add(code);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      pressedKeys.current.delete(e.code);
    };

    const clearKeys = () => {
      pressedKeys.current.clear();
      isDraggingLook.current = false;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 2) return;
      isDraggingLook.current = true;
      lastPointer.current = { x: e.clientX, y: e.clientY };
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDraggingLook.current) return;
      const dx = e.clientX - lastPointer.current.x;
      const dy = e.clientY - lastPointer.current.y;
      lastPointer.current = { x: e.clientX, y: e.clientY };

      const sensitivity = 0.0052;
      cameraYaw.current -= dx * sensitivity;

      const maxPitch = activePovRef.current === 'first_person' ? 0.85 : 0.68;
      const minPitch = activePovRef.current === 'first_person' ? -0.82 : -0.22;
      cameraPitch.current = THREE.MathUtils.clamp(
        cameraPitch.current + dy * sensitivity,
        minPitch,
        maxPitch
      );
    };

    const onPointerUp = () => {
      isDraggingLook.current = false;
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearKeys);
    canvasEl.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    canvasEl.addEventListener('contextmenu', onContextMenu);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearKeys);
      canvasEl.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      canvasEl.removeEventListener('contextmenu', onContextMenu);
      clearKeys();
    };
  }, [enabled, gl.domElement, togglePov, triggerGarmentInteract]);

  useFrame((state, rawDelta) => {
    if (!enabled) return;

    const dt = Math.min(rawDelta, 0.05);
    const elapsed = state.clock.elapsedTime;
    const keys = pressedKeys.current;

    // 1. Q / E Smooth Camera Yaw Orbit (when E isn't intercepted by garment inspect)
    const turnSpeed = 2.05;
    if (keys.has('KeyQ')) {
      cameraYaw.current += turnSpeed * dt;
    }
    if (keys.has('KeyE') && !nearbyTargetRef.current) {
      cameraYaw.current -= turnSpeed * dt;
    }

    // 2. Movement Vector Relative to Camera Yaw
    let inputForward = 0;
    let inputRight = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) inputForward += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) inputForward -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) inputRight += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) inputRight -= 1;

    const isSprinting = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const moveSpeed = isSprinting ? SPRINT_SPEED : WALK_SPEED;

    const yaw = cameraYaw.current;
    // Camera forward on XZ when yaw = 0 points along -Z ([0, 0, -1])
    const forwardX = -Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);

    let moveX = forwardX * inputForward + rightX * inputRight;
    let moveZ = forwardZ * inputForward + rightZ * inputRight;
    const moveMag = Math.hypot(moveX, moveZ);
    const isMoving = moveMag > 0.001;

    if (isMoving) {
      moveX = (moveX / moveMag) * moveSpeed;
      moveZ = (moveZ / moveMag) * moveSpeed;
    }

    // 3. Horizontal Integration + Smooth Sliding Obstacle & Wall Collision
    let nextX = playerPos.current.x + moveX * dt;
    let nextZ = playerPos.current.z + moveZ * dt;

    for (let pass = 0; pass < 2; pass++) {
      for (const obs of obstacles) {
        [nextX, nextZ] = resolveCircleObb2D(nextX, nextZ, PLAYER_RADIUS, obs);
      }
      nextX = THREE.MathUtils.clamp(nextX, ROOM_PLAYER_BOUNDS.minX, ROOM_PLAYER_BOUNDS.maxX);
      nextZ = THREE.MathUtils.clamp(nextZ, ROOM_PLAYER_BOUNDS.minZ, ROOM_PLAYER_BOUNDS.maxZ);
    }

    playerPos.current.x = nextX;
    playerPos.current.z = nextZ;

    // 4. Crisp Jump Physics & Floor Landing at y = 0
    if (!isGrounded.current || velocityY.current > 0) {
      playerPos.current.y += velocityY.current * dt;
      velocityY.current += GRAVITY * dt;
      if (playerPos.current.y <= 0) {
        playerPos.current.y = 0;
        velocityY.current = 0;
        isGrounded.current = true;
      }
    }

    // 5. Smooth Avatar Heading & Procedural Articulated Limb Animation
    if (activePovRef.current === 'first_person') {
      avatarYaw.current = yaw + Math.PI;
    } else if (isMoving) {
      const desiredAvatarYaw = Math.atan2(moveX, moveZ);
      avatarYaw.current = lerpAngleShortest(
        avatarYaw.current,
        desiredAvatarYaw,
        Math.min(1, dt * 14)
      );
    }

    if (avatarRootRef.current) {
      avatarRootRef.current.position.copy(playerPos.current);
      avatarRootRef.current.rotation.y = avatarYaw.current;
    }

    const targetSwing = isMoving ? (isSprinting ? 0.92 : 0.62) : 0;
    swingAmp.current = THREE.MathUtils.lerp(swingAmp.current, targetSwing, Math.min(1, dt * 12));

    if (isMoving && isGrounded.current) {
      walkPhase.current += dt * (isSprinting ? 13.5 : 9.2);
    }

    const phaseSin = Math.sin(walkPhase.current);
    const airborne = !isGrounded.current;

    if (bodyBobRef.current) {
      const walkBounce =
        isGrounded.current && isMoving
          ? Math.abs(phaseSin) * (isSprinting ? 0.036 : 0.024)
          : Math.sin(elapsed * 2.2) * 0.009;
      bodyBobRef.current.position.y = airborne ? 0.02 : walkBounce;
    }

    if (leftLegRef.current && rightLegRef.current) {
      if (airborne) {
        leftLegRef.current.rotation.x = THREE.MathUtils.lerp(
          leftLegRef.current.rotation.x,
          -0.28,
          Math.min(1, dt * 14)
        );
        rightLegRef.current.rotation.x = THREE.MathUtils.lerp(
          rightLegRef.current.rotation.x,
          0.32,
          Math.min(1, dt * 14)
        );
      } else {
        leftLegRef.current.rotation.x = phaseSin * swingAmp.current;
        rightLegRef.current.rotation.x = -phaseSin * swingAmp.current;
      }
    }

    if (leftArmRef.current && rightArmRef.current) {
      if (airborne) {
        // Iconic Roblox joyful jump pose: right arm raised high, left arm swept out
        rightArmRef.current.rotation.x = THREE.MathUtils.lerp(
          rightArmRef.current.rotation.x,
          -2.45,
          Math.min(1, dt * 14)
        );
        leftArmRef.current.rotation.x = THREE.MathUtils.lerp(
          leftArmRef.current.rotation.x,
          0.42,
          Math.min(1, dt * 14)
        );
        leftArmRef.current.rotation.z = 0.14;
        rightArmRef.current.rotation.z = -0.16;
      } else {
        const idleBreath = Math.sin(elapsed * 1.9) * 0.035;
        leftArmRef.current.rotation.x = -phaseSin * swingAmp.current * 0.85 + idleBreath;
        rightArmRef.current.rotation.x = phaseSin * swingAmp.current * 0.85 - idleBreath;
        leftArmRef.current.rotation.z = 0.06;
        rightArmRef.current.rotation.z = -0.06;
      }
    }

    // Subtle periodic eye blink & curious head glance toward nearby garment
    const blinkCycle = elapsed % 3.8;
    const eyeScaleY = blinkCycle > 3.68 ? 0.12 : 1;
    if (leftEyeRef.current && rightEyeRef.current) {
      leftEyeRef.current.scale.y = eyeScaleY;
      rightEyeRef.current.scale.y = eyeScaleY;
    }

    if (headGroupRef.current) {
      let targetHeadYaw = 0;
      if (nearbyTargetRef.current && !isMoving) {
        const toGarmentYaw = Math.atan2(
          nearbyTargetRef.current.worldX - playerPos.current.x,
          nearbyTargetRef.current.worldZ - playerPos.current.z
        );
        let rel = (toGarmentYaw - avatarYaw.current + Math.PI) % (Math.PI * 2);
        if (rel < 0) rel += Math.PI * 2;
        rel -= Math.PI;
        targetHeadYaw = THREE.MathUtils.clamp(rel * 0.55, -0.52, 0.52);
      }
      headGroupRef.current.rotation.y = THREE.MathUtils.lerp(
        headGroupRef.current.rotation.y,
        targetHeadYaw,
        Math.min(1, dt * 8)
      );
    }

    // 6. Camera Placement: 3rd-Person Over-the-Shoulder PopperCam vs 1st-Person POV
    const pitch = cameraPitch.current;
    if (activePovRef.current === 'first_person') {
      scratchDesiredCam.current.set(
        THREE.MathUtils.clamp(
          playerPos.current.x,
          ROOM_CAMERA_SAFE_BOUNDS.minX,
          ROOM_CAMERA_SAFE_BOUNDS.maxX
        ),
        playerPos.current.y + FIRST_PERSON_EYE_HEIGHT,
        THREE.MathUtils.clamp(
          playerPos.current.z,
          ROOM_CAMERA_SAFE_BOUNDS.minZ,
          ROOM_CAMERA_SAFE_BOUNDS.maxZ
        )
      );
      camera.position.lerp(scratchDesiredCam.current, Math.min(1, dt * 22));

      const cosP = Math.cos(pitch);
      scratchLookTarget.current.set(
        camera.position.x - Math.sin(yaw) * cosP,
        camera.position.y - Math.sin(pitch),
        camera.position.z - Math.cos(yaw) * cosP
      );
      camera.lookAt(scratchLookTarget.current);
    } else {
      // 3rd-person over-the-shoulder pivot
      scratchPivot.current.set(
        playerPos.current.x + rightX * THIRD_PERSON_SHOULDER_OFFSET,
        playerPos.current.y + THIRD_PERSON_PIVOT_HEIGHT,
        playerPos.current.z + rightZ * THIRD_PERSON_SHOULDER_OFFSET
      );

      const horizDist = Math.cos(pitch) * THIRD_PERSON_DISTANCE;
      const vertOffset = Math.sin(pitch) * THIRD_PERSON_DISTANCE;

      scratchDesiredCam.current.set(
        scratchPivot.current.x - forwardX * horizDist,
        scratchPivot.current.y + vertOffset,
        scratchPivot.current.z - forwardZ * horizDist
      );

      clampCameraAlongSpringArm(
        scratchPivot.current,
        scratchDesiredCam.current,
        scratchClampedCam.current
      );

      camera.position.lerp(scratchClampedCam.current, Math.min(1, dt * 16));
      camera.lookAt(scratchPivot.current);
    }

    // 7. Nearest Garment Proximity Check (within 1.55m)
    let closest: WorldGarmentTarget | null = null;
    let closestDist = INTERACT_RADIUS;

    for (const gt of garmentTargets) {
      const d = Math.hypot(
        gt.worldX - playerPos.current.x,
        gt.worldZ - playerPos.current.z
      );
      if (d <= closestDist) {
        closestDist = d;
        closest = gt;
      }
    }

    if ((closest?.id ?? null) !== (nearbyTargetRef.current?.id ?? null)) {
      nearbyTargetRef.current = closest;
      setNearbyTarget(closest);
    }

    onPlayerMove?.(
      [playerPos.current.x, playerPos.current.y, playerPos.current.z],
      avatarYaw.current
    );
  });

  if (!enabled) return null;

  return (
    <group name="roblox-player-layer">
      <group ref={avatarRootRef} position={initialPosition}>
        <StylizedPlayerAvatar
          palette={config.palette}
          visible={activePov !== 'first_person'}
          bodyBobRef={bodyBobRef}
          headGroupRef={headGroupRef}
          leftArmRef={leftArmRef}
          rightArmRef={rightArmRef}
          leftLegRef={leftLegRef}
          rightLegRef={rightLegRef}
          leftEyeRef={leftEyeRef}
          rightEyeRef={rightEyeRef}
          interactPulse={interactPulse}
        />
      </group>

      {/* Floating 3D Proximity Inspection Prompt */}
      {nearbyTarget && (
        <Html
          position={[
            nearbyTarget.worldX,
            nearbyTarget.worldY + 0.28,
            nearbyTarget.worldZ,
          ]}
          center
          zIndexRange={[18, 0]}
        >
          <button
            type="button"
            onClick={() => triggerGarmentInteract(nearbyTarget)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 13px',
              borderRadius: 999,
              border: `1.5px solid ${config.palette.accent}`,
              background: 'rgba(16, 17, 16, 0.88)',
              backdropFilter: 'blur(10px)',
              color: '#F7F4EC',
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.42)',
              fontFamily: 'system-ui, -apple-system, sans-serif',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 22,
                height: 22,
                padding: '0 6px',
                borderRadius: 6,
                background: '#D4AF37',
                color: '#141412',
                fontWeight: 800,
                fontSize: 11,
                letterSpacing: '0.02em',
              }}
            >
              E
            </span>
            <span>
              Press [E] to Inspect {nearbyTarget.asset.title} · $
              {nearbyTarget.asset.price}
            </span>
          </button>
        </Html>
      )}
    </group>
  );
};

/**
 * Compact HTML overlay pill showing Roblox Boutique controls & optional quick POV toggle
 */
export const RobloxControlsHint: React.FC<RobloxControlsHintProps> = ({
  povMode,
  onTogglePov,
  nearbyGarmentTitle,
  style,
}) => {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 66,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 14px',
        borderRadius: 999,
        background: 'rgba(18, 18, 17, 0.82)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255, 255, 255, 0.14)',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.32)',
        color: 'rgba(247, 244, 236, 0.9)',
        fontSize: 11.5,
        fontWeight: 500,
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
        pointerEvents: onTogglePov ? 'auto' : 'none',
        userSelect: 'none',
        ...style,
      }}
    >
      <span>
        <strong style={{ color: '#D4AF37' }}>WASD</strong> Move ·{' '}
        <strong style={{ color: '#D4AF37' }}>Mouse Drag</strong> Look ·{' '}
        <strong style={{ color: '#D4AF37' }}>Space</strong> Jump ·{' '}
        <strong style={{ color: '#D4AF37' }}>Shift</strong> Sprint ·{' '}
        <strong style={{ color: '#D4AF37' }}>V</strong> POV ·{' '}
        <strong style={{ color: '#D4AF37' }}>E</strong> Inspect
      </span>
      {povMode && (
        <button
          type="button"
          onClick={onTogglePov}
          style={{
            border: '1px solid rgba(212, 175, 55, 0.45)',
            background: 'rgba(212, 175, 55, 0.16)',
            color: '#F5E3A1',
            borderRadius: 999,
            padding: '2px 8px',
            fontSize: 10.5,
            fontWeight: 700,
            cursor: onTogglePov ? 'pointer' : 'default',
          }}
        >
          {povMode === 'first_person' ? '1st Person' : '3rd Person'}
        </button>
      )}
      {nearbyGarmentTitle && (
        <span style={{ color: '#9BE58B', fontWeight: 600 }}>
          · Near: {nearbyGarmentTitle}
        </span>
      )}
    </div>
  );
};
