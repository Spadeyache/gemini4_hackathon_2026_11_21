import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { BrandCore, WorldSpec } from "@mybrand/shared";
import * as THREE from "three";
import {
  mergeBoxGeometries,
  resolveAssetUrl,
  type BrandPalette,
} from "../../world/geometryUtils";
import {
  detectOpenFrontWall,
  type OpenWallSide,
  type RoomBounds,
} from "../../world/roomLayout";
import { useCachedTexture } from "../../world/textureCache";
import {
  buildStageAccentLightParts,
  buildStageArchitectureParts,
  type WorldThemeAtmosphere,
} from "../../world/themeAtmosphere";

interface RoomShellProps {
  brandCore: BrandCore;
  worldSpec: WorldSpec;
  bounds: RoomBounds;
  palette: BrandPalette;
  theme: WorldThemeAtmosphere;
  assetUrlById: Map<string, string>;
  cameraMode: "diorama" | "walk";
}

function buildSkyDomeGeometry(
  radius: number,
  zenithHex: string,
  horizonHex: string,
  groundHex: string
): THREE.BufferGeometry {
  const geom = new THREE.SphereGeometry(radius, 28, 16);
  const posAttr = geom.attributes.position;
  const colors = new Float32Array(posAttr.count * 3);

  const zenith = new THREE.Color(zenithHex);
  const horizon = new THREE.Color(horizonHex);
  const ground = new THREE.Color(groundHex);
  const scratch = new THREE.Color();

  for (let i = 0; i < posAttr.count; i++) {
    const ny = posAttr.getY(i) / radius;
    if (ny >= 0) {
      const t = Math.pow(Math.min(1, ny), 0.65);
      scratch.copy(horizon).lerp(zenith, t);
    } else {
      const t = Math.min(1, -ny * 2.4);
      scratch.copy(horizon).lerp(ground, t);
    }
    colors[i * 3] = scratch.r;
    colors[i * 3 + 1] = scratch.g;
    colors[i * 3 + 2] = scratch.b;
  }

  geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geom;
}

function getBackThetaForOpenWall(openFrontWall: OpenWallSide): number {
  switch (openFrontWall) {
    case "minZ":
      return 0; // back is +Z
    case "maxZ":
      return Math.PI; // back is -Z
    case "minX":
      return Math.PI / 2; // back is +X
    case "maxX":
      return -Math.PI / 2; // back is -X
  }
}

const CYCLORAMA_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CYCLORAMA_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uHorizonColor;
  varying vec2 vUv;

  void main() {
    // Flip horizontal UV because we view the inside (BackSide) of the cylinder arc
    vec2 uv = vec2(1.0 - vUv.x, vUv.y);
    vec4 tex = texture2D(uMap, uv);

    // Silky edge feathering so the panoramic vista melts seamlessly into the sky dome & surround
    float sideFade = smoothstep(0.0, 0.13, vUv.x) * smoothstep(1.0, 0.87, vUv.x);
    float topFade = smoothstep(1.0, 0.76, vUv.y);
    float bottomFade = smoothstep(0.0, 0.08, vUv.y);
    float alpha = sideFade * topFade * bottomFade;

    // Gentle atmospheric horizon tint near top and sides for unified depth
    vec3 color = mix(uHorizonColor, tex.rgb, 0.88 * topFade + 0.12);
    gl_FragColor = vec4(color, alpha);
  }
