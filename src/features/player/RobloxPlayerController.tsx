import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type {
  GarmentAssetSet,
  InventedProductSpec,
  StoreConfig,
  StorePalette,
} from '../../types/storeConfig';

export type PlayerPovMode = 'third_person' | 'first_person';

export interface RobloxPlayerControllerProps {
  /** Active store configuration providing palette, racks, and product metadata */
  config: StoreConfig;
  /** Whether the walkable gallery controller is active (defaults to true) */
  enabled?: boolean;
  /** Optional spawn coordinates [x, y, z] (defaults to [0, 0, 3.05] facing the hero stand) */
  initialPosition?: [number, number, number];
  /** Optional initial yaw in radians (0 = looking toward -Z hero stand) */
  initialYaw?: number;
  /** Optional controlled POV mode; defaults to 'first_person' and toggleable via [V] */
  povMode?: PlayerPovMode;
  /** Optional callback fired when POV mode toggles */
  onPovModeChange?: (mode: PlayerPovMode) => void;
  /** Fired when the user presses [E] (or clicks the prompt) within proximity of a product */
  onInteractGarment?: (garmentId: string, garment: GarmentAssetSet) => void;
  /** Optional flag matching App layout (defaults to true so all racks in config.racks are active) */
  showSecondaryRack?: boolean;
  /** Optional callback broadcasting live walkthrough world position */
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

interface WorldProductTarget {
  id: string;
  rackId: string;
  rackLabel: string;
  asset: GarmentAssetSet;
  worldX: number;
  worldY: number;
  worldZ: number;
}

const ROOM_PLAYER_BOUNDS = {
  minX: -4.35,
  maxX: 4.35,
  minZ: -1.45,
  maxZ: 7.1,
};

const ROOM_CAMERA_SAFE_BOUNDS = {
  minX: -4.52,
  maxX: 4.52,
  minY: 0.45,
  maxY: 4.25,
  minZ: -1.68,
  maxZ: 7.52,
};

const PLAYER_RADIUS = 0.26;
const GALLERY_WALK_SPEED = 2.15;
const GALLERY_BRISK_SPEED = 3.25;
const INTERACT_RADIUS = 1.65;

const FIRST_PERSON_EYE_HEIGHT = 1.56;
const THIRD_PERSON_DISTANCE = 2.45;
const THIRD_PERSON_PIVOT_HEIGHT = 1.38;
const THIRD_PERSON_SHOULDER_OFFSET = 0.14;

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

/**
 * Smooth 2D Circle-vs-Oriented-Bounding-Box (OBB) collision resolver on XZ plane.
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
    const penX = box.hx - Math.abs(lx);
    const penZ = box.hz - Math.abs(lz);
    if (penX < penZ) {
      lx = (lx >= 0 ? 1 : -1) * (box.hx + radius);
    } else {
      lz = (lz >= 0 ? 1 : -1) * (box.hz + radius);
    }
  }

  const wx = box.cx + lx * cosR + lz * sinR;
  const wz = box.cz - lx * sinR + lz * cosR;
  return [wx, wz];
}

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

  obstacles.push({
    id: 'right-pedestal',
    cx: 2.1,
    cz: -0.8,
    hx: 0.46,
    hz: 0.3,
    rotY: -0.24,
  });

  obstacles.push({
    id: 'left-bench',
    cx: -2.35,
    cz: 0.82,
    hx: 0.58,
    hz: 0.22,
    rotY: 0.38,
  });

  if ((config.products ?? []).some((p) => p.placement === 'center_table')) {
    obstacles.push({
      id: 'center-table',
      cx: 0,
      cz: 1.08,
      hx: 0.44,
      hz: 0.28,
      rotY: 0,
    });
  }

  return obstacles;
}

function specToInspectableAsset(spec: InventedProductSpec): GarmentAssetSet {
  return {
    id: spec.id,
    sku: spec.sku,
    title: spec.title,
    subtitle: spec.subtitle,
    price: spec.price,
    featured: spec.featured,
    productSpec: spec,
    rawUrl: spec.customCutoutUrl ?? '',
    dominantHex: spec.primaryColor,
  };
}

/**
 * Computes world coordinates for inspectable garments & 3D fixture products across StoreConfig
 */
function buildProductTargets(
  config: StoreConfig,
  showSecondaryRack = true
): WorldProductTarget[] {
  const targets: WorldProductTarget[] = [];
  const seenIds = new Set<string>();

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
        localX = items.length === 1 ? 0 : idx === 0 ? -0.3 : 0.3;
        localZ = 0;
      } else if (idx === 0) {
        localX = 0;
        localZ = items.length >= 2 ? 0.13 : 0.03;
      } else {
        localX = idx === 1 ? -0.63 : 0.63;
        localZ = -0.08;
      }

