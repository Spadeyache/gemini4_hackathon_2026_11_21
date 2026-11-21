import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type {
  BrandCore,
  Product,
  SessionState,
  WorldSpec,
} from "@mybrand/shared";
import * as THREE from "three";
import {
  getGuideTargetZone,
  getHeroProductId,
} from "../../state/sessionState";
import { buildColliders } from "../../world/collision";
import { extractBrandPalette } from "../../world/geometryUtils";
import { buildWorldThemeAtmosphere } from "../../world/themeAtmosphere";
import {
  computeInitialSpawn,
  computeRoomBounds,
} from "../../world/roomLayout";
import { getCachedTextureCount } from "../../world/textureCache";
import { DioramaCameraController } from "./DioramaCameraController";
import { FirstPersonController } from "./FirstPersonController";
import { GuidePath } from "./GuidePath";
import { HeroPlinth } from "./HeroPlinth";
import type { ProductHitData } from "./ProductDisplay";
import { RoomShell } from "./RoomShell";
import { ZoneGroup } from "./ZoneGroup";

export type CameraMode = "diorama" | "walk";

export interface TargetGazeInfo {
  product: Product;
  slotId: string;
  zoneId: string;
  progress01: number;
  cursorX?: number;
  cursorY?: number;
}

export interface ScenePerfStats {
  fps: number;
  objects: number;
  textures: number;
}

interface BoutiqueSceneProps {
  brandCore: BrandCore;
  worldSpec: WorldSpec;
  sessionState: SessionState;
  productById: Map<string, Product>;
  assetUrlById: Map<string, string>;
  cameraMode: CameraMode;
  focusedZoneId: string | null;
  controlsDisabled: boolean;
  pointerLocked: boolean;
  onPointerLockChange: (locked: boolean) => void;
  onZoneChange: (
    nextZoneId: string | null,
    prevZoneId: string | null,
    dwellMs: number
  ) => void;
  onFocusZone: (zoneId: string | null) => void;
  onLookEvent: (productId: string, zoneId: string, ms: number) => void;
  onInspectProduct: (product: Product, zoneId: string) => void;
  onTargetChange: (target: TargetGazeInfo | null) => void;
  onPerfStats: (stats: ScenePerfStats) => void;
}

const LOOK_MIN_MS = 600;
const LOOK_TICK_MS = 1000;
const MAX_WALK_LOOK_DISTANCE_M = 7.5;
const MAX_DIORAMA_LOOK_DISTANCE_M = 95;
const RAYCAST_INTERVAL_S = 0.065; // ~15 Hz ray polling

function isProductHitData(data: unknown): data is ProductHitData {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as Record<string, unknown>).isProductTarget === true &&
    typeof (data as Record<string, unknown>).productId === "string"
  );
}

