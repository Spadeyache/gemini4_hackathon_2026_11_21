import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { WorldSpec } from "@mybrand/shared";
import {
  clampDioramaPose,
  computeDioramaLimits,
  computeDioramaOverview,
  computeDioramaZoneFocus,
  dioramaPoseToCameraPosition,
  type DioramaCameraPose,
} from "../../world/dioramaCamera";
import type { RoomBounds } from "../../world/roomLayout";

interface DioramaCameraControllerProps {
  worldSpec: WorldSpec;
  bounds: RoomBounds;
  focusedZoneId: string | null;
  controlsDisabled: boolean;
  wasDraggingRef: MutableRefObject<boolean>;
}

const ORBIT_SENSITIVITY = 0.0055;
const ELEVATION_SENSITIVITY = 0.0042;
const PAN_SENSITIVITY = 0.015;
const ZOOM_SENSITIVITY = 0.0045;
const SMOOTH_LAMBDA = 7.0;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function DioramaCameraController({
  worldSpec,
  bounds,
  focusedZoneId,
  controlsDisabled,
  wasDraggingRef,
}: DioramaCameraControllerProps) {
  const { camera, gl } = useThree();

  const limits = useMemo(
    () => computeDioramaLimits(worldSpec, bounds),
    [worldSpec, bounds]
  );

  const initialPose = useMemo(
    () => clampDioramaPose(computeDioramaOverview(worldSpec, bounds), bounds, limits),
    [worldSpec, bounds, limits]
  );

  const currentPoseRef = useRef<DioramaCameraPose>({ ...initialPose });
  const targetPoseRef = useRef<DioramaCameraPose>({ ...initialPose });

  const dragRef = useRef<{
    active: boolean;
    mode: "orbit" | "pan";
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  }>({
    active: false,
    mode: "orbit",
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    moved: false,
  });

  // Snap camera immediately on first mount into diorama mode
  useEffect(() => {
    const startPose = clampDioramaPose(
      focusedZoneId
        ? (() => {
            const z = worldSpec.zones.find((item) => item.id === focusedZoneId);
            return z
              ? computeDioramaZoneFocus(z, bounds)
              : computeDioramaOverview(worldSpec, bounds);
          })()
        : computeDioramaOverview(worldSpec, bounds),
      bounds,
      limits
    );

    currentPoseRef.current = { ...startPose };
    targetPoseRef.current = { ...startPose };

    const [cx, cy, cz] = dioramaPoseToCameraPosition(startPose, limits);
    camera.position.set(cx, cy, cz);
    camera.lookAt(startPose.targetX, startPose.targetY, startPose.targetZ);
    // Only snap when mounting / switching worlds; zone changes glide smoothly below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, worldSpec, bounds, limits]);

  // Smoothly glide whenever the user focuses a zone or returns to overview
  useEffect(() => {
    if (!focusedZoneId) {
      targetPoseRef.current = clampDioramaPose(
        computeDioramaOverview(worldSpec, bounds),
        bounds,
        limits
      );
      return;
    }

    const zone = worldSpec.zones.find((z) => z.id === focusedZoneId);
    if (!zone) return;

    targetPoseRef.current = clampDioramaPose(
      computeDioramaZoneFocus(zone, bounds),
      bounds,
      limits
    );
  }, [focusedZoneId, worldSpec, bounds, limits]);

  // Pointer drag orbit/pan and wheel zoom handlers
  useEffect(() => {
    const domElement = gl.domElement;

    const handlePointerDown = (event: PointerEvent) => {
      if (controlsDisabled) return;
      if (event.button !== 0 && event.button !== 2) return;
      dragRef.current = {
        active: true,
        mode: event.button === 2 || event.shiftKey ? "pan" : "orbit",
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        moved: false,
      };
      wasDraggingRef.current = false;
    };

    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag.active || controlsDisabled) return;

      const dx = event.clientX - drag.lastX;
      const dy = event.clientY - drag.lastY;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;

      if (
        !drag.moved &&
        Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6
      ) {
        drag.moved = true;
        wasDraggingRef.current = true;
      }

      if (!drag.moved) return;

      const next = { ...targetPoseRef.current };
      if (drag.mode === "orbit") {
        next.orbitYawOffset -= dx * ORBIT_SENSITIVITY;
        next.elevation += dy * ELEVATION_SENSITIVITY;
      } else {
        const angle = limits.baseOutwardAngle + next.orbitYawOffset;
        // Screen-right unit vector in XZ plane perpendicular to camera view direction
        const rightX = Math.cos(angle);
        const rightZ = -Math.sin(angle);
        const forwardX = -Math.sin(angle);
        const forwardZ = -Math.cos(angle);
        const panScale = PAN_SENSITIVITY * (next.distance / 10);

        next.targetX -= (rightX * dx - forwardX * dy) * panScale;
        next.targetZ -= (rightZ * dx - forwardZ * dy) * panScale;
      }

      targetPoseRef.current = clampDioramaPose(next, bounds, limits);
    };

    const handlePointerUp = () => {
      if (dragRef.current.active) {
        const moved = dragRef.current.moved;
        dragRef.current.active = false;
        dragRef.current.moved = false;
        wasDraggingRef.current = moved;
        if (moved) {
          // Clear drag flag after the click event loop tick so product/floor onClick ignores this drag release
          window.setTimeout(() => {
            wasDraggingRef.current = false;
          }, 0);
        }
      }
    };

    const handleWheel = (event: WheelEvent) => {
      if (controlsDisabled) return;
      event.preventDefault();
      const next = {
        ...targetPoseRef.current,
        distance: targetPoseRef.current.distance + event.deltaY * ZOOM_SENSITIVITY,
      };
      targetPoseRef.current = clampDioramaPose(next, bounds, limits);
    };

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    domElement.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    domElement.addEventListener("wheel", handleWheel, { passive: false });
    domElement.addEventListener("contextmenu", handleContextMenu);

    return () => {
      domElement.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      domElement.removeEventListener("wheel", handleWheel);
      domElement.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [gl.domElement, controlsDisabled, bounds, limits, wasDraggingRef]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const alpha = 1 - Math.exp(-SMOOTH_LAMBDA * dt);

    const cur = currentPoseRef.current;
    const tgt = targetPoseRef.current;

    cur.targetX = lerp(cur.targetX, tgt.targetX, alpha);
    cur.targetY = lerp(cur.targetY, tgt.targetY, alpha);
    cur.targetZ = lerp(cur.targetZ, tgt.targetZ, alpha);
    cur.orbitYawOffset = lerp(cur.orbitYawOffset, tgt.orbitYawOffset, alpha);
    cur.elevation = lerp(cur.elevation, tgt.elevation, alpha);
    cur.distance = lerp(cur.distance, tgt.distance, alpha);

    const [cx, cy, cz] = dioramaPoseToCameraPosition(cur, limits);
    camera.position.set(cx, cy, cz);
    camera.lookAt(cur.targetX, cur.targetY, cur.targetZ);
  });

  return null;
}