      const worldX = rack.position[0] + localX * cosR + localZ * sinR;
      const worldZ = rack.position[2] - localX * sinR + localZ * cosR;

      seenIds.add(asset.id);
      targets.push({
        id: asset.id,
        rackId: rack.id,
        rackLabel: rack.label,
        asset,
        worldX,
        worldY: 1.46,
        worldZ,
      });
    });
  });

  // Include invented pedestal / table products if not already represented in racks
  (config.products ?? []).forEach((spec) => {
    if (seenIds.has(spec.id)) return;
    seenIds.add(spec.id);

    let pos: [number, number, number] = [0, 1.15, 0.95];
    let label = 'Display Fixture';
    if (spec.placement === 'right_pedestal') {
      pos = [2.1, 1.05, -0.8];
      label = 'Right Pedestal';
    } else if (spec.placement === 'left_pedestal') {
      pos = [-2.15, 1.02, 0.55];
      label = 'Left Pedestal';
    } else if (spec.placement === 'center_table') {
      pos = [0.05, 1.02, 0.95];
      label = 'Center Table';
    } else if (spec.placement === 'capsule_rack') {
      if (!showSecondaryRack) return;
      pos = [-1.58, 1.42, -0.58];
      label = 'Capsule Rail';
    } else if (spec.placement === 'hero_rack') {
      pos = [0, 1.46, 0];
      label = 'Hero Stand';
    }

    targets.push({
      id: spec.id,
      rackId: spec.placement,
      rackLabel: label,
      asset: specToInspectableAsset(spec),
      worldX: pos[0],
      worldY: pos[1],
      worldZ: pos[2],
    });
  });

  return targets;
}

/**
 * Watertight manifold sculpted architectural silhouette column (`y = 0.018m .. 1.385m`)
 */
function createWalkthroughMonolithBodyGeometry(): THREE.BufferGeometry {
  const profilePoints = [
    new THREE.Vector2(0.001, 0.018),
    new THREE.Vector2(0.132, 0.019),
    new THREE.Vector2(0.136, 0.048),
    new THREE.Vector2(0.114, 0.28),
    new THREE.Vector2(0.101, 0.58),
    new THREE.Vector2(0.105, 0.8),
    new THREE.Vector2(0.093, 0.985),
    new THREE.Vector2(0.121, 1.155),
    new THREE.Vector2(0.141, 1.272),
    new THREE.Vector2(0.112, 1.338),
    new THREE.Vector2(0.056, 1.375),
    new THREE.Vector2(0.045, 1.385),
    new THREE.Vector2(0.0, 1.385),
  ];

  const spline = new THREE.SplineCurve(profilePoints);
  const sampled = spline.getPoints(56);
  sampled[0].set(0, 0.018);
  sampled[sampled.length - 1].set(0, 1.385);

  const geo = new THREE.LatheGeometry(sampled, 56);
  const pos = geo.attributes.position;

  for (let i = 0; i < pos.count; i++) {
    const x0 = pos.getX(i);
    const y0 = pos.getY(i);
    const z0 = pos.getZ(i);
    const r0 = Math.hypot(x0, z0);

    if (r0 > 1e-5) {
      const cosPhi = x0 / r0;
      const sinPhi = z0 / r0;

      const hemFade = THREE.MathUtils.smoothstep(y0, 0.02, 0.12);
      const collarFade = 1 - THREE.MathUtils.smoothstep(y0, 1.33, 1.384);
      const sculptMask = hemFade * collarFade;

      const shoulderBell = Math.exp(-Math.pow((y0 - 1.255) / 0.102, 2));
      const sleeveDrape = Math.exp(-Math.pow((y0 - 1.03) / 0.215, 2));
      const lateralCubic = cosPhi * cosPhi * cosPhi;

      const x =
        x0 * 1.08 +
        lateralCubic * (0.036 * shoulderBell + 0.021 * sleeveDrape) * sculptMask;

      const chestPoise =
        0.013 * Math.exp(-Math.pow((y0 - 1.16) / 0.145, 2)) * Math.max(0, sinPhi);
      const z = z0 * 0.68 + chestPoise * sculptMask;

      pos.setXYZ(i, x, y0, z);
    }
  }

  geo.computeVertexNormals();
  return geo;
}