`;

const SURROUND_VERT = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SURROUND_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uNearColor;
  uniform vec3 uFarColor;
  uniform vec3 uSunColor;
  uniform vec3 uHorizonColor;
  uniform vec2 uCenter;
  uniform float uWater;
  uniform float uAviation;
  varying vec3 vWorldPos;

  void main() {
    vec2 rel = vWorldPos.xz - uCenter;
    float dist = length(rel);
    float horizonT = smoothstep(10.0, 78.0, dist);
    vec3 base = mix(uNearColor, uFarColor, smoothstep(6.0, 42.0, dist));

    if (uWater > 0.5) {
      // Gentle multi-frequency coastal swells & dawn sun shimmer (0 textures)
      float w1 = sin(rel.x * 0.48 + rel.y * 0.34 + uTime * 0.85);
      float w2 = cos(rel.x * 0.82 - rel.y * 0.62 + uTime * 1.15);
      float w3 = sin(rel.y * 1.45 - uTime * 0.65);
      float ripple = (w1 * 0.45 + w2 * 0.35 + w3 * 0.2);

      // Deeper color in troughs, brighter sky reflection on crests
      base = mix(base * 0.86, base * 1.16 + uHorizonColor * 0.14, ripple * 0.5 + 0.5);

      // Subtle golden sun glint path across the open water
      float sunPath = exp(-pow(rel.x * 0.095, 2.0)) * smoothstep(5.0, 48.0, dist) * (1.0 - horizonT * 0.65);
      float sparkle = pow(max(0.0, ripple * 0.5 + 0.5), 4.0) * sunPath;
      base += uSunColor * sparkle * 0.52;
    } else if (uAviation > 0.5) {
      // Subtle airport tarmac / apron expansion joint lines
      float gx = smoothstep(0.96, 1.0, abs(sin(rel.x * 0.65)));
      float gz = smoothstep(0.96, 1.0, abs(sin(rel.y * 0.65)));
      float grid = max(gx, gz) * (1.0 - horizonT) * 0.12;
      base += vec3(0.65, 0.72, 0.82) * grid;
    }

    vec3 finalColor = mix(base, uHorizonColor, horizonT);
    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

export function RoomShell({
  worldSpec,
  bounds,
  palette,
  theme,
  assetUrlById,
  cameraMode,
}: RoomShellProps) {
  const floorUrl = resolveAssetUrl(worldSpec.room.floor_asset, assetUrlById);
  const wallUrl = resolveAssetUrl(worldSpec.room.wall_asset, assetUrlById);
  const logoAsset = useMemo(
    () => worldSpec.assets.find((asset) => asset.kind === "logo") ?? null,
    [worldSpec.assets]
  );

  const { width, depth, height, centerX, centerZ, minX, maxX, minZ, maxZ } =
    bounds;
  const halfH = height / 2;

  const isScenicPhotoWall = Boolean(wallUrl && !wallUrl.toLowerCase().endsWith(".svg"));

  // Balanced repeating floor planks/tiles; 1:1 clean panoramic texture for scenic walls
  const floorRepeatX = Math.max(2, Math.round(width / 3.4));
  const floorRepeatY = Math.max(2, Math.round(depth / 3.4));
  const wallRepeatX = isScenicPhotoWall
    ? 1
    : Math.max(1, Math.round(width / Math.max(2, height)));
  const backWallAspect = isScenicPhotoWall
    ? 16 / 9
    : width / Math.max(1, height);

  const floorTexture = useCachedTexture(floorUrl, floorRepeatX, floorRepeatY);
  const wallTexture = useCachedTexture(wallUrl, wallRepeatX, 1, backWallAspect);
  const logoTexture = useCachedTexture(logoAsset?.url ?? null, 1, 1);

  const openFrontWall = useMemo(
    () => detectOpenFrontWall(worldSpec, bounds),
    [worldSpec, bounds]
  );

  const isDiorama = cameraMode === "diorama";
  const skyRadius = Math.max(85, Math.hypot(width, depth) * 4.5);

  const skyDomeGeometry = useMemo(
    () =>
      buildSkyDomeGeometry(
        skyRadius,
        theme.skyZenith,
        theme.skyHorizon,
        theme.skyGround
      ),
    [skyRadius, theme.skyZenith, theme.skyHorizon, theme.skyGround]
  );

  // Merged architectural stage frame (pier pilings/rails, terminal ribs, gallery piers)
  const stageArchGeometry = useMemo(
    () =>
      mergeBoxGeometries(
        buildStageArchitectureParts(
          theme.archetype,
          bounds,
          openFrontWall,
          theme.deckElevationM
        )
      ),
    [theme.archetype, bounds, openFrontWall, theme.deckElevationM]
  );

  const stageAccentGeometry = useMemo(
    () =>
      mergeBoxGeometries(
        buildStageAccentLightParts(theme.archetype, bounds, openFrontWall)
      ),
    [theme.archetype, bounds, openFrontWall]
  );

  // Curved seamless scenic horizon cyclorama behind the open-front diorama stage
  const cycloramaParams = useMemo(() => {
    const span = Math.max(width, depth);
    const radius = span * 1.18;
    const cylHeight = Math.max(12.5, height * 3.15);
    const arcLen = Math.PI * 1.06; // ~190 deg enveloping horizon behind and beside stage
    const backTheta = getBackThetaForOpenWall(openFrontWall);
    const thetaStart = backTheta - arcLen / 2;
    return { radius, cylHeight, thetaStart, arcLen };
  }, [width, depth, height, openFrontWall]);

  const cycloramaMaterial = useMemo(() => {
    if (!wallTexture) return null;
    return new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: wallTexture },
        uHorizonColor: { value: new THREE.Color(theme.skyHorizon) },
      },
      vertexShader: CYCLORAMA_VERT,
      fragmentShader: CYCLORAMA_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      fog: false,
    });
  }, [wallTexture, theme.skyHorizon]);

  const surroundMaterialRef = useRef<THREE.ShaderMaterial | null>(null);
  const surroundMaterial = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uNearColor: { value: new THREE.Color(theme.surroundNear) },
        uFarColor: { value: new THREE.Color(theme.surroundFar) },
        uSunColor: { value: new THREE.Color(theme.sunColor) },
        uHorizonColor: { value: new THREE.Color(theme.skyHorizon) },
        uCenter: { value: new THREE.Vector2(centerX, centerZ) },
        uWater: { value: theme.waterShimmer ? 1.0 : 0.0 },
        uAviation: { value: theme.archetype === "aviation" ? 1.0 : 0.0 },
      },
      vertexShader: SURROUND_VERT,
      fragmentShader: SURROUND_FRAG,
      fog: false,
    });
    surroundMaterialRef.current = mat;
    return mat;
  }, [
    theme.surroundNear,
    theme.surroundFar,
    theme.sunColor,
    theme.skyHorizon,
    theme.waterShimmer,
    theme.archetype,
    centerX,
    centerZ,
  ]);

  useFrame((_, delta) => {
    if (surroundMaterialRef.current) {
      surroundMaterialRef.current.uniforms.uTime.value += Math.min(delta, 0.05);
    }
  });

  useEffect(() => {
    return () => {
      skyDomeGeometry.dispose();
      stageArchGeometry.dispose();
      stageAccentGeometry.dispose();
      cycloramaMaterial?.dispose();
      surroundMaterial.dispose();
    };
  }, [
    skyDomeGeometry,
    stageArchGeometry,
    stageAccentGeometry,
    cycloramaMaterial,
    surroundMaterial,
  ]);

  // Place logo medallion cleanly on back architectural fascia/wall
  const logoPlacement = useMemo<{
    pos: [number, number, number];
    rotY: number;
  }>(() => {
    const y = Math.min(height - 0.65, 3.3);
    switch (openFrontWall) {
      case "minZ":
        return { pos: [centerX, y, maxZ - 0.06], rotY: Math.PI };
      case "maxZ":
        return { pos: [centerX, y, minZ + 0.06], rotY: 0 };
      case "minX":
        return { pos: [maxX - 0.06, y, centerZ], rotY: -Math.PI / 2 };
      case "maxX":
        return { pos: [minX + 0.06, y, centerZ], rotY: Math.PI / 2 };
    }
  }, [openFrontWall, centerX, centerZ, height, minX, maxX, minZ, maxZ]);

  // For flat-swatch gallery brands (like demo-brand), render a clean single back gallery wall
  // in 2.5D mode instead of a 13m cyclorama, avoiding any floating shoebox side walls.
  const backWallTransform = useMemo(() => {
    switch (openFrontWall) {
      case "minZ":
        return {
          pos: [centerX, halfH, maxZ] as [number, number, number],
          rotY: Math.PI,
          span: width,
        };
      case "maxZ":
        return {
          pos: [centerX, halfH, minZ] as [number, number, number],
          rotY: 0,
          span: width,
        };
      case "minX":
        return {
          pos: [maxX, halfH, centerZ] as [number, number, number],
          rotY: -Math.PI / 2,
          span: depth,
        };
      case "maxX":
        return {
          pos: [minX, halfH, centerZ] as [number, number, number],
          rotY: Math.PI / 2,
          span: depth,
        };
    }
  }, [openFrontWall, centerX, centerZ, halfH, minX, maxX, minZ, maxZ, width, depth]);

  return (
    <group name="room-shell">
      {/* Full atmospheric sky dome (0 GPU textures) */}
      <mesh
        geometry={skyDomeGeometry}
        position={[centerX, 0, centerZ]}
        name="world-sky-dome"
      >
        <meshBasicMaterial
          vertexColors
          side={THREE.BackSide}
          depthWrite={false}
          fog={false}
        />
      </mesh>

      {/* Living world surround plane (animated coastal water, twilight tarmac, courtyard, etc.) */}
      {isDiorama && (
        <mesh
          position={[centerX, -theme.deckElevationM + 0.06, centerZ]}
          rotation={[-Math.PI / 2, 0, 0]}
          material={surroundMaterial}
          name="world-surround-plane"
        >
          <planeGeometry args={[180, 180]} />
        </mesh>
      )}

      {/* Curved seamless scenic horizon cyclorama for photorealistic generated worlds */}
      {isDiorama && isScenicPhotoWall && cycloramaMaterial && (
        <mesh
          position={[
            centerX,
            cycloramaParams.cylHeight * 0.42 - theme.deckElevationM,
            centerZ,
          ]}
          material={cycloramaMaterial}
          name="world-horizon-cyclorama"
        >
          <cylinderGeometry
            args={[
              cycloramaParams.radius,
              cycloramaParams.radius,
              cycloramaParams.cylHeight,
              44,
              1,
              true,
              cycloramaParams.thetaStart,
              cycloramaParams.arcLen,
            ]}
          />
        </mesh>
      )}

      {/* Clean single architectural back gallery wall for flat-swatch studio brands in 2.5D */}
      {isDiorama && !isScenicPhotoWall && (
        <mesh
          position={backWallTransform.pos}
          rotation={[0, backWallTransform.rotY, 0]}
          name="gallery-back-wall"
        >
          <planeGeometry args={[backWallTransform.span, height]} />
          <meshStandardMaterial
            key={wallTexture ? "wall-mapped" : "wall-flat"}
            color={wallTexture ? "#f7f3ed" : palette.wall}
            map={wallTexture}
            roughness={0.9}
          />
        </mesh>
      )}

      {/* Stage floor deck */}
      <mesh
        position={[centerX, 0, centerZ]}
        rotation={[-Math.PI / 2, 0, 0]}
        name="room-floor"
      >
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial
          key={floorTexture ? "floor-mapped" : "floor-flat"}
          color={floorTexture ? "#ffffff" : palette.floor}
          map={floorTexture}
          roughness={theme.archetype === "aviation" ? 0.52 : 0.84}
          metalness={theme.archetype === "aviation" ? 0.14 : 0.04}
        />
      </mesh>

      {/* Theme-aware merged architectural stage frame (pilings/rails, terminal ribs, gallery piers) */}
      {isDiorama && (
        <mesh geometry={stageArchGeometry} name="stage-architecture">
          <meshStandardMaterial
            color={theme.railColor}
            roughness={theme.archetype === "aviation" ? 0.42 : 0.8}
            metalness={theme.archetype === "aviation" ? 0.45 : 0.08}
          />
        </mesh>
      )}

      {/* Subtle architectural accent lights (pier brass bollards, runway beacons, cove strip) */}
      {isDiorama && (
        <mesh geometry={stageAccentGeometry} name="stage-accent-lights">
          <meshStandardMaterial
            color={theme.accentGlowColor}
            emissive={theme.accentGlowColor}
            emissiveIntensity={1.25}
            roughness={0.3}
            metalness={0.2}
          />
        </mesh>
      )}

      {/* Walk mode: enclosed room walls (panoramic vista on back wall, calm solid palette sides — no triple wallpaper) */}
      {!isDiorama && (
        <>
          <mesh
            position={[centerX, height, centerZ]}
            rotation={[Math.PI / 2, 0, 0]}
            name="room-ceiling"
          >
            <planeGeometry args={[width, depth]} />
            <meshStandardMaterial color={palette.wall} roughness={0.94} />
          </mesh>

          <mesh position={[centerX, halfH, minZ]} name="wall-entrance">
            <planeGeometry args={[width, height]} />
            <meshStandardMaterial
              color={openFrontWall === "maxZ" && wallTexture ? "#f7f3ed" : palette.wall}
              map={openFrontWall === "maxZ" ? wallTexture : null}
              roughness={0.9}
            />
          </mesh>

          <mesh
            position={[centerX, halfH, maxZ]}
            rotation={[0, Math.PI, 0]}
            name="wall-far"
          >
            <planeGeometry args={[width, height]} />
            <meshStandardMaterial
              color={openFrontWall === "minZ" && wallTexture ? "#f7f3ed" : palette.wall}
              map={openFrontWall === "minZ" ? wallTexture : null}
              roughness={0.9}
            />
          </mesh>

          <mesh
            position={[minX, halfH, centerZ]}
            rotation={[0, Math.PI / 2, 0]}
            name="wall-left"
          >
            <planeGeometry args={[depth, height]} />
            <meshStandardMaterial
              color={openFrontWall === "maxX" && wallTexture ? "#f7f3ed" : palette.wall}
              map={openFrontWall === "maxX" ? wallTexture : null}
              roughness={0.9}
            />
          </mesh>

          <mesh
            position={[maxX, halfH, centerZ]}
            rotation={[0, -Math.PI / 2, 0]}
            name="wall-right"
          >
            <planeGeometry args={[depth, height]} />
            <meshStandardMaterial
              color={openFrontWall === "minX" && wallTexture ? "#f7f3ed" : palette.wall}
              map={openFrontWall === "minX" ? wallTexture : null}
              roughness={0.9}
            />
          </mesh>
        </>
      )}

      {/* Studio Logo Medallion on Back Wall (when present & not obstructing scenic vista) */}
      {logoTexture && (!isDiorama || !isScenicPhotoWall) && (
        <mesh
          position={logoPlacement.pos}
          rotation={[0, logoPlacement.rotY, 0]}
          name="brand-logo"
        >
          <planeGeometry args={[1.25, 1.25]} />
          <meshStandardMaterial
            map={logoTexture}
            roughness={0.55}
            metalness={0.05}
          />
        </mesh>
      )}
    </group>
  );
}
