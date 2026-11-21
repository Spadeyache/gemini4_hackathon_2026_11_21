import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

export type CameraPresetId = 'hero' | 'objects' | 'macro' | 'side' | 'rear' | 'wide';

export const CAMERA_PRESETS: Record<
  CameraPresetId,
  {
    label: string;
    position: [number, number, number];
    target: [number, number, number];
  }
> = {
  hero: {
    label: 'Showroom',
    position: [0.35, 1.44, 3.55],
    target: [0.18, 1.18, -0.05],
  },
  objects: {
    label: '3D Objects',
    position: [0.85, 1.34, 2.28],
    target: [1.68, 0.92, 0.12],
  },
  macro: {
    label: 'Garment Detail',
    position: [0.22, 1.56, 1.32],
    target: [0, 1.38, 0.02],
  },
  side: {
    label: '3D Drape Profile',
    position: [1.38, 1.32, 0.68],
    target: [0, 1.22, 0.02],
  },
  rear: {
    label: 'Back Seam (360°)',
    position: [1.18, 1.46, -1.28],
    target: [0, 1.28, 0],
  },
  wide: {
    label: 'Boutique World',
    position: [-1.55, 1.72, 4.35],
    target: [0.05, 1.32, -0.35],
  },
};

interface CameraRigProps {
  preset: CameraPresetId;
  instant?: boolean;
}

export function CameraRig({ preset, instant = false }: CameraRigProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();

  const desiredPos = useRef(new THREE.Vector3(...CAMERA_PRESETS[preset].position));
  const desiredTarget = useRef(new THREE.Vector3(...CAMERA_PRESETS[preset].target));
  const isTransitioning = useRef(false);

  useEffect(() => {
    const spec = CAMERA_PRESETS[preset];
    desiredPos.current.set(...spec.position);
    desiredTarget.current.set(...spec.target);

    if (instant) {
      camera.position.copy(desiredPos.current);
      if (controlsRef.current) {
        controlsRef.current.target.copy(desiredTarget.current);
        controlsRef.current.update();
      }
      isTransitioning.current = false;
    } else {
      isTransitioning.current = true;
    }
  }, [preset, instant, camera]);

  useFrame((_, delta) => {
    if (!controlsRef.current) return;
    if (isTransitioning.current) {
      const step = Math.min(1, delta * 5.5);
      camera.position.lerp(desiredPos.current, step);
      controlsRef.current.target.lerp(desiredTarget.current, step);
      controlsRef.current.update();

      if (
        camera.position.distanceTo(desiredPos.current) < 0.015 &&
        controlsRef.current.target.distanceTo(desiredTarget.current) < 0.015
      ) {
        isTransitioning.current = false;
      }
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.06}
      minDistance={0.75}
      maxDistance={7.5}
      minPolarAngle={0.25}
      maxPolarAngle={Math.PI / 2 - 0.03}
      onStart={() => {
        isTransitioning.current = false;
      }}
    />
  );
}
