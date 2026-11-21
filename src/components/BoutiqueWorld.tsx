import React, { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer, RoundedBox } from '@react-three/drei';
import type { LightingPreset, StoreConfig } from '../types/storeConfig';

export interface BoutiqueWorldProps {
  config: StoreConfig;
  children?: React.ReactNode;
}

/**
 * Local error boundary so optional Drei Suspense helpers (<Environment>, <Text>)
 * never crash or blank out the 3D showroom if run completely offline.
 */
class SafeAssetBoundary extends Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

/**
 * Non-blocking optional texture loader with RepeatWrapping + anisotropy.
 * Returns `null` while loading or if omitted/404 so procedural PBR CanvasTextures
 * render instantaneously on frame 0 with zero network failures.
 */
function useOptionalTexture(
  url: string | undefined,
  options: {
    repeat?: [number, number];
    wrap?: THREE.Wrapping;
    anisotropy?: number;
  } = {}
): THREE.Texture | null {
  const { gl } = useThree();
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const repeatX = options.repeat?.[0] ?? 1;
  const repeatY = options.repeat?.[1] ?? 1;
  const wrap = options.wrap ?? THREE.RepeatWrapping;
  const maxAniso = options.anisotropy ?? Math.min(8, gl.capabilities.getMaxAnisotropy());

  useEffect(() => {
    if (!url) {
      setTexture(null);
      return;
    }

    let cancelled = false;
    let loadedTex: THREE.Texture | null = null;
    const loader = new THREE.TextureLoader();

    loader.load(
      url,
      (tex) => {
        if (cancelled) {
          tex.dispose();
          return;
        }
        tex.wrapS = wrap;
        tex.wrapT = wrap;
        tex.repeat.set(repeatX, repeatY);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = maxAniso;
        tex.needsUpdate = true;
        loadedTex = tex;
        setTexture(tex);
      },
      undefined,
      () => {
        if (!cancelled) {
          setTexture(null);
        }
      }
    );

    return () => {
      cancelled = true;
      if (loadedTex) {
        loadedTex.dispose();
      }
    };
  }, [url, repeatX, repeatY, wrap, maxAniso]);

  return texture;
}

/**
 * Helper to adjust hex color brightness subtly for procedural architectural grain
 */
function shiftHex(hex: string, delta: number): string {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, delta);
  return `#${c.getHexString()}`;
}

/**
 * Generates seamless procedural floor texture tailored to preset Brand DNA
 */
function createProceduralFloorTexture(
  floorHex: string,
  presetId: string,
  maxAniso: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = floorHex;
  ctx.fillRect(0, 0, 512, 512);

  if (presetId === 'kinetic-concrete') {
    // Dark charcoal aggregate terrazzo chips
    const chipColors = [
      shiftHex(floorHex, 0.08),
      shiftHex(floorHex, -0.04),
      shiftHex(floorHex, 0.14),
      '#3c3f45',
    ];
    for (let i = 0; i < 650; i++) {
      ctx.fillStyle = chipColors[i % chipColors.length];
      const x = (Math.sin(i * 127.1) * 0.5 + 0.5) * 512;
      const y = (Math.cos(i * 311.7) * 0.5 + 0.5) * 512;
      const r = 1.2 + ((i * 17) % 5) * 0.65;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Expansion joint grid
    ctx.strokeStyle = shiftHex(floorHex, -0.05);
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 510, 510);
    ctx.beginPath();
    ctx.moveTo(0, 256);
    ctx.lineTo(512, 256);
    ctx.moveTo(256, 0);
    ctx.lineTo(256, 512);
    ctx.stroke();
  } else if (presetId === 'kyoto-atelier') {
    // Wide-plank natural Japanese cedar grain
    const planks = 6;
    const plankH = 512 / planks;
    for (let p = 0; p < planks; p++) {
      ctx.fillStyle = shiftHex(floorHex, ((p % 3) - 1) * 0.022);
      ctx.fillRect(0, p * plankH, 512, plankH);
      ctx.strokeStyle = shiftHex(floorHex, -0.055);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, p * plankH);
      ctx.lineTo(512, p * plankH);
      ctx.stroke();

      // Subtle wood grain fibers
      ctx.strokeStyle = shiftHex(floorHex, -0.025);
      ctx.lineWidth = 1;
      for (let g = 0; g < 9; g++) {
        const gy = p * plankH + (g + 0.5) * (plankH / 9);
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.bezierCurveTo(170, gy + ((g % 2) * 3 - 1.5), 340, gy - ((g % 2) * 3 - 1.5), 512, gy);
        ctx.stroke();
      }
    }
  } else {
    // Honed Roman travertine ashlar stone slabs
    const rows = 4;
    const rowH = 512 / rows;
    for (let r = 0; r < rows; r++) {
      const offset = (r % 2) * 128;
      for (let col = -1; col < 3; col++) {
        const x = col * 256 + offset;
        ctx.fillStyle = shiftHex(floorHex, (((r + col) % 3) - 1) * 0.015);
        ctx.fillRect(x, r * rowH, 256, rowH);
        ctx.strokeStyle = shiftHex(floorHex, -0.05);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, r * rowH, 256, rowH);
      }
    }
    // Linear travertine mineral veins
    for (let v = 0; v < 90; v++) {
      ctx.fillStyle = shiftHex(floorHex, v % 2 === 0 ? -0.025 : 0.02);
      const vx = ((v * 73) % 500) + 6;
      const vy = ((v * 139) % 504) + 4;
      ctx.fillRect(vx, vy, 18 + (v % 26), 1.4);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 5);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

/**
 * Generates seamless Venetian limewash / concrete / juraku clay wall texture
 */
