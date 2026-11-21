import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import type {
  GarmentTuningParams,
  InventedProductSpec,
  ProductCategory3D,
  StorePalette,
} from '../../types/storeConfig';
import {
  getOrCreateProductTextures,
  type MaterialFinishPreset,
} from './productTextureGenerator';

export interface HangingApparel3DProps {
  spec: InventedProductSpec;
  /** Anchor point directly ON the rack rail (default `[0, 0, 0]`, matching `HangingGarment`) */
  position?: [number, number, number];
  rotationY?: number;
  hookSwivelY?: number;
  metalColor?: string;
  woodColor?: string;
  metalness?: number;
  metalRoughness?: number;
  accentColor?: string;
  palette?: Partial<StorePalette>;
  tuning?: Partial<GarmentTuningParams>;
  swayIntensity?: number;
  selected?: boolean;
  onSelect?: (spec: InventedProductSpec) => void;
  label?: string;
  price?: number;
}

export interface PedestalProduct3DProps {
  spec: InventedProductSpec;
  /** Anchored with base resting cleanly at `y = 0` on top of any pedestal or table */
  position?: [number, number, number];
  rotationY?: number;
  scale?: number;
  metalColor?: string;
  metalness?: number;
  metalRoughness?: number;
  accentColor?: string;
  palette?: Partial<StorePalette>;
  selected?: boolean;
  onSelect?: (spec: InventedProductSpec) => void;
}

const CLOTH_ANCHOR_Y = -0.072;
const VEC2_035 = new THREE.Vector2(0.35, 0.35);
const VEC2_045 = new THREE.Vector2(0.45, 0.45);
const VEC2_055 = new THREE.Vector2(0.55, 0.55);
const VEC2_065 = new THREE.Vector2(0.65, 0.65);
const VEC2_070 = new THREE.Vector2(0.7, 0.7);
const VEC2_085 = new THREE.Vector2(0.85, 0.85);

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / Math.max(1e-5, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function shiftColorHex(hex: string, deltaL: number): string {
  const c = new THREE.Color();
  try {
    c.set(hex);
  } catch {
    c.set('#888888');
  }
  c.offsetHSL(0, 0, deltaL);
  return `#${c.getHexString()}`;
}

/**
 * Superellipse helper: preserves smooth continuous curvature around 360° while giving
 * broad tailored front/back panels and softly rounded 3D side seams.
 */
function signedPow(val: number, exp: number): number {
  return Math.sign(val) * Math.pow(Math.abs(val), exp);
}

/**
 * Creates a crisp museum-grade spec placard texture (`Title · $Price`) shown on hover.
 */
function createMuseumPlacardTexture(
  title: string,
  price: number | undefined,
  sku: string | undefined,
  accentHex: string,
  metalHex: string
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 576;
  canvas.height = 152;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#FAF7F0';
  ctx.fillRect(0, 0, 576, 152);

  ctx.strokeStyle = metalHex;
  ctx.lineWidth = 4;
  ctx.strokeRect(8, 8, 560, 136);

  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 2;
  ctx.strokeRect(16, 16, 544, 120);

  ctx.fillStyle = '#1B1D1B';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 26px Georgia, "Times New Roman", serif';
  const cleanTitle = title.trim().toUpperCase();
  const displayTitle = cleanTitle.length > 30 ? `${cleanTitle.slice(0, 29)}…` : cleanTitle;
  ctx.fillText(displayTitle, 288, price !== undefined ? 56 : 76);

  if (price !== undefined) {
    ctx.fillStyle = accentHex;
    ctx.font = '600 22px system-ui, -apple-system, sans-serif';
    const suffix = sku ? ` · ${sku.toUpperCase()}` : ' · ARCHIVE OBJECT';
    ctx.fillText(`${displayTitle ? '' : ''}$${price.toFixed(0)}${suffix}`, 288, 99);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Camera-facing placard wrapper so hover labels on 360° pedestals always read left-to-right.
 */
const CameraFacingPlacard: React.FC<{
  position: [number, number, number];
  texture: THREE.Texture;
  width?: number;
  height?: number;
}> = ({ position, texture, width = 0.25, height = 0.066 }) => {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ camera }) => {
    if (ref.current) {
      ref.current.quaternion.copy(camera.quaternion);
    }
  });

  return (
    <group ref={ref} position={position}>
      <mesh>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial map={texture} transparent depthTest={false} />
      </mesh>
    </group>
  );
};

/**
 * Generates a cached-per-component striped varsity rib-knit CanvasTexture
 * (used for varsity bomber collar, cuffs, and waist hem).
 */
function createVarsityStripeTexture(
  baseHex: string,
  stripePrimaryHex: string,
  stripeAccentHex: string
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 256, 128);

  // Twin athletic varsity stripes
  ctx.fillStyle = stripePrimaryHex;
  ctx.fillRect(0, 30, 256, 18);
  ctx.fillRect(0, 80, 256, 18);

  ctx.fillStyle = stripeAccentHex;
  ctx.fillRect(0, 48, 256, 6);
  ctx.fillRect(0, 74, 256, 6);

  // Subtle vertical knit rib shading
  for (let x = 0; x < 256; x += 4) {
    ctx.fillStyle = x % 8 === 0 ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.12)';
    ctx.fillRect(x, 0, 2, 128);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(4, 1);
  tex.needsUpdate = true;
  return tex;
}

// ============================================================================
// PARAMETRIC 3D APPAREL GEOMETRY BUILDERS
// ============================================================================

interface TorsoProfileParams {
  torsoLength: number;
  chestHalfW: number;
  hemHalfW: number;
  neckHalfW: number;
  baseHalfDepth: number;
  frontNeckScoop: number;
  drapeFoldAmp: number;
}

function getTorsoProfile(category: ProductCategory3D): TorsoProfileParams {
  switch (category) {
    case 'heavyweight_hoodie':
      return {
        torsoLength: 0.64,
        chestHalfW: 0.246,
        hemHalfW: 0.224,
        neckHalfW: 0.092,
        baseHalfDepth: 0.034, // ~6.8cm 3D chest thickness
        frontNeckScoop: 0.034,
        drapeFoldAmp: 0.0042,
      };
    case 'varsity_jacket':
      return {
        torsoLength: 0.63,
        chestHalfW: 0.252,
        hemHalfW: 0.22,
        neckHalfW: 0.088,
        baseHalfDepth: 0.036, // ~7.2cm structured outerwear chest depth
        frontNeckScoop: 0.032,
        drapeFoldAmp: 0.0026,
      };
    case 'structured_tshirt':
    default:
      return {
        torsoLength: 0.69,
        chestHalfW: 0.238,
        hemHalfW: 0.242,
        neckHalfW: 0.084,
        baseHalfDepth: 0.03, // ~6.0cm boxy heavyweight tee depth
        frontNeckScoop: 0.03,
        drapeFoldAmp: 0.0038,
      };
  }
}

/**
 * Evaluates a point `(x, y, z)` on the closed 3D sculpted garment torso surface for
 * angular coordinate `theta` (`0..2π`, `π/2` = front `+Z`, `3π/2` = back `-Z`) and vertical `v` (`0..1`).
 */
function evaluateTorsoSurfacePoint(
  theta: number,
  v: number,
  p: TorsoProfileParams
): [number, number, number] {
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  // Width envelope: hem -> full boxy chest -> sloped shoulders (v: 0.80..1.0) -> open collar
  const shoulderStart = 0.8;
  let halfW: number;
  if (v < shoulderStart) {
    const bodyFrac = smoothstep(0, 0.55, v / shoulderStart);
    halfW = p.hemHalfW + (p.chestHalfW - p.hemHalfW) * bodyFrac;
  } else {
    const shFrac = (v - shoulderStart) / (1 - shoulderStart);
    // Smooth tailored shoulder slope matching the 23° wooden hanger inside
    halfW = p.chestHalfW * (1 - smoothstep(0, 1, shFrac)) + p.neckHalfW * smoothstep(0, 1, shFrac);
  }

  // Depth envelope: ~6-7.2cm full chest loft, tapering slightly toward hem and collar
  const chestLoft = Math.sin(v * Math.PI) * 0.008;
  const hemPinch = 0.76 + 0.24 * smoothstep(0, 0.14, v);
  const halfD = (p.baseHalfDepth + chestLoft) * hemPinch;

  // Superellipse cross-section for broad front/back panels + sculpted rounded side seams
  const sx = signedPow(cosT, 0.74);
  const sz = signedPow(sinT, 0.8);

  const x = sx * halfW;

  // Organic vertical fabric drape folds near lower torso
  const lowerWeight = (1 - smoothstep(0.18, 0.82, v)) * smoothstep(0, 0.04, v);
  const drapeWave =
    (Math.sin(sx * Math.PI * 3.0) * p.drapeFoldAmp +
      Math.cos(sx * Math.PI * 1.5) * p.drapeFoldAmp * 0.5) *
    lowerWeight *
    Math.sign(sinT || 1);

  // Slight forward hanger shoulder sweep near v = 0.85
  const hangerSweep = smoothstep(0.7, 0.94, v) * Math.abs(sx) * 0.005;
  const z = sz * halfD + drapeWave + hangerSweep;

  // Vertical coordinate y: 0 at top collar crown, -torsoLength at hem, with front neck scoop
  const frontMask = Math.max(0, sinT);
  const neckScoop = smoothstep(0.76, 1.0, v) * frontMask * (1 - Math.abs(sx) * 0.65) * p.frontNeckScoop;
  const y = -(1 - v) * p.torsoLength - neckScoop;

  return [x, y, z];
}

/**
 * Builds a closed 360° volumetric 3D garment torso BufferGeometry with outward normals and tiled fabric UVs.
 */