export function BoutiqueScene({
  brandCore,
  worldSpec,
  sessionState,
  productById,
  assetUrlById,
  cameraMode,
  focusedZoneId,
  controlsDisabled,
  pointerLocked,
  onPointerLockChange,
  onZoneChange,
  onFocusZone,
  onLookEvent,
  onInspectProduct,
  onTargetChange,
  onPerfStats,
}: BoutiqueSceneProps) {
  const { camera, scene, gl } = useThree();

  const palette = useMemo(() => extractBrandPalette(brandCore), [brandCore]);
  const theme = useMemo(
    () => buildWorldThemeAtmosphere(brandCore, palette, worldSpec),
    [brandCore, palette, worldSpec]
  );
  const bounds = useMemo(() => computeRoomBounds(worldSpec), [worldSpec]);
  const spawn = useMemo(
    () => computeInitialSpawn(worldSpec, bounds),
    [worldSpec, bounds]
  );
  const colliders = useMemo(() => buildColliders(worldSpec), [worldSpec]);

  const activeHeroProductId = getHeroProductId(sessionState, worldSpec);
  const activeGuideZoneId = getGuideTargetZone(sessionState, worldSpec);

  const [targetedKey, setTargetedKey] = useState<string | null>(null);

  // Reusable raycast helpers (zero per-frame allocations)
  const raycasterRef = useRef(new THREE.Raycaster());
  const centerNdcRef = useRef(new THREE.Vector2(0, 0));
  const pointerNdcRef = useRef(new THREE.Vector2(0, 0));
  const pointerActiveRef = useRef(false);
  const cursorScreenRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const wasDraggingRef = useRef(false);

  const raycastAccumRef = useRef(0);
  const hitTargetsRef = useRef<THREE.Object3D[]>([]);

  const gazeRef = useRef<{
    productId: string | null;
    slotId: string | null;
    zoneId: string | null;
    targetKey: string | null;
    startedAtMs: number;
    reportedMs: number;
    lastHudProgress: number;
    lastCursorX: number;
    lastCursorY: number;
  }>({
    productId: null,
    slotId: null,
    zoneId: null,
    targetKey: null,
    startedAtMs: 0,
    reportedMs: 0,
    lastHudProgress: -1,
    lastCursorX: -1,
    lastCursorY: -1,
  });

  // FPS & scene budget counters
  const perfRef = useRef({ frames: 0, elapsed: 0 });

  // Refresh hit-target array whenever rendered slot assignments may change
  useEffect(() => {
    const targets: THREE.Object3D[] = [];
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh && isProductHitData(obj.userData)) {
        targets.push(obj);
      }
    });
    hitTargetsRef.current = targets;
  }, [scene, sessionState, worldSpec]);

  const finalizeGaze = useCallback(
    (nowMs: number) => {
      const gaze = gazeRef.current;
      if (!gaze.productId || !gaze.zoneId) return;

      const totalMs = Math.max(0, Math.round(nowMs - gaze.startedAtMs));
      if (gaze.reportedMs === 0 && totalMs >= LOOK_MIN_MS) {
        onLookEvent(gaze.productId, gaze.zoneId, totalMs);
      } else if (gaze.reportedMs > 0 && totalMs - gaze.reportedMs >= 200) {
        onLookEvent(gaze.productId, gaze.zoneId, totalMs - gaze.reportedMs);
      }

      gaze.productId = null;
      gaze.slotId = null;
      gaze.zoneId = null;
      gaze.targetKey = null;
      gaze.startedAtMs = 0;
      gaze.reportedMs = 0;
      gaze.lastHudProgress = -1;
      gaze.lastCursorX = -1;
      gaze.lastCursorY = -1;
      setTargetedKey(null);
      onTargetChange(null);
    },
    [onLookEvent, onTargetChange]
  );

  // Flush any active gaze when inspect panel/overlay opens, camera mode switches, or unmounts
  useEffect(() => {
    if (controlsDisabled) {
      finalizeGaze(performance.now());
    }
  }, [controlsDisabled, finalizeGaze]);

  useEffect(() => {
    finalizeGaze(performance.now());
    pointerActiveRef.current = false;
  }, [cameraMode, finalizeGaze]);

  useEffect(() => {
    return () => {
      finalizeGaze(performance.now());
    };
  }, [finalizeGaze]);

  // Track pointer NDC in 2.5D Diorama mode for direct cursor raycasting
  useEffect(() => {
    if (cameraMode !== "diorama") return;
    const domElement = gl.domElement;

    const handlePointerMove = (event: PointerEvent) => {
      const rect = domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      pointerNdcRef.current.set(nx, ny);
      cursorScreenRef.current = { x: event.clientX, y: event.clientY };
      pointerActiveRef.current = true;
    };

    const handlePointerLeave = () => {
      pointerActiveRef.current = false;
      finalizeGaze(performance.now());
    };

    domElement.addEventListener("pointermove", handlePointerMove);
    domElement.addEventListener("pointerleave", handlePointerLeave);
    return () => {
      domElement.removeEventListener("pointermove", handlePointerMove);
      domElement.removeEventListener("pointerleave", handlePointerLeave);
    };
  }, [cameraMode, gl.domElement, finalizeGaze]);

  // Update canvas cursor smoothly when hovering a product in 2.5D Diorama mode
  useEffect(() => {
    const domElement = gl.domElement;
    if (cameraMode === "diorama" && !controlsDisabled) {
      domElement.style.cursor = targetedKey ? "pointer" : "grab";
    } else {
      domElement.style.cursor = "";
    }
    return () => {
      domElement.style.cursor = "";
    };
  }, [cameraMode, controlsDisabled, targetedKey, gl.domElement]);

  const handleSelectProduct = useCallback(
    (product: Product, zoneId: string) => {
      if (cameraMode === "diorama" && wasDraggingRef.current) return;
      finalizeGaze(performance.now());
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
      onInspectProduct(product, zoneId);
    },
    [cameraMode, finalizeGaze, onInspectProduct]
  );

  const handleDioramaFocusZone = useCallback(
    (zoneId: string) => {
      if (cameraMode !== "diorama" || wasDraggingRef.current) return;
      onFocusZone(zoneId);
    },
    [cameraMode, onFocusZone]
  );

  // While pointer-locked in Walk mode, left-click inspects the product under the center crosshair
  useEffect(() => {
    if (cameraMode !== "walk") return;
    const domElement = gl.domElement;

    const handleCanvasClick = () => {
      if (controlsDisabled) return;

      if (pointerLocked) {
        const gaze = gazeRef.current;
        if (gaze.productId && gaze.zoneId) {
          const product = productById.get(gaze.productId);
          if (product) {
            handleSelectProduct(product, gaze.zoneId);
          }
        }
      }
    };

    domElement.addEventListener("click", handleCanvasClick);
    return () => {
      domElement.removeEventListener("click", handleCanvasClick);
    };
  }, [
    cameraMode,
    gl.domElement,
    controlsDisabled,
    pointerLocked,
    productById,
    handleSelectProduct,
  ]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);

    // Performance & budget telemetry (~2 Hz)
    perfRef.current.frames += 1;
    perfRef.current.elapsed += dt;
    if (perfRef.current.elapsed >= 0.5) {
      const fps = Math.round(perfRef.current.frames / perfRef.current.elapsed);
      let meshAndLightCount = 0;
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Light) {
          meshAndLightCount += 1;
        }
      });
      const gpuTextures = Math.max(
        gl.info.memory.textures,
        getCachedTextureCount()
      );
      onPerfStats({
        fps,
        objects: meshAndLightCount,
        textures: gpuTextures,
      });
      perfRef.current.frames = 0;
      perfRef.current.elapsed = 0;
    }

    if (controlsDisabled) return;

    // Throttled raycast for look detection (cursor ray in diorama mode, center reticle ray in walk mode)
    raycastAccumRef.current += dt;
    if (raycastAccumRef.current < RAYCAST_INTERVAL_S) return;
    raycastAccumRef.current = 0;

    if (cameraMode === "diorama" && !pointerActiveRef.current) {
      if (gazeRef.current.productId !== null) {
        finalizeGaze(performance.now());
      }
      return;
    }

    let targets = hitTargetsRef.current;
    if (targets.length === 0) {
      const refreshed: THREE.Object3D[] = [];
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh && isProductHitData(obj.userData)) {
          refreshed.push(obj);
        }
      });
      hitTargetsRef.current = refreshed;
      targets = refreshed;
    }
    if (targets.length === 0) return;

    const raycaster = raycasterRef.current;
    raycaster.far =
      cameraMode === "diorama"
        ? MAX_DIORAMA_LOOK_DISTANCE_M
        : MAX_WALK_LOOK_DISTANCE_M;
    raycaster.setFromCamera(
      cameraMode === "diorama" ? pointerNdcRef.current : centerNdcRef.current,
      camera
    );

    const hits = raycaster.intersectObjects(targets, false);
    const nowMs = performance.now();
    const firstValidHit = hits.find((hit) =>
      isProductHitData(hit.object.userData)
    );

    if (!firstValidHit) {
      if (gazeRef.current.productId !== null) {
        finalizeGaze(nowMs);
      }
      return;
    }

    const hitData = firstValidHit.object.userData as ProductHitData;
    const product = productById.get(hitData.productId);
    if (!product) {
      if (gazeRef.current.productId !== null) {
        finalizeGaze(nowMs);
      }
      return;
    }

    const nextKey = `${hitData.zoneId}:${hitData.slotId}`;
    const cursorX =
      cameraMode === "diorama" ? cursorScreenRef.current.x : undefined;
    const cursorY =
      cameraMode === "diorama" ? cursorScreenRef.current.y : undefined;

    const gaze = gazeRef.current;
    if (gaze.productId !== hitData.productId || gaze.targetKey !== nextKey) {
      if (gaze.productId !== null) {
        finalizeGaze(nowMs);
      }
      gaze.productId = hitData.productId;
      gaze.slotId = hitData.slotId;
      gaze.zoneId = hitData.zoneId;
      gaze.targetKey = nextKey;
      gaze.startedAtMs = nowMs;
      gaze.reportedMs = 0;
      gaze.lastHudProgress = 0;
      gaze.lastCursorX = cursorX ?? -1;
      gaze.lastCursorY = cursorY ?? -1;
      setTargetedKey(nextKey);
      onTargetChange({
        product,
        slotId: hitData.slotId,
        zoneId: hitData.zoneId,
        progress01: 0,
        cursorX,
        cursorY,
      });
      return;
    }

    const totalMs = nowMs - gaze.startedAtMs;
    const progress01 = Math.min(1, totalMs / LOOK_MIN_MS);
    const cursorMoved =
      cursorX !== undefined &&
      cursorY !== undefined &&
      Math.hypot(cursorX - gaze.lastCursorX, cursorY - gaze.lastCursorY) >= 8;

    if (
      Math.abs(progress01 - gaze.lastHudProgress) >= 0.08 ||
      (progress01 === 1 && gaze.lastHudProgress < 1) ||
      cursorMoved
    ) {
      gaze.lastHudProgress = progress01;
      if (cursorX !== undefined && cursorY !== undefined) {
        gaze.lastCursorX = cursorX;
        gaze.lastCursorY = cursorY;
      }
      onTargetChange({
        product,
        slotId: hitData.slotId,
        zoneId: hitData.zoneId,
        progress01,
        cursorX,
        cursorY,
      });
    }

    if (gaze.reportedMs === 0 && totalMs >= LOOK_MIN_MS) {
      const chunk = Math.round(totalMs);
      gaze.reportedMs = chunk;
      onLookEvent(hitData.productId, hitData.zoneId, chunk);
    } else if (
      gaze.reportedMs > 0 &&
      totalMs - gaze.reportedMs >= LOOK_TICK_MS
    ) {
      const chunk = Math.round(totalMs - gaze.reportedMs);
      gaze.reportedMs += chunk;
      onLookEvent(hitData.productId, hitData.zoneId, chunk);
    }
  });

  // Dynamic fog scaled to room size (pushed further back in elevated 2.5D Diorama mode)
  const roomDiag = Math.hypot(bounds.width, bounds.depth);
  const fogNear =
    cameraMode === "diorama"
      ? Math.max(24, roomDiag * 1.25)
      : Math.max(12, roomDiag * 0.65);
  const fogFar =
    cameraMode === "diorama"
      ? Math.max(58, roomDiag * 3.0)
      : Math.max(26, roomDiag * 1.45);

  return (
    <>
      <color attach="background" args={[theme.fogColor]} />
      <fog attach="fog" args={[theme.fogColor, fogNear, fogFar]} />

      {/* Theme-calibrated atmospheric key + sky/ground fill lighting */}
      <ambientLight
        intensity={cameraMode === "diorama" ? theme.ambientIntensity : 0.48}
        color={theme.ambientColor}
      />
      <hemisphereLight args={[theme.hemiSkyColor, theme.hemiGroundColor, 0.72]} />
      <directionalLight
        position={[bounds.centerX + 8, 12, bounds.maxZ + 6]}
        intensity={theme.sunIntensity}
        color={theme.sunColor}
      />

      {cameraMode === "diorama" ? (
        <DioramaCameraController
          worldSpec={worldSpec}
          bounds={bounds}
          focusedZoneId={focusedZoneId}
          controlsDisabled={controlsDisabled}
          wasDraggingRef={wasDraggingRef}
        />
      ) : (
        <FirstPersonController
          worldSpec={worldSpec}
          bounds={bounds}
          spawn={spawn}
          colliders={colliders}
          controlsDisabled={controlsDisabled}
          onPointerLockChange={onPointerLockChange}
          onZoneChange={onZoneChange}
        />
      )}

      <RoomShell
        brandCore={brandCore}
        worldSpec={worldSpec}
        bounds={bounds}
        palette={palette}
        theme={theme}
        assetUrlById={assetUrlById}
        cameraMode={cameraMode}
      />

      <HeroPlinth
        worldSpec={worldSpec}
        activeProductId={activeHeroProductId}
        productById={productById}
        assetUrlById={assetUrlById}
        palette={palette}
        targetedKey={targetedKey}
        onSelectProduct={handleSelectProduct}
      />

      {worldSpec.zones.map((zone, zoneIndex) => (
        <ZoneGroup
          key={zone.id}
          zone={zone}
          zoneIndex={zoneIndex}
          worldSpec={worldSpec}
          sessionState={sessionState}
          productById={productById}
          assetUrlById={assetUrlById}
          palette={palette}
          targetedKey={targetedKey}
          cameraMode={cameraMode}
          isFocusedZone={focusedZoneId === zone.id}
          onFocusZone={handleDioramaFocusZone}
          onSelectProduct={handleSelectProduct}
        />
      ))}

      <GuidePath
        worldSpec={worldSpec}
        targetZoneId={activeGuideZoneId}
        palette={palette}
      />
    </>
  );
}
