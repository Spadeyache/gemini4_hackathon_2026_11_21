import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { WorldSpec } from "@mybrand/shared";
import * as THREE from "three";
import { resolvePlayerMovement, type BoxCollider2D } from "../../world/collision";
import {
  EYE_HEIGHT_M,
  PLAYER_RADIUS_M,
  findZoneAtPosition,
  type RoomBounds,
  type SpawnTransform,
} from "../../world/roomLayout";

interface FirstPersonControllerProps {
  worldSpec: WorldSpec;
  bounds: RoomBounds;
  spawn: SpawnTransform;
  colliders: readonly BoxCollider2D[];
  controlsDisabled: boolean;
  onPointerLockChange: (locked: boolean) => void;
  onZoneChange: (nextZoneId: string | null, prevZoneId: string | null, dwellMs: number) => void;
}

const WALK_SPEED_MPS = 3.2;
const MOUSE_SENSITIVITY = 0.0022;
const DRAG_SENSITIVITY = 0.004;
const KEY_TURN_SPEED = 1.65;
const MAX_PITCH_RAD = THREE.MathUtils.degToRad(65);

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export function FirstPersonController({
  worldSpec,
  bounds,
  spawn,
  colliders,
  controlsDisabled,
  onPointerLockChange,
  onZoneChange,
}: FirstPersonControllerProps) {
  const { camera, gl } = useThree();

  const keysRef = useRef<Set<string>>(new Set());
  const yawRef = useRef(spawn.yaw);
  const pitchRef = useRef(0);
  const pointerLockedRef = useRef(false);
  const isDraggingRef = useRef(false);
  const lastDragPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const currentZoneRef = useRef<string | null>(null);
  const zoneEnteredAtRef = useRef<number>(performance.now());

  // Reusable scratch vectors (zero per-frame allocations)
  const forwardRef = useRef(new THREE.Vector3());
  const rightRef = useRef(new THREE.Vector3());
  const moveRef = useRef(new THREE.Vector3());

  // Initialize camera spawn transform
  useEffect(() => {
    camera.rotation.order = "YXZ";
    camera.position.set(spawn.position[0], spawn.position[1], spawn.position[2]);
    yawRef.current = spawn.yaw;
    pitchRef.current = -0.04;
    camera.rotation.set(pitchRef.current, yawRef.current, 0, "YXZ");

    const startZone = findZoneAtPosition(
      worldSpec.zones,
      spawn.position[0],
      spawn.position[2]
    );
    currentZoneRef.current = startZone?.id ?? null;
    zoneEnteredAtRef.current = performance.now();
    if (startZone) {
      onZoneChange(startZone.id, null, 0);
    }
  }, [camera, spawn, worldSpec.zones, onZoneChange]);

  // Pointer lock, mouse look, drag fallback, and keyboard handlers
  useEffect(() => {
    const domElement = gl.domElement;

    const handlePointerLockChange = () => {
      const locked = document.pointerLockElement === domElement;
      pointerLockedRef.current = locked;
      onPointerLockChange(locked);
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (controlsDisabled) return;

      if (pointerLockedRef.current) {
        yawRef.current -= event.movementX * MOUSE_SENSITIVITY;
        pitchRef.current = THREE.MathUtils.clamp(
          pitchRef.current - event.movementY * MOUSE_SENSITIVITY,
          -MAX_PITCH_RAD,
          MAX_PITCH_RAD
        );
      } else if (isDraggingRef.current) {
        const dx = event.clientX - lastDragPosRef.current.x;
        const dy = event.clientY - lastDragPosRef.current.y;
        lastDragPosRef.current = { x: event.clientX, y: event.clientY };
        yawRef.current -= dx * DRAG_SENSITIVITY;
        pitchRef.current = THREE.MathUtils.clamp(
          pitchRef.current - dy * DRAG_SENSITIVITY,
          -MAX_PITCH_RAD,
          MAX_PITCH_RAD
        );
      }
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (controlsDisabled || event.button !== 0) return;
      if (!pointerLockedRef.current) {
        isDraggingRef.current = true;
        lastDragPosRef.current = { x: event.clientX, y: event.clientY };
      }
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      keysRef.current.add(event.code);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      keysRef.current.delete(event.code);
    };

    const handleBlur = () => {
      keysRef.current.clear();
      isDraggingRef.current = false;
    };

    document.addEventListener("pointerlockchange", handlePointerLockChange);
    window.addEventListener("mousemove", handleMouseMove);
    domElement.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);

    return () => {
      document.removeEventListener("pointerlockchange", handlePointerLockChange);
      window.removeEventListener("mousemove", handleMouseMove);
      domElement.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [gl.domElement, controlsDisabled, onPointerLockChange]);

  // Clear stuck keys when modal/panel disables controls
  useEffect(() => {
    if (controlsDisabled) {
      keysRef.current.clear();
      isDraggingRef.current = false;
    }
  }, [controlsDisabled]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const keys = keysRef.current;

    if (!controlsDisabled) {
      // Optional Q/E keyboard yaw turn fallback
      if (keys.has("KeyQ")) yawRef.current += KEY_TURN_SPEED * dt;
      if (keys.has("KeyE")) yawRef.current -= KEY_TURN_SPEED * dt;

      camera.rotation.set(pitchRef.current, yawRef.current, 0, "YXZ");

      const forwardInput =
        (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) -
        (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
      const strafeInput =
        (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) -
        (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);

      if (forwardInput !== 0 || strafeInput !== 0) {
        const yaw = yawRef.current;
        const forward = forwardRef.current.set(-Math.sin(yaw), 0, -Math.cos(yaw));
        const right = rightRef.current.set(Math.cos(yaw), 0, -Math.sin(yaw));
        const move = moveRef.current
          .set(0, 0, 0)
          .addScaledVector(forward, forwardInput)
          .addScaledVector(right, strafeInput);

        if (move.lengthSq() > 0) {
          move.normalize().multiplyScalar(WALK_SPEED_MPS * dt);
          const desiredX = camera.position.x + move.x;
          const desiredZ = camera.position.z + move.z;

          const resolved = resolvePlayerMovement(
            desiredX,
            desiredZ,
            PLAYER_RADIUS_M,
            bounds,
            colliders
          );
          camera.position.x = resolved.x;
          camera.position.z = resolved.z;
          camera.position.y = EYE_HEIGHT_M;
        }
      }
    }

    // Zone enter/exit telemetry check
    const activeZone = findZoneAtPosition(
      worldSpec.zones,
      camera.position.x,
      camera.position.z
    );
    const nextZoneId = activeZone?.id ?? null;

    if (nextZoneId !== currentZoneRef.current) {
      const now = performance.now();
      const dwellMs = Math.max(0, Math.round(now - zoneEnteredAtRef.current));
      const prevZoneId = currentZoneRef.current;
      currentZoneRef.current = nextZoneId;
      zoneEnteredAtRef.current = now;
      onZoneChange(nextZoneId, prevZoneId, dwellMs);
    }
  });

  return null;
}