function buildSculptedTorsoGeometry(profile: TorsoProfileParams): THREE.BufferGeometry {
  const radialSegs = 44;
  const heightSegs = 30;
  const cols = radialSegs + 1;
  const rows = heightSegs + 1;

  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  const indices: number[] = [];

  let ptr = 0;
  let uvPtr = 0;

  for (let r = 0; r <= heightSegs; r++) {
    const v = r / heightSegs;
    for (let c = 0; c <= radialSegs; c++) {
      const u = c / radialSegs;
      const theta = u * Math.PI * 2;
      const [x, y, z] = evaluateTorsoSurfacePoint(theta, v, profile);

      positions[ptr++] = x;
      positions[ptr++] = y;
      positions[ptr++] = z;

      uvs[uvPtr++] = u * 6;
      uvs[uvPtr++] = v * 6;
    }
  }

  for (let r = 0; r < heightSegs; r++) {
    for (let c = 0; c < radialSegs; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = (r + 1) * cols + c;
      const e = d + 1;
      // Verified outward normal winding: (a, d, b) & (b, d, e)
      indices.push(a, d, b);
      indices.push(b, d, e);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a conformal 3D curved graphic patch following the exact mathematical front (`+Z`) or back (`-Z`)
 * surface of the sculpted torso so custom brand artwork hugs every 3D curve without flat-plane artifacts.
 */
function buildConformalTorsoPatchGeometry(
  profile: TorsoProfileParams,
  options: {
    side: 'front' | 'back';
    centerX?: number;
    centerV: number;
    spanTheta: number;
    spanV: number;
    offsetZ?: number;
  }
): THREE.BufferGeometry {
  const segX = 22;
  const segY = 22;
  const cols = segX + 1;
  const rows = segY + 1;

  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  const indices: number[] = [];

  const isFront = options.side === 'front';
  const baseTheta = isFront ? Math.PI * 0.5 : Math.PI * 1.5;
  const zNudge = (options.offsetZ ?? 0.0016) * (isFront ? 1 : -1);
  const shiftX = options.centerX ?? 0;

  let ptr = 0;
  let uvPtr = 0;

  for (let r = 0; r <= segY; r++) {
    const vLocal = r / segY; // 0 bottom -> 1 top
    const vTorso = clamp(options.centerV + (vLocal - 0.5) * options.spanV, 0.06, 0.86);

    for (let c = 0; c <= segX; c++) {
      const uLocal = c / segX; // 0 viewer-left -> 1 viewer-right
      // On +Z front: viewer-left (-X) is theta > pi/2, viewer-right (+X) is theta < pi/2
      // On -Z back: when viewed from -Z looking +Z, viewer-left (+X) is theta > 3pi/2, viewer-right (-X) is theta < 3pi/2
      const theta = baseTheta + (0.5 - uLocal) * options.spanTheta;
      const [tx, ty, tz] = evaluateTorsoSurfacePoint(theta, vTorso, profile);

      positions[ptr++] = tx + shiftX;
      positions[ptr++] = ty;
      positions[ptr++] = tz + zNudge;

      uvs[uvPtr++] = uLocal;
      uvs[uvPtr++] = vLocal;
    }
  }

  for (let r = 0; r < segY; r++) {
    for (let c = 0; c < segX; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = (r + 1) * cols + c;
      const e = d + 1;
      // Since theta decreases as uLocal increases, a->b is +X on front (-X on back) and a->d is +Y:
      // (b - a) x (d - a) = (+X) x (+Y) = +Z outward on front, and (-X) x (+Y) = -Z outward on back!
      indices.push(a, b, d);
      indices.push(b, e, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a thick 3D ribbed waist hem band wrapping around `v = 0` of the garment torso.
 */
function buildRibbedWaistBandGeometry(
  profile: TorsoProfileParams,
  bandHeight: number,
  flutedRibs = true
): THREE.BufferGeometry {
  const radialSegs = 56;
  const heightSegs = 8;
  const cols = radialSegs + 1;
  const rows = heightSegs + 1;

  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  const indices: number[] = [];

  let ptr = 0;
  let uvPtr = 0;

  for (let r = 0; r <= heightSegs; r++) {
    const vf = r / heightSegs; // 0 bottom of rib -> 1 top meeting torso hem
    const cinch = 0.91 + 0.09 * smoothstep(0, 0.85, vf);
    const bulge = Math.sin(vf * Math.PI) * 0.0035;

    for (let c = 0; c <= radialSegs; c++) {
      const u = c / radialSegs;
      const theta = u * Math.PI * 2;
      const [bx, by, bz] = evaluateTorsoSurfacePoint(theta, 0.01, profile);
      const rib = flutedRibs ? Math.sin(theta * 42) * 0.0009 : 0;

      positions[ptr++] = bx * cinch + Math.cos(theta) * (bulge + rib);
      positions[ptr++] = by - (1 - vf) * bandHeight;
      positions[ptr++] = bz * cinch + Math.sin(theta) * (bulge + rib);

      uvs[uvPtr++] = u;
      uvs[uvPtr++] = vf;
    }
  }

  for (let r = 0; r < heightSegs; r++) {
    for (let c = 0; c < radialSegs; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = (r + 1) * cols + c;
      const e = d + 1;
      indices.push(a, d, b);
      indices.push(b, d, e);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a variable-radius 3D tubular garment sleeve with twist-free frames, natural gravity drape,
 * and optional wrist/cuff coordinates returned for attaching 3D ribbed cuffs.
 */
function buildSculptedSleeveGeometry(
  side: -1 | 1,
  style: 'long_relaxed' | 'short_boxy'
): {
  sleeveGeo: THREE.BufferGeometry;
  cuffPos: THREE.Vector3;
  cuffQuat: THREE.Quaternion;
  cuffRadius: number;
} {
  const controlPts =
    style === 'long_relaxed'
      ? [
          new THREE.Vector3(side * 0.195, -0.122, 0.002),
          new THREE.Vector3(side * 0.278, -0.255, 0.009),
          new THREE.Vector3(side * 0.318, -0.435, 0.019),
          new THREE.Vector3(side * 0.312, -0.625, 0.014),
        ]
      : [
          new THREE.Vector3(side * 0.192, -0.122, 0.002),
          new THREE.Vector3(side * 0.278, -0.222, 0.006),
          new THREE.Vector3(side * 0.344, -0.334, 0.009),
        ];

  const curve = new THREE.CatmullRomCurve3(controlPts, false, 'centripetal', 0.5);
  const lengthSegs = style === 'long_relaxed' ? 24 : 16;
  const radialSegs = 22;
  const cols = radialSegs + 1;
  const rows = lengthSegs + 1;

  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  const indices: number[] = [];

  const zAxis = new THREE.Vector3(0, 0, 1);
  let ptr = 0;
  let uvPtr = 0;

  for (let r = 0; r <= lengthSegs; r++) {
    const t = r / lengthSegs;
    const center = curve.getPoint(t);
    const tangent = curve.getTangent(t).normalize();

    // Stable twist-free cross-section frame
    const latAxis = new THREE.Vector3().crossVectors(tangent, zAxis).normalize();
    const depthAxis = new THREE.Vector3().crossVectors(latAxis, tangent).normalize();

    const rLat =
      style === 'long_relaxed'
        ? 0.068 * (1 - t * 0.31) + Math.sin(t * Math.PI) * 0.005
        : 0.069 * (1 - t * 0.09);
    const rDep =
      style === 'long_relaxed'
        ? 0.044 * (1 - t * 0.08) + Math.sin(t * Math.PI) * 0.004
        : 0.045 * (1 + t * 0.12);

    for (let c = 0; c <= radialSegs; c++) {
      const u = c / radialSegs;
      const ang = u * Math.PI * 2;
      const cosA = Math.cos(ang);
      const sinA = Math.sin(ang);

      const px = center.x + latAxis.x * cosA * rLat + depthAxis.x * sinA * rDep;
      const py = center.y + latAxis.y * cosA * rLat + depthAxis.y * sinA * rDep;
      const pz = center.z + latAxis.z * cosA * rLat + depthAxis.z * sinA * rDep;

      positions[ptr++] = px;
      positions[ptr++] = py;
      positions[ptr++] = pz;

      uvs[uvPtr++] = u * 2;
      uvs[uvPtr++] = t * 3;
    }
  }

  // `tangent` points downward along sleeve (`t` increasing); `(latAxis, depthAxis, tangent)` is right-handed:
  // `(a -> b)` is `+ang` (`lat -> depth`), `(a -> d)` is `+tangent`.
  // `(+ang) x (+tangent)` points OUTWARD from sleeve centerline!
  for (let r = 0; r < lengthSegs; r++) {
    for (let c = 0; c < radialSegs; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = (r + 1) * cols + c;
      const e = d + 1;
      indices.push(a, b, d);
      indices.push(b, e, d);
    }
  }

  const sleeveGeo = new THREE.BufferGeometry();
  sleeveGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  sleeveGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  sleeveGeo.setIndex(indices);
  sleeveGeo.computeVertexNormals();

  const endPt = curve.getPoint(1);
  const endTan = curve.getTangent(1).normalize();
  const cuffQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), endTan);
  const cuffRadius = style === 'long_relaxed' ? 0.046 : 0.061;

  return { sleeveGeo, cuffPos: endPt, cuffQuat, cuffRadius };
}

/**
 * Builds a 3D raised trapezoid kangaroo pocket curved to hug the front of the heavyweight hoodie.
 */
function buildCurvedKangarooPocketGeometry(profile: TorsoProfileParams): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const halfBottom = 0.142;
  const halfTop = 0.094;
  const halfMid = 0.148;
  const h = 0.175;

  shape.moveTo(-halfBottom, 0);
  shape.lineTo(halfBottom, 0);
  shape.lineTo(halfMid, h * 0.34);
  shape.lineTo(halfTop, h);
  shape.lineTo(-halfTop, h);
  shape.lineTo(-halfMid, h * 0.34);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.013,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.004,
    bevelSegments: 3,
    curveSegments: 8,
  });

  // Curve vertices in Z to hug the exact front fleece torso contour at y = -0.605 .. -0.43
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const pyLocal = pos.getY(i);
    const pzLocal = pos.getZ(i);

    const worldY = -0.605 + pyLocal;
    const vTorso = clamp(1 + worldY / profile.torsoLength, 0.04, 0.55);
    const approxTheta = Math.PI * 0.5 - (px / profile.chestHalfW) * 0.85;
    const [, , surfaceZ] = evaluateTorsoSurfacePoint(approxTheta, vTorso, profile);

    pos.setXYZ(i, px, worldY, surfaceZ - 0.002 + pzLocal);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// ============================================================================
// COMPONENT A: HangingApparel3D
// ============================================================================

export const HangingApparel3D: React.FC<HangingApparel3DProps> = ({
  spec,
  position = [0, 0, 0],
  rotationY = 0,
  hookSwivelY = 0,
  metalColor,
  woodColor,
  metalness = 0.88,
  metalRoughness = 0.25,
  accentColor,
  palette,
  tuning,
  swayIntensity,
  selected = false,
  onSelect,
  label,
  price,
}) => {
  const swayGroupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

  const hwMetal = metalColor ?? palette?.rackMetal ?? '#C5A059';
  const hwWood = woodColor ?? palette?.hangerWood ?? '#7A5230';
  const badgeAccent = accentColor ?? palette?.accent ?? spec.accentColor ?? '#547049';
  const effectiveSway = swayIntensity ?? tuning?.swayIntensity ?? 0.35;
  const effectiveNormalScale = tuning?.normalStrength ?? 0.85;

  const textures = useMemo(() => getOrCreateProductTextures(spec), [spec]);

  const finishPreset: MaterialFinishPreset = useMemo(() => {
    if (spec.materialFinish) return spec.materialFinish;
    if (spec.category === 'heavyweight_hoodie') return 'brushed_fleece';
    if (spec.category === 'varsity_jacket') return 'merino_knit';
    return 'combed_cotton';
  }, [spec.category, spec.materialFinish]);

  const fabricMatProps = useMemo(() => {
    switch (finishPreset) {
      case 'brushed_fleece':
        return { roughness: 0.93, sheen: 0.44, sheenRoughness: 0.86 };
      case 'merino_knit':
        return { roughness: 0.86, sheen: 0.38, sheenRoughness: 0.72 };
      case 'combed_cotton':
      default:
        return { roughness: 0.89, sheen: 0.25, sheenRoughness: 0.78 };
    }
  }, [finishPreset]);

  const normalScaleVec = useMemo(
    () => new THREE.Vector2(effectiveNormalScale * 0.65, effectiveNormalScale * 0.65),
    [effectiveNormalScale]
  );

  // Sculpted boutique wood & metal hanger anchored at [0, 0, 0]
  const hangerGeo = useMemo(() => {
    const shoulderHalfSpan = 0.168;
    const slope23 = Math.tan((23 * Math.PI) / 180);
    const crownY = CLOTH_ANCHOR_Y - 0.005;
    const wingRadius = 0.0064;

    const collarY = crownY + 0.0095;
    const hookElbowY = -0.0225;
    const neckPinHeight = hookElbowY - collarY;
    const neckPinY = (hookElbowY + collarY) * 0.5;

    const makeWingPt = (signedFrac: number, extraDrop = 0) => {
      const x = signedFrac * shoulderHalfSpan;
      const absX = Math.abs(x);
      const t = absX / shoulderHalfSpan;
      const z = Math.sin(t * Math.PI * 0.78) * 0.005 + Math.pow(t, 1.45) * 0.0025;
      return new THREE.Vector3(x, crownY - absX * slope23 - extraDrop, z);
    };

    const curve = new THREE.CatmullRomCurve3(
      [
        makeWingPt(-1.0, 0.008),
        makeWingPt(-0.7, 0.002),
        makeWingPt(-0.35, 0),
        new THREE.Vector3(0, crownY + 0.0012, 0),
        makeWingPt(0.35, 0),
        makeWingPt(0.7, 0.002),
        makeWingPt(1.0, 0.008),
      ],
      false,
      'centripetal',
      0.45
    );

    const tubeGeo = new THREE.TubeGeometry(curve, 44, wingRadius, 16, false);
    const hookRadius = 0.0195;
    const hookArc = Math.PI * 1.42;
    const tipTheta = -Math.PI * 0.5 + hookArc;

    return {
      tubeGeo,
      wingRadius,
      crownY,
      collarY,
      neckPinY,
      neckPinHeight,
      leftTip: curve.getPoint(0),
      rightTip: curve.getPoint(1),
      hookRadius,
      hookArc,
      hookTipPos: [
        hookRadius * Math.cos(tipTheta),
        -0.003 + hookRadius * Math.sin(tipTheta),
        0,
      ] as [number, number, number],
    };
  }, []);

  useEffect(() => {
    return () => {
      hangerGeo.tubeGeo.dispose();
    };
  }, [hangerGeo]);

  // Apparel category-specific 3D sculpted geometries
  const apparelGeo = useMemo(() => {
    const cat: ProductCategory3D =
      spec.category === 'heavyweight_hoodie' ||
      spec.category === 'varsity_jacket' ||
      spec.category === 'structured_tshirt'
        ? spec.category
        : 'structured_tshirt';

    const profile = getTorsoProfile(cat);
    const torsoGeo = buildSculptedTorsoGeometry(profile);

    const isLongSleeve = cat === 'heavyweight_hoodie' || cat === 'varsity_jacket';
    const leftSleeve = buildSculptedSleeveGeometry(
      -1,
      isLongSleeve ? 'long_relaxed' : 'short_boxy'
    );
    const rightSleeve = buildSculptedSleeveGeometry(
      1,
      isLongSleeve ? 'long_relaxed' : 'short_boxy'
    );

    // Waist hem band for hoodie & varsity jacket
    const waistBandGeo =
      cat === 'heavyweight_hoodie'
        ? buildRibbedWaistBandGeometry(profile, 0.068, true)
        : cat === 'varsity_jacket'
          ? buildRibbedWaistBandGeometry(profile, 0.066, false)
          : null;

    // Collar / Hood 3D assemblies
    let collarGeo: THREE.BufferGeometry;
    let hoodDomeGeo: THREE.BufferGeometry | null = null;
    let leftCordGeo: THREE.BufferGeometry | null = null;
    let rightCordGeo: THREE.BufferGeometry | null = null;
    let pocketGeo: THREE.BufferGeometry | null = null;

    if (cat === 'heavyweight_hoodie') {
      // Plush 3D draped hood collar wrapping around the hanger neck with V-crossover front
      const hoodRingCurve = new THREE.CatmullRomCurve3(
        [
          new THREE.Vector3(-0.018, -0.044, 0.038),
          new THREE.Vector3(-0.078, -0.022, 0.028),
          new THREE.Vector3(-0.106, 0.012, -0.002),
          new THREE.Vector3(-0.072, 0.046, -0.044),
          new THREE.Vector3(0, 0.056, -0.058),
          new THREE.Vector3(0.072, 0.046, -0.044),
          new THREE.Vector3(0.106, 0.012, -0.002),
          new THREE.Vector3(0.078, -0.022, 0.03),
          new THREE.Vector3(0.016, -0.039, 0.042),
        ],
        false,
        'centripetal',
        0.5
      );
      collarGeo = new THREE.TubeGeometry(hoodRingCurve, 44, 0.021, 16, false);

      // Volumetric 3D rear draped hood pouch resting naturally behind the neck
      hoodDomeGeo = new THREE.SphereGeometry(1, 28, 22, 0, Math.PI * 2, 0, Math.PI * 0.68);
      hoodDomeGeo.scale(0.128, 0.115, 0.078);
      hoodDomeGeo.rotateX(-Math.PI * 0.42);
      hoodDomeGeo.translate(0, 0.012, -0.046);

      // Left & right woven drawstrings draping down upper chest
      const lCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.036, -0.046, 0.04),
        new THREE.Vector3(-0.041, -0.115, 0.044),
        new THREE.Vector3(-0.038, -0.188, 0.043),
      ]);
      const rCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.036, -0.046, 0.042),
        new THREE.Vector3(0.042, -0.125, 0.045),
        new THREE.Vector3(0.039, -0.212, 0.043),
      ]);
      leftCordGeo = new THREE.TubeGeometry(lCurve, 18, 0.0036, 10, false);
      rightCordGeo = new THREE.TubeGeometry(rCurve, 18, 0.0036, 10, false);

      // 3D raised trapezoid kangaroo pocket
      pocketGeo = buildCurvedKangarooPocketGeometry(profile);
    } else if (cat === 'varsity_jacket') {
      // Sculpted shawl / bomber rib-knit collar open slightly at top placket
      const bomberCollarCurve = new THREE.CatmullRomCurve3(
        [
          new THREE.Vector3(-0.022, -0.036, 0.034),
          new THREE.Vector3(-0.078, -0.018, 0.024),
          new THREE.Vector3(-0.095, 0.006, -0.004),
          new THREE.Vector3(0, 0.018, -0.034),
          new THREE.Vector3(0.095, 0.006, -0.004),
          new THREE.Vector3(0.078, -0.018, 0.024),
          new THREE.Vector3(0.022, -0.036, 0.034),
        ],
        false,
        'centripetal',
        0.5
      );
      collarGeo = new THREE.TubeGeometry(bomberCollarCurve, 40, 0.016, 14, false);
    } else {
      // Closed sculpted 3D crew/ringer rib-knit collar ring
      const crewCurve = new THREE.CatmullRomCurve3(
        [
          new THREE.Vector3(0, -0.032, 0.032),
          new THREE.Vector3(-0.068, -0.018, 0.022),
          new THREE.Vector3(-0.088, 0.002, -0.002),
          new THREE.Vector3(0, 0.009, -0.03),
          new THREE.Vector3(0.088, 0.002, -0.002),
          new THREE.Vector3(0.068, -0.018, 0.022),
        ],
        true,
        'centripetal',
        0.5
      );
      collarGeo = new THREE.TubeGeometry(crewCurve, 44, 0.0125, 14, true);
    }

    // Conformal 3D curved artwork patches
    const frontGraphicGeo =
      cat === 'varsity_jacket'
        ? buildConformalTorsoPatchGeometry(profile, {
            side: 'front',
            centerX: 0.012,
            centerV: 0.65,
            spanTheta: 0.5,
            spanV: 0.2,
            offsetZ: 0.0034,
          })
        : cat === 'heavyweight_hoodie'
          ? buildConformalTorsoPatchGeometry(profile, {
              side: 'front',
              centerV: 0.63,
              spanTheta: 0.98,
              spanV: 0.37,
              offsetZ: 0.0018,
            })
          : buildConformalTorsoPatchGeometry(profile, {
              side: 'front',
              centerV: 0.58,
              spanTheta: 1.06,
              spanV: 0.4,
              offsetZ: 0.0018,
            });

    const backGraphicGeo =
      cat === 'varsity_jacket'
        ? buildConformalTorsoPatchGeometry(profile, {
            side: 'back',
            centerV: 0.56,
            spanTheta: 1.08,
            spanV: 0.42,
            offsetZ: 0.0018,
          })
        : cat === 'structured_tshirt'
          ? buildConformalTorsoPatchGeometry(profile, {
              side: 'back',
              centerV: 0.8,
              spanTheta: 0.36,
              spanV: 0.13,
              offsetZ: 0.0016,
            })
          : null;

    // Varsity left-chest shift for conformal patch: shift theta onto wearer's left chest (+X)
    const varsityLeftTheta = Math.PI * 0.5 - 0.36;
    const varsityRightTheta = Math.PI * 0.5 + 0.36;
    const leftChestAnchor = evaluateTorsoSurfacePoint(varsityLeftTheta, 0.65, profile);
    const rightChestAnchor = evaluateTorsoSurfacePoint(varsityRightTheta, 0.65, profile);

    if (cat === 'varsity_jacket') {
      const pos = frontGraphicGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const u = frontGraphicGeo.attributes.uv.getX(i);
        const v = frontGraphicGeo.attributes.uv.getY(i);
        const vTorso = clamp(0.65 + (v - 0.5) * 0.18, 0.1, 0.85);
        const theta = varsityLeftTheta + (0.5 - u) * 0.42;
        const [tx, ty, tz] = evaluateTorsoSurfacePoint(theta, vTorso, profile);
        pos.setXYZ(i, tx, ty, tz + 0.0052);
      }
      pos.needsUpdate = true;
      frontGraphicGeo.computeVertexNormals();
    }

    // Varsity placket & 6 snap buttons along front x = 0
    const snapPoints: Array<[number, number, number]> = [];
    if (cat === 'varsity_jacket') {
      for (let s = 0; s < 6; s++) {
        const vSnap = 0.84 - (s / 5) * 0.78;
        const [, sy, sz] = evaluateTorsoSurfacePoint(Math.PI * 0.5, vSnap, profile);
        snapPoints.push([0, sy, sz + 0.0065]);
      }
    }

    return {
      cat,
      profile,
      torsoGeo,
      leftSleeve,
      rightSleeve,
      waistBandGeo,
      collarGeo,
      hoodDomeGeo,
      leftCordGeo,
      rightCordGeo,
      pocketGeo,
      frontGraphicGeo,
      backGraphicGeo,
      snapPoints,
      leftChestAnchor,
      rightChestAnchor,
    };
  }, [spec.category]);

  useEffect(() => {
    return () => {
      apparelGeo.torsoGeo.dispose();
      apparelGeo.leftSleeve.sleeveGeo.dispose();
      apparelGeo.rightSleeve.sleeveGeo.dispose();
      apparelGeo.waistBandGeo?.dispose();
      apparelGeo.collarGeo.dispose();
      apparelGeo.hoodDomeGeo?.dispose();
      apparelGeo.leftCordGeo?.dispose();
      apparelGeo.rightCordGeo?.dispose();
      apparelGeo.pocketGeo?.dispose();
      apparelGeo.frontGraphicGeo.dispose();
      apparelGeo.backGraphicGeo?.dispose();
    };
  }, [apparelGeo]);

  const varsityStripeTex = useMemo(() => {
    if (apparelGeo.cat !== 'varsity_jacket') return null;
    return createVarsityStripeTexture(
      spec.secondaryColor,
      spec.primaryColor,
      spec.accentColor
    );
  }, [apparelGeo.cat, spec.secondaryColor, spec.primaryColor, spec.accentColor]);

  useEffect(() => {
    return () => {
      varsityStripeTex?.dispose();
    };
  }, [varsityStripeTex]);

  const badgeTitle = label ?? spec.title;
  const badgePrice = price ?? spec.price;
  const placardTex = useMemo(
    () =>
      createMuseumPlacardTexture(
        badgeTitle,
        badgePrice,
        spec.sku,
        badgeAccent,
        hwMetal
      ),
    [badgeTitle, badgePrice, spec.sku, badgeAccent, hwMetal]
  );

  useEffect(() => {
    return () => {
      placardTex.dispose();
    };
  }, [placardTex]);

  useEffect(() => {
    if (!hovered) return;
    const prev = document.body.style.cursor;
    document.body.style.cursor = 'pointer';
    return () => {
      document.body.style.cursor = prev;
    };
  }, [hovered]);

  const phaseOffset = useMemo(
    () => Math.abs(position[0] * 3.7 + position[2] * 5.1 + rotationY * 2.3 + spec.id.length * 0.37),
    [position, rotationY, spec.id]
  );

  const springRef = useRef({ ax: 0, vx: 0, az: 0, vz: 0, ay: 0, vy: 0 });

  useFrame((state, delta) => {
    const g = swayGroupRef.current;
    if (!g) return;
    const dt = Math.min(delta, 0.05);
    const t = state.clock.getElapsedTime();
    const s = springRef.current;

    s.vx += (-24 * s.ax - 4.4 * s.vx) * dt;
    s.ax += s.vx * dt;
    s.vz += (-24 * s.az - 4.4 * s.vz) * dt;
    s.az += s.vz * dt;
    s.vy += (-18 * s.ay - 3.8 * s.vy) * dt;
    s.ay += s.vy * dt;

    const amt = Math.max(0, effectiveSway);
    g.rotation.x =
      (Math.sin(t * 1.15 + phaseOffset) * 0.014 +
        Math.sin(t * 2.4 + phaseOffset * 1.6) * 0.004) *
        amt +
      s.ax;
    g.rotation.z = Math.cos(t * 0.86 + phaseOffset * 1.3) * 0.005 * amt + s.az;
    g.rotation.y = Math.sin(t * 0.62 + phaseOffset * 0.85) * 0.01 * amt + s.ay;
  });

  const handlePointerEnter = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(true);
    springRef.current.vx = Math.max(-0.42, springRef.current.vx - 0.2);
    springRef.current.vy += 0.09;
  };

  const handlePointerLeave = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(false);
  };

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    springRef.current.vx = Math.max(-0.5, springRef.current.vx - 0.28);
    springRef.current.vy += 0.13;
    onSelect?.(spec);
  };

  const sheenColor = useMemo(() => new THREE.Color('#FFFDF8'), []);
  const isVarsity = apparelGeo.cat === 'varsity_jacket';
  const isHoodie = apparelGeo.cat === 'heavyweight_hoodie';
  const isTee = apparelGeo.cat === 'structured_tshirt';

  return (
    <group position={position} rotation={[0, rotationY, 0]} name={`hanging-apparel-3d-${spec.id}`}>
      <group ref={swayGroupRef}>
        {/* =================================================================
            1. SCULPTED 3D WOOD & BRUSHED METAL HANGER (Rail Contact @ [0,0,0])
           ================================================================= */}
        <group name="sculpted-3d-hanger">
          <group rotation={[0, hookSwivelY, 0]}>
            <mesh position={[0, -0.003, 0]} rotation={[0, 0, -Math.PI * 0.5]} castShadow>
              <torusGeometry args={[hangerGeo.hookRadius, 0.0033, 14, 38, hangerGeo.hookArc]} />
              <meshStandardMaterial
                color={hwMetal}
                metalness={metalness}
                roughness={metalRoughness}
              />
            </mesh>
            <mesh position={hangerGeo.hookTipPos} castShadow>
              <sphereGeometry args={[0.0041, 12, 12]} />
              <meshStandardMaterial
                color={hwMetal}
                metalness={metalness}
                roughness={metalRoughness}
              />
            </mesh>
            <mesh position={[0, -0.0225, 0]}>
              <sphereGeometry args={[0.0035, 10, 10]} />
              <meshStandardMaterial
                color={hwMetal}
                metalness={metalness}
                roughness={metalRoughness}
              />
            </mesh>
          </group>

          <mesh position={[0, hangerGeo.neckPinY, 0]} castShadow>
            <cylinderGeometry args={[0.0032, 0.0032, hangerGeo.neckPinHeight, 16]} />
            <meshStandardMaterial
              color={hwMetal}
              metalness={metalness}
              roughness={metalRoughness}
            />
          </mesh>

          <group position={[0, hangerGeo.collarY, 0]}>
            <mesh position={[0, 0.0005, 0]} castShadow>
              <cylinderGeometry args={[0.0074, 0.0074, 0.009, 20]} />
              <meshStandardMaterial
                color={hwMetal}
                metalness={Math.min(1, metalness + 0.04)}
                roughness={metalRoughness}
                emissive={hwMetal}
                emissiveIntensity={selected || hovered ? 0.24 : 0}
              />
            </mesh>
          </group>

          <mesh
            position={[0, hangerGeo.crownY + 0.0008, 0]}
            scale={[2.05, 1.05, 1.08]}
            castShadow
            receiveShadow
          >
            <sphereGeometry args={[hangerGeo.wingRadius * 1.08, 18, 14]} />
            <meshPhysicalMaterial
              color={hwWood}
              roughness={0.42}
              metalness={0.02}
              clearcoat={0.28}
              clearcoatRoughness={0.38}
            />
          </mesh>

          <mesh geometry={hangerGeo.tubeGeo} castShadow receiveShadow>
            <meshPhysicalMaterial
              color={hwWood}
              roughness={0.42}
              metalness={0.02}
              clearcoat={0.28}
              clearcoatRoughness={0.38}
            />
          </mesh>

          <mesh position={hangerGeo.leftTip} castShadow>
            <sphereGeometry args={[hangerGeo.wingRadius, 14, 14]} />
            <meshPhysicalMaterial color={hwWood} roughness={0.42} clearcoat={0.28} />
          </mesh>
          <mesh position={hangerGeo.rightTip} castShadow>
            <sphereGeometry args={[hangerGeo.wingRadius, 14, 14]} />
            <meshPhysicalMaterial color={hwWood} roughness={0.42} clearcoat={0.28} />
          </mesh>
        </group>

        {/* =================================================================
            2. SCULPTED 3D VOLUMETRIC APPAREL SILHOUETTE
           ================================================================= */}
        <group
          position={[0, CLOTH_ANCHOR_Y, 0]}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
          onClick={handleClick}
        >
          {/* Main 3D Volumetric Torso Shell (~6-7.2cm real chest depth) */}
          <mesh geometry={apparelGeo.torsoGeo} castShadow receiveShadow>
            <meshPhysicalMaterial
              color={spec.primaryColor}
              normalMap={textures.normalMap}
              normalScale={normalScaleVec}
              roughness={fabricMatProps.roughness}
              metalness={0.01}
              sheen={fabricMatProps.sheen}
              sheenRoughness={fabricMatProps.sheenRoughness}
              sheenColor={sheenColor}
              side={THREE.DoubleSide}
            />
          </mesh>

          {/* Dark Recessed Inner Neck Cavity + Woven Studio Neck Label */}
          <mesh position={[0, -0.048, 0]} scale={[1, 1, 0.36]}>
            <cylinderGeometry args={[0.078, 0.084, 0.06, 24]} />
            <meshStandardMaterial
              color={shiftColorHex(spec.primaryColor, -0.18)}
              roughness={0.95}
            />
          </mesh>
          <mesh position={[0, -0.024, -0.026]}>
            <planeGeometry args={[0.046, 0.022]} />
            <meshStandardMaterial map={textures.archivalLabelMap} roughness={0.7} />
          </mesh>

          {/* Sculpted 3D Left & Right Sleeves (Contrast Leather/Satin on Varsity Jacket!) */}
          {[apparelGeo.leftSleeve, apparelGeo.rightSleeve].map((slv, idx) => (
            <React.Fragment key={idx}>
              <mesh geometry={slv.sleeveGeo} castShadow receiveShadow>
                <meshPhysicalMaterial
                  color={isVarsity ? spec.secondaryColor : spec.primaryColor}
                  normalMap={textures.normalMap}
                  normalScale={normalScaleVec}
                  roughness={isVarsity ? 0.36 : fabricMatProps.roughness}
                  metalness={isVarsity ? 0.04 : 0.01}
                  clearcoat={isVarsity ? 0.34 : 0}
                  clearcoatRoughness={0.38}
                  sheen={isVarsity ? 0.16 : fabricMatProps.sheen}
                  sheenRoughness={fabricMatProps.sheenRoughness}
                  sheenColor={sheenColor}
                  side={THREE.DoubleSide}
                />
              </mesh>

              {/* 3D Ribbed Sleeve Cuffs (`secondaryColor` or Striped Varsity Knit) */}
              <group position={slv.cuffPos} quaternion={slv.cuffQuat}>
                <mesh position={[0, -0.022, 0]} castShadow receiveShadow>
                  <cylinderGeometry
                    args={[
                      slv.cuffRadius * (isTee ? 1.02 : 0.96),
                      slv.cuffRadius * (isTee ? 1.0 : 0.88),
                      isTee ? 0.028 : 0.054,
                      24,
                    ]}
                  />
                  <meshPhysicalMaterial
                    color={isVarsity ? '#ffffff' : spec.secondaryColor}
                    map={isVarsity ? varsityStripeTex : null}
                    normalMap={textures.normalMap}
                    normalScale={normalScaleVec}
                    roughness={0.86}
                    sheen={0.3}
                    sheenColor={sheenColor}
                  />
                </mesh>
                {/* Hollow Dark Cuff Interior Disc */}
                <mesh
                  position={[0, isTee ? -0.035 : -0.048, 0]}
                  rotation={[Math.PI * 0.5, 0, 0]}
                >
                  <circleGeometry args={[slv.cuffRadius * 0.84, 20]} />
                  <meshStandardMaterial color="#151618" roughness={0.96} />
                </mesh>
              </group>
            </React.Fragment>
          ))}

          {/* 3D Collar / Draped Hood Assembly */}
          <mesh geometry={apparelGeo.collarGeo} castShadow receiveShadow>
            <meshPhysicalMaterial
              color={
                isHoodie
                  ? spec.primaryColor
                  : isVarsity
                    ? '#ffffff'
                    : spec.secondaryColor
              }
              map={isVarsity ? varsityStripeTex : null}
              normalMap={textures.normalMap}
              normalScale={normalScaleVec}
              roughness={0.88}
              sheen={fabricMatProps.sheen}
              sheenColor={sheenColor}
            />
          </mesh>

          {/* Heavyweight Hoodie Exclusive 3D Details: Rear Hood Bowl, Cords + Metal Aglets, Kangaroo Pocket */}
          {isHoodie && (
            <group name="hoodie-3d-details">
              {apparelGeo.hoodDomeGeo && (
                <mesh geometry={apparelGeo.hoodDomeGeo} castShadow receiveShadow>
                  <meshPhysicalMaterial
                    color={shiftColorHex(spec.primaryColor, -0.03)}
                    normalMap={textures.normalMap}
                    normalScale={normalScaleVec}
                    roughness={0.93}
                    sheen={0.44}
                    sheenColor={sheenColor}
                    side={THREE.DoubleSide}
                  />
                </mesh>
              )}

              {/* Metal Grommet Eyelets + Woven Drawstring Cords + Machined Metal Aglets */}
              {([-0.036, 0.036] as const).map((ex, i) => (
                <mesh key={i} position={[ex, -0.046, 0.041]} castShadow>
                  <torusGeometry args={[0.0052, 0.0016, 10, 18]} />
                  <meshStandardMaterial
                    color={hwMetal}
                    metalness={0.9}
                    roughness={0.22}
                  />
                </mesh>
              ))}
              {apparelGeo.leftCordGeo && (
                <mesh geometry={apparelGeo.leftCordGeo} castShadow>
                  <meshStandardMaterial color={spec.secondaryColor} roughness={0.85} />
                </mesh>
              )}
              {apparelGeo.rightCordGeo && (
                <mesh geometry={apparelGeo.rightCordGeo} castShadow>
                  <meshStandardMaterial color={spec.secondaryColor} roughness={0.85} />
                </mesh>
              )}
              {/* Metal Aglet Tips */}
              <mesh position={[-0.038, -0.197, 0.043]} castShadow>
                <cylinderGeometry args={[0.0042, 0.0038, 0.019, 12]} />
                <meshStandardMaterial color={hwMetal} metalness={0.92} roughness={0.18} />
              </mesh>
              <mesh position={[0.039, -0.221, 0.043]} castShadow>
                <cylinderGeometry args={[0.0042, 0.0038, 0.019, 12]} />
                <meshStandardMaterial color={hwMetal} metalness={0.92} roughness={0.18} />
              </mesh>

              {/* 3D Raised Trapezoid Kangaroo Pocket */}
              {apparelGeo.pocketGeo && (
                <mesh geometry={apparelGeo.pocketGeo} castShadow receiveShadow>
                  <meshPhysicalMaterial
                    color={shiftColorHex(spec.primaryColor, -0.018)}
                    normalMap={textures.normalMap}
                    normalScale={normalScaleVec}
                    roughness={0.93}
                    sheen={0.44}
                    sheenColor={sheenColor}
                  />
                </mesh>
              )}
            </group>
          )}

          {/* 3D Ribbed Waist Hem Band (Hoodie & Varsity Jacket) */}
          {apparelGeo.waistBandGeo && (
            <mesh geometry={apparelGeo.waistBandGeo} castShadow receiveShadow>
              <meshPhysicalMaterial
                color={isVarsity ? '#ffffff' : spec.secondaryColor}
                map={isVarsity ? varsityStripeTex : null}
                normalMap={textures.normalMap}
                normalScale={normalScaleVec}
                roughness={0.88}
                sheen={0.32}
                sheenColor={sheenColor}
                side={THREE.DoubleSide}
              />
            </mesh>
          )}

          {/* Varsity Jacket Exclusive 3D Details: Placket, 6 Metal Snaps, Welt Pockets, Left-Chest Patch Base */}
          {isVarsity && (
            <group name="varsity-jacket-3d-details">
              {/* Central Vertical Snap Placket Strip */}
              <RoundedBox
                args={[0.032, 0.61, 0.008]}
                radius={0.003}
                smoothness={2}
                position={[0, -0.365, 0.038]}
                castShadow
              >
                <meshPhysicalMaterial
                  color={spec.primaryColor}
                  roughness={0.85}
                  sheen={0.35}
                  sheenColor={sheenColor}
                />
              </RoundedBox>

              {/* 6 Tiny 3D Machined Metallic Snap Buttons */}
              {apparelGeo.snapPoints.map(([sx, sy, sz], idx) => (
                <group key={idx} position={[sx, sy, sz]} rotation={[Math.PI * 0.5, 0, 0]}>
                  <mesh castShadow>
                    <cylinderGeometry args={[0.0076, 0.0082, 0.004, 18]} />
                    <meshStandardMaterial
                      color={hwMetal}
                      metalness={0.92}
                      roughness={0.2}
                    />
                  </mesh>
                  <mesh position={[0, 0.0022, 0]} scale={[1, 0.45, 1]}>
                    <sphereGeometry args={[0.0072, 14, 10]} />
                    <meshStandardMaterial
                      color={hwMetal}
                      metalness={0.95}
                      roughness={0.16}
                    />
                  </mesh>
                </group>
              ))}

              {/* Raised Embroidered Chenille Backing Disc under Left-Chest Crest */}
              <mesh
                position={[
                  apparelGeo.leftChestAnchor[0],
                  apparelGeo.leftChestAnchor[1],
                  apparelGeo.leftChestAnchor[2] + 0.0015,
                ]}
                rotation={[Math.PI * 0.5, 0, -0.22]}
                castShadow
              >
                <cylinderGeometry args={[0.056, 0.056, 0.005, 32]} />
                <meshStandardMaterial
                  color={spec.secondaryColor}
                  roughness={0.88}
                />
              </mesh>
              <mesh
                position={[
                  apparelGeo.leftChestAnchor[0],
                  apparelGeo.leftChestAnchor[1],
                  apparelGeo.leftChestAnchor[2] + 0.004,
                ]}
                rotation={[0, 0.22, 0]}
              >
                <torusGeometry args={[0.055, 0.0028, 10, 32]} />
                <meshStandardMaterial color={spec.accentColor} roughness={0.65} />
              </mesh>

              {/* Right-Chest Chain-Stitch Nameplate Plaque */}
              <RoundedBox
                args={[0.076, 0.02, 0.004]}
                radius={0.002}
                position={[
                  apparelGeo.rightChestAnchor[0],
                  apparelGeo.rightChestAnchor[1],
                  apparelGeo.rightChestAnchor[2] + 0.002,
                ]}
                rotation={[0, -0.22, 0]}
                castShadow
              >
                <meshStandardMaterial color={spec.accentColor} roughness={0.6} />
              </RoundedBox>

              {/* Diagonal Contrast Leather Slash Pocket Welts */}
              {([-1, 1] as const).map((side, idx) => (
                <RoundedBox
                  key={idx}
                  args={[0.016, 0.128, 0.007]}
                  radius={0.003}
                  position={[side * 0.132, -0.495, 0.033]}
                  rotation={[0, side * 0.32, side * 0.28]}
                  castShadow
                >
                  <meshPhysicalMaterial
                    color={spec.secondaryColor}
                    roughness={0.36}
                    clearcoat={0.34}
                  />
                </RoundedBox>
              ))}
            </group>
          )}

          {/* Conformal 3D Front Brand Graphic (Screen-print / Left-Chest Embroidery) */}
          <mesh geometry={apparelGeo.frontGraphicGeo}>
            <meshPhysicalMaterial
              map={textures.decalMap}
              normalMap={textures.normalMap}
              normalScale={normalScaleVec}
              transparent
              alphaTest={0.04}
              depthWrite={false}
              polygonOffset
              polygonOffsetFactor={-1}
              roughness={0.68}
              sheen={0.2}
              sheenColor={sheenColor}
            />
          </mesh>

          {/* Conformal 3D Un-Mirrored Back Artwork (Full Back Varsity Crest / Tee Neck Stamp) */}
          {apparelGeo.backGraphicGeo && (
            <mesh geometry={apparelGeo.backGraphicGeo}>
              <meshPhysicalMaterial
                map={textures.decalMap}
                normalMap={textures.normalMap}
                normalScale={normalScaleVec}
                transparent
                alphaTest={0.04}
                depthWrite={false}
                polygonOffset
                polygonOffsetFactor={-1}
                roughness={0.68}
                sheen={0.2}
                sheenColor={sheenColor}
              />
            </mesh>
          )}

          {/* Hover-Only Floating Boutique Spec Placard */}
          {hovered && (
            <group position={[0, -0.77, 0.04]}>
              <mesh>
                <planeGeometry args={[0.25, 0.066]} />
                <meshBasicMaterial map={placardTex} transparent />
              </mesh>
            </group>
          )}
        </group>
      </group>
    </group>
  );
};

