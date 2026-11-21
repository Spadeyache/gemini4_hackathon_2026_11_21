import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import type { GarmentTuningParams } from '../types/storeConfig';

export interface HangingGarmentProps {
  frontMap: THREE.Texture;
  backMap?: THREE.Texture;
  normalMap?: THREE.Texture;
  /** Width / height of trimmed garment PNG, default 0.85 */
  aspect?: number;
  /** Anchor point directly ON the rack top bar (default [0, 0, 0]) */
  position?: [number, number, number];
  /** Yaw rotation of the garment & wooden hanger body in radians */
  rotationY?: number;
  /** Optional swivel angle for the metal hook relative to the hanger body so it straddles X or Z rails cleanly */
  hookSwivelY?: number;
  /** Machined hanger hook & collar finish (e.g. '#C5A059') */
  metalColor?: string;
  /** Contoured luxury wooden shoulder finish (e.g. '#7A5230') */
  woodColor?: string;
  /** Optional PBR metalness override from StoreConfig */
  metalness?: number;
  /** Optional PBR metal roughness override from StoreConfig */
  metalRoughness?: number;
  /** Optional brand accent color for subtle selection tag trim */
  accentColor?: string;
  /** Real-time volumetric cloth & comparison tuning parameters */
  tuning: GarmentTuningParams;
  selected?: boolean;
  onSelect?: () => void;
  label?: string;
  price?: number;
  /** Optional flag if a horizontally mirrored back photo ever requires UV flip (default false: 1:1 silhouette lock) */
  flipBackUV?: boolean;
}

const GARMENT_HEIGHT = 0.74; // Real-world adult luxury knit/tee length in meters
const CLOTH_ANCHOR_Y = -0.074; // Distance below rack rail center [0,0,0] to garment 3% collar line
const COLLAR_TOP_RATIO = 0.97; // Collar anchor sits at 3% down from top of trimmed PNG
const GRID_SEGMENTS = 48;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-5, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Evaluates the forward-swept Z contour of the luxury wooden hanger at |x|
 * so both the 3D CatmullRomCurve3 hanger and the upper shoulder cloth shells
 * share the exact same tailored 3D ridge line without poke-through.
 */
function evaluateHangerSweepZ(absX: number, halfSpan: number): number {
  const t = Math.max(0, Math.min(1, absX / Math.max(0.001, halfSpan)));
  return Math.sin(t * Math.PI * 0.78) * 0.005 + Math.pow(t, 1.45) * 0.0025;
}

/**
 * Synthesizes a clean cotton-knit back texture preserving frontMap's exact 1:1 alpha silhouette
 * if `backMap` is omitted in volumetric mode, ensuring zero mirrored front graphics when orbiting 360°.
 */
