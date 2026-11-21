import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { WorldSpec } from "@mybrand/shared";
import * as THREE from "three";
import type { BrandPalette } from "../../world/geometryUtils";
import { buildGuidePathPoints } from "../../world/roomLayout";

interface GuidePathProps {
  worldSpec: WorldSpec;
  targetZoneId: string;
  palette: BrandPalette;
}

export function GuidePath({
  worldSpec,
  targetZoneId,
  palette,
}: GuidePathProps) {
  const ribbonMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const ringMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const ringMeshRef = useRef<THREE.Mesh>(null);
  const fadeProgressRef = useRef(0);

  const { tubeGeometry, targetCenter } = useMemo(() => {
    const rawPoints = buildGuidePathPoints(worldSpec, targetZoneId);
    const vecPoints = rawPoints.map((pt) => new THREE.Vector3(pt[0], pt[1], pt[2]));
    const curve =
      vecPoints.length >= 2
        ? new THREE.CatmullRomCurve3(vecPoints, false, "catmullrom", 0.45)
        : new THREE.CatmullRomCurve3([
            new THREE.Vector3(0, 0.025, 0.8),
            new THREE.Vector3(0, 0.025, 3),
          ]);

    const geom = new THREE.TubeGeometry(curve, 44, 0.055, 8, false);
    const endPoint = rawPoints[rawPoints.length - 1] ?? [0, 0.025, 3];
    return {
      tubeGeometry: geom,
      targetCenter: [endPoint[0], 0.02, endPoint[2]] as [number, number, number],
    };
  }, [worldSpec, targetZoneId]);

  useEffect(() => {
    fadeProgressRef.current = 0;
    return () => {
      tubeGeometry.dispose();
    };
  }, [tubeGeometry]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    fadeProgressRef.current = Math.min(1, fadeProgressRef.current + dt / 0.5);
    const fade = fadeProgressRef.current;
    const pulse = 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 3.0);

    if (ribbonMatRef.current) {
      ribbonMatRef.current.opacity = (0.68 + 0.24 * pulse) * fade;
      ribbonMatRef.current.emissiveIntensity = (0.85 + 0.55 * pulse) * fade;
    }

    if (ringMatRef.current) {
      ringMatRef.current.opacity = (0.55 + 0.35 * pulse) * fade;
      ringMatRef.current.emissiveIntensity = (0.9 + 0.6 * pulse) * fade;
    }

    if (ringMeshRef.current) {
      const s = 0.94 + 0.1 * pulse;
      ringMeshRef.current.scale.set(s, s, 1);
    }
  });

  return (
    <group name="guide-path-group">
      <mesh
        geometry={tubeGeometry}
        scale={[1, 0.22, 1]}
        name="guide-path-ribbon"
      >
        <meshStandardMaterial
          ref={ribbonMatRef}
          color={palette.accent}
          emissive={palette.accent}
          emissiveIntensity={1.1}
          transparent
          opacity={0.85}
          roughness={0.3}
          depthWrite={false}
        />
      </mesh>

      <mesh
        ref={ringMeshRef}
        position={targetCenter}
        rotation={[-Math.PI / 2, 0, 0]}
        name="guide-path-target-ring"
      >
        <ringGeometry args={[0.36, 0.52, 28]} />
        <meshStandardMaterial
          ref={ringMatRef}
          color={palette.accent}
          emissive={palette.accent}
          emissiveIntensity={1.2}
          transparent
          opacity={0.75}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