// ============================================================================
// COMPONENT B: PedestalProduct3D (Base resting cleanly at y = 0)
// ============================================================================

/**
 * 1. CERAMIC MUG (`height ≈ 0.19m`, `radius ≈ 0.075m`, resting on stacked presentation pad at `y = 0`)
 */
const CeramicMug3D: React.FC<{
  spec: InventedProductSpec;
  hwMetal: string;
  metalness: number;
  metalRoughness: number;
}> = ({ spec, hwMetal, metalness, metalRoughness }) => {
  const textures = useMemo(() => getOrCreateProductTextures(spec), [spec]);

  const mugGeo = useMemo(() => {
    // Thick-walled stoneware LatheGeometry with open hollow interior (y = 0.018 .. 0.192m)
    const outerR = 0.075;
    const innerR = 0.0665;
    const baseY = 0.018;
    const rimY = 0.192;

    const pts: THREE.Vector2[] = [
      new THREE.Vector2(0, baseY + 0.002),
      new THREE.Vector2(outerR * 0.82, baseY + 0.002),
      new THREE.Vector2(outerR * 0.88, baseY),
      new THREE.Vector2(outerR * 0.96, baseY + 0.004),
      new THREE.Vector2(outerR, baseY + 0.02),
      new THREE.Vector2(outerR, rimY - 0.006),
      // Smooth rounded stoneware lip rim
      new THREE.Vector2(outerR - 0.0015, rimY - 0.0015),
      new THREE.Vector2((outerR + innerR) * 0.5, rimY),
      new THREE.Vector2(innerR + 0.0015, rimY - 0.0015),
      new THREE.Vector2(innerR, rimY - 0.006),
      // Open hollow interior descending down to glazed inner floor
      new THREE.Vector2(innerR, baseY + 0.018),
      new THREE.Vector2(innerR * 0.85, baseY + 0.014),
      new THREE.Vector2(0, baseY + 0.014),
    ];

    const bodyGeo = new THREE.LatheGeometry(pts, 48);

    // Ergonomic 3D C-handle (`TubeGeometry`) on +X side
    const handleCurve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(outerR - 0.005, 0.156, 0),
        new THREE.Vector3(outerR + 0.034, 0.16, 0),
        new THREE.Vector3(outerR + 0.052, 0.112, 0),
        new THREE.Vector3(outerR + 0.034, 0.06, 0),
        new THREE.Vector3(outerR - 0.005, 0.056, 0),
      ],
      false,
      'centripetal',
      0.5
    );
    const handleGeo = new THREE.TubeGeometry(handleCurve, 32, 0.0108, 16, false);

    // Wraparound front graphic band centered on +Z (`±108°` arc)
    const halfArc = (108 * Math.PI) / 180;
    const wrapBandGeo = new THREE.CylinderGeometry(
      outerR + 0.0008,
      outerR + 0.0008,
      0.128,
      44,
      1,
      true,
      -halfArc,
      halfArc * 2
    );

    return { bodyGeo, handleGeo, wrapBandGeo, innerR, baseY };
  }, []);

  useEffect(() => {
    return () => {
      mugGeo.bodyGeo.dispose();
      mugGeo.handleGeo.dispose();
      mugGeo.wrapBandGeo.dispose();
    };
  }, [mugGeo]);

  return (
    <group name="ceramic-mug-3d">
      {/* Stacked Presentation Coaster / Plinth Pad resting at y = 0 .. 0.018m */}
      <mesh position={[0, 0.0035, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.102, 0.104, 0.007, 40]} />
        <meshStandardMaterial
          color={hwMetal}
          metalness={metalness}
          roughness={metalRoughness}
        />
      </mesh>
      <mesh position={[0, 0.0125, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.095, 0.098, 0.011, 40]} />
        <meshStandardMaterial color={spec.secondaryColor} roughness={0.62} />
      </mesh>
      <mesh position={[0, 0.0182, 0]} rotation={[-Math.PI * 0.5, 0, 0]}>
        <ringGeometry args={[0.077, 0.081, 40]} />
        <meshStandardMaterial color={spec.accentColor} roughness={0.4} />
      </mesh>

      {/* Raw Unglazed Stoneware Foot Ring Accent */}
      <mesh position={[0, 0.021, 0]}>
        <cylinderGeometry args={[0.0745, 0.0735, 0.006, 40]} />
        <meshStandardMaterial color="#D6C9B4" roughness={0.92} />
      </mesh>

      {/* Thick-Walled Matte Stoneware Body */}
      <mesh geometry={mugGeo.bodyGeo} castShadow receiveShadow>
        <meshPhysicalMaterial
          color={spec.primaryColor}
          normalMap={textures.normalMap}
          normalScale={VEC2_045}
          roughness={0.72}
          clearcoat={0.08}
          clearcoatRoughness={0.6}
        />
      </mesh>

      {/* Glossy Dark Espresso Glaze Interior Wall + Pour Surface */}
      <mesh position={[0, 0.104, 0]}>
        <cylinderGeometry args={[mugGeo.innerR - 0.0006, mugGeo.innerR - 0.0006, 0.142, 40, 1, true]} />
        <meshPhysicalMaterial
          color="#1D1512"
          roughness={0.12}
          clearcoat={0.96}
          clearcoatRoughness={0.08}
          side={THREE.BackSide}
        />
      </mesh>
      <mesh position={[0, 0.142, 0]} rotation={[-Math.PI * 0.5, 0, 0]}>
        <circleGeometry args={[mugGeo.innerR - 0.001, 36]} />
        <meshPhysicalMaterial
          color="#241812"
          roughness={0.08}
          clearcoat={1}
          clearcoatRoughness={0.05}
        />
      </mesh>

      {/* Sculpted 3D C-Handle */}
      <mesh geometry={mugGeo.handleGeo} castShadow receiveShadow>
        <meshPhysicalMaterial
          color={spec.secondaryColor}
          roughness={0.68}
          clearcoat={0.12}
        />
      </mesh>

      {/* Custom Wraparound Brand Graphic Band */}
      <mesh geometry={mugGeo.wrapBandGeo} position={[0, 0.106, 0]}>
        <meshPhysicalMaterial
          map={textures.decalMap}
          transparent
          alphaTest={0.04}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-1}
          roughness={0.52}
          clearcoat={0.18}
        />
      </mesh>
    </group>
  );
};