/**
 * Featureless sculptural ovoid head (`y = 1.400m .. 1.680m`, hovering 1.5cm above collar)
 */
function createWalkthroughOvoidHeadGeometry(): THREE.BufferGeometry {
  const headPoints = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.045, 0.018),
    new THREE.Vector2(0.077, 0.076),
    new THREE.Vector2(0.094, 0.156),
    new THREE.Vector2(0.085, 0.228),
    new THREE.Vector2(0.047, 0.268),
    new THREE.Vector2(0.0, 0.28),
  ];

  const spline = new THREE.SplineCurve(headPoints);
  const sampled = spline.getPoints(36);
  sampled[0].set(0, 0.0);
  sampled[sampled.length - 1].set(0, 0.28);

  const geo = new THREE.LatheGeometry(sampled, 40);
  geo.scale(0.88, 1.0, 1.02);
  geo.computeVertexNormals();
  return geo;
}

interface ArchitecturalPlayerSilhouetteProps {
  palette: StorePalette;
  visible: boolean;
  figureLeanRef: React.RefObject<THREE.Group>;
  headMeshRef: React.RefObject<THREE.Mesh>;
  interactPulse: number;
}

/**
 * Sleek, Faceless Frosted-Monolith Architectural Scale Silhouette (`height = 1.68m`)
 * shown when Third-Person View is toggled via [V].
 */
