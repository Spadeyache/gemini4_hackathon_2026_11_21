import { useEffect, useMemo } from "react";
import { Text } from "@react-three/drei";
import type { Fixture, FixtureType } from "@mybrand/shared";
import * as THREE from "three";
import {
  mergeBoxGeometries,
  type BoxPart,
  type BrandPalette,
} from "../../world/geometryUtils";
import { getFixtureDimensions } from "../../world/roomLayout";
import { useCachedTexture } from "../../world/textureCache";

interface FixtureMeshProps {
  fixture: Fixture;
  zoneBeat: string;
  palette: BrandPalette;
  posterUrl: string | null;
  cameraMode?: "diorama" | "walk";
}

function buildFixtureParts(
  type: FixtureType,
  mountY: number,
  groundWallFixtures: boolean
): BoxPart[] {
  const dims = getFixtureDimensions(type);
  const { width: w, height: h, depth: d } = dims;

  switch (type) {
    case "plinth":
      return [
        // Recessed shadow toe-kick
        { size: [w * 0.88, 0.08, d * 0.88], position: [0, 0.04, 0] },
        // Pedestal column
        { size: [w, h - 0.14, d], position: [0, 0.08 + (h - 0.14) / 2, 0] },
        // Top display cap
        { size: [w + 0.04, 0.06, d + 0.04], position: [0, h - 0.03, 0] },
      ];

    case "table": {
      const topH = 0.07;
      const legW = 0.07;
      const legH = h - topH;
      const lx = w / 2 - 0.12;
      const lz = d / 2 - 0.12;
      return [
        // Tabletop
        { size: [w, topH, d], position: [0, h - topH / 2, 0] },
        // Apron bar
        { size: [w - 0.24, 0.08, d - 0.24], position: [0, h - topH - 0.04, 0] },
        // 4 tapered-style legs
        { size: [legW, legH, legW], position: [-lx, legH / 2, -lz] },
        { size: [legW, legH, legW], position: [lx, legH / 2, -lz] },
        { size: [legW, legH, legW], position: [-lx, legH / 2, lz] },
        { size: [legW, legH, legW], position: [lx, legH / 2, lz] },
      ];
    }

    case "wall_shelf":
      return [
        // Back panel
        { size: [w, h, 0.06], position: [0, h / 2, -d / 2 + 0.03] },
        // Left & right side gables
        { size: [0.06, h, d], position: [-w / 2 + 0.03, h / 2, 0] },
        { size: [0.06, h, d], position: [w / 2 - 0.03, h / 2, 0] },
        // Base plinth
        { size: [w, 0.14, d], position: [0, 0.07, 0] },
        // Lower shelf
        { size: [w - 0.08, 0.05, d - 0.04], position: [0, 0.56, 0.01] },
        // Main display shelf (at slotSurfaceY = 1.12)
        { size: [w - 0.08, 0.05, d - 0.02], position: [0, 1.095, 0.01] },
        // Top cornice
        { size: [w + 0.04, 0.06, d + 0.02], position: [0, h - 0.03, 0] },
      ];

    case "rack": {
      const postW = 0.055;
      const sx = w / 2 - 0.06;
      return [
        // Base runners
        { size: [0.1, 0.05, d], position: [-sx, 0.025, 0] },
        { size: [0.1, 0.05, d], position: [sx, 0.025, 0] },
        // Lower deck shelf
        { size: [w - 0.14, 0.04, d * 0.72], position: [0, 0.2, 0] },
        // Side uprights
        { size: [postW, h, postW], position: [-sx, h / 2, 0] },
        { size: [postW, h, postW], position: [sx, h / 2, 0] },
        // Top hanging crossbar
        { size: [w - 0.06, 0.045, 0.045], position: [0, h - 0.08, 0] },
        // Mid display ledge
        { size: [w - 0.14, 0.045, d * 0.65], position: [0, 1.025, 0] },
      ];
    }

    case "display_case":
      return [
        // Solid gallery cabinet base (up to y = 0.88)
        { size: [w * 0.92, 0.08, d * 0.92], position: [0, 0.04, 0] },
        { size: [w, 0.78, d], position: [0, 0.47, 0] },
        { size: [w + 0.04, 0.04, d + 0.04], position: [0, 0.88, 0] },
        // Slim top hood trim frame
        { size: [w + 0.02, 0.03, d + 0.02], position: [0, h - 0.015, 0] },
      ];

    case "poster_frame": {
      const parts: BoxPart[] = [
        // Frame outer backing & 4 bevel rails (centered around y=0)
        { size: [w, h, 0.05], position: [0, 0, -0.025] },
        { size: [w + 0.08, 0.06, 0.08], position: [0, h / 2 + 0.01, 0] },
        { size: [w + 0.08, 0.06, 0.08], position: [0, -h / 2 - 0.01, 0] },
        { size: [0.06, h, 0.08], position: [-w / 2 - 0.01, 0, 0] },
        { size: [0.06, h, 0.08], position: [w / 2 + 0.01, 0, 0] },
      ];
      // In open-air 2.5D diorama mode, ground poster frames on sleek twin gallery posts
      if (groundWallFixtures && mountY > h / 2) {
        const legBottom = -mountY;
        const legTop = -h / 2 - 0.02;
        const legH = Math.max(0.08, legTop - legBottom);
        const legCenterY = (legBottom + legTop) / 2;
        const postX = w * 0.36;
        parts.push(
          { size: [0.055, legH, 0.055], position: [-postX, legCenterY, -0.02] },
          { size: [0.055, legH, 0.055], position: [postX, legCenterY, -0.02] },
          { size: [w * 0.92, 0.05, 0.24], position: [0, legBottom + 0.025, -0.02] }
        );
      }
      return parts;
    }

    case "screen": {
      const parts: BoxPart[] = [
        // Sleek dark gallery monitor chassis (centered around y=0)
        { size: [w + 0.1, h + 0.1, 0.06], position: [0, 0, -0.02] },
      ];
      if (groundWallFixtures && mountY > h / 2) {
        const legBottom = -mountY;
        const legTop = -h / 2 - 0.04;
        const legH = Math.max(0.08, legTop - legBottom);
        const legCenterY = (legBottom + legTop) / 2;
        parts.push(
          { size: [0.08, legH, 0.08], position: [0, legCenterY, -0.02] },
          { size: [w * 0.6, 0.05, 0.3], position: [0, legBottom + 0.025, -0.02] }
        );
      }
      return parts;
    }
  }
}