/**
 * 2. STRUCTURED 6-PANEL CAP (`width ≈ 0.24m`, resting on minimalist brushed-metal millinery stand at `y = 0`)
 */
const StructuredCap3D: React.FC<{
  spec: InventedProductSpec;
  hwMetal: string;
  metalness: number;
  metalRoughness: number;
}> = ({ spec, hwMetal, metalness, metalRoughness }) => {
  const textures = useMemo(() => getOrCreateProductTextures(spec), [spec]);

  const capGeo = useMemo(() => {
    // 1. Sculpted 6-panel baseball crown dome (open underside, boxy structured front brow)
    const crownGeo = new THREE.SphereGeometry(1, 42, 24, 0, Math.PI * 2, 0, Math.PI * 0.52);
    const cPos = crownGeo.attributes.position;
    for (let i = 0; i < cPos.count; i++) {
      let x = cPos.getX(i);
      let y = cPos.getY(i);
      let z = cPos.getZ(i);

      // Authentic baseball crown proportions: width ~0.205m, length ~0.228m, height ~0.112m
      const structuredFront = z > 0 ? 1 + z * 0.08 : 1;
      x *= 0.102 * structuredFront;
      y *= 0.114;
      z *= 0.114;

      // Subtle 6-panel facet pinch along the 6 meridian seams
      const az = Math.atan2(z, x);
      const panelIndent = Math.abs(Math.cos(az * 3)) * 0.0018 * (1 - y / 0.114);
      x -= Math.cos(az) * panelIndent;
      z -= Math.sin(az) * panelIndent;

      cPos.setXYZ(i, x, y, z);
    }
    cPos.needsUpdate = true;
    crownGeo.computeVertexNormals();

    // 2. 6 raised 3D panel seam ribs radiating every 60° from apex to rim
    const seamGeos: THREE.BufferGeometry[] = [];
    for (let p = 0; p < 6; p++) {
      const ang = (p * Math.PI) / 3 + Math.PI / 6;
      const pts: THREE.Vector3[] = [];
      for (let s = 0; s <= 12; s++) {
        const phi = (s / 12) * Math.PI * 0.51;
        const sinP = Math.sin(phi);
        const cosP = Math.cos(phi);
        const zRaw = Math.sin(ang) * sinP;
        const frontBoost = zRaw > 0 ? 1 + zRaw * 0.08 : 1;
        pts.push(
          new THREE.Vector3(
            Math.cos(ang) * sinP * 0.1025 * frontBoost,
            cosP * 0.1145,
            zRaw * 0.1145
          )
        );
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      seamGeos.push(new THREE.TubeGeometry(curve, 16, 0.0016, 6, false));
    }

    // 3. Curved 3D visor bill (`width ≈ 0.195m`, projecting forward `z = +0.082 .. +0.188m`)
    const segU = 26;
    const segV = 14;
    const cols = segU + 1;
    const rows = segV + 1;
    const billThickness = 0.0052;
    const topPositions: number[] = [];
    const botPositions: number[] = [];
    const billUvs: number[] = [];

    for (let r = 0; r <= segV; r++) {
      const v = r / segV; // 0 crown attachment -> 1 front bill tip
      const zBase = 0.082 + v * 0.106;
      // Classic rounded baseball brim narrowing smoothly toward tip
      const halfSpan = (0.098 * Math.sqrt(Math.max(0.08, 1 - Math.pow(v * 0.92, 2.1)))) + 0.012 * (1 - v);

      for (let c = 0; c <= segU; c++) {
        const u = c / segU;
        const nx = (u - 0.5) * 2; // -1..1
        const x = nx * halfSpan;
        // Parabolic pre-curved brim arch + slight downward pitch
        const archY = (1 - nx * nx) * 0.025 - v * 0.016 - 0.012;
        const z = zBase - nx * nx * 0.02 * (1 - v * 0.35);

        topPositions.push(x, archY + billThickness * 0.5, z);
        botPositions.push(x, archY - billThickness * 0.5, z);
        billUvs.push(u, v);
      }
    }

    const buildSurface = (arr: number[], flipWinding: boolean) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(billUvs, 2));
      const idx: number[] = [];
      for (let r = 0; r < segV; r++) {
        for (let c = 0; c < segU; c++) {
          const a = r * cols + c;
          const b = a + 1;
          const d = (r + 1) * cols + c;
          const e = d + 1;
          if (flipWinding) {
            idx.push(a, b, d, b, e, d);
          } else {
            idx.push(a, d, b, b, d, e);
          }
        }
      }
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };

    const visorTopGeo = buildSurface(topPositions, false);
    const visorUnderGeo = buildSurface(botPositions, true);

    // 4. Curved front crown crest plaque hugging front panels
    const crestGeo = new THREE.CylinderGeometry(
      0.118,
      0.118,
      0.068,
      28,
      1,
      true,
      -0.36,
      0.72
    );

    return { crownGeo, seamGeos, visorTopGeo, visorUnderGeo, crestGeo };
  }, []);

  useEffect(() => {
    return () => {
      capGeo.crownGeo.dispose();
      capGeo.seamGeos.forEach((g) => g.dispose());
      capGeo.visorTopGeo.dispose();
      capGeo.visorUnderGeo.dispose();
      capGeo.crestGeo.dispose();
    };
  }, [capGeo]);

  return (
    <group name="structured-cap-3d">
      {/* Minimalist Brushed-Metal Millinery Stand resting cleanly at y = 0 .. 0.145m */}
      <group name="millinery-display-stand">
        <mesh position={[0, 0.006, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.078, 0.082, 0.012, 36]} />
          <meshStandardMaterial
            color={hwMetal}
            metalness={metalness}
            roughness={metalRoughness}
          />
        </mesh>
        <mesh position={[0, 0.015, 0]} castShadow>
          <cylinderGeometry args={[0.016, 0.022, 0.008, 24]} />
          <meshStandardMaterial
            color={hwMetal}
            metalness={metalness}
            roughness={metalRoughness}
          />
        </mesh>
        <mesh position={[0, 0.082, 0]} castShadow>
          <cylinderGeometry args={[0.0058, 0.0058, 0.128, 20]} />
          <meshStandardMaterial
            color={hwMetal}
            metalness={metalness}
            roughness={metalRoughness}
          />
        </mesh>
        {/* Cushioned Millinery Crown Rest Dome */}
        <mesh position={[0, 0.146, 0]} scale={[1, 0.42, 1]} castShadow>
          <sphereGeometry args={[0.056, 24, 14]} />
          <meshStandardMaterial color={hwMetal} metalness={metalness} roughness={metalRoughness} />
        </mesh>
      </group>

      {/* Authentic 6-Panel Club Cap perched on stand (`height ≈ 0.13..0.26m`, width ≈ 0.235m) */}
      <group position={[0, 0.136, -0.012]} rotation={[0.11, 0, 0]}>
        {/* 6-Panel Crown Dome */}
        <mesh geometry={capGeo.crownGeo} castShadow receiveShadow>
          <meshPhysicalMaterial
            color={spec.primaryColor}
            normalMap={textures.normalMap}
            normalScale={VEC2_070}
            roughness={0.86}
            sheen={0.28}
            sheenColor="#FFFDF8"
            side={THREE.DoubleSide}
          />
        </mesh>

        {/* Interior Sweatband Rim */}
        <mesh position={[0, 0.005, 0]} rotation={[Math.PI * 0.5, 0, 0]} scale={[0.98, 1.09, 1]}>
          <torusGeometry args={[0.102, 0.0042, 10, 40]} />
          <meshStandardMaterial color={spec.secondaryColor} roughness={0.85} />
        </mesh>

        {/* 6 Raised Panel Seam Ribs */}
        {capGeo.seamGeos.map((sg, idx) => (
          <mesh key={idx} geometry={sg} castShadow>
            <meshStandardMaterial
              color={shiftColorHex(spec.primaryColor, -0.05)}
              roughness={0.88}
            />
          </mesh>
        ))}

        {/* 6 Embroidered Panel Ventilation Eyelets */}
        {[0, 1, 2, 3, 4, 5].map((idx) => {
          const ang = (idx * Math.PI) / 3;
          const phi = 0.52;
          return (
            <mesh
              key={idx}
              position={[
                Math.cos(ang) * Math.sin(phi) * 0.103,
                Math.cos(phi) * 0.115,
                Math.sin(ang) * Math.sin(phi) * 0.115,
              ]}
              rotation={[Math.sin(ang) * phi, 0, -Math.cos(ang) * phi]}
            >
              <torusGeometry args={[0.0038, 0.0013, 8, 14]} />
              <meshStandardMaterial color={spec.accentColor} roughness={0.6} />
            </mesh>
          );
        })}

        {/* Top Fabric Squatchee Button */}
        <mesh position={[0, 0.116, 0]} scale={[1, 0.45, 1]} castShadow>
          <sphereGeometry args={[0.0125, 18, 14]} />
          <meshStandardMaterial color={spec.secondaryColor} roughness={0.8} />
        </mesh>

        {/* Curved 3D Visor Bill (`secondaryColor` top + `accentColor` heritage underbrim) */}
        <mesh geometry={capGeo.visorTopGeo} castShadow receiveShadow>
          <meshPhysicalMaterial
            color={spec.secondaryColor}
            normalMap={textures.normalMap}
            normalScale={VEC2_065}
            roughness={0.82}
            sheen={0.22}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh geometry={capGeo.visorUnderGeo} receiveShadow>
          <meshStandardMaterial
            color={spec.accentColor}
            roughness={0.88}
            side={THREE.DoubleSide}
          />
        </mesh>

        {/* Raised 3D Front Brand Crest Plaque + Studio Artwork */}
        <mesh position={[0, 0.046, 0.108]} rotation={[-0.24, 0, 0]} castShadow>
          <RoundedBox args={[0.082, 0.062, 0.005]} radius={0.006} smoothness={2}>
            <meshStandardMaterial color={spec.primaryColor} roughness={0.75} />
          </RoundedBox>
        </mesh>
        <mesh position={[0, 0.046, 0.1085]} rotation={[-0.24, 0, 0]}>
          <RoundedBox args={[0.086, 0.066, 0.003]} radius={0.007} smoothness={2}>
            <meshStandardMaterial color={spec.accentColor} roughness={0.55} />
          </RoundedBox>
        </mesh>
        <mesh position={[0, 0.046, 0.1112]} rotation={[-0.24, 0, 0]}>
          <planeGeometry args={[0.074, 0.056]} />
          <meshStandardMaterial
            map={textures.decalMap}
            transparent
            alphaTest={0.04}
            roughness={0.55}
          />
        </mesh>
      </group>
    </group>
  );
};