const ArchitecturalPlayerSilhouette: React.FC<ArchitecturalPlayerSilhouetteProps> = ({
  palette,
  visible,
  figureLeanRef,
  headMeshRef,
  interactPulse,
}) => {
  const bodyGeo = useMemo(() => createWalkthroughMonolithBodyGeometry(), []);
  const headGeo = useMemo(() => createWalkthroughOvoidHeadGeometry(), []);

  useEffect(() => {
    return () => {
      bodyGeo.dispose();
      headGeo.dispose();
    };
  }, [bodyGeo, headGeo]);

  const { monolithColor, sheenTint } = useMemo(() => {
    const accent = new THREE.Color(palette.accent);
    const base = new THREE.Color('#EFECE4').lerp(accent, 0.09);
    const sheen = new THREE.Color('#FFFFFF').lerp(accent, 0.48);
    return {
      monolithColor: `#${base.getHexString()}`,
      sheenTint: `#${sheen.getHexString()}`,
    };
  }, [palette.accent]);

  return (
    <group visible={visible} name="architectural-walkthrough-silhouette">
      {/* Thin Brushed-Brass / Anodized-Ring Floor Plinth Disc */}
      <mesh position={[0, 0.007, 0]} receiveShadow>
        <cylinderGeometry args={[0.186, 0.198, 0.014, 48]} />
        <meshStandardMaterial
          color={palette.rackMetal}
          metalness={0.84}
          roughness={0.28}
        />
      </mesh>
      <mesh position={[0, 0.0085, 0]} receiveShadow>
        <cylinderGeometry args={[0.162, 0.162, 0.017, 48]} />
        <meshStandardMaterial
          color={palette.plinth}
          roughness={0.52}
          metalness={0.06}
        />
      </mesh>
      <mesh position={[0, 0.0178, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.165, 0.184 + interactPulse * 0.06, 48]} />
        <meshBasicMaterial
          color={palette.accent}
          transparent
          opacity={0.48 + interactPulse * 0.36}
        />
      </mesh>

      <group ref={figureLeanRef}>
        <mesh geometry={bodyGeo} castShadow receiveShadow>
          <meshPhysicalMaterial
            color={monolithColor}
            roughness={0.32}
            metalness={0.08}
            opacity={0.88}
            transparent
            clearcoat={0.5}
            clearcoatRoughness={0.22}
            sheen={0.55}
            sheenRoughness={0.35}
            sheenColor={sheenTint}
            ior={1.48}
          />
        </mesh>

        <mesh
          position={[0, 1.385, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[1.06, 0.68, 1]}
        >
          <torusGeometry args={[0.045, 0.003, 12, 36]} />
          <meshStandardMaterial
            color={palette.rackMetal}
            metalness={0.85}
            roughness={0.26}
          />
        </mesh>

        <mesh
          ref={headMeshRef}
          geometry={headGeo}
          position={[0, 1.4, 0.004]}
          castShadow
          receiveShadow
        >
          <meshPhysicalMaterial
            color={monolithColor}
            roughness={0.32}
            metalness={0.08}
            opacity={0.88}
            transparent
            clearcoat={0.5}
            clearcoatRoughness={0.22}
            sheen={0.55}
            sheenRoughness={0.35}
            sheenColor={sheenTint}
            ior={1.48}
          />
        </mesh>
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

  // Default to clean first-person architectural walkthrough ('first_person')
  const [internalPov, setInternalPov] = useState<PlayerPovMode>('first_person');
  const didInitFirstPersonRef = useRef<boolean>(false);

  useEffect(() => {
    if (!enabled) {
      didInitFirstPersonRef.current = false;
      return;
    }
    if (!didInitFirstPersonRef.current) {
      didInitFirstPersonRef.current = true;
      setInternalPov('first_person');
      if (controlledPovMode !== 'first_person' && onPovModeChange) {
        onPovModeChange('first_person');
      }
    }
  }, [enabled, controlledPovMode, onPovModeChange]);

  const activePov: PlayerPovMode =
    !didInitFirstPersonRef.current && onPovModeChange
      ? 'first_person'
      : (controlledPovMode ?? internalPov);
  const activePovRef = useRef<PlayerPovMode>(activePov);
  activePovRef.current = activePov;

  const [nearbyTarget, setNearbyTarget] = useState<WorldProductTarget | null>(null);
  const nearbyTargetRef = useRef<WorldProductTarget | null>(null);
  const [interactPulse, setInteractPulse] = useState<number>(0);

  // Smooth damped walkthrough physics state
  const playerPos = useRef(
    new THREE.Vector3(initialPosition[0], 0, initialPosition[2])
  );
  const velocityXZ = useRef<{ x: number; z: number }>({ x: 0, z: 0 });
  const avatarYaw = useRef<number>(Math.PI);
  const cameraYaw = useRef<number>(initialYaw);
  const cameraPitch = useRef<number>(0.04); // Calm gallery eye-level pitch
  const stepPhase = useRef<number>(0);
  const glideLean = useRef<number>(0);

  const pressedKeys = useRef<Set<string>>(new Set());
  const isDraggingLook = useRef<boolean>(false);
  const lastPointer = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const avatarRootRef = useRef<THREE.Group>(null);
  const figureLeanRef = useRef<THREE.Group>(null);
  const headMeshRef = useRef<THREE.Mesh>(null);

  const scratchPivot = useRef(new THREE.Vector3());
  const scratchDesiredCam = useRef(new THREE.Vector3());
  const scratchClampedCam = useRef(new THREE.Vector3());
  const scratchLookTarget = useRef(new THREE.Vector3());

  const obstacles = useMemo(
    () => buildBoutiqueObstacles(config, showSecondaryRack),
    [config, showSecondaryRack]
  );

  const productTargets = useMemo(
    () => buildProductTargets(config, showSecondaryRack),
    [config, showSecondaryRack]
  );

  const togglePov = useCallback(() => {
    const next: PlayerPovMode =
      activePovRef.current === 'first_person' ? 'third_person' : 'first_person';
    if (controlledPovMode === undefined) {
      setInternalPov(next);
    }
    onPovModeChange?.(next);
  }, [controlledPovMode, onPovModeChange]);

  const triggerGarmentInteract = useCallback(
    (target: WorldProductTarget | null) => {
      if (!target) return;
      setInteractPulse(1);
      onInteractGarment?.(target.id, target.asset);
    },
    [onInteractGarment]
  );

  useEffect(() => {
    if (interactPulse <= 0) return;
    const timer = window.setTimeout(() => setInteractPulse(0), 320);
    return () => window.clearTimeout(timer);
  }, [interactPulse]);

  // Disable OrbitControls while walkthrough controller owns the camera
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

  // Keyboard & Mouse-Drag Walkthrough Listeners
  useEffect(() => {
    if (!enabled) {
      pressedKeys.current.clear();
      isDraggingLook.current = false;
      velocityXZ.current = { x: 0, z: 0 };
      return;
    }

    const canvasEl = gl.domElement;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableElementActive()) return;

      const code = e.code;
      if (
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

      const sensitivity = 0.0046;
      cameraYaw.current -= dx * sensitivity;

      const maxPitch = activePovRef.current === 'first_person' ? 0.78 : 0.62;
      const minPitch = activePovRef.current === 'first_person' ? -0.75 : -0.18;
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

    // 1. Optional Q / E gentle yaw pan when E isn't inspecting a nearby product
    const turnSpeed = 1.65;
    if (keys.has('KeyQ')) {
      cameraYaw.current += turnSpeed * dt;
    }
    if (keys.has('KeyE') && !nearbyTargetRef.current) {
      cameraYaw.current -= turnSpeed * dt;
    }

    // 2. Desired Walkthrough Velocity Relative to Camera Yaw
    let inputForward = 0;
    let inputRight = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) inputForward += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) inputForward -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) inputRight += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) inputRight -= 1;

    const isBrisk = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const maxSpeed = isBrisk ? GALLERY_BRISK_SPEED : GALLERY_WALK_SPEED;

    const yaw = cameraYaw.current;
    const forwardX = -Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);

    let desiredVx = forwardX * inputForward + rightX * inputRight;
    let desiredVz = forwardZ * inputForward + rightZ * inputRight;
    const inputMag = Math.hypot(desiredVx, desiredVz);

    if (inputMag > 0.001) {
      desiredVx = (desiredVx / inputMag) * maxSpeed;
      desiredVz = (desiredVz / inputMag) * maxSpeed;
    }

    // Exponentially damped gallery glide acceleration & deceleration
    const dampingRate = inputMag > 0.001 ? 10.5 : 13.0;
    const dampAlpha = 1 - Math.exp(-dampingRate * dt);
    velocityXZ.current.x = THREE.MathUtils.lerp(velocityXZ.current.x, desiredVx, dampAlpha);
    velocityXZ.current.z = THREE.MathUtils.lerp(velocityXZ.current.z, desiredVz, dampAlpha);

    const speedSq =
      velocityXZ.current.x * velocityXZ.current.x +
      velocityXZ.current.z * velocityXZ.current.z;
    const currentSpeed = Math.sqrt(speedSq);
    const isMoving = currentSpeed > 0.04;

    // 3. Horizontal Integration + Smooth Sliding Obstacle & Wall Collision
    let nextX = playerPos.current.x + velocityXZ.current.x * dt;
    let nextZ = playerPos.current.z + velocityXZ.current.z * dt;

    for (let pass = 0; pass < 2; pass++) {
      for (const obs of obstacles) {
        [nextX, nextZ] = resolveCircleObb2D(nextX, nextZ, PLAYER_RADIUS, obs);
      }
      nextX = THREE.MathUtils.clamp(nextX, ROOM_PLAYER_BOUNDS.minX, ROOM_PLAYER_BOUNDS.maxX);
      nextZ = THREE.MathUtils.clamp(nextZ, ROOM_PLAYER_BOUNDS.minZ, ROOM_PLAYER_BOUNDS.maxZ);
    }

    playerPos.current.x = nextX;
    playerPos.current.y = 0;
    playerPos.current.z = nextZ;

    // 4. Silhouette Heading & Composed Monolith Poise (for 3rd-person toggle)
    if (activePovRef.current === 'first_person') {
      avatarYaw.current = yaw + Math.PI;
    } else if (isMoving) {
      const desiredAvatarYaw = Math.atan2(velocityXZ.current.x, velocityXZ.current.z);
      avatarYaw.current = lerpAngleShortest(
        avatarYaw.current,
        desiredAvatarYaw,
        Math.min(1, dt * 10)
      );
    }

    if (avatarRootRef.current) {
      avatarRootRef.current.position.copy(playerPos.current);
      avatarRootRef.current.rotation.y = avatarYaw.current;
    }

    if (isMoving) {
      stepPhase.current += dt * (currentSpeed * 3.1);
    }

    const targetLean = isMoving ? 0.018 : 0;
    glideLean.current = THREE.MathUtils.lerp(glideLean.current, targetLean, Math.min(1, dt * 7));
    if (figureLeanRef.current) {
      figureLeanRef.current.rotation.x = glideLean.current;
    }
    if (headMeshRef.current) {
      headMeshRef.current.position.y = 1.4 + Math.sin(elapsed * 1.4) * 0.0018;
    }

    // 5. Camera Placement: Clean 1st-Person Gallery Walkthrough (eyeHeight = 1.56m) vs 3rd-Person Silhouette
    const pitch = cameraPitch.current;
    if (activePovRef.current === 'first_person') {
      const subtleStepOffset = isMoving
        ? Math.sin(stepPhase.current) * 0.005 * THREE.MathUtils.clamp(currentSpeed / GALLERY_WALK_SPEED, 0, 1)
        : 0;

      scratchDesiredCam.current.set(
        THREE.MathUtils.clamp(
          playerPos.current.x,
          ROOM_CAMERA_SAFE_BOUNDS.minX,
          ROOM_CAMERA_SAFE_BOUNDS.maxX
        ),
        FIRST_PERSON_EYE_HEIGHT + subtleStepOffset,
        THREE.MathUtils.clamp(
          playerPos.current.z,
          ROOM_CAMERA_SAFE_BOUNDS.minZ,
          ROOM_CAMERA_SAFE_BOUNDS.maxZ
        )
      );
      camera.position.lerp(scratchDesiredCam.current, Math.min(1, dt * 24));

      const cosP = Math.cos(pitch);
      scratchLookTarget.current.set(
        camera.position.x - Math.sin(yaw) * cosP,
        camera.position.y - Math.sin(pitch),
        camera.position.z - Math.cos(yaw) * cosP
      );
      camera.lookAt(scratchLookTarget.current);
    } else {
      scratchPivot.current.set(
        playerPos.current.x + rightX * THIRD_PERSON_SHOULDER_OFFSET,
        THIRD_PERSON_PIVOT_HEIGHT,
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

    // 6. Nearest Product Proximity Check
    let closest: WorldProductTarget | null = null;
    let closestDist = INTERACT_RADIUS;

    for (const pt of productTargets) {
      const d = Math.hypot(
        pt.worldX - playerPos.current.x,
        pt.worldZ - playerPos.current.z
      );
      if (d <= closestDist) {
        closestDist = d;
        closest = pt;
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
    <group name="gallery-walkthrough-layer">
      <group ref={avatarRootRef} position={initialPosition}>
        <ArchitecturalPlayerSilhouette
          palette={config.palette}
          visible={activePov === 'third_person'}
          figureLeanRef={figureLeanRef}
          headMeshRef={headMeshRef}
          interactPulse={interactPulse}
        />
      </group>

      {/* Clean Architectural Product Inspection Prompt */}
      {nearbyTarget && (
        <Html
          position={[
            nearbyTarget.worldX,
            nearbyTarget.worldY + 0.26,
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
              padding: '6px 12px',
              borderRadius: 999,
              border: '1px solid rgba(255, 255, 255, 0.22)',
              background: 'rgba(14, 15, 16, 0.88)',
              backdropFilter: 'blur(12px)',
              color: '#F7F4EC',
              fontSize: 11.5,
              fontWeight: 500,
              letterSpacing: '0.02em',
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.38)',
              fontFamily: 'system-ui, -apple-system, sans-serif',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 20,
                height: 20,
                padding: '0 5px',
                borderRadius: 5,
                background: 'rgba(212, 175, 55, 0.22)',
                border: '1px solid rgba(212, 175, 55, 0.55)',
                color: '#E7C96B',
                fontWeight: 700,
                fontSize: 10.5,
              }}
            >
              E
            </span>
            <span>
              Inspect {nearbyTarget.asset.title} · ${nearbyTarget.asset.price}
            </span>
          </button>
        </Html>
      )}
    </group>
  );
};

/**
 * Clean Architectural Walkthrough Controls Hint Pill
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
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '6px 14px',
        borderRadius: 999,
        background: 'rgba(15, 16, 17, 0.84)',
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
        <strong style={{ color: '#D4AF37', fontWeight: 600 }}>WASD</strong> Walk Gallery ·{' '}
        <strong style={{ color: '#D4AF37', fontWeight: 600 }}>Drag Mouse</strong> Look ·{' '}
        <strong style={{ color: '#D4AF37', fontWeight: 600 }}>E</strong> Inspect Product ·{' '}
        <strong style={{ color: '#D4AF37', fontWeight: 600 }}>V</strong> Toggle View
      </span>
      {povMode && (
        <button
          type="button"
          onClick={onTogglePov}
          style={{
            border: '1px solid rgba(212, 175, 55, 0.42)',
            background: 'rgba(212, 175, 55, 0.14)',
            color: '#F2DFA0',
            borderRadius: 999,
            padding: '2px 8px',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.03em',
            cursor: onTogglePov ? 'pointer' : 'default',
          }}
        >
          {povMode === 'first_person' ? '1st Person' : 'Silhouette'}
        </button>
      )}
      {nearbyGarmentTitle && (
        <span style={{ color: '#B7DEC8', fontWeight: 600 }}>
          · {nearbyGarmentTitle}
        </span>
      )}
    </div>
  );
};