export function FixtureMesh({
  fixture,
  zoneBeat,
  palette,
  posterUrl,
  cameraMode = "diorama",
}: FixtureMeshProps) {
  const dims = getFixtureDimensions(fixture.type);
  const posterTexture = useCachedTexture(
    fixture.type === "poster_frame" ? posterUrl : null,
    1,
    1
  );

  const groundWallFixtures = cameraMode === "diorama";
  const bodyGeometry = useMemo(
    () =>
      mergeBoxGeometries(
        buildFixtureParts(fixture.type, fixture.position[1], groundWallFixtures)
      ),
    [fixture.type, fixture.position, groundWallFixtures]
  );

  useEffect(() => {
    return () => {
      bodyGeometry.dispose();
    };
  }, [bodyGeometry]);

  const bodyColor = useMemo(() => {
    switch (fixture.type) {
      case "plinth":
        return palette.wall;
      case "table":
      case "wall_shelf":
        return palette.wood;
      case "display_case":
        return palette.dark;
      case "rack":
      case "poster_frame":
      case "screen":
        return palette.dark;
    }
  }, [fixture.type, palette]);

  const rotationRad = THREE.MathUtils.degToRad(fixture.rotation_deg);

  return (
    <group
      position={fixture.position}
      rotation={[0, rotationRad, 0]}
      name={`fixture-${fixture.id}`}
    >
      <mesh geometry={bodyGeometry} name={`fixture-body-${fixture.id}`}>
        <meshStandardMaterial
          color={bodyColor}
          roughness={fixture.type === "screen" ? 0.35 : 0.72}
          metalness={fixture.type === "rack" || fixture.type === "screen" ? 0.25 : 0.06}
        />
      </mesh>

      {fixture.type === "display_case" && (
        <mesh
          position={[0, 0.9 + (dims.height - 0.92) / 2, 0]}
          name={`fixture-glass-${fixture.id}`}
        >
          <boxGeometry args={[dims.width - 0.02, dims.height - 0.93, dims.depth - 0.02]} />
          <meshStandardMaterial
            color="#eef4f2"
            transparent
            opacity={0.18}
            roughness={0.1}
            metalness={0.15}
            depthWrite={false}
          />
        </mesh>
      )}

      {fixture.type === "poster_frame" && (
        <mesh position={[0, 0, 0.022]} name={`fixture-poster-${fixture.id}`}>
          <planeGeometry args={[dims.width - 0.1, dims.height - 0.1]} />
          <meshStandardMaterial
            key={posterTexture ? "poster-mapped" : "poster-flat"}
            color={posterTexture ? "#ffffff" : palette.floor}
            map={posterTexture}
            roughness={0.78}
          />
        </mesh>
      )}

      {fixture.type === "screen" && (
        <>
          <mesh position={[0, 0, 0.022]} name={`fixture-screen-${fixture.id}`}>
            <planeGeometry args={[dims.width - 0.06, dims.height - 0.06]} />
            <meshStandardMaterial
              color={palette.dark}
              emissive={palette.accent}
              emissiveIntensity={0.22}
              roughness={0.22}
              metalness={0.1}
            />
          </mesh>
          <Text
            position={[0, 0, 0.032]}
            fontSize={0.11}
            maxWidth={dims.width - 0.32}
            lineHeight={1.35}
            color={palette.wall}
            anchorX="center"
            anchorY="middle"
            textAlign="center"
          >
            {zoneBeat}
          </Text>
        </>
      )}
    </group>
  );
}