function createProceduralWallTexture(
  wallHex: string,
  presetId: string,
  maxAniso: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = wallHex;
  ctx.fillRect(0, 0, 512, 512);

  // Soft mineral plaster clouding
  for (let i = 0; i < 140; i++) {
    const x = ((i * 97) % 512);
    const y = ((i * 193) % 512);
    const rad = 36 + (i % 5) * 18;
    const grad = ctx.createRadialGradient(x, y, 2, x, y, rad);
    grad.addColorStop(0, shiftHex(wallHex, i % 2 === 0 ? 0.02 : -0.02));
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.globalAlpha = 0.32;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  if (presetId === 'kinetic-concrete') {
    // Subtle board-formed concrete panel seams & tie holes
    ctx.strokeStyle = shiftHex(wallHex, -0.045);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(0, 0, 256, 512);
    ctx.strokeRect(256, 0, 256, 512);
    const tieCoords = [
      [64, 128],
      [192, 128],
      [64, 384],
      [192, 384],
      [320, 128],
      [448, 128],
      [320, 384],
      [448, 384],
    ];
    ctx.fillStyle = shiftHex(wallHex, -0.08);
    for (const [tx, ty] of tieCoords) {
      ctx.beginPath();
      ctx.arc(tx, ty, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

/**
 * Generates procedural vertical fluted panel texture in `accentHex`
 */
function createProceduralFlutedTexture(accentHex: string, maxAniso: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const flutes = 24;
  const fluteW = 512 / flutes;

  for (let i = 0; i < flutes; i++) {
    const x0 = i * fluteW;
    const grad = ctx.createLinearGradient(x0, 0, x0 + fluteW, 0);
    grad.addColorStop(0, shiftHex(accentHex, -0.09));
    grad.addColorStop(0.22, shiftHex(accentHex, 0.03));
    grad.addColorStop(0.5, shiftHex(accentHex, 0.065));
    grad.addColorStop(0.78, shiftHex(accentHex, 0.02));
    grad.addColorStop(1, shiftHex(accentHex, -0.1));
    ctx.fillStyle = grad;
    ctx.fillRect(x0, 0, fluteW + 0.5, 512);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1.5);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

/**
 * Generates tactile woven bouclé area rug color + bump textures
 */
function createBoucleRugTextures(
  rugHex: string,
  borderHex: string,
  maxAniso: number
): { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = 256;
  bumpCanvas.height = 256;
  const bCtx = bumpCanvas.getContext('2d')!;

  ctx.fillStyle = rugHex;
  ctx.fillRect(0, 0, 512, 512);
  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, 256, 256);

  // Bouclé slub weave knots
  for (let y = 0; y < 512; y += 6) {
    for (let x = 0; x < 512; x += 8) {
      const jitter = ((x * 31 + y * 17) % 7) - 3;
      ctx.fillStyle = shiftHex(rugHex, jitter * 0.011);
      ctx.fillRect(x, y, 6, 4);
    }
  }

  for (let y = 0; y < 256; y += 4) {
    for (let x = 0; x < 256; x += 4) {
      const v = 110 + ((x * 19 + y * 37) % 45);
      bCtx.fillStyle = `rgb(${v},${v},${v})`;
      bCtx.fillRect(x, y, 3, 3);
    }
  }

  // Subtle woven inset frame border
  ctx.strokeStyle = borderHex;
  ctx.lineWidth = 14;
  ctx.strokeRect(18, 18, 476, 476);

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAniso;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(8, 6);

  return { map, bumpMap };
}

/**
 * Generates bespoke framed gallery exhibition print when `posterUrl` is omitted or loading
 */
function createProceduralPosterTexture(config: StoreConfig, maxAniso: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  const isDark = new THREE.Color(config.palette.wall).getHSL({ h: 0, s: 0, l: 0 }).l < 0.35;
  const paperBg = isDark ? '#191A1D' : '#F5F0E5';
  const inkPrimary = isDark ? '#F2F4F8' : '#2C3529';
  const accent = config.palette.accent;
  const metal = config.palette.rackMetal;

  ctx.fillStyle = paperBg;
  ctx.fillRect(0, 0, 768, 1024);

  // Archival double rule border
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.strokeRect(44, 44, 680, 936);
  ctx.strokeStyle = metal;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(58, 58, 652, 908);

  if (config.id === 'kinetic-concrete') {
    // Brutalist Milan/Tokyo architectural composition
    ctx.fillStyle = accent;
    ctx.fillRect(164, 175, 440, 320);
    ctx.fillStyle = paperBg;
    ctx.beginPath();
    ctx.arc(384, 335, 96, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = inkPrimary;
    ctx.lineWidth = 5;
    ctx.strokeRect(164, 520, 440, 155);
    ctx.beginPath();
    ctx.moveTo(164, 597);
    ctx.lineTo(604, 597);
    ctx.moveTo(384, 520);
    ctx.lineTo(384, 675);
    ctx.stroke();
  } else if (config.id === 'kyoto-atelier') {
    // Serene Kyoto organic architectural study
    ctx.strokeStyle = accent;
    ctx.lineWidth = 22;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(384, 390, 155, 0.25, Math.PI * 1.88);
    ctx.stroke();

    ctx.fillStyle = metal;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(310, 585, 148, 4);
    ctx.globalAlpha = 1;
  } else {
    // Heritage lawn-tennis court geometry crest
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3.5;
    ctx.strokeRect(234, 150, 300, 500);
    // Service boxes & baseline
    ctx.beginPath();
    ctx.moveTo(272, 150);
    ctx.lineTo(272, 650);
    ctx.moveTo(496, 150);
    ctx.lineTo(496, 650);
    ctx.moveTo(234, 400);
    ctx.lineTo(534, 400);
    ctx.moveTo(272, 275);
    ctx.lineTo(496, 275);
    ctx.moveTo(272, 525);
    ctx.lineTo(496, 525);
    ctx.moveTo(384, 275);
    ctx.lineTo(384, 525);
    ctx.stroke();

    ctx.strokeStyle = metal;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(384, 400, 112, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Exhibition typography
  ctx.fillStyle = inkPrimary;
  ctx.textAlign = 'center';
  ctx.font = '600 34px Georgia, "Times New Roman", serif';
  ctx.fillText(config.brandName.toUpperCase(), 384, 790);

  ctx.fillStyle = accent;
  ctx.font = '500 17px system-ui, -apple-system, sans-serif';
  ctx.fillText(config.tagline.toUpperCase(), 384, 838);

  ctx.fillStyle = metal;
  ctx.font = '400 14px system-ui, -apple-system, sans-serif';
  ctx.fillText('SPATIAL EDITION · ARCHIVE PLATE 01', 384, 888);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

/**
 * Helper to render tracked uppercase typography onto a high-DPI 2D canvas
 * with automatic horizontal fit and crisp pixel centering.
 */
function drawTrackedCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  centerY: number,
  trackingPx: number,
  maxWidth: number
) {
  const chars = Array.from(text);
  if (chars.length === 0) return;
  const advances = chars.map((ch) => ctx.measureText(ch).width);
  const rawTotal =
    advances.reduce((acc, w) => acc + w, 0) + trackingPx * (chars.length - 1);
  const scaleX = rawTotal > maxWidth ? maxWidth / rawTotal : 1;

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.scale(scaleX, 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  let cursorX = -rawTotal / 2;
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], cursorX, 0);
    cursorX += advances[i] + trackingPx;
  }
  ctx.restore();
}

/**
 * Deterministic zero-latency 2048×512 CanvasTexture signage renderer for the upper-arch brand plaque.
 * Guarantees razor-sharp brand typography on frame 0 with zero worker font latency or glare hotspot.
 */
function FallbackCanvasSignage({
  brandName,
  tagline,
  textColor,
  subColor,
}: {
  brandName: string;
  tagline: string;
  textColor: string;
  subColor: string;
}) {
  const tex = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 2048, 512);

    ctx.fillStyle = textColor;
    ctx.font = '600 116px Georgia, "Times New Roman", serif';
    drawTrackedCanvasText(ctx, brandName.toUpperCase(), 1024, 190, 22, 1840);

    ctx.fillStyle = subColor;
    ctx.font = '600 38px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    drawTrackedCanvasText(ctx, tagline.toUpperCase(), 1024, 382, 9, 1840);

    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  }, [brandName, tagline, textColor, subColor]);

  useEffect(() => () => tex.dispose(), [tex]);

  return (
    <mesh position={[0, 0, 0.021]}>
      <planeGeometry args={[1.76, 0.44]} />
      <meshStandardMaterial
        map={tex}
        emissive="#ffffff"
        emissiveMap={tex}
        emissiveIntensity={0.18}
        roughness={0.82}
        metalness={0.05}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
}

/**
 * Offline / zero-latency procedural Lightformer environment fallback
 */
function ProceduralStudioEnvironment({
  preset,
  intensity,
}: {
  preset: LightingPreset;
  intensity: number;
}) {
  const topTint =
    preset === 'cool_gallery_spot'
      ? '#EEF4FF'
      : preset === 'kyoto_golden_hour'
        ? '#FFE4BC'
        : '#FFF7E8';

  return (
    <Environment resolution={128} frames={1} environmentIntensity={intensity}>
      <Lightformer
        intensity={1.15}
        color={topTint}
        position={[0, 5, 1]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[8, 6, 1]}
      />
      <Lightformer
        intensity={0.65}
        color="#FFFFFF"
        position={[-4, 2.2, 2]}
        rotation={[0, Math.PI / 2, 0]}
        scale={[6, 3, 1]}
      />
      <Lightformer
        intensity={0.6}
        color={topTint}
        position={[4, 2.2, 2]}
        rotation={[0, -Math.PI / 2, 0]}
        scale={[6, 3, 1]}
      />
    </Environment>
  );
}

/**
 * Maps `LightingPreset` to Drei HDRI preset + calibrated intensity
 */
function ShowroomEnvironment({ preset }: { preset: LightingPreset }) {
  const { dreiPreset, intensity } = useMemo(() => {
    switch (preset) {
      case 'cool_gallery_spot':
        return { dreiPreset: 'city' as const, intensity: 0.42 };
      case 'kyoto_golden_hour':
        return { dreiPreset: 'studio' as const, intensity: 0.35 };
      case 'warm_court_sunlight':
      default:
        return { dreiPreset: 'apartment' as const, intensity: 0.35 };
    }
  }, [preset]);

  const fallback = <ProceduralStudioEnvironment preset={preset} intensity={intensity} />;

  return (
    <SafeAssetBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <Environment preset={dreiPreset} environmentIntensity={intensity} />
      </Suspense>
    </SafeAssetBoundary>
  );
}

/**
 * Studio Lighting Rig with `2048x2048` shadow-casting key spotlight aimed right at hero garment
 */
function StudioLightingRig({ config }: { config: StoreConfig }) {
  const spotTarget = useMemo(() => {
    const obj = new THREE.Object3D();
    obj.position.set(0, 1.24, 0);
    return obj;
  }, []);

  const isCool = config.lightingPreset === 'cool_gallery_spot';
  const isGolden = config.lightingPreset === 'kyoto_golden_hour';

  const keyIntensity = isCool ? 17.5 : isGolden ? 14.5 : 15.5;
  const ambientIntensity = isCool ? 0.36 : isGolden ? 0.31 : 0.33;
  const coveColor = isCool ? '#FF7A3D' : '#FFE4B5';

  return (
    <group name="studio-lighting-rig">
      <ShowroomEnvironment preset={config.lightingPreset} />

      {/* Target anchor right on hero hanging shirt */}
      <primitive object={spotTarget} />

      {/* Calibrated ambient & sky-ground bounce so cotton folds retain rich micro-shadows */}
      <ambientLight color={config.palette.ambientLight} intensity={ambientIntensity} />
      <hemisphereLight
        args={[config.palette.ambientLight, config.palette.floor, 0.34]}
        position={[0, 4.5, 0]}
      />

      {/* Key Gallery SpotLight casting 2048x2048 directional cloth & hanger micro-shadows */}
      <spotLight
        position={[0.98, 3.45, 2.05]}
        target={spotTarget}
        color={config.palette.spotLight}
        intensity={keyIntensity}
        distance={12}
        decay={1.55}
        angle={0.54}
        penumbra={0.68}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0003}
        shadow-camera-near={0.8}
        shadow-camera-far={9.5}
      />

      {/* Secondary Left-Front Soft Fill Spot so capsule rail & right fold stay luminous */}
      <spotLight
        position={[-1.45, 3.48, 2.05]}
        target={spotTarget}
        color={config.palette.ambientLight}
        intensity={6.0}
        distance={11}
        decay={1.65}
        angle={0.62}
        penumbra={0.85}
      />

      {/* Side & Gentle Rear Rim Lights to sculpt 3D shoulder & rear cotton drape folds */}
      <directionalLight
        position={[-2.2, 3.1, -1.35]}
        color={config.palette.spotLight}
        intensity={0.52}
      />
      <directionalLight
        position={[0.8, 2.65, -1.52]}
        color={config.palette.spotLight}
        intensity={0.6}
      />
      <directionalLight
        position={[2.4, 2.6, 1.8]}
        color={config.palette.ambientLight}
        intensity={0.24}
      />

      {/* Softened Hidden LED Cove Bounce Lights inside the Recessed Arch Alcove */}
      <pointLight
        position={[0, 2.25, -1.92]}
        color={coveColor}
        intensity={1.15}
        distance={3.4}
        decay={2}
      />
      <pointLight
        position={[-1.08, 1.45, -1.96]}
        color={coveColor}
        intensity={1.2}
        distance={3.0}
        decay={2}
      />
      <pointLight
        position={[1.08, 1.45, -1.96]}
        color={coveColor}
        intensity={1.2}
        distance={3.0}
        decay={2}
      />

      {/* Grounded contact shadow plane right at y = 0.005 */}
      <ContactShadows
        position={[0, 0.005, 0]}
        opacity={0.45}
        scale={10}
        blur={2.2}
        far={4}
        resolution={512}
      />
    </group>
  );
}

/**
 * Assigns planar world-space UVs to an ExtrudeGeometry so architectural wall textures tile cleanly
 */
function applyPlanarWallUVs(geo: THREE.BufferGeometry, scale = 0.28) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  if (!pos || !uv) return;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    uv.setXY(i, (x + 6) * scale, y * scale);
  }
  uv.needsUpdate = true;
}

/**
 * Recessed Architectural Arch Alcove + Limewash Wall + Fluted Sage Feature Panel + Hidden LED Cove Strip + 3D Brand Signage
 */
function ArchitecturalShell({
  config,
  wallMap,
  accentFlutedMap,
}: {
  config: StoreConfig;
  wallMap: THREE.Texture;
  accentFlutedMap: THREE.Texture;
}) {
  const archRadius = 1.36;
  const springY = 2.04;
  const wallWidth = 11.6;
  const wallHeight = 4.6;

  const { outerWallGeo, archTrimGeo, ledCoveGeo, flutes } = useMemo(() => {
    // 1. Outer Back Wall with true semi-circular Arch opening
    const wallShape = new THREE.Shape();
    wallShape.moveTo(-wallWidth / 2, 0);
    wallShape.lineTo(wallWidth / 2, 0);
    wallShape.lineTo(wallWidth / 2, wallHeight);
    wallShape.lineTo(-wallWidth / 2, wallHeight);
    wallShape.closePath();

    const archHole = new THREE.Path();
    archHole.moveTo(-archRadius, 0);
    archHole.lineTo(-archRadius, springY);
    archHole.absarc(0, springY, archRadius, Math.PI, 0, true);
    archHole.lineTo(archRadius, 0);
    archHole.closePath();
    wallShape.holes.push(archHole);

    const wGeo = new THREE.ExtrudeGeometry(wallShape, {
      depth: 0.22,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.01,
      bevelSegments: 3,
      curveSegments: 48,
    });
    applyPlanarWallUVs(wGeo, 0.26);

    // 2. Stepped Cream Architrave Molding framing the arch opening
    const trimOuterR = archRadius + 0.095;
    const trimShape = new THREE.Shape();
    trimShape.moveTo(-trimOuterR, 0);
    trimShape.lineTo(-trimOuterR, springY);
    trimShape.absarc(0, springY, trimOuterR, Math.PI, 0, true);
    trimShape.lineTo(trimOuterR, 0);
    trimShape.lineTo(archRadius, 0);
    trimShape.lineTo(archRadius, springY);
    trimShape.absarc(0, springY, archRadius, 0, Math.PI, false);
    trimShape.lineTo(-archRadius, 0);
    trimShape.closePath();

    const tGeo = new THREE.ExtrudeGeometry(trimShape, {
      depth: 0.026,
      bevelEnabled: true,
      bevelThickness: 0.006,
      bevelSize: 0.006,
      bevelSegments: 2,
      curveSegments: 48,
    });

    // 3. Warm Hidden LED Cove Strip tucked inside the alcove reveal
    const coveInnerR = archRadius - 0.012;
    const coveOuterR = archRadius + 0.032;
    const coveShape = new THREE.Shape();
    coveShape.moveTo(-coveOuterR, 0.04);
    coveShape.lineTo(-coveOuterR, springY);
    coveShape.absarc(0, springY, coveOuterR, Math.PI, 0, true);
    coveShape.lineTo(coveOuterR, 0.04);
    coveShape.lineTo(coveInnerR, 0.04);
    coveShape.lineTo(coveInnerR, springY);
    coveShape.absarc(0, springY, coveInnerR, 0, Math.PI, false);
    coveShape.lineTo(-coveInnerR, 0.04);
    coveShape.closePath();

    const cGeo = new THREE.ExtrudeGeometry(coveShape, {
      depth: 0.024,
      bevelEnabled: false,
      curveSegments: 48,
    });

    // 4. Physical 3D vertical fluted slats inside the recessed alcove
    const fluteItems: Array<{ x: number; height: number }> = [];
    const step = 0.074;
    for (let x = -archRadius + 0.045; x <= archRadius - 0.045; x += step) {
      const inside = Math.max(0, (archRadius + 0.03) ** 2 - x * x);
      const h = springY + Math.sqrt(inside);
      fluteItems.push({ x, height: h });
    }

    return {
      outerWallGeo: wGeo,
      archTrimGeo: tGeo,
      ledCoveGeo: cGeo,
      flutes: fluteItems,
    };
  }, []);

  useEffect(() => {
    return () => {
      outerWallGeo.dispose();
      archTrimGeo.dispose();
      ledCoveGeo.dispose();
    };
  }, [outerWallGeo, archTrimGeo, ledCoveGeo]);

  const isDarkRoom = useMemo(
    () => new THREE.Color(config.palette.wall).getHSL({ h: 0, s: 0, l: 0 }).l < 0.35,
    [config.palette.wall]
  );

  const rackMetalLum = useMemo(
    () => new THREE.Color(config.palette.rackMetal).getHSL({ h: 0, s: 0, l: 0 }).l,
    [config.palette.rackMetal]
  );

  const signageTextColor = isDarkRoom ? '#F6F7FA' : '#FAF6EE';
  const signageSubColor =
    rackMetalLum < 0.42 ? config.palette.secondaryAccent : config.palette.rackMetal;
  const coveGlowHex = config.lightingPreset === 'cool_gallery_spot' ? '#FF9858' : '#FFE8BE';

  return (
    <group name="architectural-shell">
      {/* Recessed Fluted Feature Panel Backing (z = -2.13) */}
      <mesh position={[0, 1.85, -2.13]} receiveShadow>
        <planeGeometry args={[3.1, 3.7]} />
        <meshStandardMaterial
          map={accentFlutedMap}
          color="#ffffff"
          roughness={0.62}
          metalness={0.05}
        />
      </mesh>

      {/* Physical 3D Vertical Fluted Ribs for genuine parallax & grazing light relief */}
      <group position={[0, 0, -2.112]}>
        {flutes.map((f, idx) => (
          <mesh
            key={idx}
            position={[f.x, f.height / 2, 0]}
            scale={[1, 1, 0.55]}
            receiveShadow
          >
            <cylinderGeometry args={[0.023, 0.023, f.height, 10]} />
            <meshStandardMaterial
              color={config.palette.accent}
              roughness={0.56}
              metalness={0.06}
            />
          </mesh>
        ))}
      </group>

      {/* Hidden Warm LED Cove Diffuser Strip outlining the recessed alcove */}
      <mesh geometry={ledCoveGeo} position={[0, 0, -1.99]}>
        <meshBasicMaterial color={coveGlowHex} toneMapped={false} />
      </mesh>

      {/* Alcove Floor Plinth Threshold Slab */}
      <mesh position={[0, 0.018, -1.98]} receiveShadow>
        <boxGeometry args={[2.86, 0.036, 0.32]} />
        <meshStandardMaterial
          color={config.palette.plinth}
          roughness={0.48}
          metalness={0.05}
        />
      </mesh>

      {/* Outer Back Wall extruded from z = -2.07 forward to z = -1.85 */}
      <mesh geometry={outerWallGeo} position={[0, 0, -2.07]} receiveShadow>
        <meshStandardMaterial
          map={wallMap}
          color="#ffffff"
          roughness={0.86}
          metalness={0.02}
        />
      </mesh>

      {/* Stepped Cream Architrave Molding around the Arch Opening */}
      <mesh geometry={archTrimGeo} position={[0, 0, -1.852]} receiveShadow castShadow>
        <meshStandardMaterial
          color={config.palette.secondaryAccent}
          roughness={0.72}
          metalness={0.04}
        />
      </mesh>

      {/* Baseboard Moldings flanking the Arch Opening on Back Wall */}
      <mesh position={[-3.62, 0.075, -1.832]} receiveShadow>
        <boxGeometry args={[4.35, 0.15, 0.028]} />
        <meshStandardMaterial color={config.palette.plinth} roughness={0.62} />
      </mesh>
      <mesh position={[3.62, 0.075, -1.832]} receiveShadow>
        <boxGeometry args={[4.35, 0.15, 0.028]} />
        <meshStandardMaterial color={config.palette.plinth} roughness={0.62} />
      </mesh>

      {/* Architectural Crown Cornices along all 4 Gallery Walls */}
      <mesh position={[0, 4.5, -1.80]} receiveShadow>
        <boxGeometry args={[11.6, 0.16, 0.12]} />
        <meshStandardMaterial color={config.palette.secondaryAccent} roughness={0.75} />
      </mesh>
      <mesh position={[0, 4.5, 7.85]} receiveShadow>
        <boxGeometry args={[9.8, 0.16, 0.12]} />
        <meshStandardMaterial color={config.palette.secondaryAccent} roughness={0.75} />
      </mesh>
      <mesh position={[-4.80, 4.5, 2.8]} receiveShadow>
        <boxGeometry args={[0.12, 0.16, 10.2]} />
        <meshStandardMaterial color={config.palette.secondaryAccent} roughness={0.75} />
      </mesh>
      <mesh position={[4.80, 4.5, 2.8]} receiveShadow>
        <boxGeometry args={[0.12, 0.16, 10.2]} />
        <meshStandardMaterial color={config.palette.secondaryAccent} roughness={0.75} />
      </mesh>

      {/* Left, Right & Front Gallery Walls fully enclosing 360° camera views */}
      <mesh position={[-4.85, 2.3, 2.8]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[10.2, 4.6]} />
        <meshStandardMaterial map={wallMap} color="#ffffff" roughness={0.88} />
      </mesh>
      <mesh position={[4.85, 2.3, 2.8]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[10.2, 4.6]} />
        <meshStandardMaterial map={wallMap} color="#ffffff" roughness={0.88} />
      </mesh>
      <mesh position={[0, 2.3, 7.9]} rotation={[0, Math.PI, 0]} receiveShadow>
        <planeGeometry args={[10.0, 4.6]} />
        <meshStandardMaterial map={wallMap} color="#ffffff" roughness={0.88} />
      </mesh>

      {/* Side & Front Wall Baseboards */}
      <mesh position={[-4.83, 0.075, 2.8]} receiveShadow>
        <boxGeometry args={[0.03, 0.15, 10.2]} />
        <meshStandardMaterial color={config.palette.plinth} roughness={0.62} />
      </mesh>
      <mesh position={[4.83, 0.075, 2.8]} receiveShadow>
        <boxGeometry args={[0.03, 0.15, 10.2]} />
        <meshStandardMaterial color={config.palette.plinth} roughness={0.62} />
      </mesh>
      <mesh position={[0, 0.075, 7.88]} receiveShadow>
        <boxGeometry args={[9.72, 0.15, 0.03]} />
        <meshStandardMaterial color={config.palette.plinth} roughness={0.62} />
      </mesh>

      {/* Overhead Architectural Ceiling Plane spanning full enclosed room up to z = 7.9+ */}
      <mesh position={[0, 4.58, 2.9]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[10.4, 10.4]} />
        <meshStandardMaterial color={config.palette.secondaryAccent} roughness={0.9} />
      </mesh>

      {/* 3D Brand Signage Mounted Inside Upper Arch */}
      <group position={[0, 2.60, -2.065]} name="brand-arch-signage">
        {/* Warm halo back-glow rim behind metallic plaque */}
        <RoundedBox args={[1.92, 0.48, 0.012]} radius={0.04} smoothness={4} position={[0, 0, -0.012]}>
          <meshBasicMaterial color={coveGlowHex} transparent opacity={0.38} toneMapped={false} />
        </RoundedBox>

        {/* Brushed Metallic Outer Plaque Frame */}
        <RoundedBox args={[1.88, 0.44, 0.022]} radius={0.036} smoothness={4} castShadow>
          <meshStandardMaterial
            color={config.palette.rackMetal}
            metalness={Math.min(0.68, config.metalness)}
            roughness={Math.max(0.48, config.metalRoughness)}
          />
        </RoundedBox>

        {/* Deep Matte Recessed Sign Faceplate */}
        <RoundedBox
          args={[1.82, 0.385, 0.026]}
          radius={0.028}
          smoothness={4}
          position={[0, 0, 0.004]}
        >
          <meshStandardMaterial
            color={isDarkRoom ? '#16171A' : shiftHex(config.palette.accent, -0.14)}
            roughness={0.86}
            metalness={0.04}
          />
        </RoundedBox>

        {/* Crisp Horizontal Brass Accent Rule */}
        <mesh position={[0, -0.042, 0.02]}>
          <boxGeometry args={[0.72, 0.004, 0.004]} />
          <meshStandardMaterial
            color={signageSubColor}
            metalness={0.72}
            roughness={0.42}
          />
        </mesh>

        {/* Deterministic Zero-Latency 2048×512 High-DPI Typography */}
        <FallbackCanvasSignage
          brandName={config.brandName}
          tagline={config.tagline}
          textColor={signageTextColor}
          subColor={signageSubColor}
        />
      </group>
    </group>
  );
}

/**
 * Framed Exhibition Art Print on Left Gallery Wall (x = -2.3, z = -1.8) + Picture-Light Accent
 */
function FramedExhibitionArt({
  config,
  posterMap,
}: {
  config: StoreConfig;
  posterMap: THREE.Texture;
}) {
  const matteBrassRoughness = Math.max(0.46, config.metalRoughness + 0.18);
  const matteBrassMetalness = Math.min(0.72, config.metalness);

  return (
    <group position={[-2.32, 1.88, -1.815]} name="framed-exhibition-art">
      {/* Sculpted Walnut Outer Gallery Frame */}
      <RoundedBox args={[0.96, 1.24, 0.044]} radius={0.008} smoothness={3} castShadow receiveShadow>
        <meshStandardMaterial
          color={config.palette.hangerWood}
          roughness={0.52}
          metalness={0.06}
        />
      </RoundedBox>

      {/* Inner Satin-Matte Brass Fillet Bezel */}
      <mesh position={[0, 0, 0.018]}>
        <boxGeometry args={[0.87, 1.15, 0.014]} />
        <meshStandardMaterial
          color={config.palette.rackMetal}
          metalness={matteBrassMetalness}
          roughness={matteBrassRoughness}
        />
      </mesh>

      {/* Archival Conservation Matboard */}
      <mesh position={[0, 0, 0.024]}>
        <planeGeometry args={[0.84, 1.12]} />
        <meshStandardMaterial color="#F7F3EA" roughness={0.94} />
      </mesh>

      {/* 3:4 Exhibition Print Plane */}
      <mesh position={[0, 0, 0.026]}>
        <planeGeometry args={[0.76, 1.013]} />
        <meshStandardMaterial map={posterMap} color="#ffffff" roughness={0.85} metalness={0.02} />
      </mesh>

      {/* Anti-Reflective Low-Iron Museum Glazing */}
      <mesh position={[0, 0, 0.028]}>
        <planeGeometry args={[0.84, 1.12]} />
        <meshPhysicalMaterial
          color="#ffffff"
          transparent
          opacity={0.035}
          roughness={0.32}
          metalness={0.04}
          clearcoat={0.12}
          clearcoatRoughness={0.42}
          depthWrite={false}
        />
      </mesh>

      {/* Brass Gallery Picture-Light Fixture Mounted Above Frame */}
      <group position={[0, 0.72, 0.04]}>
        {/* Wall Backplate */}
        <mesh position={[0, 0, -0.03]}>
          <cylinderGeometry args={[0.034, 0.034, 0.016, 20]} />
          <meshStandardMaterial
            color={config.palette.rackMetal}
            metalness={matteBrassMetalness}
            roughness={matteBrassRoughness}
          />
        </mesh>
        {/* Horizontal Extension Arm */}
        <mesh position={[0, 0.015, 0.055]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.008, 0.008, 0.16, 12]} />
          <meshStandardMaterial
            color={config.palette.rackMetal}
            metalness={matteBrassMetalness}
            roughness={matteBrassRoughness}
          />
        </mesh>
        {/* Cylindrical Brass Picture-Light Hood */}
        <mesh position={[0, 0.01, 0.135]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.022, 0.022, 0.44, 20]} />
          <meshStandardMaterial
            color={config.palette.rackMetal}
            metalness={matteBrassMetalness}
            roughness={matteBrassRoughness}
          />
        </mesh>
        {/* Warm Emissive Filament Strip Under Hood */}
        <mesh position={[0, -0.008, 0.135]}>
          <boxGeometry args={[0.38, 0.008, 0.018]} />
          <meshBasicMaterial color="#FFEAC2" toneMapped={false} />
        </mesh>
        {/* Softened Warm Picture Light Wash (glare-free) */}
        <pointLight
          position={[0, -0.06, 0.20]}
          color="#FFE9C4"
          intensity={0.6}
          distance={1.85}
          decay={2}
        />
      </group>
    </group>
  );
}