function createSynthesizedBackTexture(frontMap: THREE.Texture): THREE.CanvasTexture | null {
  const source = frontMap.image as
    | HTMLImageElement
    | HTMLCanvasElement
    | ImageBitmap
    | undefined;
  if (!source) return null;

  const srcW = (source as HTMLImageElement).naturalWidth || source.width || 0;
  const srcH = (source as HTMLImageElement).naturalHeight || source.height || 0;
  if (srcW <= 0 || srcH <= 0) return null;

  try {
    const w = Math.min(512, srcW);
    const h = Math.min(512, srcH);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(source as CanvasImageSource, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);
    const { data } = imgData;

    // Sample clean cotton body color from upper shoulder/lower hem zones away from center chest graphic
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let count = 0;

    for (let py = 0; py < h; py += 3) {
      const ny = py / h;
      for (let px = 0; px < w; px += 3) {
        const nx = px / w;
        const inCleanShoulder = ny > 0.14 && ny < 0.28 && ((nx > 0.24 && nx < 0.36) || (nx > 0.64 && nx < 0.76));
        const inCleanLowerBody = ny > 0.72 && ny < 0.90 && nx > 0.28 && nx < 0.72;
        if (!inCleanShoulder && !inCleanLowerBody) continue;

        const idx = (py * w + px) * 4;
        if (data[idx + 3] > 210) {
          sumR += data[idx];
          sumG += data[idx + 1];
          sumB += data[idx + 2];
          count++;
        }
      }
    }

    const baseR = count > 8 ? sumR / count : 242;
    const baseG = count > 8 ? sumG / count : 238;
    const baseB = count > 8 ? sumB / count : 230;

    for (let py = 0; py < h; py++) {
      const vNorm = py / h;
      // Keep top 9% collar/ringer rib detail authentic while replacing chest graphic with clean jersey knit
      const keepCollarBand = vNorm < 0.085 ? 1 - smoothstep(0.055, 0.09, vNorm) : 0;

      for (let px = 0; px < w; px++) {
        const idx = (py * w + px) * 4;
        const alpha = data[idx + 3];
        if (alpha < 8) continue;

        const uNorm = px / w;
        // Preserve outer sleeve ringer cuff trim as well
        const edgeDist = Math.abs(uNorm - 0.5) * 2;
        const keepCuffTrim = edgeDist > 0.78 && vNorm < 0.62 ? smoothstep(0.78, 0.88, edgeDist) : 0;
        const preserve = Math.max(keepCollarBand, keepCuffTrim);

        // Subtle organic vertical jersey slub & soft center spine drape shading
        const slub =
          Math.sin(uNorm * Math.PI * 6) * 3.2 +
          ((px * 17 + py * 31) % 5) * 0.55 -
          1.2;
        const targetR = Math.max(0, Math.min(255, baseR + slub));
        const targetG = Math.max(0, Math.min(255, baseG + slub));
        const targetB = Math.max(0, Math.min(255, baseB + slub));

        data[idx] = Math.round(data[idx] * preserve + targetR * (1 - preserve));
        data[idx + 1] = Math.round(data[idx + 1] * preserve + targetG * (1 - preserve));
        data[idx + 2] = Math.round(data[idx + 2] * preserve + targetB * (1 - preserve));
      }
    }

    ctx.putImageData(imgData, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = frontMap.anisotropy || 4;
    tex.needsUpdate = true;
    return tex;
  } catch {
    return null;
  }
}

/**
 * Creates a crisp offline-proof boutique archival label badge texture when hovered/selected
 */
function createBoutiqueBadgeTexture(
  label: string,
  price: number | undefined,
  accentHex: string,
  metalHex: string
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 144;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#FAF7F0';
  ctx.fillRect(0, 0, 512, 144);

  ctx.strokeStyle = metalHex;
  ctx.lineWidth = 4;
  ctx.strokeRect(8, 8, 496, 128);

  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 2;
  ctx.strokeRect(16, 16, 480, 112);

  ctx.fillStyle = '#1E211D';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 26px Georgia, "Times New Roman", serif';
  const truncated = label.length > 28 ? `${label.slice(0, 27)}…` : label;
  ctx.fillText(truncated.toUpperCase(), 256, price !== undefined ? 54 : 72);

  if (price !== undefined) {
    ctx.fillStyle = accentHex;
    ctx.font = '600 22px system-ui, -apple-system, sans-serif';
    ctx.fillText(`$${price.toFixed(0)} · ARCHIVE EDITION`, 256, 95);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export const HangingGarment: React.FC<HangingGarmentProps> = ({
  frontMap,
  backMap,
  normalMap,
  aspect = 0.85,
  position = [0, 0, 0],
  rotationY = 0,
  hookSwivelY = 0,
  metalColor = '#C5A059',
  woodColor = '#7A5230',
  metalness = 0.88,
  metalRoughness = 0.24,
  accentColor = '#547049',
  tuning,
  selected = false,
  onSelect,
  label,
  price,
  flipBackUV = false,
}) => {
  const swayGroupRef = useRef<THREE.Group>(null);
  const frontMatRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const backMatRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const [hovered, setHovered] = useState(false);

  // Unique phase offset per garment instance so multiple garments on a capsule rail breathe organically
  const phaseOffset = useMemo(
    () =>
      Math.abs(
        position[0] * 3.7 + position[2] * 5.3 + rotationY * 2.1 + (label ? label.length * 0.41 : 0.7)
      ),
    [position, rotationY, label]
  );

  // Damped harmonic spring state for interactive finger-brush & click impulse
  const springState = useRef({
    angleX: 0,
    velX: 0,
    angleZ: 0,
    velZ: 0,
    angleY: 0,
    velY: 0,
  });

  useEffect(() => {
    if (!hovered) return;
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = 'pointer';
    return () => {
      document.body.style.cursor = prevCursor;
    };
  }, [hovered]);

  const safeAspect = Math.max(0.45, Math.min(1.55, Number.isFinite(aspect) ? aspect : 0.85));
  const garmentWidth = GARMENT_HEIGHT * safeAspect;
  // Luxury wooden shoulder half-span tucks wingtips cleanly inside shoulder seams
  const shoulderHalfSpan = Math.min(0.132, Math.max(0.104, garmentWidth * 0.198));
  const isVolumetric = tuning.renderMode === 'volumetric';

  // Synthesize a clean cotton jersey back fallback only if backMap was omitted in volumetric mode
  const fallbackBackMap = useMemo(() => {
    if (backMap || !isVolumetric) return null;
    return createSynthesizedBackTexture(frontMap);
  }, [backMap, frontMap, isVolumetric]);

  useEffect(() => {
    return () => {
      fallbackBackMap?.dispose();
    };
  }, [fallbackBackMap]);

  const effectiveBackMap = backMap ?? fallbackBackMap ?? frontMap;

  // Sculpted 3D Contoured Wooden Hanger Geometry (23° downward shoulder wings + forward sweep + capped tips)
  const hangerGeometryData = useMemo(() => {
    const slope23 = Math.tan((23 * Math.PI) / 180); // ~0.4245
    const crownY = CLOTH_ANCHOR_Y - 0.005; // Nestles visibly inside collar neck opening while wings tuck below seams
    const wingRadius = 0.0062;

    // Seamless hardware vertical chain from lower hook elbow (-0.0225) -> swivel neck pin -> knurled collar -> crownY
    const collarY = crownY + 0.0095;
    const hookElbowY = -0.0225;
    const neckPinHeight = hookElbowY - collarY;
    const neckPinY = (hookElbowY + collarY) * 0.5;

    const makeWingPoint = (signedFrac: number, extraTipDrop = 0) => {
      const x = signedFrac * shoulderHalfSpan;
      const absX = Math.abs(x);
      const y = crownY - absX * slope23 - extraTipDrop;
      const z = evaluateHangerSweepZ(absX, shoulderHalfSpan);
      return new THREE.Vector3(x, y, z);
    };

    const curve = new THREE.CatmullRomCurve3(
      [
        makeWingPoint(-1.0, 0.008),
        makeWingPoint(-0.74, 0.0025),
        makeWingPoint(-0.38, 0),
        new THREE.Vector3(0, crownY + 0.0012, 0),
        makeWingPoint(0.38, 0),
        makeWingPoint(0.74, 0.0025),
        makeWingPoint(1.0, 0.008),
      ],
      false,
      'centripetal',
      0.45
    );

    const tubeGeo = new THREE.TubeGeometry(curve, 52, wingRadius, 18, false);
    const leftTipPos = curve.getPoint(0);
    const rightTipPos = curve.getPoint(1);

    // Hook open tip coordinates for machined ball finial
    const hookRadius = 0.0195;
    const hookArc = Math.PI * 1.42;
    const tipTheta = -Math.PI * 0.5 + hookArc;
    const hookTipPos: [number, number, number] = [
      hookRadius * Math.cos(tipTheta),
      -0.003 + hookRadius * Math.sin(tipTheta),
      0,
    ];

    return {
      tubeGeo,
      wingRadius,
      crownY,
      collarY,
      neckPinY,
      neckPinHeight,
      leftTipPos,
      rightTipPos,
      hookRadius,
      hookArc,
      hookTipPos,
    };
  }, [shoulderHalfSpan]);

  useEffect(() => {
    return () => {
      hangerGeometryData.tubeGeo.dispose();
    };
  }, [hangerGeometryData]);

  // Pre-allocate 48x48 Front & Back cloth geometries per aspect/flipBackUV, plus flat comparison geometry
  const clothGeometries = useMemo(() => {
    const frontGeo = new THREE.PlaneGeometry(
      garmentWidth,
      GARMENT_HEIGHT,
      GRID_SEGMENTS,
      GRID_SEGMENTS
    );
    const backGeo = new THREE.PlaneGeometry(
      garmentWidth,
      GARMENT_HEIGHT,
      GRID_SEGMENTS,
      GRID_SEGMENTS
    );

    if (flipBackUV) {
      const uv = backGeo.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        uv.setX(i, 1 - uv.getX(i));
      }
      uv.needsUpdate = true;
    }

    // Naive flat comparison geometry: single uncurved PlaneGeometry anchored at the same 3% collar line
    const flatGeo = new THREE.PlaneGeometry(garmentWidth, GARMENT_HEIGHT, 1, 1);
    flatGeo.translate(0, (0.5 - COLLAR_TOP_RATIO) * GARMENT_HEIGHT, 0);

    return { frontGeo, backGeo, flatGeo };
  }, [garmentWidth, flipBackUV]);

  useEffect(() => {
    return () => {
      clothGeometries.frontGeo.dispose();
      clothGeometries.backGeo.dispose();
      clothGeometries.flatGeo.dispose();
    };
  }, [clothGeometries]);

  // Deform 48x48 dual-shell cloth vertices in-place at 60-120fps whenever tuning sliders change
  useLayoutEffect(() => {
    if (!isVolumetric) return;

    const { frontGeo, backGeo } = clothGeometries;
    const frontPos = frontGeo.attributes.position;
    const backPos = backGeo.attributes.position;
    const uvAttr = frontGeo.attributes.uv;

    const curveDepth = Math.max(0, tuning.curveDepth);
    const sleeveRelax = Math.max(0, Math.min(1.25, tuning.sleeveRelax));
    const baseShell = Math.max(0.002, tuning.shellThickness);

    for (let i = 0; i < uvAttr.count; i++) {
      const u = uvAttr.getX(i); // 0..1 left to right
      const v = uvAttr.getY(i); // 0..1 bottom to top

      const nx = (u - 0.5) * 2; // -1..1 across garment width
      const absNx = Math.abs(nx);
      const ny = (v - 0.5) * 2; // -1..1 bottom to top (ny > 0.05 is upper half)

      // Base cloth coordinates with 3%-from-top collar anchored at y = 0 in cloth space
      let x = (u - 0.5) * garmentWidth;
      let y = (v - COLLAR_TOP_RATIO) * GARMENT_HEIGHT;

      // 1. Cylindrical chest/torso drape + forward-swept hanger shoulder ridge alignment
      const shoulderRidgeMask =
        Math.exp(-Math.pow((1 - v) / 0.21, 2)) * (1 - smoothstep(0.46, 0.72, absNx));
      const torsoDrapeZ = -Math.pow(nx, 2) * curveDepth * (1 - shoulderRidgeMask * 0.82);
      const hangerRidgeZ =
        evaluateHangerSweepZ(Math.abs(x), shoulderHalfSpan) * shoulderRidgeMask;
      const chestLoftZ =
        Math.sin(v * Math.PI) * (1 - Math.pow(nx, 2)) * (curveDepth * 0.22);

      // 2. Flat-Lay Sleeve Gravity Relaxation (|nx| > 0.28 in upper half ny > 0.05)
      let sleeveBackZ = 0;
      if (absNx > 0.28 && ny > 0.05 && sleeveRelax > 0) {
        const wingRaw = (absNx - 0.28) / (1 - 0.28);
        const wingEase = Math.pow(wingRaw, 1.92);
        const upperMask = smoothstep(0.05, 0.28, ny);
        const relax = sleeveRelax * wingEase * upperMask;

        const droopY = relax * 0.112;
        y -= droopY;
        // Length-preserving inward rotation around shoulder seam so cuffs hang naturally without stretching
        x -= Math.sign(nx) * droopY * 0.33;
        // Gentle backward & inward cylindrical sleeve relaxation + subtle sleeve fold wave
        sleeveBackZ =
          -relax * (0.042 + curveDepth * 0.26) +
          Math.sin(ny * Math.PI * 2.1) * relax * 0.007;
      }

      // 3. Natural vertical catenary pleat waves: 0 at rigid hanger shoulders -> soft cotton waves at hem
      const fromShoulders = Math.max(0, 1 - v);
      const bottomFactor = Math.pow(smoothstep(0.05, 1.0, fromShoulders), 1.25);
      const hemWaveZ =
        Math.sin(nx * 11) * 0.016 * bottomFactor +
        Math.cos(nx * 5.5) * 0.01 * bottomFactor;

      // Subtle catenary hem settle at center torso
      y -= (1 - Math.pow(nx, 2)) * 0.0038 * bottomFactor;

      const zCenter = torsoDrapeZ + hangerRidgeZ + chestLoftZ + sleeveBackZ + hemWaveZ;

      // 4. Dual-Shell Volumetric Thickness Profile:
      // - Full `shellThickness` (~0.018m) in torso center
      // - Smoothly pinched down to 0.002m near bottom hem, outer sleeve tips & lower side seams
      // - Open ~0.022m+ around top-center collar neck opening & shoulder bar so 3D wooden hanger enters cleanly inside!
      const bottomPinch = smoothstep(0.0, 0.11, v);
      const lowerHalfWeight = 1 - smoothstep(0.46, 0.62, v);
      const lowerTorsoPinch = 1 - smoothstep(0.34, 0.50, absNx);
      const upperWingPinch = 1 - smoothstep(0.70, 0.96, absNx);
      const lateralEnvelope =
        lowerHalfWeight * lowerTorsoPinch + (1 - lowerHalfWeight) * upperWingPinch;

      let localGap = 0.002 + (baseShell - 0.002) * bottomPinch * lateralEnvelope;

      // Ensure physical clearance over the contoured wooden hanger wings inside the shoulders
      const shoulderBarMask =
        smoothstep(0.74, 0.86, v) * (1 - smoothstep(0.46, 0.60, absNx));
      const hangerClearance = 0.0225 * shoulderBarMask;

      // Keep top-center collar neck opening slightly open (~0.023m-0.025m) so wooden crown visibly enters between shells
      const collarOpenMask =
        smoothstep(0.82, 0.95, v) * (1 - smoothstep(0.15, 0.29, absNx));
      const collarOpening = Math.max(0.0235, baseShell * 1.28) * collarOpenMask;

      localGap = Math.max(localGap, hangerClearance, collarOpening);

      const halfGap = localGap * 0.5;
      // Slight natural collar scoop relief between front neckband and higher back neckband
      const collarRelief = collarOpenMask * 0.0025;

      frontPos.setXYZ(i, x, y, zCenter + halfGap + collarRelief);
      backPos.setXYZ(i, x, y, zCenter - halfGap - collarRelief);
    }

    frontPos.needsUpdate = true;
    backPos.needsUpdate = true;
    frontGeo.computeVertexNormals();
    backGeo.computeVertexNormals();
    frontGeo.computeBoundingSphere();
    backGeo.computeBoundingSphere();
  }, [
    isVolumetric,
    clothGeometries,
    garmentWidth,
    shoulderHalfSpan,
    tuning.curveDepth,
    tuning.sleeveRelax,
    tuning.shellThickness,
  ]);

  // Custom RGBADepthPacking shadow material so spotlights cast razor-sharp shirt-shaped shadows onto wall & plinth
  const customDepthMaterial = useMemo(() => {
    return new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: frontMap,
      alphaTest: 0.38,
      side: THREE.DoubleSide,
    });
  }, [frontMap]);

  useEffect(() => {
    return () => {
      customDepthMaterial.dispose();
    };
  }, [customDepthMaterial]);

  // Ensure shader recompiles cleanly if normalMap presence or renderMode changes dynamically
  useEffect(() => {
    if (frontMatRef.current) frontMatRef.current.needsUpdate = true;
    if (backMatRef.current) backMatRef.current.needsUpdate = true;
  }, [frontMap, effectiveBackMap, normalMap, isVolumetric]);

  const sheenColor = useMemo(() => new THREE.Color('#FFFDF8'), []);
  const normalScaleVec = useMemo(
    () => new THREE.Vector2(tuning.normalStrength, tuning.normalStrength),
    [tuning.normalStrength]
  );
  const backNormalScaleVec = useMemo(
    () => new THREE.Vector2(tuning.normalStrength * 0.7, tuning.normalStrength * 0.7),
    [tuning.normalStrength]
  );

  // Subtle boutique archival label badge shown below hem when selected or hovered
  const badgeTexture = useMemo(() => {
    if (!label) return null;
    return createBoutiqueBadgeTexture(label, price, accentColor, metalColor);
  }, [label, price, accentColor, metalColor]);

  useEffect(() => {
    return () => {
      badgeTexture?.dispose();
    };
  }, [badgeTexture]);

  // Subtle air-conditioning pendulum sway + interactive spring physics
  useFrame((state, delta) => {
    const group = swayGroupRef.current;
    if (!group) return;

    const dt = Math.min(delta, 0.05);
    const t = state.clock.getElapsedTime();
    const s = springState.current;

    const stiffness = 24;
    const damping = 4.4;

    s.velX += (-stiffness * s.angleX - damping * s.velX) * dt;
    s.angleX += s.velX * dt;

    s.velZ += (-stiffness * s.angleZ - damping * s.velZ) * dt;
    s.angleZ += s.velZ * dt;

    s.velY += (-18 * s.angleY - 3.8 * s.velY) * dt;
    s.angleY += s.velY * dt;

    const swayAmt = Math.max(0, tuning.swayIntensity);
    const ambientX =
      (Math.sin(t * 1.18 + phaseOffset) * 0.015 +
        Math.sin(t * 2.45 + phaseOffset * 1.7) * 0.0045) *
      swayAmt;
    const ambientZ = Math.cos(t * 0.88 + phaseOffset * 1.3) * 0.0055 * swayAmt;
    const ambientY = Math.sin(t * 0.64 + phaseOffset * 0.85) * 0.011 * swayAmt;

    group.rotation.x = ambientX + s.angleX;
    group.rotation.z = ambientZ + s.angleZ;
    group.rotation.y = ambientY + s.angleY;
  });

  const handlePointerEnter = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(true);
    // Gentle hand-brush impulse nudging the hanging cloth on the rack
    springState.current.velX = Math.max(-0.45, springState.current.velX - 0.22);
    springState.current.velZ += (Math.random() - 0.5) * 0.08;
    springState.current.velY += (e.point.x >= position[0] ? 1 : -1) * 0.11;
  };

  const handlePointerLeave = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(false);
  };

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    springState.current.velX = Math.max(-0.55, springState.current.velX - 0.3);
    springState.current.velY += 0.14;
    onSelect?.();
  };

  const showBadge = Boolean(badgeTexture && hovered);

  return (
    <group position={position} rotation={[0, rotationY, 0]} name="hanging-garment-anchor">
      {/* Pendulum group pivoting directly around the rack bar contact point [0, 0, 0] */}
      <group ref={swayGroupRef}>
        {/* =================================================================
            1. SCULPTED 3D BOUTIQUE HANGER (Visible in `volumetric` mode)
           ================================================================= */}
        {isVolumetric && (
          <group name="sculpted-boutique-hanger">
            {/* Machined Metal Swivel Hook resting physically around the rack rail at [0, 0, 0] */}
            <group rotation={[0, hookSwivelY, 0]}>
              <mesh
                position={[0, -0.003, 0]}
                rotation={[0, 0, -Math.PI * 0.5]}
                castShadow
              >
                <torusGeometry
                  args={[
                    hangerGeometryData.hookRadius,
                    0.0033,
                    16,
                    42,
                    hangerGeometryData.hookArc,
                  ]}
                />
                <meshStandardMaterial
                  color={metalColor}
                  metalness={metalness}
                  roughness={metalRoughness}
                />
              </mesh>

              {/* Rounded Machined Hook End-Cap Finial */}
              <mesh position={hangerGeometryData.hookTipPos} castShadow>
                <sphereGeometry args={[0.0041, 14, 14]} />
                <meshStandardMaterial
                  color={metalColor}
                  metalness={metalness}
                  roughness={metalRoughness}
                />
              </mesh>

              {/* Smooth Lower Hook Elbow Transition */}
              <mesh position={[0, -0.0225, 0]}>
                <sphereGeometry args={[0.0035, 12, 12]} />
                <meshStandardMaterial
                  color={metalColor}
                  metalness={metalness}
                  roughness={metalRoughness}
                />
              </mesh>
            </group>

            {/* Vertical Machined Swivel Neck Pin */}
            <mesh position={[0, hangerGeometryData.neckPinY, 0]} castShadow>
              <cylinderGeometry
                args={[0.0032, 0.0032, hangerGeometryData.neckPinHeight, 18]}
              />
              <meshStandardMaterial
                color={metalColor}
                metalness={metalness}
                roughness={metalRoughness}
              />
            </mesh>

            {/* Knurled Brass Swivel Collar Assembly sitting atop Wooden Hanger Crown */}
            <group position={[0, hangerGeometryData.collarY, 0]}>
              {/* Upper Beveled Collar Ring */}
              <mesh position={[0, 0.0052, 0]} castShadow>
                <cylinderGeometry args={[0.005, 0.0072, 0.0032, 24]} />
                <meshStandardMaterial
                  color={metalColor}
                  metalness={metalness}
                  roughness={metalRoughness}
                />
              </mesh>
              {/* Faceted Knurled Brass Barrel */}
              <mesh position={[0, 0.0005, 0]} castShadow>
                <cylinderGeometry args={[0.0073, 0.0073, 0.0068, 20]} />
                <meshStandardMaterial
                  color={metalColor}
                  metalness={Math.min(1, metalness + 0.04)}
                  roughness={Math.min(1, metalRoughness + 0.08)}
                  emissive={metalColor}
                  emissiveIntensity={selected ? 0.22 : 0}
                />
              </mesh>
              {/* Base Precision Washer Flange resting on Wood Crown */}
              <mesh position={[0, -0.0038, 0]} castShadow>
                <cylinderGeometry args={[0.0088, 0.0096, 0.0026, 26]} />
                <meshStandardMaterial
                  color={metalColor}
                  metalness={metalness}
                  roughness={metalRoughness}
                />
              </mesh>
            </group>

            {/* Sculpted Central Wooden Crown Boss */}
            <mesh
              position={[0, hangerGeometryData.crownY + 0.0008, 0]}
              scale={[2.05, 1.05, 1.08]}
              castShadow
              receiveShadow
            >
              <sphereGeometry args={[hangerGeometryData.wingRadius * 1.08, 20, 16]} />
              <meshPhysicalMaterial
                color={woodColor}
                roughness={0.42}
                metalness={0.02}
                clearcoat={0.28}
                clearcoatRoughness={0.38}
              />
            </mesh>

            {/* Contoured 3D Wooden Shoulder Wings (23° downward angle + forward sweep) */}
            <mesh geometry={hangerGeometryData.tubeGeo} castShadow receiveShadow>
              <meshPhysicalMaterial
                color={woodColor}
                roughness={0.42}
                metalness={0.02}
                clearcoat={0.28}
                clearcoatRoughness={0.38}
              />
            </mesh>

            {/* Cleanly Capped Rounded Left & Right Wooden Shoulder Wingtips */}
            <mesh position={hangerGeometryData.leftTipPos} castShadow>
              <sphereGeometry args={[hangerGeometryData.wingRadius, 16, 16]} />
              <meshPhysicalMaterial
                color={woodColor}
                roughness={0.42}
                metalness={0.02}
                clearcoat={0.28}
                clearcoatRoughness={0.38}
              />
            </mesh>
            <mesh position={hangerGeometryData.rightTipPos} castShadow>
              <sphereGeometry args={[hangerGeometryData.wingRadius, 16, 16]} />
              <meshPhysicalMaterial
                color={woodColor}
                roughness={0.42}
                metalness={0.02}
                clearcoat={0.28}
                clearcoatRoughness={0.38}
              />
            </mesh>
          </group>
        )}

        {/* =================================================================
            2. VOLUMETRIC DUAL-SHELL CLOTH vs. NAIVE FLAT CUTOUT COMPARISON
           ================================================================= */}
        <group
          position={[0, CLOTH_ANCHOR_Y, 0]}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
          onClick={handleClick}
        >
          {isVolumetric ? (
            <>
              {/* FRONT VOLUMETRIC CLOTH SHELL (PBR Cotton Jersey + Grazing Sheen + Normal Weave) */}
              <mesh
                geometry={clothGeometries.frontGeo}
                customDepthMaterial={customDepthMaterial}
                castShadow
                receiveShadow
              >
                <meshPhysicalMaterial
                  ref={frontMatRef}
                  color="#F6F4EE"
                  map={frontMap}
                  normalMap={normalMap ?? null}
                  normalScale={normalScaleVec}
                  roughness={0.92}
                  metalness={0.01}
                  sheen={tuning.fabricSheen}
                  sheenRoughness={0.82}
                  sheenColor={sheenColor}
                  side={THREE.FrontSide}
                  alphaTest={0.35}
                  alphaToCoverage
                />
              </mesh>

              {/* BACK VOLUMETRIC CLOTH SHELL (True 360° Back Seam — Zero Backwards Snoopy!) */}
              <mesh
                geometry={clothGeometries.backGeo}
                receiveShadow
              >
                <meshPhysicalMaterial
                  ref={backMatRef}
                  color="#F6F4EE"
                  map={effectiveBackMap}
                  normalMap={normalMap ?? null}
                  normalScale={backNormalScaleVec}
                  roughness={0.92}
                  metalness={0.01}
                  sheen={tuning.fabricSheen}
                  sheenRoughness={0.82}
                  sheenColor={sheenColor}
                  side={THREE.BackSide}
                  alphaTest={0.35}
                  alphaToCoverage
                />
              </mesh>
            </>
          ) : (
            /* NAIVE FLAT COMPARISON MODE: Single uncurved plane, no hanger shoulders, no sheen, no normalMap, DoubleSide mirrored */
            <mesh
              geometry={clothGeometries.flatGeo}
              customDepthMaterial={customDepthMaterial}
              castShadow
              receiveShadow
            >
              <meshStandardMaterial
                map={frontMap}
                roughness={0.95}
                metalness={0}
                side={THREE.DoubleSide}
                alphaTest={0.35}
                transparent
              />
            </mesh>
          )}

          {/* Discreet Floating Archival Gallery Tag on Hover Only */}
          {showBadge && badgeTexture && (
            <group position={[0, -GARMENT_HEIGHT * 1.03, 0.032]}>
              <mesh>
                <planeGeometry args={[0.24, 0.068]} />
                <meshBasicMaterial map={badgeTexture} transparent />
              </mesh>
            </group>
          )}
        </group>
      </group>
    </group>
  );
};

export default HangingGarment;