/**
 * 3. HEAVYWEIGHT GUSSETED CANVAS TOTE (`0.34m × 0.38m × 0.11m`, upright with T-bar stand at `y = 0`)
 */
const CanvasTote3D: React.FC<{
  spec: InventedProductSpec;
  hwMetal: string;
  metalness: number;
  metalRoughness: number;
}> = ({ spec, hwMetal, metalness, metalRoughness }) => {
  const textures = useMemo(() => getOrCreateProductTextures(spec), [spec]);

  const toteGeo = useMemo(() => {
    const halfW = 0.17; // 0.34m total width
    const height = 0.376;
    const halfD = 0.055; // 0.11m gusset depth

    // Dual curved 3D webbed shoulder handles (`TubeGeometry` scaled into flat cotton webbing)
    const makeStrapGeo = (zSign: 1 | -1, leanZ: number) => {
      const zAttach = zSign * (halfD - 0.002);
      const curve = new THREE.CatmullRomCurve3(
        [
          new THREE.Vector3(-0.078, height - 0.01, zAttach),
          new THREE.Vector3(-0.072, height + 0.092, zAttach * 0.72 + leanZ * 0.5),
          new THREE.Vector3(0, height + 0.148, leanZ),
          new THREE.Vector3(0.072, height + 0.092, zAttach * 0.72 + leanZ * 0.5),
          new THREE.Vector3(0.078, height - 0.01, zAttach),
        ],
        false,
        'centripetal',
        0.5
      );
      const geo = new THREE.TubeGeometry(curve, 36, 0.011, 10, false);
      geo.scale(1, 1, 0.38); // Flatten cylindrical tube into realistic thick cotton webbing strap
      return geo;
    };

    const frontStrapGeo = makeStrapGeo(1, 0.018);
    const backStrapGeo = makeStrapGeo(-1, -0.048); // Rests cleanly over the rear T-bar bag stand

    // V-creased side gusset geometry (inward accordion crease along x = ±halfW)
    const gussetShape = new THREE.BufferGeometry();
    const gVerts = new Float32Array([
      // Front half of gusset -> center V crease -> Back half of gusset
      0, 0.006, halfD,
      -0.016, 0.006, 0,
      0, height, halfD,
      -0.022, height, 0,

      -0.016, 0.006, 0,
      0, 0.006, -halfD,
      -0.022, height, 0,
      0, height, -halfD,
    ]);
    const gIdx = [0, 1, 2, 1, 3, 2, 4, 5, 6, 5, 7, 6];
    gussetShape.setAttribute('position', new THREE.BufferAttribute(gVerts, 3));
    gussetShape.setIndex(gIdx);
    gussetShape.computeVertexNormals();

    return { frontStrapGeo, backStrapGeo, gussetShape, halfW, height, halfD };
  }, []);

  useEffect(() => {
    return () => {
      toteGeo.frontStrapGeo.dispose();
      toteGeo.backStrapGeo.dispose();
      toteGeo.gussetShape.dispose();
    };
  }, [toteGeo]);

      const { halfW, height, halfD } = toteGeo;
  const normalScale = VEC2_085;

  return (
    <group name="canvas-tote-3d">
      {/* Sleek Rear Brushed-Metal T-Bar Bag Display Stand resting at y = 0 */}
      <group name="tote-tbar-stand">
        <RoundedBox
          args={[0.2, 0.008, 0.14]}
          radius={0.003}
          position={[0, 0.004, -0.028]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial
            color={hwMetal}
            metalness={metalness}
            roughness={metalRoughness}
          />
        </RoundedBox>
        {/* Vertical Upright Stanchion rising behind tote to y = 0.528m */}
        <mesh position={[0, 0.268, -0.078]} castShadow>
          <cylinderGeometry args={[0.0055, 0.0055, 0.52, 18]} />
          <meshStandardMaterial
            color={hwMetal}
            metalness={metalness}
            roughness={metalRoughness}
          />
        </mesh>
        {/* Horizontal T-Bar Crossbar + Finial Caps */}
        <mesh position={[0, 0.524, -0.062]} rotation={[0, 0, Math.PI * 0.5]} castShadow>
          <cylinderGeometry args={[0.0052, 0.0052, 0.19, 18]} />
          <meshStandardMaterial
            color={hwMetal}
            metalness={metalness}
            roughness={metalRoughness}
          />
        </mesh>
        <mesh position={[0, 0.524, -0.07]} rotation={[Math.PI * 0.5, 0, 0]}>
          <cylinderGeometry args={[0.005, 0.005, 0.022, 14]} />
          <meshStandardMaterial
            color={hwMetal}
            metalness={metalness}
            roughness={metalRoughness}
          />
        </mesh>
      </group>

      {/* 4 Tiny Brass Bag Feet resting at y = 0..0.006m */}
      {[-0.125, 0.125].map((fx) =>
        [-0.032, 0.032].map((fz) => (
          <mesh key={`${fx}-${fz}`} position={[fx, 0.003, fz]} castShadow>
            <cylinderGeometry args={[0.007, 0.008, 0.006, 14]} />
            <meshStandardMaterial color={hwMetal} metalness={0.9} roughness={0.22} />
          </mesh>
        ))
      )}

      {/* Reinforced Contrast Dipped Canvas Bottom Boot (y = 0.006 .. 0.076m) */}
      <RoundedBox
        args={[halfW * 2 + 0.004, 0.07, halfD * 2 + 0.004]}
        radius={0.008}
        smoothness={3}
        position={[0, 0.041, 0]}
        castShadow
        receiveShadow
      >
        <meshPhysicalMaterial
          color={spec.secondaryColor}
          normalMap={textures.normalMap}
          normalScale={normalScale}
          roughness={0.9}
          sheen={0.2}
        />
      </RoundedBox>

      {/* Structured Front & Back Heavy Duck Canvas Panels */}
      <RoundedBox
        args={[halfW * 2, height - 0.01, 0.009]}
        radius={0.004}
        position={[0, height * 0.5 + 0.004, halfD - 0.004]}
        castShadow
        receiveShadow
      >
        <meshPhysicalMaterial
          color={spec.primaryColor}
          normalMap={textures.normalMap}
          normalScale={normalScale}
          roughness={0.9}
          sheen={0.22}
        />
      </RoundedBox>
      <RoundedBox
        args={[halfW * 2, height - 0.01, 0.009]}
        radius={0.004}
        position={[0, height * 0.5 + 0.004, -halfD + 0.004]}
        castShadow
        receiveShadow
      >
        <meshPhysicalMaterial
          color={spec.primaryColor}
          normalMap={textures.normalMap}
          normalScale={normalScale}
          roughness={0.9}
          sheen={0.22}
        />
      </RoundedBox>

      {/* Crisp Accordion V-Fold Left & Right Side Gussets */}
      <mesh geometry={toteGeo.gussetShape} position={[halfW, 0, 0]} castShadow receiveShadow>
        <meshPhysicalMaterial
          color={shiftColorHex(spec.primaryColor, -0.035)}
          normalMap={textures.normalMap}
          normalScale={normalScale}
          roughness={0.92}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh
        geometry={toteGeo.gussetShape}
        position={[-halfW, 0, 0]}
        scale={[-1, 1, 1]}
        castShadow
        receiveShadow
      >
        <meshPhysicalMaterial
          color={shiftColorHex(spec.primaryColor, -0.035)}
          normalMap={textures.normalMap}
          normalScale={normalScale}
          roughness={0.92}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Dark Recessed Open Top Interior Cavity + Inner Pocket Tag */}
      <mesh position={[0, height - 0.09, 0]}>
        <boxGeometry args={[halfW * 2 - 0.028, 0.17, halfD * 2 - 0.022]} />
        <meshStandardMaterial
          color="#1B1A19"
          roughness={0.96}
          side={THREE.BackSide}
        />
      </mesh>
      <mesh position={[0, height - 0.045, -halfD + 0.012]}>
        <planeGeometry args={[0.07, 0.035]} />
        <meshStandardMaterial map={textures.archivalLabelMap} roughness={0.75} />
      </mesh>

      {/* Exterior Vertical Webbing Strap Tails + Brass Rivets */}
      {([-0.078, 0.078] as const).map((sx) =>
        ([1, -1] as const).map((zs) => (
          <React.Fragment key={`${sx}-${zs}`}>
            <mesh
              position={[sx, 0.225, zs * (halfD + 0.0025)]}
              castShadow
              receiveShadow
            >
              <boxGeometry args={[0.024, 0.305, 0.005]} />
              <meshPhysicalMaterial
                color={spec.secondaryColor}
                normalMap={textures.normalMap}
                normalScale={normalScale}
                roughness={0.86}
              />
            </mesh>
            {/* Brass Reinforcement Rivet */}
            <mesh
              position={[sx, height - 0.018, zs * (halfD + 0.006)]}
              rotation={[Math.PI * 0.5, 0, 0]}
            >
              <cylinderGeometry args={[0.0045, 0.0045, 0.003, 14]} />
              <meshStandardMaterial color={hwMetal} metalness={0.92} roughness={0.2} />
            </mesh>
          </React.Fragment>
        ))
      )}

      {/* Dual Curved 3D Webbed Shoulder Handles */}
      <mesh geometry={toteGeo.frontStrapGeo} position={[0, 0, 0.022]} castShadow>
        <meshPhysicalMaterial
          color={spec.secondaryColor}
          normalMap={textures.normalMap}
          normalScale={normalScale}
          roughness={0.84}
        />
      </mesh>
      <mesh geometry={toteGeo.backStrapGeo} position={[0, 0, -0.015]} castShadow>
        <meshPhysicalMaterial
          color={spec.secondaryColor}
          normalMap={textures.normalMap}
          normalScale={normalScale}
          roughness={0.84}
        />
      </mesh>

      {/* Bold Screen-Printed Front Brand Artwork (Centered between webbing straps!) */}
      <mesh position={[0, 0.222, halfD + 0.0018]}>
        <planeGeometry args={[0.132, 0.195]} />
        <meshPhysicalMaterial
          map={textures.decalMap}
          normalMap={textures.normalMap}
          normalScale={normalScale}
          transparent
          alphaTest={0.04}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-1}
          roughness={0.76}
        />
      </mesh>
    </group>
  );
};