/**
 * Boutique Merchandising Props:
 * 1) Right Side (x = 2.1, z = -0.8): Low fluted travertine display pedestal + stacked folded knitwear + ceramic sculptural vessel + brass placard
 * 2) Left Foreground/Side (x = -2.35, z = 0.78): Architectural bench plinth + archive lookbooks + minimalist championship tennis court orb
 */
function BoutiqueMerchandisingProps({ config }: { config: StoreConfig }) {
  const vesselGeo = useMemo(() => {
    const pts = [
      new THREE.Vector2(0.001, 0),
      new THREE.Vector2(0.055, 0),
      new THREE.Vector2(0.088, 0.06),
      new THREE.Vector2(0.095, 0.13),
      new THREE.Vector2(0.068, 0.21),
      new THREE.Vector2(0.036, 0.255),
      new THREE.Vector2(0.044, 0.285),
      new THREE.Vector2(0.034, 0.285),
      new THREE.Vector2(0.028, 0.24),
    ];
    return new THREE.LatheGeometry(pts, 28);
  }, []);

  useEffect(() => () => vesselGeo.dispose(), [vesselGeo]);

  const pedestalFlutes = useMemo(() => {
    const coords: number[] = [];
    for (let x = -0.38; x <= 0.381; x += 0.0633) {
      coords.push(x);
    }
    return coords;
  }, []);

  return (
    <group name="boutique-merchandising-props">
      {/* =====================================================================
          RIGHT SIDE: Low Fluted Travertine Display Pedestal (x = 2.1, z = -0.8)
         ===================================================================== */}
      <group position={[2.1, 0, -0.8]} rotation={[0, -0.24, 0]}>
        {/* Recessed Dark Brass Toe-Kick Shadow Base */}
        <mesh position={[0, 0.025, 0]} receiveShadow>
          <boxGeometry args={[0.82, 0.05, 0.50]} />
          <meshStandardMaterial
            color={config.palette.rackMetal}
            metalness={config.metalness}
            roughness={0.38}
          />
        </mesh>

        {/* Main Travertine Plinth Core */}
        <RoundedBox
          args={[0.88, 0.64, 0.56]}
          radius={0.014}
          smoothness={3}
          position={[0, 0.37, 0]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial color={config.palette.plinth} roughness={0.62} metalness={0.03} />
        </RoundedBox>

        {/* Front & Rear Fluted Stone Reliefs on Pedestal */}
        {pedestalFlutes.map((fx, idx) => (
          <React.Fragment key={idx}>
            <mesh position={[fx, 0.37, 0.282]} scale={[1, 1, 0.45]} castShadow receiveShadow>
              <cylinderGeometry args={[0.02, 0.02, 0.60, 10]} />
              <meshStandardMaterial color={config.palette.plinth} roughness={0.58} />
            </mesh>
            <mesh position={[fx, 0.37, -0.282]} scale={[1, 1, 0.45]} receiveShadow>
              <cylinderGeometry args={[0.02, 0.02, 0.60, 10]} />
              <meshStandardMaterial color={config.palette.plinth} roughness={0.58} />
            </mesh>
          </React.Fragment>
        ))}

        {/* Honed Travertine Top Display Slab */}
        <RoundedBox
          args={[0.93, 0.052, 0.60]}
          radius={0.01}
          smoothness={3}
          position={[0, 0.715, 0]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial color={config.palette.plinth} roughness={0.44} metalness={0.04} />
        </RoundedBox>

        {/* Neat Stacked Folded Knitwear Blocks (Left Half of Pedestal) */}
        <group position={[-0.19, 0.742, 0.01]}>
          {/* Bottom Folded Sweater — Oat Heather */}
          <RoundedBox
            args={[0.34, 0.058, 0.38]}
            radius={0.022}
            smoothness={4}
            position={[0, 0.029, 0]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={config.palette.rug} roughness={0.92} />
          </RoundedBox>
          {/* Middle Folded Sweater — Brand Accent (Wimbledon Sage / Orange / Moss) */}
          <RoundedBox
            args={[0.325, 0.055, 0.365]}
            radius={0.022}
            smoothness={4}
            position={[0.008, 0.085, -0.006]}
            rotation={[0, 0.045, 0]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={config.palette.accent} roughness={0.9} />
          </RoundedBox>
          {/* Top Folded Sweater — Unbleached Ecru Cream with Ribbed Collar Fold */}
          <RoundedBox
            args={[0.31, 0.052, 0.35]}
            radius={0.022}
            smoothness={4}
            position={[-0.004, 0.138, 0.005]}
            rotation={[0, -0.03, 0]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color="#F4EFE4" roughness={0.92} />
          </RoundedBox>
          {/* Woven Brand Neck Label Detail on Top Fold */}
          <mesh position={[-0.004, 0.165, 0.04]} rotation={[-Math.PI / 2, 0, -0.03]}>
            <planeGeometry args={[0.075, 0.028]} />
            <meshStandardMaterial color={config.palette.accent} roughness={0.85} />
          </mesh>
        </group>

        {/* Minimalist Ceramic Sculptural Vessel + Architectural Stems (Right Half of Pedestal) */}
        <group position={[0.20, 0.741, -0.04]}>
          <mesh geometry={vesselGeo} castShadow receiveShadow>
            <meshStandardMaterial color="#EDE6D8" roughness={0.78} metalness={0.02} />
          </mesh>
          {/* Minimalist Dried Architectural Branches */}
          <mesh position={[-0.015, 0.38, 0.01]} rotation={[0.08, 0, 0.18]} castShadow>
            <cylinderGeometry args={[0.003, 0.005, 0.34, 8]} />
            <meshStandardMaterial color={config.palette.hangerWood} roughness={0.85} />
          </mesh>
          <mesh position={[0.022, 0.41, -0.012]} rotation={[-0.1, 0.2, -0.14]} castShadow>
            <cylinderGeometry args={[0.0025, 0.0045, 0.38, 8]} />
            <meshStandardMaterial color={config.palette.hangerWood} roughness={0.85} />
          </mesh>
          {/* Sculptural Botanical Seed Pods */}
          <mesh position={[-0.048, 0.53, 0.024]} castShadow>
            <sphereGeometry args={[0.016, 12, 12]} />
            <meshStandardMaterial color={config.palette.secondaryAccent} roughness={0.88} />
          </mesh>
          <mesh position={[0.052, 0.57, -0.028]} castShadow>
            <sphereGeometry args={[0.014, 12, 12]} />
            <meshStandardMaterial color={config.palette.secondaryAccent} roughness={0.88} />
          </mesh>
        </group>

        {/* Tiny Brushed Brass Price / Collection Placard */}
        <group position={[0.26, 0.742, 0.19]} rotation={[0, -0.28, 0]}>
          <mesh position={[0, 0.026, 0]} rotation={[-0.32, 0, 0]} castShadow>
            <boxGeometry args={[0.115, 0.058, 0.006]} />
            <meshStandardMaterial
              color={config.palette.rackMetal}
              metalness={config.metalness}
              roughness={config.metalRoughness}
            />
          </mesh>
          <mesh position={[0, 0.012, -0.016]}>
            <boxGeometry args={[0.095, 0.024, 0.026]} />
            <meshStandardMaterial
              color={config.palette.rackMetal}
              metalness={config.metalness}
              roughness={config.metalRoughness}
            />
          </mesh>
        </group>
      </group>

      {/* =====================================================================
          LEFT FOREGROUND / SIDE: Architectural Gallery Bench + Court Orb & Lookbooks
         ===================================================================== */}
      <group position={[-2.35, 0, 0.82]} rotation={[0, 0.38, 0]}>
        {/* Twin Monolithic Travertine Leg Blocks */}
        <RoundedBox
          args={[0.16, 0.36, 0.40]}
          radius={0.012}
          smoothness={3}
          position={[-0.40, 0.18, 0]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial color={config.palette.plinth} roughness={0.62} />
        </RoundedBox>
        <RoundedBox
          args={[0.16, 0.36, 0.40]}
          radius={0.012}
          smoothness={3}
          position={[0.40, 0.18, 0]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial color={config.palette.plinth} roughness={0.62} />
        </RoundedBox>

        {/* Walnut Timber Bench Deck */}
        <RoundedBox
          args={[1.16, 0.044, 0.44]}
          radius={0.01}
          smoothness={3}
          position={[0, 0.382, 0]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial color={config.palette.hangerWood} roughness={0.48} />
        </RoundedBox>

        {/* Tailored Bouclé Bench Seat Pad */}
        <RoundedBox
          args={[1.10, 0.038, 0.40]}
          radius={0.016}
          smoothness={4}
          position={[0, 0.422, 0]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial color={config.palette.rug} roughness={0.94} />
        </RoundedBox>

        {/* Stacked Linen-Bound Archive Lookbooks */}
        <group position={[-0.22, 0.441, 0.01]} rotation={[0, 0.14, 0]}>
          <RoundedBox
            args={[0.31, 0.032, 0.24]}
            radius={0.005}
            smoothness={2}
            position={[0, 0.016, 0]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color="#F3EFE6" roughness={0.82} />
          </RoundedBox>
          <RoundedBox
            args={[0.28, 0.028, 0.215]}
            radius={0.005}
            smoothness={2}
            position={[0.01, 0.046, -0.006]}
            rotation={[0, -0.08, 0]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={config.palette.accent} roughness={0.78} />
          </RoundedBox>
        </group>

        {/* Stylized Minimalist Championship Tennis Court Orb on Brass Ring Stand */}
        <group position={[0.24, 0.441, -0.02]}>
          <mesh position={[0, 0.012, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <torusGeometry args={[0.042, 0.007, 12, 28]} />
            <meshStandardMaterial
              color={config.palette.rackMetal}
              metalness={config.metalness}
              roughness={config.metalRoughness}
            />
          </mesh>
          <mesh position={[0, 0.072, 0]} castShadow receiveShadow>
            <sphereGeometry args={[0.064, 28, 28]} />
            <meshStandardMaterial
              color={config.id === 'good-shot-club' ? '#C7D36F' : config.palette.accent}
              roughness={0.86}
            />
          </mesh>
          {/* Crisp Curved Tennis Seam Inlay */}
          <mesh position={[0, 0.072, 0]} rotation={[0.45, 0.3, 0]}>
            <torusGeometry args={[0.0635, 0.0032, 10, 36]} />
            <meshStandardMaterial color="#FAF7F0" roughness={0.6} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

/**
 * Overhead Black/Brass Architectural Track-Lighting Rig (y = 3.65)
 * with 3 physical cylindrical spotlight canisters angled toward hero rack & alcove
 */
function OverheadTrackLightingRig({ config }: { config: StoreConfig }) {
  const canisterPositions: Array<{ x: number; rotZ: number; rotX: number }> = [
    { x: -1.12, rotZ: -0.34, rotX: -0.58 },
    { x: 0, rotZ: 0, rotX: -0.62 },
    { x: 1.12, rotZ: 0.34, rotX: -0.58 },
  ];

  const trackBlack = '#191A1D';

  return (
    <group position={[0, 3.65, 0]} name="overhead-track-rig">
      {/* Main Front & Rear Track Busbars */}
      <mesh position={[0, 0, 0.92]} castShadow>
        <boxGeometry args={[3.4, 0.036, 0.042]} />
        <meshStandardMaterial color={trackBlack} roughness={0.35} metalness={0.65} />
      </mesh>
      <mesh position={[0, 0, -0.82]}>
        <boxGeometry args={[3.4, 0.036, 0.042]} />
        <meshStandardMaterial color={trackBlack} roughness={0.35} metalness={0.65} />
      </mesh>

      {/* Side Crossbars forming Architectural H-Grid */}
      <mesh position={[-1.68, 0, 0.05]}>
        <boxGeometry args={[0.042, 0.036, 1.78]} />
        <meshStandardMaterial color={trackBlack} roughness={0.35} metalness={0.65} />
      </mesh>
      <mesh position={[1.68, 0, 0.05]}>
        <boxGeometry args={[0.042, 0.036, 1.78]} />
        <meshStandardMaterial color={trackBlack} roughness={0.35} metalness={0.65} />
      </mesh>

      {/* 4 Vertical Ceiling Suspension Rods + Brass Couplers */}
      {[
        [-1.62, 0.92],
        [1.62, 0.92],
        [-1.62, -0.82],
        [1.62, -0.82],
      ].map(([rx, rz], i) => (
        <group key={i} position={[rx, 0.46, rz]}>
          <mesh>
            <cylinderGeometry args={[0.008, 0.008, 0.92, 10]} />
            <meshStandardMaterial color={trackBlack} roughness={0.4} metalness={0.7} />
          </mesh>
          <mesh position={[0, -0.43, 0]}>
            <cylinderGeometry args={[0.018, 0.018, 0.045, 14]} />
            <meshStandardMaterial
              color={config.palette.rackMetal}
              metalness={config.metalness}
              roughness={config.metalRoughness}
            />
          </mesh>
        </group>
      ))}

      {/* 3 Physical Cylindrical Spotlight Canisters Angled at Hero Rack & Alcove */}
      {canisterPositions.map((spot, idx) => (
        <group key={idx} position={[spot.x, -0.02, 0.92]}>
          {/* Brass Track Adapter Collar */}
          <mesh position={[0, -0.025, 0]}>
            <cylinderGeometry args={[0.024, 0.024, 0.05, 16]} />
            <meshStandardMaterial
              color={config.palette.rackMetal}
              metalness={config.metalness}
              roughness={config.metalRoughness}
            />
          </mesh>

          {/* Angled Gimbal Yoke + Cylindrical Canister Body */}
          <group position={[0, -0.095, 0]} rotation={[spot.rotX, 0, spot.rotZ]}>
            {/* U-Yoke Stem */}
            <mesh position={[0, 0.04, 0]}>
              <boxGeometry args={[0.11, 0.014, 0.022]} />
              <meshStandardMaterial color={trackBlack} roughness={0.4} metalness={0.7} />
            </mesh>

            {/* Matte Black Cylindrical Canister Housing */}
            <mesh castShadow>
              <cylinderGeometry args={[0.046, 0.046, 0.19, 24]} />
              <meshStandardMaterial color={trackBlack} roughness={0.32} metalness={0.68} />
            </mesh>

            {/* Brushed Brass Snoot Baffle Trim Ring */}
            <mesh position={[0, -0.092, 0]}>
              <cylinderGeometry args={[0.048, 0.048, 0.022, 24]} />
              <meshStandardMaterial
                color={config.palette.rackMetal}
                metalness={config.metalness}
                roughness={config.metalRoughness}
              />
            </mesh>

            {/* Emissive Optical Lens */}
            <mesh position={[0, -0.102, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.039, 20]} />
              <meshBasicMaterial color={config.palette.spotLight} toneMapped={false} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
}

/**
 * Architectural Magazine-Grade 3D Boutique Showroom
 */
export const BoutiqueWorld: React.FC<BoutiqueWorldProps> = ({ config, children }) => {
  const { gl, scene } = useThree();
  const maxAniso = useMemo(() => Math.min(8, gl.capabilities.getMaxAnisotropy()), [gl]);

  useEffect(() => {
    scene.background = new THREE.Color(config.palette.wall);
    scene.fog = new THREE.Fog(config.palette.wall, 9.8, 19.5);
  }, [scene, config.palette.wall]);

  // Load optional PNG textures safely; only apply default Good Shot Club PNGs if palette matches
  // so custom-dropped shirt palette mutations dynamically recolor surfaces cleanly!
  const usePresetFloorPng =
    Boolean(config.textures.floorUrl) &&
    (config.textures.floorUrl !== '/assets/textures/travertine-floor.png' ||
      config.palette.floor.toLowerCase() === '#ddd5c7');

  const usePresetWallPng =
    Boolean(config.textures.wallUrl) &&
    (config.textures.wallUrl !== '/assets/textures/limewash-wall.png' ||
      config.palette.wall.toLowerCase() === '#f3efe6');

  const usePresetFlutedPng =
    Boolean(config.textures.accentPanelUrl) &&
    (config.textures.accentPanelUrl !== '/assets/textures/sage-fluted-wood.png' ||
      config.palette.accent.toLowerCase() === '#547049');

  const loadedFloorTex = useOptionalTexture(
    usePresetFloorPng ? config.textures.floorUrl : undefined,
    { repeat: [5, 5], anisotropy: maxAniso }
  );
  const loadedWallTex = useOptionalTexture(
    usePresetWallPng ? config.textures.wallUrl : undefined,
    { repeat: [2, 2], anisotropy: maxAniso }
  );
  const loadedFlutedTex = useOptionalTexture(
    usePresetFlutedPng ? config.textures.accentPanelUrl : undefined,
    { repeat: [2.2, 1.5], anisotropy: maxAniso }
  );
  const loadedPosterTex = useOptionalTexture(config.textures.posterUrl, {
    repeat: [1, 1],
    wrap: THREE.ClampToEdgeWrapping,
    anisotropy: maxAniso,
  });

  // Procedural high-DPI fallback textures (instantaneous & dynamic for every preset/mutation)
  const procFloorTex = useMemo(
    () => createProceduralFloorTexture(config.palette.floor, config.id, maxAniso),
    [config.palette.floor, config.id, maxAniso]
  );
  const procWallTex = useMemo(
    () => createProceduralWallTexture(config.palette.wall, config.id, maxAniso),
    [config.palette.wall, config.id, maxAniso]
  );
  const procFlutedTex = useMemo(
    () => createProceduralFlutedTexture(config.palette.accent, maxAniso),
    [config.palette.accent, maxAniso]
  );
  const procPosterTex = useMemo(
    () => createProceduralPosterTexture(config, maxAniso),
    [config, maxAniso]
  );
  const rugTextures = useMemo(
    () =>
      createBoucleRugTextures(
        config.palette.rug,
        config.palette.secondaryAccent,
        maxAniso
      ),
    [config.palette.rug, config.palette.secondaryAccent, maxAniso]
  );

  useEffect(() => () => procFloorTex.dispose(), [procFloorTex]);
  useEffect(() => () => procWallTex.dispose(), [procWallTex]);
  useEffect(() => () => procFlutedTex.dispose(), [procFlutedTex]);
  useEffect(() => () => procPosterTex.dispose(), [procPosterTex]);
  useEffect(
    () => () => {
      rugTextures.map.dispose();
      rugTextures.bumpMap.dispose();
    },
    [rugTextures]
  );

  const floorMatRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const activeFloorMap = loadedFloorTex ?? procFloorTex;
  const activeWallMap = loadedWallTex ?? procWallTex;
  const activeFlutedMap = loadedFlutedTex ?? procFlutedTex;
  const activePosterMap = loadedPosterTex ?? procPosterTex;

  useEffect(() => {
    if (floorMatRef.current) {
      floorMatRef.current.needsUpdate = true;
    }
  }, [activeFloorMap]);

  const floorRoughness =
    config.id === 'kinetic-concrete' ? 0.42 : config.id === 'kyoto-atelier' ? 0.64 : 0.54;

  return (
    <group name="boutique-world">
      {/* Studio Lighting Rig + ContactShadows + Key Shadow SpotLight */}
      <StudioLightingRig config={config} />

      {/* Spacious Showroom Floor (y = 0) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 1.8]} receiveShadow>
        <planeGeometry args={[18, 16]} />
        <meshPhysicalMaterial
          ref={floorMatRef}
          map={activeFloorMap}
          color="#ffffff"
          roughness={floorRoughness}
          metalness={0.04}
          clearcoat={0.14}
          clearcoatRoughness={0.55}
        />
      </mesh>

      {/* Woven Bouclé Rectangular Area Rug Framing Hero Rack Zone (sits below y = 0.005 ContactShadows) */}
      <group position={[0, 0, 0.08]} name="boucle-area-rug">
        {/* Outer Mitered Binding Trim */}
        <mesh position={[0, 0.0014, 0]} receiveShadow>
          <boxGeometry args={[3.48, 0.0028, 2.42]} />
          <meshStandardMaterial color={config.palette.secondaryAccent} roughness={0.92} />
        </mesh>
        {/* Main Woven Bouclé Pile */}
        <mesh position={[0, 0.0024, 0]} receiveShadow>
          <boxGeometry args={[3.38, 0.0038, 2.32]} />
          <meshStandardMaterial
            map={rugTextures.map}
            bumpMap={rugTextures.bumpMap}
            bumpScale={0.007}
            color="#ffffff"
            roughness={0.96}
            metalness={0.01}
          />
        </mesh>
      </group>

      {/* Recessed Arch Alcove + Fluted Feature Panel + Hidden LED Cove + 3D Brand Signage */}
      <ArchitecturalShell
        config={config}
        wallMap={activeWallMap}
        accentFlutedMap={activeFlutedMap}
      />

      {/* Framed Exhibition Art Print + Brass Picture Light on Left Wall */}
      <FramedExhibitionArt config={config} posterMap={activePosterMap} />

      {/* Flanking Boutique Merchandising Props (Pedestal + Knitwear + Ceramic Vessel + Bench + Court Orb) */}
      <BoutiqueMerchandisingProps config={config} />

      {/* Overhead Black/Brass Architectural Track-Lighting Rig with 3 Physical Canisters */}
      <OverheadTrackLightingRig config={config} />

      {/* Optional Nested Children (e.g., BoutiqueRack placements if passed as children) */}
      {children}
    </group>
  );
};

export default BoutiqueWorld;