/**
 * 4. HARDCOVER COFFEE-TABLE MONOGRAPH (`0.28m × 0.36m × 0.042m` propped at `72°` gallery angle on easel at `y = 0`)
 */
const HardcoverBook3D: React.FC<{
  spec: InventedProductSpec;
  hwMetal: string;
  metalness: number;
  metalRoughness: number;
}> = ({ spec, hwMetal, metalness, metalRoughness }) => {
  const textures = useMemo(() => getOrCreateProductTextures(spec), [spec]);

  // Procedural archival cream page-block edge texture with fine paper sheet striations
  const pageEdgeTex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#F3EDE0';
    ctx.fillRect(0, 0, 128, 128);
    for (let x = 0; x < 128; x += 2) {
      ctx.fillStyle = x % 4 === 0 ? '#E4DCCB' : '#FAF6EC';
      ctx.fillRect(x, 0, 1, 128);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 1);
    t.needsUpdate = true;
    return t;
  }, []);

  useEffect(() => {
    return () => {
      pageEdgeTex.dispose();
    };
  }, [pageEdgeTex]);

  const bookW = 0.28;
  const bookH = 0.36;
  const bookD = 0.042;
  const boardT = 0.0045;
  // 72° from horizontal = 18° backward gallery tilt
  const leanRad = -(18 * Math.PI) / 180;

  return (
    <group name="hardcover-book-3d">
      {/* Minimalist Brushed-Metal Gallery Book Easel resting cleanly at y = 0 */}
      <group name="metal-book-easel">
        {/* Left & Right Base Sled Rails at y = 0 .. 0.008m */}
        {([-0.088, 0.088] as const).map((rx, idx) => (
          <React.Fragment key={idx}>
            <RoundedBox
              args={[0.012, 0.008, 0.21]}
              radius={0.002}
              position={[rx, 0.004, -0.005]}
              castShadow
              receiveShadow
            >
              <meshStandardMaterial
                color={hwMetal}
                metalness={metalness}
                roughness={metalRoughness}
              />
            </RoundedBox>
            {/* Front Upturned Cradle Lip */}
            <RoundedBox
              args={[0.012, 0.036, 0.008]}
              radius={0.002}
              position={[rx, 0.02, 0.096]}
              castShadow
            >
              <meshStandardMaterial
                color={hwMetal}
                metalness={metalness}
                roughness={metalRoughness}
              />
            </RoundedBox>
            {/* Angled 72° Easel Backrest Arm */}
            <RoundedBox
              args={[0.01, 0.26, 0.008]}
              radius={0.002}
              position={[rx, 0.125, -0.008]}
              rotation={[leanRad, 0, 0]}
              castShadow
            >
              <meshStandardMaterial
                color={hwMetal}
                metalness={metalness}
                roughness={metalRoughness}
              />
            </RoundedBox>
            {/* Rear Diagonal Support Strut down to base sled */}
            <RoundedBox
              args={[0.008, 0.155, 0.008]}
              radius={0.002}
              position={[rx, 0.072, -0.068]}
              rotation={[0.42, 0, 0]}
              castShadow
            >
              <meshStandardMaterial
                color={hwMetal}
                metalness={metalness}
                roughness={metalRoughness}
              />
            </RoundedBox>
          </React.Fragment>
        ))}

        {/* Horizontal Tie Bars on Easel */}
        <mesh position={[0, 0.004, 0.085]}>
          <boxGeometry args={[0.188, 0.006, 0.012]} />
          <meshStandardMaterial
            color={hwMetal}
            metalness={metalness}
            roughness={metalRoughness}
          />
        </mesh>
        <mesh position={[0, 0.175, -0.025]} rotation={[leanRad, 0, 0]}>
          <boxGeometry args={[0.188, 0.012, 0.006]} />
          <meshStandardMaterial
            color={hwMetal}
            metalness={metalness}
            roughness={metalRoughness}
          />
        </mesh>
      </group>

      {/* Oversized Luxury Hardcover Monograph cradled inside the 72° easel */}
      <group position={[0, 0.014, 0.07]} rotation={[leanRad, 0, 0]}>
        {/* Group origin sits at bottom-center of book; book extends y = 0 .. bookH, z = -bookD..0 */}
        <group position={[0, bookH * 0.5, -bookD * 0.5]}>
          {/* Back Linen Hardcover Board */}
          <RoundedBox
            args={[bookW, bookH, boardT]}
            radius={0.0018}
            position={[0, 0, -bookD * 0.5 + boardT * 0.5]}
            castShadow
            receiveShadow
          >
            <meshPhysicalMaterial
              color={spec.primaryColor}
              normalMap={textures.normalMap}
              normalScale={VEC2_055}
              roughness={0.78}
              sheen={0.24}
            />
          </RoundedBox>

          {/* Front Linen Hardcover Board */}
          <RoundedBox
            args={[bookW, bookH, boardT]}
            radius={0.0018}
            position={[0, 0, bookD * 0.5 - boardT * 0.5]}
            castShadow
            receiveShadow
          >
            <meshPhysicalMaterial
              color={spec.primaryColor}
              normalMap={textures.normalMap}
              normalScale={VEC2_055}
              roughness={0.78}
              sheen={0.24}
            />
          </RoundedBox>

          {/* Recessed Cream Paper Page Block (visible on Top, Right Fore-Edge, and Bottom!) */}
          <mesh position={[0.003, 0, 0]} castShadow receiveShadow>
            <boxGeometry args={[bookW - 0.012, bookH - 0.012, bookD - boardT * 2 - 0.001]} />
            <meshStandardMaterial map={pageEdgeTex} roughness={0.86} />
          </mesh>

          {/* Quarter-Cloth Bound Spine (`secondaryColor`) wrapping hinge + rounded spine back */}
          <RoundedBox
            args={[0.036, bookH + 0.001, bookD + 0.0015]}
            radius={0.004}
            position={[-bookW * 0.5 + 0.017, 0, 0]}
            castShadow
            receiveShadow
          >
            <meshPhysicalMaterial
              color={spec.secondaryColor}
              normalMap={textures.normalMap}
              normalScale={VEC2_065}
              roughness={0.8}
              sheen={0.3}
            />
          </RoundedBox>

          {/* Metallic Foil Spine Groove Rule along Quarter-Cloth Joint */}
          <mesh position={[-bookW * 0.5 + 0.036, 0, bookD * 0.5 + 0.0008]}>
            <planeGeometry args={[0.0025, bookH - 0.004]} />
            <meshStandardMaterial
              color={spec.accentColor}
              metalness={0.65}
              roughness={0.3}
            />
          </mesh>

          {/* Silk Headband / Tailband + Ribbon Bookmark Peek */}
          <mesh position={[-bookW * 0.5 + 0.016, bookH * 0.5 - 0.005, 0]}>
            <boxGeometry args={[0.012, 0.004, bookD - boardT * 2]} />
            <meshStandardMaterial color={spec.accentColor} roughness={0.6} />
          </mesh>
          <mesh position={[0.02, -bookH * 0.5 - 0.004, 0.004]} rotation={[0, 0, 0.14]}>
            <boxGeometry args={[0.012, 0.018, 0.0015]} />
            <meshStandardMaterial color={spec.accentColor} roughness={0.5} />
          </mesh>

          {/* Metallic Foil Frame Trim + Debossed Front Cover Plate & Artwork */}
          <mesh position={[0.014, 0.006, bookD * 0.5 + 0.0006]}>
            <planeGeometry args={[0.219, 0.281]} />
            <meshStandardMaterial
              color={spec.accentColor}
              metalness={0.7}
              roughness={0.28}
            />
          </mesh>
          <mesh position={[0.014, 0.006, bookD * 0.5 + 0.0011]}>
            <planeGeometry args={[0.214, 0.276]} />
            <meshPhysicalMaterial
              map={textures.frontMap}
              roughness={0.42}
              metalness={0.14}
              clearcoat={0.22}
            />
          </mesh>
        </group>
      </group>
    </group>
  );
};

/**
 * 5. APOTHECARY BOTTLE & RIGID PRESENTATION BOX DUO (`bottle height ≈ 0.26m`, `box 0.12m × 0.24m × 0.12m` at `y = 0`)
 */
const ApothecaryBottleDuo3D: React.FC<{
  spec: InventedProductSpec;
  hwMetal: string;
  metalness: number;
  metalRoughness: number;
}> = ({ spec, hwMetal, metalness, metalRoughness }) => {
  const textures = useMemo(() => getOrCreateProductTextures(spec), [spec]);

  const bottleGeo = useMemo(() => {
    const r = 0.045;
    const neckR = 0.0155;
    // Boston-round luxury apothecary glass profile (y = 0.008 .. 0.210m)
    const pts: THREE.Vector2[] = [
      new THREE.Vector2(0, 0.01),
      new THREE.Vector2(r * 0.82, 0.008),
      new THREE.Vector2(r * 0.96, 0.011),
      new THREE.Vector2(r, 0.02),
      new THREE.Vector2(r, 0.148),
      // Smooth curved apothecary shoulder
      new THREE.Vector2(r * 0.94, 0.164),
      new THREE.Vector2(r * 0.74, 0.178),
      new THREE.Vector2(neckR * 1.35, 0.189),
      new THREE.Vector2(neckR, 0.195),
      new THREE.Vector2(neckR, 0.207),
      new THREE.Vector2(neckR * 1.18, 0.209),
      new THREE.Vector2(neckR * 0.85, 0.211),
    ];

    const glassGeo = new THREE.LatheGeometry(pts, 44);

    // Wraparound archival cotton-rag bottle label (`±116°` on +Z)
    const halfArc = (116 * Math.PI) / 180;
    const wrapLabelGeo = new THREE.CylinderGeometry(
      r + 0.0007,
      r + 0.0007,
      0.112,
      40,
      1,
      true,
      -halfArc,
      halfArc * 2
    );

    return { glassGeo, wrapLabelGeo, r };
  }, []);

  useEffect(() => {
    return () => {
      bottleGeo.glassGeo.dispose();
      bottleGeo.wrapLabelGeo.dispose();
    };
  }, [bottleGeo]);

  // Harmonious apothecary glass tint (frosted botanical or warm smoked amber-infused brand hue)
  const isFrosted = spec.materialFinish === 'frosted_glass';
  const glassTint = useMemo(() => {
    const c = new THREE.Color();
    try {
      c.set(spec.primaryColor);
    } catch {
      c.set('#5C3A21');
    }
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    if (hsl.l > 0.78 && !isFrosted) {
      // Pure cream/white brand primary -> classic Aesop/Byredo smoked amber-tea glass
      return '#6E4223';
    }
    return `#${c.getHexString()}`;
  }, [spec.primaryColor, isFrosted]);

  return (
    <group name="apothecary-bottle-duo-3d">
      {/* Low-Profile Chamfered Presentation Plinth Tray resting at y = 0 .. 0.008m */}
      <RoundedBox
        args={[0.285, 0.008, 0.175]}
        radius={0.003}
        position={[0, 0.004, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          color={hwMetal}
          metalness={metalness * 0.85}
          roughness={Math.min(1, metalRoughness + 0.14)}
        />
      </RoundedBox>

      {/* 1. RIGID TELESCOPE PRESENTATION BOX (`0.12m × 0.24m × 0.12m`, standing left-rear) */}
      <group position={[-0.064, 0.008, -0.012]} rotation={[0, 0.18, 0]}>
        {/* Lower Rigid Base Box */}
        <RoundedBox
          args={[0.118, 0.176, 0.118]}
          radius={0.003}
          position={[0, 0.088, 0]}
          castShadow
          receiveShadow
        >
          <meshPhysicalMaterial
            color={spec.secondaryColor}
            normalMap={textures.normalMap}
            normalScale={VEC2_035}
            roughness={0.82}
            sheen={0.18}
          />
        </RoundedBox>

        {/* Accent Neck Reveal Band between Box Base & Telescope Lid */}
        <mesh position={[0, 0.178, 0]}>
          <boxGeometry args={[0.114, 0.006, 0.114]} />
          <meshStandardMaterial
            color={spec.accentColor}
            metalness={0.35}
            roughness={0.4}
          />
        </mesh>

        {/* Upper Rigid Telescope Lid (Total box height = 0.24m) */}
        <RoundedBox
          args={[0.12, 0.06, 0.12]}
          radius={0.003}
          position={[0, 0.21, 0]}
          castShadow
          receiveShadow
        >
          <meshPhysicalMaterial
            color={spec.secondaryColor}
            normalMap={textures.normalMap}
            normalScale={VEC2_035}
            roughness={0.8}
            sheen={0.18}
          />
        </RoundedBox>

        {/* Branded Archival Front Packaging Label */}
        <mesh position={[0, 0.104, 0.0596]}>
          <planeGeometry args={[0.094, 0.132]} />
          <meshStandardMaterial map={textures.archivalLabelMap} roughness={0.74} />
        </mesh>
      </group>

      {/* 2. SCULPTURAL APOTHECARY GLASS BOTTLE (`height ≈ 0.26m`, front-right) */}
      <group position={[0.064, 0, 0.018]} rotation={[0, -0.14, 0]}>
        {/* Inner Botanical Elixir Core + Slender Pipette Glass Tube visible inside glass */}
        <mesh position={[0, 0.082, 0]}>
          <cylinderGeometry args={[0.039, 0.039, 0.128, 28]} />
          <meshStandardMaterial
            color={spec.accentColor}
            roughness={0.25}
            transparent
            opacity={0.72}
          />
        </mesh>
        <mesh position={[0, 0.115, 0]}>
          <cylinderGeometry args={[0.003, 0.0022, 0.165, 12]} />
          <meshStandardMaterial color="#EAE6DC" roughness={0.2} />
        </mesh>

        {/* Sculptural LatheGeometry Glass Bottle (`MeshPhysicalMaterial` clearcoat: 0.9, roughness: 0.18) */}
        <mesh geometry={bottleGeo.glassGeo} castShadow receiveShadow>
          <meshPhysicalMaterial
            color={glassTint}
            normalMap={textures.normalMap}
            normalScale={new THREE.Vector2(isFrosted ? 0.35 : 0.08, isFrosted ? 0.35 : 0.08)}
            roughness={isFrosted ? 0.24 : 0.16}
            metalness={0.02}
            clearcoat={0.92}
            clearcoatRoughness={0.08}
            transmission={0.54}
            thickness={0.042}
            ior={1.52}
          />
        </mesh>

        {/* Wraparound Archival Cotton-Rag Paper Label */}
        <mesh geometry={bottleGeo.wrapLabelGeo} position={[0, 0.085, 0]}>
          <meshStandardMaterial
            map={textures.archivalLabelMap}
            roughness={0.78}
            polygonOffset
            polygonOffsetFactor={-1}
          />
        </mesh>

        {/* Machined Aluminum / Turned Walnut Collar + Dropper Pipette Cap (to y = 0.264m) */}
        <mesh position={[0, 0.214, 0]} castShadow>
          <cylinderGeometry args={[0.0205, 0.0205, 0.007, 28]} />
          <meshStandardMaterial color={hwMetal} metalness={0.92} roughness={0.22} />
        </mesh>
        <mesh position={[0, 0.228, 0]} castShadow>
          <cylinderGeometry args={[0.0195, 0.0198, 0.022, 28]} />
          <meshPhysicalMaterial
            color="#3D2B1F"
            roughness={0.42}
            clearcoat={0.28}
            clearcoatRoughness={0.35}
          />
        </mesh>
        {/* Tactile Matte Dropper Pipette Bulb */}
        <mesh position={[0, 0.247, 0]} castShadow>
          <cylinderGeometry args={[0.011, 0.0125, 0.022, 22]} />
          <meshStandardMaterial color="#1D1D1F" roughness={0.68} />
        </mesh>
        <mesh position={[0, 0.258, 0]} castShadow>
          <sphereGeometry args={[0.011, 20, 16]} />
          <meshStandardMaterial color="#1D1D1F" roughness={0.68} />
        </mesh>
      </group>
    </group>
  );
};

/**
 * Exported Multi-Category Pedestal / Display Table 3D Retail Object
 */
export const PedestalProduct3D: React.FC<PedestalProduct3DProps> = ({
  spec,
  position = [0, 0, 0],
  rotationY = 0,
  scale = 1,
  metalColor,
  metalness = 0.86,
  metalRoughness = 0.26,
  accentColor,
  palette,
  selected = false,
  onSelect,
}) => {
  const [hovered, setHovered] = useState(false);
  const animGroupRef = useRef<THREE.Group>(null);
  const hoverLiftRef = useRef(0);

  const hwMetal = metalColor ?? palette?.rackMetal ?? '#C5A059';
  const badgeAccent = accentColor ?? palette?.accent ?? spec.accentColor ?? '#547049';

  const placardTex = useMemo(
    () =>
      createMuseumPlacardTexture(
        spec.title,
        spec.price,
        spec.sku,
        badgeAccent,
        hwMetal
      ),
    [spec.title, spec.price, spec.sku, badgeAccent, hwMetal]
  );

  useEffect(() => {
    return () => {
      placardTex.dispose();
    };
  }, [placardTex]);

  useEffect(() => {
    if (!hovered) return;
    const prev = document.body.style.cursor;
    document.body.style.cursor = 'pointer';
    return () => {
      document.body.style.cursor = prev;
    };
  }, [hovered]);

  // Subtle interactive yaw ease on hover while keeping base grounded cleanly at y = 0
  useFrame((_, delta) => {
    const target = hovered ? 1 : 0;
    hoverLiftRef.current += (target - hoverLiftRef.current) * Math.min(1, delta * 10);
    if (animGroupRef.current) {
      animGroupRef.current.rotation.y = hoverLiftRef.current * 0.055;
    }
  });

  const placardHeightY = useMemo(() => {
    switch (spec.category) {
      case 'ceramic_mug':
        return 0.255;
      case 'structured_cap':
        return 0.315;
      case 'canvas_tote':
        return 0.585;
      case 'hardcover_book':
        return 0.425;
      case 'apothecary_bottle':
        return 0.325;
      default:
        return 0.34;
    }
  }, [spec.category]);

  const haloRadius = useMemo(() => {
    switch (spec.category) {
      case 'ceramic_mug':
        return 0.118;
      case 'structured_cap':
        return 0.112;
      case 'canvas_tote':
        return 0.195;
      case 'hardcover_book':
        return 0.175;
      case 'apothecary_bottle':
        return 0.168;
      default:
        return 0.14;
    }
  }, [spec.category]);

  return (
    <group
      position={position}
      rotation={[0, rotationY, 0]}
      scale={scale}
      name={`pedestal-product-3d-${spec.id}`}
      onPointerEnter={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerLeave={(e) => {
        e.stopPropagation();
        setHovered(false);
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.(spec);
      }}
    >
      {/* Subtle Museum Selection / Hover Accent Ring resting flush at y = 0.0015m */}
      {(hovered || selected) && (
        <mesh position={[0, 0.0015, 0]} rotation={[-Math.PI * 0.5, 0, 0]}>
          <ringGeometry args={[haloRadius - 0.005, haloRadius, 48]} />
          <meshBasicMaterial
            color={badgeAccent}
            transparent
            opacity={selected ? 0.85 : 0.58}
          />
        </mesh>
      )}

      <group ref={animGroupRef}>
        {spec.category === 'ceramic_mug' && (
          <CeramicMug3D
            spec={spec}
            hwMetal={hwMetal}
            metalness={metalness}
            metalRoughness={metalRoughness}
          />
        )}
        {spec.category === 'structured_cap' && (
          <StructuredCap3D
            spec={spec}
            hwMetal={hwMetal}
            metalness={metalness}
            metalRoughness={metalRoughness}
          />
        )}
        {spec.category === 'canvas_tote' && (
          <CanvasTote3D
            spec={spec}
            hwMetal={hwMetal}
            metalness={metalness}
            metalRoughness={metalRoughness}
          />
        )}
        {spec.category === 'hardcover_book' && (
          <HardcoverBook3D
            spec={spec}
            hwMetal={hwMetal}
            metalness={metalness}
            metalRoughness={metalRoughness}
          />
        )}
        {(spec.category === 'apothecary_bottle' ||
          (spec.category !== 'ceramic_mug' &&
            spec.category !== 'structured_cap' &&
            spec.category !== 'canvas_tote' &&
            spec.category !== 'hardcover_book')) && (
          <ApothecaryBottleDuo3D
            spec={spec}
            hwMetal={hwMetal}
            metalness={metalness}
            metalRoughness={metalRoughness}
          />
        )}
      </group>

      {/* Clean Hover-Only Museum Spec Placard (`Title · $Price`) */}
      {hovered && (
        <CameraFacingPlacard
          position={[0, placardHeightY, 0]}
          texture={placardTex}
          width={0.26}
          height={0.068}
        />
      )}
    </group>
  );
};

export default PedestalProduct3D;
