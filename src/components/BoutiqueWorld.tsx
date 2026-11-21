import React, { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer, RoundedBox } from '@react-three/drei';
import type { LightingPreset, StoreConfig, WorldArchetypeId } from '../types/storeConfig';

export interface BoutiqueWorldProps {
  config: StoreConfig;
  children?: React.ReactNode;
}

/**
 * Standardized 3D product display fixture surface anchors ([x, topY, z]).
 * In all 4 architectural worlds, clean flat fixture tops sit at these exact heights:
 *  - center_table:   [1.55, 0.78, 0.65]
 *  - right_pedestal: [2.35, 0.96, -0.85]
 *  - left_pedestal:  [-2.45, 0.92, 0.75]
 */
export const DISPLAY_FIXTURE_ANCHORS = {
  center_table: [1.55, 0.78, 0.65] as [number, number, number],
  right_pedestal: [2.35, 0.96, -0.85] as [number, number, number],
  left_pedestal: [-2.45, 0.92, 0.75] as [number, number, number],
};

export const DISPLAY_FIXTURE_TOPS = DISPLAY_FIXTURE_ANCHORS;

/**
 * Resolves the active WorldArchetypeId from StoreConfig with graceful fallback
 */
export function resolveWorldArchetype(config: StoreConfig): WorldArchetypeId {
  if (config.archetype) return config.archetype;
  if (config.id === 'kinetic-concrete') return 'avant_garde_concrete_loft';
  if (config.id === 'kyoto-atelier') return 'warm_artisanal_atelier';
  if (config.id === 'linear-systems') return 'minimalist_tech_pavilion';
  return 'heritage_arch_flagship';
}

/**
 * Local error boundary so optional Drei Suspense helpers (<Environment>)
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
 * Bounded LRU-style procedural CanvasTexture cache so switching presets or
 * ingesting live URLs synthesizes architectural surfaces in <15ms (0ms on cache hit).
 */
const PROCEDURAL_TEX_CACHE = new Map<string, THREE.CanvasTexture>();
const MAX_TEX_CACHE_ENTRIES = 72;

function getCachedCanvasTexture(
  key: string,
  factory: () => THREE.CanvasTexture
): THREE.CanvasTexture {
  const hit = PROCEDURAL_TEX_CACHE.get(key);
  if (hit) return hit;

  if (PROCEDURAL_TEX_CACHE.size >= MAX_TEX_CACHE_ENTRIES) {
    const oldestKey = PROCEDURAL_TEX_CACHE.keys().next().value;
    if (oldestKey !== undefined) {
      const evicted = PROCEDURAL_TEX_CACHE.get(oldestKey);
      PROCEDURAL_TEX_CACHE.delete(oldestKey);
      evicted?.dispose();
    }
  }

  const created = factory();
  PROCEDURAL_TEX_CACHE.set(key, created);
  return created;
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
 * Helpers for subtle palette derivation
 */
function shiftHex(hex: string, delta: number): string {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, delta);
  return `#${c.getHexString()}`;
}

function getLuminance(hex: string): number {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(hex).getHSL(hsl);
  return hsl.l;
}

function resolveWarmOakHex(hangerWoodHex: string): string {
  const c = new THREE.Color(hangerWoodHex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  // Ensure artisanal timber louvers & ceiling beams always read as rich warm oak/hinoki
  if (hsl.l < 0.26 || hsl.s < 0.12) {
    return '#B98E63';
  }
  return `#${c.getHexString()}`;
}

/**
 * Fast, cached procedural floor texture tailored to WorldArchetypeId + Brand Palette
 */
function getProceduralFloorTexture(
  floorHex: string,
  secondaryHex: string,
  archetype: WorldArchetypeId,
  maxAniso: number
): THREE.CanvasTexture {
  const key = `floor|${archetype}|${floorHex}|${secondaryHex}|${maxAniso}`;
  return getCachedCanvasTexture(key, () => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = floorHex;
    ctx.fillRect(0, 0, 512, 512);

    if (archetype === 'minimalist_tech_pavilion') {
      // Large-format rectified dark basalt / architectural slate slabs with hairline joints
      const grid = 2;
      const cell = 512 / grid;
      for (let r = 0; r < grid; r++) {
        for (let c = 0; c < grid; c++) {
          const delta = ((r * 3 + c) % 3 - 1) * 0.012;
          const grad = ctx.createLinearGradient(c * cell, r * cell, (c + 1) * cell, (r + 1) * cell);
          grad.addColorStop(0, shiftHex(floorHex, delta + 0.012));
          grad.addColorStop(1, shiftHex(floorHex, delta - 0.012));
          ctx.fillStyle = grad;
          ctx.fillRect(c * cell, r * cell, cell, cell);

          ctx.strokeStyle = shiftHex(floorHex, -0.055);
          ctx.lineWidth = 2;
          ctx.strokeRect(c * cell + 1, r * cell + 1, cell - 2, cell - 2);
        }
      }
      // Subtle micro-honed slate flecks
      for (let i = 0; i < 180; i++) {
        ctx.fillStyle = shiftHex(floorHex, i % 2 === 0 ? 0.025 : -0.02);
        const x = (i * 89) % 508;
        const y = (i * 173) % 508;
        ctx.fillRect(x, y, 6 + (i % 10), 1);
      }
    } else if (archetype === 'avant_garde_concrete_loft') {
      // Polished charcoal/mineral aggregate terrazzo + brass/zinc expansion joints
      const chipColors = [
        shiftHex(floorHex, 0.09),
        shiftHex(floorHex, -0.045),
        shiftHex(floorHex, 0.16),
        secondaryHex,
      ];
      for (let i = 0; i < 520; i++) {
        ctx.fillStyle = chipColors[i % chipColors.length];
        const x = (Math.sin(i * 127.1) * 0.5 + 0.5) * 512;
        const y = (Math.cos(i * 311.7) * 0.5 + 0.5) * 512;
        const r = 1.2 + ((i * 17) % 5) * 0.65;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = shiftHex(floorHex, -0.06);
      ctx.lineWidth = 2.5;
      ctx.strokeRect(1, 1, 510, 510);
      ctx.beginPath();
      ctx.moveTo(0, 256);
      ctx.lineTo(512, 256);
      ctx.moveTo(256, 0);
      ctx.lineTo(256, 512);
      ctx.stroke();
    } else if (archetype === 'warm_artisanal_atelier') {
      // Warm honed limestone / organic travertine slabs with warm sand mortar joints
      const rows = 3;
      const rowH = 512 / rows;
      for (let r = 0; r < rows; r++) {
        const offset = (r % 2) * 170;
        for (let col = -1; col < 3; col++) {
          const x = col * 256 + offset;
          ctx.fillStyle = shiftHex(floorHex, (((r + col) % 3) - 1) * 0.018);
          ctx.fillRect(x, r * rowH, 256, rowH);
          ctx.strokeStyle = shiftHex(floorHex, -0.05);
          ctx.lineWidth = 2;
          ctx.strokeRect(x, r * rowH, 256, rowH);
        }
      }
      // Organic sedimentary limestone veins
      for (let v = 0; v < 110; v++) {
        ctx.fillStyle = shiftHex(floorHex, v % 2 === 0 ? -0.028 : 0.024);
        const vx = ((v * 67) % 496) + 4;
        const vy = ((v * 149) % 502) + 4;
        ctx.globalAlpha = 0.45;
        ctx.fillRect(vx, vy, 24 + (v % 34), 1.6);
      }
      ctx.globalAlpha = 1;
    } else {
      // Heritage Arch Flagship: Honed Roman travertine ashlar stone slabs
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
  });
}

/**
 * Fast, cached procedural wall texture tailored to WorldArchetypeId + Brand Palette
 */
function getProceduralWallTexture(
  wallHex: string,
  archetype: WorldArchetypeId,
  maxAniso: number
): THREE.CanvasTexture {
  const key = `wall|${archetype}|${wallHex}|${maxAniso}`;
  return getCachedCanvasTexture(key, () => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = wallHex;
    ctx.fillRect(0, 0, 512, 512);

    if (archetype === 'minimalist_tech_pavilion') {
      // Precision bead-blasted anodized aluminum / matte architectural panel grid
      const cols = 2;
      const rows = 2;
      const w = 512 / cols;
      const h = 512 / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const grad = ctx.createLinearGradient(c * w, r * h, c * w + w, r * h + h);
          grad.addColorStop(0, shiftHex(wallHex, 0.018));
          grad.addColorStop(0.5, wallHex);
          grad.addColorStop(1, shiftHex(wallHex, -0.018));
          ctx.fillStyle = grad;
          ctx.fillRect(c * w, r * h, w, h);

          ctx.strokeStyle = shiftHex(wallHex, -0.055);
          ctx.lineWidth = 2;
          ctx.strokeRect(c * w + 1, r * h + 1, w - 2, h - 2);
        }
      }
    } else if (archetype === 'avant_garde_concrete_loft') {
      // Authentic board-formed poured concrete monolith with shuttering grain & tie-rod dimples
      const boards = 8;
      const boardH = 512 / boards;
      for (let b = 0; b < boards; b++) {
        ctx.fillStyle = shiftHex(wallHex, ((b % 3) - 1) * 0.014);
        ctx.fillRect(0, b * boardH, 512, boardH);
        ctx.strokeStyle = shiftHex(wallHex, -0.042);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, b * boardH);
        ctx.lineTo(512, b * boardH);
        ctx.stroke();
      }
      // Mineral concrete mottling
      for (let i = 0; i < 85; i++) {
        const x = (i * 97) % 512;
        const y = (i * 193) % 512;
        const rad = 28 + (i % 4) * 16;
        const grad = ctx.createRadialGradient(x, y, 2, x, y, rad);
        grad.addColorStop(0, shiftHex(wallHex, i % 2 === 0 ? 0.024 : -0.026));
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.globalAlpha = 0.34;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Vertical formwork slab joints & cast tie-rod cone holes
      ctx.strokeStyle = shiftHex(wallHex, -0.065);
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, 254, 510);
      ctx.strokeRect(257, 1, 254, 510);

      const tieCoords = [
        [56, 112],
        [200, 112],
        [56, 400],
        [200, 400],
        [312, 112],
        [456, 112],
        [312, 400],
        [456, 400],
      ];
      for (const [tx, ty] of tieCoords) {
        ctx.fillStyle = shiftHex(wallHex, -0.11);
        ctx.beginPath();
        ctx.arc(tx, ty, 4.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = shiftHex(wallHex, 0.03);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    } else if (archetype === 'warm_artisanal_atelier') {
      // Warm rammed-earth / hand-troweled clay & sand strata plaster
      for (let s = 0; s < 16; s++) {
        const sy = (s / 16) * 512;
        const grad = ctx.createLinearGradient(0, sy, 0, sy + 42);
        grad.addColorStop(0, shiftHex(wallHex, ((s % 3) - 1) * 0.018));
        grad.addColorStop(1, shiftHex(wallHex, (((s + 1) % 3) - 1) * 0.016));
        ctx.fillStyle = grad;
        ctx.globalAlpha = 0.55;
        ctx.fillRect(0, sy, 512, 42);
      }
      for (let i = 0; i < 110; i++) {
        const x = (i * 103) % 512;
        const y = (i * 181) % 512;
        const rad = 32 + (i % 5) * 16;
        const grad = ctx.createRadialGradient(x, y, 2, x, y, rad);
        grad.addColorStop(0, shiftHex(wallHex, i % 2 === 0 ? 0.022 : -0.024));
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.globalAlpha = 0.28;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else {
      // Venetian limewash plaster clouding
      for (let i = 0; i < 120; i++) {
        const x = (i * 97) % 512;
        const y = (i * 193) % 512;
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
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 2);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAniso;
    return tex;
  });
}

/**
 * Fast, cached procedural natural oak / timber grain texture for warm_artisanal_atelier
 */
function getProceduralTimberTexture(oakHex: string, maxAniso: number): THREE.CanvasTexture {
  const key = `timber|${oakHex}|${maxAniso}`;
  return getCachedCanvasTexture(key, () => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = oakHex;
    ctx.fillRect(0, 0, 256, 512);

    for (let i = 0; i < 42; i++) {
      const gx = (i / 42) * 256;
      ctx.strokeStyle = shiftHex(oakHex, i % 2 === 0 ? -0.032 : 0.022);
      ctx.lineWidth = 1.2 + (i % 3) * 0.6;
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.bezierCurveTo(
        gx + ((i % 3) - 1) * 4,
        170,
        gx - ((i % 3) - 1) * 4,
        340,
        gx,
        512
      );
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAniso;
    return tex;
  });
}

/**
 * Fast, cached vertical fluted panel texture in `accentHex`
 */
function getProceduralFlutedTexture(accentHex: string, maxAniso: number): THREE.CanvasTexture {
  const key = `fluted|${accentHex}|${maxAniso}`;
  return getCachedCanvasTexture(key, () => {
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
  });
}

/**
 * Fast, cached area rug / architectural floor mat textures per archetype
 */
function getRugTextures(
  rugHex: string,
  borderHex: string,
  accentHex: string,
  archetype: WorldArchetypeId,
  maxAniso: number
): { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  const mapKey = `rug-map|${archetype}|${rugHex}|${borderHex}|${accentHex}|${maxAniso}`;
  const bumpKey = `rug-bump|${archetype}`;

  const map = getCachedCanvasTexture(mapKey, () => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = rugHex;
    ctx.fillRect(0, 0, 512, 512);

    if (archetype === 'minimalist_tech_pavilion') {
      // Precision linear micro-ribbed monochrome architectural mat
      for (let y = 0; y < 512; y += 4) {
        ctx.fillStyle = shiftHex(rugHex, y % 8 === 0 ? 0.014 : -0.014);
        ctx.fillRect(0, y, 512, 2);
      }
      ctx.strokeStyle = borderHex;
      ctx.lineWidth = 6;
      ctx.strokeRect(14, 14, 484, 484);
      ctx.strokeStyle = accentHex;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 2;
      ctx.strokeRect(24, 24, 464, 464);
      ctx.globalAlpha = 1;
    } else if (archetype === 'avant_garde_concrete_loft') {
      // Industrial gallery mat with geometric corner registration marks
      for (let y = 0; y < 512; y += 8) {
        for (let x = 0; x < 512; x += 8) {
          ctx.fillStyle = shiftHex(rugHex, ((x + y) % 16 === 0 ? 1 : -1) * 0.015);
          ctx.fillRect(x, y, 6, 6);
        }
      }
      ctx.strokeStyle = borderHex;
      ctx.lineWidth = 10;
      ctx.strokeRect(16, 16, 480, 480);
      // Corner brutalist registration ticks in accentHex
      ctx.fillStyle = accentHex;
      ctx.fillRect(16, 16, 36, 6);
      ctx.fillRect(16, 16, 6, 36);
      ctx.fillRect(460, 16, 36, 6);
      ctx.fillRect(490, 16, 6, 36);
      ctx.fillRect(16, 490, 36, 6);
      ctx.fillRect(16, 460, 6, 36);
      ctx.fillRect(460, 490, 36, 6);
      ctx.fillRect(490, 460, 6, 36);
    } else if (archetype === 'warm_artisanal_atelier') {
      // Woven natural jute / herringbone craft weave
      for (let y = 0; y < 512; y += 8) {
        for (let x = 0; x < 512; x += 12) {
          const jitter = (((x * 13 + y * 29) % 7) - 3) * 0.013;
          ctx.fillStyle = shiftHex(rugHex, jitter);
          ctx.fillRect(x, y, 10, 6);
        }
      }
      ctx.strokeStyle = shiftHex(rugHex, -0.08);
      ctx.lineWidth = 16;
      ctx.strokeRect(16, 16, 480, 480);
    } else {
      // Classic woven bouclé slub rug
      for (let y = 0; y < 512; y += 6) {
        for (let x = 0; x < 512; x += 8) {
          const jitter = ((x * 31 + y * 17) % 7) - 3;
          ctx.fillStyle = shiftHex(rugHex, jitter * 0.011);
          ctx.fillRect(x, y, 6, 4);
        }
      }
      ctx.strokeStyle = borderHex;
      ctx.lineWidth = 14;
      ctx.strokeRect(18, 18, 476, 476);
    }

    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAniso;
    return t;
  });

  const bumpMap = getCachedCanvasTexture(bumpKey, () => {
    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = 128;
    bumpCanvas.height = 128;
    const bCtx = bumpCanvas.getContext('2d')!;
    bCtx.fillStyle = '#808080';
    bCtx.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 4) {
      for (let x = 0; x < 128; x += 4) {
        const v = 112 + ((x * 19 + y * 37) % 42);
        bCtx.fillStyle = `rgb(${v},${v},${v})`;
        bCtx.fillRect(x, y, 3, 3);
      }
    }
    const bt = new THREE.CanvasTexture(bumpCanvas);
    bt.wrapS = THREE.RepeatWrapping;
    bt.wrapT = THREE.RepeatWrapping;
    bt.repeat.set(8, 6);
    return bt;
  });

  return { map, bumpMap };
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
 * Fast, cached bespoke framed gallery exhibition lithograph auto-generated dynamically
 * from `config.brandName`, `config.tagline`, `config.archetype`, and `config.palette`
 * whenever `config.textures.posterUrl` is empty!
 */
function getProceduralPosterTexture(
  config: StoreConfig,
  archetype: WorldArchetypeId,
  maxAniso: number
): THREE.CanvasTexture {
  const key = [
    'poster',
    archetype,
    config.brandName,
    config.tagline,
    config.palette.wall,
    config.palette.accent,
    config.palette.rackMetal,
    maxAniso,
  ].join('|');

  return getCachedCanvasTexture(key, () => {
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d')!;

    const isDark = getLuminance(config.palette.wall) < 0.36;
    const paperBg =
      archetype === 'minimalist_tech_pavilion'
        ? isDark
          ? '#12151C'
          : '#F4F6FA'
        : archetype === 'avant_garde_concrete_loft'
          ? '#17181B'
          : '#F5EFE4';
    const inkPrimary =
      paperBg.startsWith('#1') ? '#F3F5FA' : '#262925';
    const accent = config.palette.accent;
    const metal = config.palette.rackMetal;

    ctx.fillStyle = paperBg;
    ctx.fillRect(0, 0, 768, 1024);

    if (archetype === 'minimalist_tech_pavilion') {
      // Swiss-grid precision orbital & technical CAD diagram
      ctx.strokeStyle = shiftHex(paperBg, isDark ? 0.12 : -0.1);
      ctx.lineWidth = 1.5;
      for (let gx = 96; gx <= 672; gx += 96) {
        ctx.beginPath();
        ctx.moveTo(gx, 96);
        ctx.lineTo(gx, 672);
        ctx.stroke();
      }
      for (let gy = 96; gy <= 672; gy += 96) {
        ctx.beginPath();
        ctx.moveTo(96, gy);
        ctx.lineTo(672, gy);
        ctx.stroke();
      }
      ctx.strokeStyle = accent;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(384, 384, 176, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = inkPrimary;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(384, 384, 108, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(384 + 176 * Math.cos(-0.65), 384 + 176 * Math.sin(-0.65), 11, 0, Math.PI * 2);
      ctx.fill();
    } else if (archetype === 'avant_garde_concrete_loft') {
      // Bold brutalist constructivist monolith block print
      ctx.fillStyle = accent;
      ctx.fillRect(116, 130, 536, 330);
      ctx.fillStyle = paperBg;
      ctx.beginPath();
      ctx.arc(384, 295, 102, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = inkPrimary;
      ctx.lineWidth = 6;
      ctx.strokeRect(116, 492, 536, 176);
      ctx.beginPath();
      ctx.moveTo(116, 580);
      ctx.lineTo(652, 580);
      ctx.moveTo(384, 492);
      ctx.lineTo(384, 668);
      ctx.stroke();
    } else if (archetype === 'warm_artisanal_atelier') {
      // Organic Kyoto / Mediterranean ceramic & botanical line study
      ctx.strokeStyle = shiftHex(accent, 0.04);
      ctx.lineWidth = 2.5;
      ctx.strokeRect(56, 56, 656, 912);

      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.18;
      ctx.beginPath();
      ctx.arc(384, 355, 168, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.strokeStyle = accent;
      ctx.lineWidth = 18;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(384, 375, 142, 0.28, Math.PI * 1.85);
      ctx.stroke();

      // Minimalist botanical stem arc
      ctx.strokeStyle = inkPrimary;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(310, 585);
      ctx.quadraticCurveTo(388, 390, 462, 235);
      ctx.stroke();
    } else {
      // Heritage Arch Flagship: Archival architectural arch & court crest lithograph
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3;
      ctx.strokeRect(46, 46, 676, 932);
      ctx.strokeStyle = metal;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(60, 60, 648, 904);

      // Classical arch + court geometry
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(234, 640);
      ctx.lineTo(234, 320);
      ctx.arc(384, 320, 150, Math.PI, 0, false);
      ctx.lineTo(534, 640);
      ctx.closePath();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(234, 445);
      ctx.lineTo(534, 445);
      ctx.moveTo(384, 290);
      ctx.lineTo(384, 600);
      ctx.stroke();

      ctx.strokeStyle = metal;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(384, 445, 92, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Dynamic Brand Typography
    const fontFamily =
      archetype === 'minimalist_tech_pavilion' || archetype === 'avant_garde_concrete_loft'
        ? '700 38px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        : '600 36px Georgia, "Times New Roman", serif';

    ctx.fillStyle = inkPrimary;
    ctx.font = fontFamily;
    drawTrackedCanvasText(ctx, config.brandName.toUpperCase(), 384, 778, 5, 620);

    ctx.fillStyle = accent;
    ctx.font = '600 17px system-ui, -apple-system, sans-serif';
    drawTrackedCanvasText(ctx, config.tagline.toUpperCase(), 384, 832, 3, 620);

    ctx.fillStyle = metal;
    ctx.font = '500 13px system-ui, -apple-system, sans-serif';
    const plateLabel =
      archetype === 'minimalist_tech_pavilion'
        ? 'SYSTEMS SPECIMEN · EDITION 01'
        : archetype === 'avant_garde_concrete_loft'
          ? 'MONOLITH EXHIBITION · ARCHIVE 01'
          : archetype === 'warm_artisanal_atelier'
            ? 'ATELIER MATERIAL STUDY · NO. 01'
            : 'ARCHIVAL FLAGSHIP · PLATE 01';
    drawTrackedCanvasText(ctx, plateLabel, 384, 886, 4, 620);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAniso;
    return tex;
  });
}

/**
 * High-DPI 2048×512 Brand Signage Canvas Plane supporting 4 distinct architectural typographies
 */
function ArchetypeBrandSignagePlane({
  brandName,
  tagline,
  textColor,
  subColor,
  accentColor,
  variant,
  width = 1.76,
  height = 0.44,
  zOffset = 0.021,
}: {
  brandName: string;
  tagline: string;
  textColor: string;
  subColor: string;
  accentColor: string;
  variant: WorldArchetypeId;
  width?: number;
  height?: number;
  zOffset?: number;
}) {
  const tex = useMemo(() => {
    const key = `signage|${variant}|${brandName}|${tagline}|${textColor}|${subColor}|${accentColor}`;
    return getCachedCanvasTexture(key, () => {
      const canvas = document.createElement('canvas');
      canvas.width = 2048;
      canvas.height = 512;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, 2048, 512);

      if (variant === 'minimalist_tech_pavilion') {
        // Precision sans-serif tech lab monolith typography + optical corner reticles
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 4;
        const m = 34;
        const len = 32;
        // Top-left & top-right reticles
        ctx.beginPath();
        ctx.moveTo(m, m + len);
        ctx.lineTo(m, m);
        ctx.lineTo(m + len, m);
        ctx.moveTo(2048 - m - len, m);
        ctx.lineTo(2048 - m, m);
        ctx.lineTo(2048 - m, m + len);
        ctx.moveTo(m, 512 - m - len);
        ctx.lineTo(m, 512 - m);
        ctx.lineTo(m + len, 512 - m);
        ctx.moveTo(2048 - m - len, 512 - m);
        ctx.lineTo(2048 - m, 512 - m);
        ctx.lineTo(2048 - m, 512 - m - len);
        ctx.stroke();

        ctx.fillStyle = textColor;
        ctx.font = '600 112px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        drawTrackedCanvasText(ctx, brandName.toUpperCase(), 1024, 194, 28, 1820);

        ctx.fillStyle = accentColor;
        ctx.fillRect(812, 284, 424, 4);

        ctx.fillStyle = subColor;
        ctx.font = '500 36px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        drawTrackedCanvasText(ctx, tagline.toUpperCase(), 1024, 372, 12, 1820);
      } else if (variant === 'avant_garde_concrete_loft') {
        // Bold industrial brutalist stencil/grotesque banner + accent bar
        ctx.fillStyle = accentColor;
        ctx.fillRect(68, 72, 18, 368);
        ctx.fillRect(1962, 72, 18, 368);

        ctx.fillStyle = textColor;
        ctx.font = '800 124px "Arial Black", Impact, system-ui, sans-serif';
        drawTrackedCanvasText(ctx, brandName.toUpperCase(), 1024, 194, 18, 1760);

        ctx.fillStyle = accentColor;
        ctx.fillRect(664, 294, 720, 8);

        ctx.fillStyle = subColor;
        ctx.font = '700 38px system-ui, -apple-system, monospace, sans-serif';
        drawTrackedCanvasText(ctx, tagline.toUpperCase(), 1024, 384, 10, 1760);
      } else if (variant === 'warm_artisanal_atelier') {
        // Refined humanist serif craft plaque
        ctx.fillStyle = textColor;
        ctx.font = '500 110px Georgia, "Times New Roman", serif';
        drawTrackedCanvasText(ctx, brandName.toUpperCase(), 1024, 192, 26, 1820);

        ctx.fillStyle = subColor;
        ctx.font = '500 36px system-ui, -apple-system, sans-serif';
        drawTrackedCanvasText(ctx, tagline.toUpperCase(), 1024, 376, 11, 1820);
      } else {
        // Heritage Arch Flagship classic serif typography
        ctx.fillStyle = textColor;
        ctx.font = '600 116px Georgia, "Times New Roman", serif';
        drawTrackedCanvasText(ctx, brandName.toUpperCase(), 1024, 190, 22, 1840);

        ctx.fillStyle = subColor;
        ctx.font = '600 38px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        drawTrackedCanvasText(ctx, tagline.toUpperCase(), 1024, 382, 9, 1840);
      }

      const t = new THREE.CanvasTexture(canvas);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      t.needsUpdate = true;
      return t;
    });
  }, [brandName, tagline, textColor, subColor, accentColor, variant]);

  return (
    <mesh position={[0, 0, zOffset]}>
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial
        map={tex}
        emissive="#ffffff"
        emissiveMap={tex}
        emissiveIntensity={variant === 'minimalist_tech_pavilion' ? 0.34 : 0.2}
        roughness={0.78}
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
        return { dreiPreset: 'city' as const, intensity: 0.44 };
      case 'kyoto_golden_hour':
        return { dreiPreset: 'studio' as const, intensity: 0.36 };
      case 'warm_court_sunlight':
      default:
        return { dreiPreset: 'apartment' as const, intensity: 0.36 };
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
 * Studio Lighting Rig calibrated per WorldArchetypeId & LightingPreset
 * Includes 2048x2048 shadow key spot + dedicated fill across hero rack & all 3 display anchors.
 */
function StudioLightingRig({
  config,
  archetype,
}: {
  config: StoreConfig;
  archetype: WorldArchetypeId;
}) {
  const spotTarget = useMemo(() => {
    const obj = new THREE.Object3D();
    obj.position.set(0, 1.24, 0);
    return obj;
  }, []);

  const isTech = archetype === 'minimalist_tech_pavilion';
  const isLoft = archetype === 'avant_garde_concrete_loft';
  const isAtelier = archetype === 'warm_artisanal_atelier';

  const keyIntensity = isTech ? 18.0 : isLoft ? 17.5 : isAtelier ? 15.0 : 15.8;
  const ambientIntensity = isTech ? 0.42 : isLoft ? 0.34 : isAtelier ? 0.35 : 0.34;
  const featureWashColor = isTech
    ? '#DCE8FF'
    : isLoft
      ? config.palette.accent
      : isAtelier
        ? '#FFDFB0'
        : '#FFE4B5';

  return (
    <group name="studio-lighting-rig">
      <ShowroomEnvironment preset={config.lightingPreset} />
      <primitive object={spotTarget} />

      <ambientLight color={config.palette.ambientLight} intensity={ambientIntensity} />
      <hemisphereLight
        args={[config.palette.ambientLight, config.palette.floor, isTech ? 0.4 : 0.34]}
        position={[0, 4.5, 0]}
      />

      {/* Key Gallery SpotLight casting crisp 2048x2048 shadows */}
      <spotLight
        position={[0.98, 3.48, 2.1]}
        target={spotTarget}
        color={config.palette.spotLight}
        intensity={keyIntensity}
        distance={13}
        decay={1.55}
        angle={0.58}
        penumbra={0.68}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0003}
        shadow-camera-near={0.8}
        shadow-camera-far={10.5}
      />

      {/* Left-Front Fill Spot illuminating capsule rack & left_pedestal */}
      <spotLight
        position={[-1.65, 3.48, 2.15]}
        target={spotTarget}
        color={config.palette.ambientLight}
        intensity={6.5}
        distance={12}
        decay={1.6}
        angle={0.66}
        penumbra={0.85}
      />

      {/* Dedicated Merchandising Fill on center_table & right_pedestal */}
      <pointLight
        position={[2.0, 2.55, 0.1]}
        color={config.palette.spotLight}
        intensity={2.4}
        distance={4.8}
        decay={2}
      />
      {/* Dedicated Merchandising Fill on left_pedestal */}
      <pointLight
        position={[-2.45, 2.45, 0.85]}
        color={config.palette.spotLight}
        intensity={1.9}
        distance={4.2}
        decay={2}
      />

      {/* Rim & Sculpting Directional Lights */}
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
        intensity={0.28}
      />

      {/* Feature Wall Cove / Neon / Louver Architectural Wash Lights */}
      <pointLight
        position={[0, 2.4, -1.82]}
        color={featureWashColor}
        intensity={isLoft ? 1.8 : 1.35}
        distance={4.0}
        decay={2}
      />
      <pointLight
        position={[-1.45, 1.65, -1.82]}
        color={featureWashColor}
        intensity={isLoft ? 2.1 : 1.25}
        distance={3.5}
        decay={2}
      />
      <pointLight
        position={[1.45, 1.65, -1.82]}
        color={featureWashColor}
        intensity={isLoft ? 2.4 : 1.25}
        distance={3.5}
        decay={2}
      />

      <ContactShadows
        position={[0, 0.005, 0.15]}
        opacity={0.44}
        scale={11}
        blur={2.2}
        far={4}
        resolution={512}
      />
    </group>
  );
}

/**
 * Shared Fully Enclosed Gallery Perimeter Shell (`x ∈ [-4.85, 4.85], z ∈ [-2.15, 7.9], y ∈ [0, 4.6]`)
 * Ensures 360° orbit & first-person walkthrough cameras stay inside tailored architecture.
 */
function EnclosedPerimeterWalls({
  wallMap,
  ceilingColor,
  trimColor,
  roughness = 0.86,
  showClassicalMoldings = false,
}: {
  wallMap: THREE.Texture;
  ceilingColor: string;
  trimColor: string;
  roughness?: number;
  showClassicalMoldings?: boolean;
}) {
  return (
    <group name="enclosed-perimeter-walls">
      {/* Left, Right & Front Gallery Walls */}
      <mesh position={[-4.85, 2.3, 2.85]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[10.3, 4.6]} />
        <meshStandardMaterial map={wallMap} color="#ffffff" roughness={roughness} />
      </mesh>
      <mesh position={[4.85, 2.3, 2.85]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[10.3, 4.6]} />
        <meshStandardMaterial map={wallMap} color="#ffffff" roughness={roughness} />
      </mesh>
      <mesh position={[0, 2.3, 7.9]} rotation={[0, Math.PI, 0]} receiveShadow>
        <planeGeometry args={[10.0, 4.6]} />
        <meshStandardMaterial map={wallMap} color="#ffffff" roughness={roughness} />
      </mesh>

      {/* Side & Front Baseboards / Shadow Plinths */}
      <mesh position={[-4.83, 0.07, 2.85]} receiveShadow>
        <boxGeometry args={[0.032, 0.14, 10.3]} />
        <meshStandardMaterial color={trimColor} roughness={0.62} />
      </mesh>
      <mesh position={[4.83, 0.07, 2.85]} receiveShadow>
        <boxGeometry args={[0.032, 0.14, 10.3]} />
        <meshStandardMaterial color={trimColor} roughness={0.62} />
      </mesh>
      <mesh position={[0, 0.07, 7.88]} receiveShadow>
        <boxGeometry args={[9.72, 0.14, 0.032]} />
        <meshStandardMaterial color={trimColor} roughness={0.62} />
      </mesh>

      {showClassicalMoldings && (
        <>
          <mesh position={[0, 4.5, -1.8]} receiveShadow>
            <boxGeometry args={[11.6, 0.16, 0.12]} />
            <meshStandardMaterial color={ceilingColor} roughness={0.75} />
          </mesh>
          <mesh position={[0, 4.5, 7.85]} receiveShadow>
            <boxGeometry args={[9.8, 0.16, 0.12]} />
            <meshStandardMaterial color={ceilingColor} roughness={0.75} />
          </mesh>
          <mesh position={[-4.8, 4.5, 2.85]} receiveShadow>
            <boxGeometry args={[0.12, 0.16, 10.3]} />
            <meshStandardMaterial color={ceilingColor} roughness={0.75} />
          </mesh>
          <mesh position={[4.8, 4.5, 2.85]} receiveShadow>
            <boxGeometry args={[0.12, 0.16, 10.3]} />
            <meshStandardMaterial color={ceilingColor} roughness={0.75} />
          </mesh>
        </>
      )}

      {/* Overhead Architectural Ceiling Plane spanning full enclosed room */}
      <mesh position={[0, 4.58, 2.88]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[10.4, 10.4]} />
        <meshStandardMaterial color={ceilingColor} roughness={0.9} />
      </mesh>
    </group>
  );
}

/**
 * Framed Exhibition Print adaptable to each archetype's frame materiality & placement
 */
function FramedExhibitionArt({
  config,
  posterMap,
  archetype,
  position = [-2.32, 1.88, -1.815],
  rotationY = 0,
}: {
  config: StoreConfig;
  posterMap: THREE.Texture;
  archetype: WorldArchetypeId;
  position?: [number, number, number];
  rotationY?: number;
}) {
  const isTech = archetype === 'minimalist_tech_pavilion';
  const isLoft = archetype === 'avant_garde_concrete_loft';
  const isAtelier = archetype === 'warm_artisanal_atelier';

  const frameColor = isTech
    ? config.palette.rackMetal
    : isLoft
      ? '#151619'
      : isAtelier
        ? resolveWarmOakHex(config.palette.hangerWood)
        : config.palette.hangerWood;

  const frameMetalness = isTech ? 0.85 : isLoft ? 0.55 : 0.06;
  const frameRoughness = isTech ? 0.24 : isLoft ? 0.38 : 0.52;
  const matColor = isTech || isLoft ? '#1E2128' : '#F7F3EA';

  return (
    <group position={position} rotation={[0, rotationY, 0]} name="framed-exhibition-art">
      {/* Outer Architectural Gallery Frame */}
      <RoundedBox
        args={[0.92, 1.2, 0.04]}
        radius={isTech || isLoft ? 0.003 : 0.008}
        smoothness={3}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          color={frameColor}
          roughness={frameRoughness}
          metalness={frameMetalness}
        />
      </RoundedBox>

      {/* Inner Bezel Fillet */}
      <mesh position={[0, 0, 0.017]}>
        <boxGeometry args={[0.84, 1.12, 0.012]} />
        <meshStandardMaterial
          color={isLoft ? config.palette.accent : config.palette.rackMetal}
          metalness={Math.min(0.76, config.metalness)}
          roughness={Math.max(0.32, config.metalRoughness)}
        />
      </mesh>

      {/* Archival Conservation Matboard */}
      <mesh position={[0, 0, 0.022]}>
        <planeGeometry args={[0.81, 1.09]} />
        <meshStandardMaterial color={matColor} roughness={0.94} />
      </mesh>

      {/* 3:4 Dynamic Brand Exhibition Print */}
      <mesh position={[0, 0, 0.024]}>
        <planeGeometry args={[0.73, 0.973]} />
        <meshStandardMaterial map={posterMap} color="#ffffff" roughness={0.84} metalness={0.02} />
      </mesh>

      {/* Anti-Reflective Low-Iron Glazing */}
      <mesh position={[0, 0, 0.026]}>
        <planeGeometry args={[0.81, 1.09]} />
        <meshPhysicalMaterial
          color="#ffffff"
          transparent
          opacity={0.035}
          roughness={0.28}
          metalness={0.04}
          clearcoat={0.14}
          depthWrite={false}
        />
      </mesh>

      {/* Top Picture-Light Fixture */}
      <group position={[0, 0.68, 0.038]}>
        <mesh position={[0, 0.012, 0.05]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.007, 0.007, 0.14, 10]} />
          <meshStandardMaterial
            color={config.palette.rackMetal}
            metalness={0.78}
            roughness={0.32}
          />
        </mesh>
        <mesh position={[0, 0.008, 0.12]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.018, 0.018, 0.42, 16]} />
          <meshStandardMaterial
            color={isLoft ? '#18191C' : config.palette.rackMetal}
            metalness={0.78}
            roughness={0.32}
          />
        </mesh>
        <mesh position={[0, -0.008, 0.12]}>
          <boxGeometry args={[0.36, 0.006, 0.014]} />
          <meshBasicMaterial
            color={isTech || isLoft ? '#EAF2FF' : '#FFEAC2'}
            toneMapped={false}
          />
        </mesh>
      </group>
    </group>
  );
}

/* ============================================================================
   ARCHETYPE 1: MINIMALIST TECH PAVILION (Apple Park / Linear / Acne Metal Lab)
   - Floor-to-ceiling matte obsidian/anodized aluminum architectural slat & panel grid
   - Crisp vertical recessed cool-LED light channels
   - Floating backlit smoked-glass & brushed-metal brand monolith sign
   - Luminous 4×3 coffered frosted daylight light-panel ceiling grid
   - Cantilevered steel & smoked-glass center table + cylindrical metal pedestals
   ============================================================================ */
function MinimalistTechPavilionWorld({
  config,
  wallMap,
  posterMap,
}: {
  config: StoreConfig;
  wallMap: THREE.Texture;
  posterMap: THREE.Texture;
}) {
  const isDark = getLuminance(config.palette.wall) < 0.38;
  const obsidianBase = isDark ? config.palette.wall : shiftHex(config.palette.wall, -0.08);
  const slatHex = isDark
    ? shiftHex(config.palette.wall, 0.065)
    : shiftHex(config.palette.wall, -0.04);
  const metalHex = config.palette.rackMetal;
  const accentHex = config.palette.accent;

  // 26 precision vertical anodized fins across center feature zone x ∈ [-1.68, 1.68]
  const verticalSlats = useMemo(() => {
    const xs: number[] = [];
    for (let x = -1.68; x <= 1.681; x += 0.12) {
      xs.push(Number(x.toFixed(3)));
    }
    return xs;
  }, []);

  // 6 crisp vertical recessed cool-LED light channels dividing the back wall
  const ledChannelXs = [-3.56, -1.84, -0.92, 0.92, 1.84, 3.56];

  // 4×3 luminous frosted daylight ceiling coffer grid
  const cofferCols = [-2.25, -0.75, 0.75, 2.25];
  const cofferRows = [-0.65, 0.95, 2.55];

  return (
    <group name="minimalist-tech-pavilion-world">
      <EnclosedPerimeterWalls
        wallMap={wallMap}
        ceilingColor={isDark ? '#181B22' : '#EAECEF'}
        trimColor={metalHex}
        roughness={0.46}
        showClassicalMoldings={false}
      />

      {/* Side-Wall Frosted Vertical Architectural Light Pilasters (for 360° immersion) */}
      {[-4.81, 4.81].map((sx, idx) => (
        <React.Fragment key={idx}>
          {[0.4, 3.6].map((sz, jdx) => (
            <group key={jdx} position={[sx, 2.25, sz]}>
              <mesh>
                <boxGeometry args={[0.04, 4.1, 0.12]} />
                <meshStandardMaterial color={metalHex} metalness={0.86} roughness={0.22} />
              </mesh>
              <mesh position={[sx < 0 ? 0.022 : -0.022, 0, 0]}>
                <planeGeometry args={[0.045, 3.92]} />
                <meshBasicMaterial
                  color="#EAF2FF"
                  toneMapped={false}
                  side={THREE.DoubleSide}
                />
              </mesh>
            </group>
          ))}
        </React.Fragment>
      ))}

      {/* =====================================================================
          BACK FEATURE WALL (z = -2.0): Anodized Panel & Slat Grid + LED Channels
         ===================================================================== */}
      <group name="tech-pavilion-back-wall">
        {/* Deep Matte Obsidian / Anodized Backing Plane */}
        <mesh position={[0, 2.3, -2.04]} receiveShadow>
          <planeGeometry args={[10.0, 4.6]} />
          <meshStandardMaterial
            map={wallMap}
            color="#ffffff"
            roughness={0.48}
            metalness={0.32}
          />
        </mesh>

        {/* Flanking Modular Anodized Aluminum Architectural Wall Panels */}
        {[-4.2, -2.7, 2.7, 4.2].map((px, idx) => (
          <mesh key={idx} position={[px, 2.28, -1.97]} receiveShadow>
            <boxGeometry args={[1.36, 4.44, 0.06]} />
            <meshStandardMaterial
              color={obsidianBase}
              roughness={0.38}
              metalness={0.45}
            />
          </mesh>
        ))}

        {/* Horizontal Precision Transom Reveal Bars across Back Wall */}
        {[1.38, 3.18].map((ty, idx) => (
          <mesh key={idx} position={[0, ty, -1.936]}>
            <boxGeometry args={[9.68, 0.018, 0.025]} />
            <meshStandardMaterial color={metalHex} metalness={0.9} roughness={0.2} />
          </mesh>
        ))}

        {/* Central Floor-to-Ceiling Anodized Slat & Fin Array */}
        <group position={[0, 2.26, -1.965]}>
          {verticalSlats.map((sx, idx) => (
            <mesh key={idx} position={[sx, 0, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.036, 4.4, 0.095]} />
              <meshStandardMaterial
                color={slatHex}
                metalness={0.62}
                roughness={0.28}
              />
            </mesh>
          ))}
        </group>

        {/* Crisp Vertical Recessed Cool-LED Light Channels */}
        {ledChannelXs.map((lx, idx) => (
          <group key={idx} position={[lx, 2.28, -1.945]}>
            {/* Anodized Aluminum Channel Housing */}
            <mesh>
              <boxGeometry args={[0.064, 4.44, 0.05]} />
              <meshStandardMaterial color="#0F1116" metalness={0.8} roughness={0.24} />
            </mesh>
            {/* Glowing Frosted Cool-Daylight LED Strip */}
            <mesh position={[0, 0, 0.026]}>
              <planeGeometry args={[0.026, 4.34]} />
              <meshBasicMaterial
                color={idx === 2 || idx === 3 ? accentHex : '#EAF2FF'}
                toneMapped={false}
              />
            </mesh>
          </group>
        ))}

        {/* Recessed Brushed-Steel Floor Shadow-Gap Grazing Threshold */}
        <mesh position={[0, 0.022, -1.92]} receiveShadow>
          <boxGeometry args={[9.7, 0.044, 0.18]} />
          <meshStandardMaterial color={metalHex} metalness={0.88} roughness={0.22} />
        </mesh>

        {/* Floating Backlit Smoked-Glass & Brushed-Metal Brand Monolith Sign */}
        <group position={[0, 2.48, -1.855]} name="tech-monolith-signage">
          {/* Cool Optical Halo Back-Glow */}
          <mesh position={[0, 0, -0.022]}>
            <planeGeometry args={[2.36, 0.62]} />
            <meshBasicMaterial
              color={accentHex}
              transparent
              opacity={0.42}
              toneMapped={false}
            />
          </mesh>

          {/* Precision Machined Brushed-Metal Chassis Frame */}
          <RoundedBox args={[2.26, 0.54, 0.032]} radius={0.008} smoothness={3} castShadow>
            <meshStandardMaterial color={metalHex} metalness={0.92} roughness={0.18} />
          </RoundedBox>

          {/* Smoked Obsidian Architectural Glass Faceplate */}
          <RoundedBox
            args={[2.2, 0.485, 0.036]}
            radius={0.006}
            smoothness={3}
            position={[0, 0, 0.005]}
          >
            <meshPhysicalMaterial
              color="#0D1017"
              roughness={0.14}
              metalness={0.18}
              clearcoat={0.9}
              clearcoatRoughness={0.12}
            />
          </RoundedBox>

          {/* Razor-Sharp Technical Brand Typography */}
          <ArchetypeBrandSignagePlane
            brandName={config.brandName}
            tagline={config.tagline}
            textColor="#F6F8FC"
            subColor={metalHex}
            accentColor={accentHex}
            variant="minimalist_tech_pavilion"
            width={2.12}
            height={0.46}
            zOffset={0.025}
          />
        </group>

        {/* Framed Technical Specimen Art on Left Anodized Panel Bay */}
        <FramedExhibitionArt
          config={config}
          posterMap={posterMap}
          archetype="minimalist_tech_pavilion"
          position={[-2.7, 1.9, -1.91]}
        />
      </group>

      {/* =====================================================================
          CEILING RIG: Luminous 4×3 Coffered Frosted Daylight Light-Panel Grid
         ===================================================================== */}
      <group position={[0, 4.24, 0]} name="tech-coffered-light-ceiling">
        {/* Outer Anodized Aluminum Suspended Ceiling Perimeter Frame */}
        <mesh position={[0, 0.08, 0.95]}>
          <boxGeometry args={[6.3, 0.16, 5.05]} />
          <meshStandardMaterial color="#151820" metalness={0.78} roughness={0.28} />
        </mesh>

        {/* 12 Luminous Frosted Architectural Daylight Panels (4 cols × 3 rows) */}
        {cofferCols.map((cx, ci) =>
          cofferRows.map((cz, ri) => (
            <group key={`${ci}-${ri}`} position={[cx, -0.005, cz]}>
              {/* Brushed-Metal Coffer Bezel Trim */}
              <mesh>
                <boxGeometry args={[1.38, 0.045, 1.44]} />
                <meshStandardMaterial color={metalHex} metalness={0.86} roughness={0.24} />
              </mesh>
              {/* Frosted Glowing Daylight Diffuser Panel */}
              <mesh position={[0, -0.024, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <planeGeometry args={[1.26, 1.32]} />
                <meshBasicMaterial color="#F2F6FF" toneMapped={false} />
              </mesh>
            </group>
          ))
        )}
      </group>

      {/* =====================================================================
          STANDARDIZED DISPLAY FIXTURES (Exact Anchor Tops!)
         ===================================================================== */}
      {/* 1. CENTER TABLE ([1.55, 0, 0.65], exact top y = 0.78) */}
      <group position={[1.55, 0, 0.65]} name="fixture-center-table">
        {/* Low-Profile Brushed-Steel Cantilever Base Plate */}
        <mesh position={[0, 0.012, 0]} receiveShadow>
          <boxGeometry args={[0.84, 0.024, 0.48]} />
          <meshStandardMaterial color={metalHex} metalness={0.9} roughness={0.2} />
        </mesh>
        {/* Cantilevered Twin Brushed-Steel Architectural Uprights */}
        {[-0.32, 0.32].map((lx, idx) => (
          <mesh key={idx} position={[lx, 0.38, -0.16]} castShadow receiveShadow>
            <boxGeometry args={[0.055, 0.72, 0.09]} />
            <meshStandardMaterial color={metalHex} metalness={0.92} roughness={0.18} />
          </mesh>
        ))}
        {/* Horizontal Cantilever Support Arms */}
        {[-0.32, 0.32].map((lx, idx) => (
          <mesh key={idx} position={[lx, 0.73, 0.01]} castShadow>
            <boxGeometry args={[0.05, 0.028, 0.42]} />
            <meshStandardMaterial color={metalHex} metalness={0.92} roughness={0.18} />
          </mesh>
        ))}
        {/* Machined Aluminum Perimeter Bezel + Subtle LED Edge */}
        <mesh position={[0, 0.752, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.94, 0.024, 0.56]} />
          <meshStandardMaterial color={metalHex} metalness={0.9} roughness={0.2} />
        </mesh>
        {/* Smoked Architectural Glass Top Deck -> Exact top at 0.772 + 0.008 = 0.780 */}
        <mesh position={[0, 0.772, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.92, 0.016, 0.54]} />
          <meshPhysicalMaterial
            color="#151922"
            roughness={0.12}
            metalness={0.15}
            clearcoat={0.95}
            clearcoatRoughness={0.1}
          />
        </mesh>
      </group>

      {/* 2. RIGHT PEDESTAL ([2.35, 0, -0.85], exact top y = 0.96) */}
      <group position={[2.35, 0, -0.85]} name="fixture-right-pedestal">
        {/* Glowing Accent Shadow-Gap Base */}
        <mesh position={[0, 0.012, 0]}>
          <cylinderGeometry args={[0.235, 0.245, 0.024, 36]} />
          <meshBasicMaterial color={accentHex} toneMapped={false} />
        </mesh>
        {/* Cylindrical Brushed-Obsidian & Anodized Metal Drum */}
        <mesh position={[0, 0.478, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.265, 0.265, 0.908, 40]} />
          <meshStandardMaterial
            color={config.palette.plinth}
            metalness={0.72}
            roughness={0.24}
          />
        </mesh>
        {/* Precision Machined Brushed-Metal Top Cap -> Exact top at 0.946 + 0.014 = 0.960 */}
        <mesh position={[0, 0.946, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.272, 0.272, 0.028, 40]} />
          <meshStandardMaterial color={metalHex} metalness={0.92} roughness={0.18} />
        </mesh>
      </group>

      {/* 3. LEFT PEDESTAL ([-2.45, 0, 0.75], exact top y = 0.92) */}
      <group position={[-2.45, 0, 0.75]} name="fixture-left-pedestal">
        <mesh position={[0, 0.012, 0]}>
          <cylinderGeometry args={[0.225, 0.235, 0.024, 36]} />
          <meshBasicMaterial color={accentHex} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.458, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.255, 0.255, 0.868, 40]} />
          <meshStandardMaterial
            color={config.palette.plinth}
            metalness={0.72}
            roughness={0.24}
          />
        </mesh>
        {/* Machined Brushed-Metal Top Cap -> Exact top at 0.906 + 0.014 = 0.920 */}
        <mesh position={[0, 0.906, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.262, 0.262, 0.028, 40]} />
          <meshStandardMaterial color={metalHex} metalness={0.92} roughness={0.18} />
        </mesh>
      </group>
    </group>
  );
}

/* ============================================================================
   ARCHETYPE 2: WARM ARTISANAL ATELIER (Aesop / Kotn / Kyoto Timber & Clay)
   - Warm rammed-earth / terracotta-sand plaster framing wide white-oak louver screen
   - Warm golden cove wash + floating timber & patinated brass signage plaque
   - Architectural oak ceiling timber beams/baffles + 3000K skylight wash
   - Corner sculptural ceramic floor amphora with dried botanical branches
   - Solid oak & honed limestone craft display table & plinths
   ============================================================================ */
function WarmArtisanalAtelierWorld({
  config,
  wallMap,
  posterMap,
  maxAniso,
}: {
  config: StoreConfig;
  wallMap: THREE.Texture;
  posterMap: THREE.Texture;
  maxAniso: number;
}) {
  const oakHex = useMemo(
    () => resolveWarmOakHex(config.palette.hangerWood),
    [config.palette.hangerWood]
  );
  const timberMap = useMemo(
    () => getProceduralTimberTexture(oakHex, maxAniso),
    [oakHex, maxAniso]
  );

  // 37 vertical white-oak architectural louvers spanning x ∈ [-2.07, 2.07]
  const louverXs = useMemo(() => {
    const xs: number[] = [];
    for (let x = -2.07; x <= 2.071; x += 0.115) {
      xs.push(Number(x.toFixed(3)));
    }
    return xs;
  }, []);

  // 11 warm oak ceiling rafters spanning the room from z = -1.55 to z = 5.45
  const rafterZs = useMemo(() => {
    const zs: number[] = [];
    for (let z = -1.55; z <= 5.46; z += 0.7) {
      zs.push(Number(z.toFixed(2)));
    }
    return zs;
  }, []);

  // Sculptural ceramic floor amphora LatheGeometry
  const amphoraGeo = useMemo(() => {
    const pts = [
      new THREE.Vector2(0.001, 0),
      new THREE.Vector2(0.11, 0),
      new THREE.Vector2(0.21, 0.16),
      new THREE.Vector2(0.245, 0.34),
      new THREE.Vector2(0.205, 0.52),
      new THREE.Vector2(0.105, 0.66),
      new THREE.Vector2(0.125, 0.74),
      new THREE.Vector2(0.098, 0.74),
      new THREE.Vector2(0.085, 0.65),
    ];
    return new THREE.LatheGeometry(pts, 32);
  }, []);

  useEffect(() => () => amphoraGeo.dispose(), [amphoraGeo]);

  const isDarkWall = getLuminance(config.palette.wall) < 0.35;

  return (
    <group name="warm-artisanal-atelier-world">
      <EnclosedPerimeterWalls
        wallMap={wallMap}
        ceilingColor={shiftHex(config.palette.wall, 0.04)}
        trimColor={oakHex}
        roughness={0.9}
        showClassicalMoldings={false}
      />

      {/* Side-Wall Architectural Timber Dado Battens for 360° Craft Warmth */}
      {[-4.82, 4.82].map((sx, idx) => (
        <mesh key={idx} position={[sx, 1.05, 2.85]} receiveShadow>
          <boxGeometry args={[0.035, 0.055, 10.2]} />
          <meshStandardMaterial map={timberMap} color="#ffffff" roughness={0.62} />
        </mesh>
      ))}

      {/* =====================================================================
          BACK FEATURE WALL (z = -2.0): Rammed-Earth Plaster + Oak Louver Screen
         ===================================================================== */}
      <group name="atelier-back-wall">
        {/* Warm Rammed-Earth / Clay Plaster Back Wall */}
        <mesh position={[0, 2.3, -2.02]} receiveShadow>
          <planeGeometry args={[10.0, 4.6]} />
          <meshStandardMaterial map={wallMap} color="#ffffff" roughness={0.92} />
        </mesh>

        {/* Deep Smoked-Clay Shadow Backing behind Oak Louvers */}
        <mesh position={[0, 1.98, -2.01]}>
          <planeGeometry args={[4.38, 3.74]} />
          <meshStandardMaterial
            color={shiftHex(config.palette.accent, -0.16)}
            roughness={0.94}
          />
        </mesh>

        {/* Solid White-Oak Architectural Box Frame around Louver Screen */}
        {/* Top Timber Lintel */}
        <mesh position={[0, 3.87, -1.93]} castShadow receiveShadow>
          <boxGeometry args={[4.56, 0.09, 0.18]} />
          <meshStandardMaterial map={timberMap} color="#ffffff" roughness={0.56} />
        </mesh>
        {/* Left & Right Timber Jamb Posts */}
        {[-2.235, 2.235].map((jx, idx) => (
          <mesh key={idx} position={[jx, 1.97, -1.93]} castShadow receiveShadow>
            <boxGeometry args={[0.09, 3.72, 0.18]} />
            <meshStandardMaterial map={timberMap} color="#ffffff" roughness={0.56} />
          </mesh>
        ))}
        {/* Honed Limestone Hearth Sill Plinth at Base of Louver Screen */}
        <mesh position={[0, 0.055, -1.91]} receiveShadow>
          <boxGeometry args={[4.62, 0.11, 0.24]} />
          <meshStandardMaterial color={config.palette.plinth} roughness={0.68} />
        </mesh>

        {/* Hidden 3000K Golden Cove Light Wash Bar under Top Oak Lintel */}
        <mesh position={[0, 3.815, -1.93]}>
          <boxGeometry args={[4.34, 0.018, 0.05]} />
          <meshBasicMaterial color="#FFE3AE" toneMapped={false} />
        </mesh>

        {/* Wide Vertical Natural White-Oak Architectural Timber Louver Screen */}
        <group position={[0, 1.96, -1.95]}>
          {louverXs.map((lx, idx) => (
            <mesh key={idx} position={[lx, 0, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.034, 3.68, 0.115]} />
              <meshStandardMaterial map={timberMap} color="#ffffff" roughness={0.58} />
            </mesh>
          ))}
        </group>

        {/* Floating Timber & Patinated Brass Artisanal Brand Plaque */}
        <group position={[0, 2.48, -1.86]} name="atelier-brand-plaque">
          {/* Warm Golden Halo Wash */}
          <RoundedBox
            args={[2.04, 0.5, 0.012]}
            radius={0.018}
            smoothness={3}
            position={[0, 0, -0.016]}
          >
            <meshBasicMaterial
              color="#FFE2AD"
              transparent
              opacity={0.42}
              toneMapped={false}
            />
          </RoundedBox>

          {/* Hand-Joined Solid Oak Outer Plaque Board */}
          <RoundedBox args={[1.98, 0.46, 0.03]} radius={0.014} smoothness={3} castShadow>
            <meshStandardMaterial map={timberMap} color="#ffffff" roughness={0.52} />
          </RoundedBox>

          {/* Inset Patinated Bronze / Earth-Slate Sign Face */}
          <RoundedBox
            args={[1.9, 0.39, 0.034]}
            radius={0.01}
            smoothness={3}
            position={[0, 0, 0.004]}
          >
            <meshStandardMaterial
              color={isDarkWall ? '#1D1B18' : '#26231F'}
              roughness={0.76}
              metalness={0.22}
            />
          </RoundedBox>

          {/* 4 Artisanal Brass Joinery Pins */}
          {[
            [-0.89, 0.15],
            [0.89, 0.15],
            [-0.89, -0.15],
            [0.89, -0.15],
          ].map(([px, py], idx) => (
            <mesh key={idx} position={[px, py, 0.023]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.009, 0.009, 0.006, 12]} />
              <meshStandardMaterial color="#C8A262" metalness={0.82} roughness={0.32} />
            </mesh>
          ))}

          {/* Crisp Humanist Serif Brand Typography */}
          <ArchetypeBrandSignagePlane
            brandName={config.brandName}
            tagline={config.tagline}
            textColor="#FAF4E8"
            subColor="#DFC394"
            accentColor={config.palette.accent}
            variant="warm_artisanal_atelier"
            width={1.82}
            height={0.42}
            zOffset={0.024}
          />
        </group>

        {/* Framed Botanical / Textile Lithograph on Left Rammed-Earth Wall Bay */}
        <FramedExhibitionArt
          config={config}
          posterMap={posterMap}
          archetype="warm_artisanal_atelier"
          position={[-3.32, 1.9, -1.96]}
        />

        {/* Right Wall Artisanal Timber & Stoneware Apothecary Shelf Detail */}
        <group position={[3.38, 1.78, -1.93]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[0.92, 0.036, 0.18]} />
            <meshStandardMaterial map={timberMap} color="#ffffff" roughness={0.55} />
          </mesh>
          {/* Small Sculptural Stoneware Vessels on Wall Shelf */}
          <mesh position={[-0.22, 0.095, 0]} castShadow>
            <cylinderGeometry args={[0.048, 0.062, 0.15, 20]} />
            <meshStandardMaterial color={config.palette.plinth} roughness={0.84} />
          </mesh>
          <mesh position={[0.04, 0.115, -0.01]} castShadow>
            <cylinderGeometry args={[0.038, 0.052, 0.19, 20]} />
            <meshStandardMaterial color={config.palette.accent} roughness={0.78} />
          </mesh>
          <mesh position={[0.25, 0.075, 0.01]} castShadow>
            <sphereGeometry args={[0.058, 18, 18]} />
            <meshStandardMaterial color="#EAE0D0" roughness={0.86} />
          </mesh>
        </group>
      </group>

      {/* =====================================================================
          CEILING RIG: Architectural Oak Timber Beams + 3000K Skylight Wash
         ===================================================================== */}
      <group position={[0, 4.02, 0]} name="atelier-oak-beam-ceiling">
        {/* Warm 3000K Shoji-Diffused Skylight Wash Plane above Timber Rafters */}
        <mesh position={[0, 0.36, 1.85]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[7.6, 7.2]} />
          <meshBasicMaterial color="#FFF0D2" toneMapped={false} />
        </mesh>

        {/* Spanning Solid White-Oak Transverse Rafters */}
        {rafterZs.map((rz, idx) => (
          <mesh key={idx} position={[0, 0, rz]} castShadow receiveShadow>
            <boxGeometry args={[9.5, 0.22, 0.085]} />
            <meshStandardMaterial map={timberMap} color="#ffffff" roughness={0.58} />
          </mesh>
        ))}

        {/* Longitudinal Oak Spine Ties */}
        {[-2.4, 2.4].map((bx, idx) => (
          <mesh key={idx} position={[bx, 0.14, 1.95]}>
            <boxGeometry args={[0.11, 0.14, 7.4]} />
            <meshStandardMaterial map={timberMap} color="#ffffff" roughness={0.58} />
          </mesh>
        ))}
      </group>

      {/* =====================================================================
          CORNER ARTISANAL PROP: Sculptural Ceramic Floor Amphora + Dried Stems
         ===================================================================== */}
      <group position={[-3.58, 0, -1.28]} name="atelier-corner-amphora">
        {/* Low Honed Stone Round Coaster Slab */}
        <mesh position={[0, 0.018, 0]} receiveShadow>
          <cylinderGeometry args={[0.26, 0.27, 0.036, 28]} />
          <meshStandardMaterial color={config.palette.plinth} roughness={0.78} />
        </mesh>
        {/* Hand-Thrown Unglazed Ceramic Floor Amphora */}
        <mesh geometry={amphoraGeo} position={[0, 0.036, 0]} castShadow receiveShadow>
          <meshStandardMaterial
            color={shiftHex(config.palette.plinth, 0.03)}
            roughness={0.86}
            metalness={0.02}
          />
        </mesh>
        {/* Sculptural Dual Amphora Ear Handles */}
        {[-1, 1].map((side) => (
          <mesh
            key={side}
            position={[side * 0.145, 0.62, 0]}
            rotation={[0, 0, side * 0.25]}
            castShadow
          >
            <torusGeometry args={[0.068, 0.016, 10, 20, Math.PI * 1.1]} />
            <meshStandardMaterial
              color={shiftHex(config.palette.plinth, 0.03)}
              roughness={0.86}
            />
          </mesh>
        ))}
        {/* Tall Architectural Dried Botanical Branches & Seed Pods */}
        <mesh position={[-0.03, 0.98, 0.02]} rotation={[0.08, 0, 0.16]} castShadow>
          <cylinderGeometry args={[0.005, 0.009, 0.72, 8]} />
          <meshStandardMaterial color="#6A513B" roughness={0.88} />
        </mesh>
        <mesh position={[0.04, 1.05, -0.02]} rotation={[-0.09, 0.2, -0.14]} castShadow>
          <cylinderGeometry args={[0.004, 0.008, 0.84, 8]} />
          <meshStandardMaterial color="#6A513B" roughness={0.88} />
        </mesh>
        <mesh position={[0.0, 1.1, 0.03]} rotation={[0.12, -0.1, 0.04]} castShadow>
          <cylinderGeometry args={[0.004, 0.007, 0.78, 8]} />
          <meshStandardMaterial color="#6A513B" roughness={0.88} />
        </mesh>
        {[
          [-0.09, 1.28, 0.05],
          [0.1, 1.38, -0.05],
          [0.02, 1.44, 0.07],
          [-0.05, 1.18, 0.02],
        ].map(([px, py, pz], idx) => (
          <mesh key={idx} position={[px, py, pz]} castShadow>
            <sphereGeometry args={[0.024, 12, 12]} />
            <meshStandardMaterial color={config.palette.accent} roughness={0.85} />
          </mesh>
        ))}
      </group>

      {/* =====================================================================
          STANDARDIZED DISPLAY FIXTURES (Exact Anchor Tops!)
         ===================================================================== */}
      {/* 1. CENTER TABLE ([1.55, 0, 0.65], exact top y = 0.78) */}
      <group position={[1.55, 0, 0.65]} name="fixture-center-table">
        {/* Twin Sculpted Honed-Limestone & Oak Trestle Columns */}
        {[-0.31, 0.31].map((lx, idx) => (
          <mesh key={idx} position={[lx, 0.36, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.095, 0.11, 0.72, 24]} />
            <meshStandardMaterial color={config.palette.plinth} roughness={0.72} />
          </mesh>
        ))}
        {/* Mortise-and-Tenon Solid Oak Stretcher Beam */}
        <mesh position={[0, 0.2, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.74, 0.055, 0.065]} />
          <meshStandardMaterial map={timberMap} color="#ffffff" roughness={0.55} />
        </mesh>
        {/* Recessed Limestone Apron Collar */}
        <mesh position={[0, 0.726, 0]} receiveShadow>
          <boxGeometry args={[0.84, 0.02, 0.48]} />
          <meshStandardMaterial color={config.palette.plinth} roughness={0.68} />
        </mesh>
        {/* Solid White-Oak Craft Tabletop -> Exact top at 0.758 + 0.022 = 0.780 */}
        <RoundedBox
          args={[0.94, 0.044, 0.58]}
          radius={0.01}
          smoothness={3}
          position={[0, 0.758, 0]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial map={timberMap} color="#ffffff" roughness={0.48} />
        </RoundedBox>
      </group>

      {/* 2. RIGHT PEDESTAL ([2.35, 0, -0.85], exact top y = 0.96) */}
      <group position={[2.35, 0, -0.85]} name="fixture-right-pedestal">
        {/* Recessed Patinated Bronze Toe-Kick */}
        <mesh position={[0, 0.015, 0]} receiveShadow>
          <boxGeometry args={[0.48, 0.03, 0.48]} />
          <meshStandardMaterial color={config.palette.rackMetal} roughness={0.5} metalness={0.65} />
        </mesh>
        {/* Warm Honed Limestone Plinth Core */}
        <RoundedBox
          args={[0.53, 0.89, 0.53]}
          radius={0.01}
          smoothness={3}
          position={[0, 0.475, 0]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial color={config.palette.plinth} roughness={0.74} />
        </RoundedBox>
        {/* Oak Joinery Reveal Collar */}
        <mesh position={[0, 0.91, 0]}>
          <boxGeometry args={[0.54, 0.02, 0.54]} />
          <meshStandardMaterial map={timberMap} color="#ffffff" roughness={0.52} />
        </mesh>
        {/* Honed Stone Craft Top Slab -> Exact top at 0.940 + 0.020 = 0.960 */}
        <mesh position={[0, 0.94, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.56, 0.04, 0.56]} />
          <meshStandardMaterial color={config.palette.plinth} roughness={0.52} />
        </mesh>
      </group>

      {/* 3. LEFT PEDESTAL ([-2.45, 0, 0.75], exact top y = 0.92) */}
      <group position={[-2.45, 0, 0.75]} name="fixture-left-pedestal">
        <mesh position={[0, 0.015, 0]} receiveShadow>
          <boxGeometry args={[0.46, 0.03, 0.46]} />
          <meshStandardMaterial color={config.palette.rackMetal} roughness={0.5} metalness={0.65} />
        </mesh>
        {/* Solid Oak Timber-Clad Atelier Plinth Core */}
        <RoundedBox
          args={[0.51, 0.85, 0.51]}
          radius={0.01}
          smoothness={3}
          position={[0, 0.455, 0]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial map={timberMap} color="#ffffff" roughness={0.56} />
        </RoundedBox>
        {/* Honed Limestone Top Slab -> Exact top at 0.900 + 0.020 = 0.920 */}
        <mesh position={[0, 0.9, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.54, 0.04, 0.54]} />
          <meshStandardMaterial color={config.palette.plinth} roughness={0.52} />
        </mesh>
      </group>
    </group>
  );
}

/* ============================================================================
   ARCHETYPE 3: AVANT-GARDE CONCRETE LOFT (Dover Street Market / A24 / Brutalist)
   - Raw board-formed poured concrete monolith slabs with tie-rod dimples & seams
   - Two chunky square concrete architectural columns (x = ±2.9, z = -1.7)
   - Razor-sharp glowing config.palette.accent vertical neon/LED light tube
   - Bold brutalist steel/stencil brand signage
   - Suspended matte-black industrial box-truss lighting grid + spotlight cans
   - Monolithic raw concrete cube pedestals & slab table
   ============================================================================ */
function AvantGardeConcreteLoftWorld({
  config,
  wallMap,
  posterMap,
  maxAniso,
}: {
  config: StoreConfig;
  wallMap: THREE.Texture;
  posterMap: THREE.Texture;
  maxAniso: number;
}) {
  const plinthConcreteMap = useMemo(
    () => getProceduralWallTexture(config.palette.plinth, 'avant_garde_concrete_loft', maxAniso),
    [config.palette.plinth, maxAniso]
  );

  const trussBlack = '#16171A';
  const accentHex = config.palette.accent;
  const chromeHex = config.palette.rackMetal;

  // 6 theatrical spotlight canisters mounted along the suspended industrial box-truss
  const trussSpots: Array<{ pos: [number, number, number]; rot: [number, number, number] }> = [
    { pos: [-1.45, -0.14, 1.25], rot: [-0.58, 0, -0.32] },
    { pos: [0, -0.14, 1.25], rot: [-0.62, 0, 0] },
    { pos: [1.45, -0.14, 1.25], rot: [-0.58, 0, 0.32] },
    { pos: [-1.45, -0.14, -0.75], rot: [0.35, 0, -0.25] },
    { pos: [0, -0.14, -0.75], rot: [0.42, 0, 0] },
    { pos: [1.45, -0.14, -0.75], rot: [0.35, 0, 0.25] },
  ];

  // Physical 3D tie-rod dimple plugs across central poured-concrete monolith slabs
  const monolithTieHoles: Array<[number, number]> = [
    [-2.05, 0.95],
    [-2.05, 2.25],
    [-2.05, 3.55],
    [-0.75, 0.95],
    [-0.75, 3.55],
    [0.75, 0.95],
    [0.75, 3.55],
    [2.05, 0.95],
    [2.05, 2.25],
    [2.05, 3.55],
  ];

  return (
    <group name="avant-garde-concrete-loft-world">
      <EnclosedPerimeterWalls
        wallMap={wallMap}
        ceilingColor="#191A1D"
        trimColor="#1F2125"
        roughness={0.82}
        showClassicalMoldings={false}
      />

      {/* Side-Wall Industrial Steel I-Beam Pilasters for 360° Brutalist Loft Scale */}
      {[-4.78, 4.78].map((sx, idx) =>
        [0.8, 4.4].map((sz, jdx) => (
          <mesh key={`${idx}-${jdx}`} position={[sx, 2.3, sz]} castShadow receiveShadow>
            <boxGeometry args={[0.12, 4.6, 0.18]} />
            <meshStandardMaterial color={trussBlack} metalness={0.72} roughness={0.36} />
          </mesh>
        ))
      )}

      {/* =====================================================================
          BACK FEATURE WALL (z = -2.0): Board-Formed Concrete + Columns + Neon
         ===================================================================== */}
      <group name="loft-brutalist-back-wall">
        {/* Deep Dark Shadow Reveal Backing Plane */}
        <mesh position={[0, 2.3, -2.06]}>
          <planeGeometry args={[10.0, 4.6]} />
          <meshStandardMaterial color="#111214" roughness={0.95} />
        </mesh>

        {/* Stepped Poured-Concrete Monolith Slabs with Deep Expansion Seam Reveals */}
        {[-4.05, -1.38, 0, 1.38, 4.05].map((sx, idx) => {
          const slabW = idx === 0 || idx === 4 ? 1.82 : 1.33;
          const slabZ = idx === 2 ? -1.94 : -1.98;
          return (
            <mesh key={idx} position={[sx, 2.29, slabZ]} castShadow receiveShadow>
              <boxGeometry args={[slabW, 4.54, 0.12]} />
              <meshStandardMaterial
                map={wallMap}
                color="#ffffff"
                roughness={0.8}
                metalness={0.05}
              />
            </mesh>
          );
        })}

        {/* Physical 3D Formwork Tie-Rod Cone Dimples & Brushed Steel Washers */}
        {monolithTieHoles.map(([tx, ty], idx) => (
          <mesh
            key={idx}
            position={[tx, ty, Math.abs(tx) < 0.9 ? -1.878 : -1.918]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <cylinderGeometry args={[0.022, 0.014, 0.012, 14]} />
            <meshStandardMaterial color="#16181B" metalness={0.75} roughness={0.35} />
          </mesh>
        ))}

        {/* TWO CHUNKY SQUARE CONCRETE ARCHITECTURAL COLUMNS (x = ±2.9, z = -1.7) */}
        {[-2.9, 2.9].map((cx, idx) => (
          <group key={idx} position={[cx, 0, -1.7]} name={`concrete-column-${idx}`}>
            {/* Heavy Chamfered Industrial Steel Base Plate */}
            <mesh position={[0, 0.022, 0]} receiveShadow>
              <boxGeometry args={[0.56, 0.044, 0.56]} />
              <meshStandardMaterial color={trussBlack} metalness={0.78} roughness={0.32} />
            </mesh>
            {/* Chunky Square Poured-Concrete Structural Column */}
            <mesh position={[0, 2.31, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.48, 4.54, 0.48]} />
              <meshStandardMaterial
                map={wallMap}
                color="#ffffff"
                roughness={0.78}
                metalness={0.05}
              />
            </mesh>
            {/* Column Tie-Rod Cones on Front Face */}
            {[0.85, 1.85, 2.85, 3.85].map((hy, hIdx) => (
              <React.Fragment key={hIdx}>
                <mesh position={[-0.13, hy, 0.242]} rotation={[Math.PI / 2, 0, 0]}>
                  <cylinderGeometry args={[0.018, 0.012, 0.01, 12]} />
                  <meshStandardMaterial color="#151619" metalness={0.7} roughness={0.4} />
                </mesh>
                <mesh position={[0.13, hy, 0.242]} rotation={[Math.PI / 2, 0, 0]}>
                  <cylinderGeometry args={[0.018, 0.012, 0.01, 12]} />
                  <meshStandardMaterial color="#151619" metalness={0.7} roughness={0.4} />
                </mesh>
              </React.Fragment>
            ))}
          </group>
        ))}

        {/* RAZOR-SHARP GLOWING ACCENT VERTICAL NEON / LED ARCHITECTURAL LIGHT TUBE */}
        <group position={[1.56, 2.22, -1.87]} name="brutalist-vertical-neon-tube">
          {/* Machined Matte-Black Steel Mounting Channel & Top/Bottom Clamps */}
          <mesh position={[0, 0, -0.025]}>
            <boxGeometry args={[0.052, 3.68, 0.03]} />
            <meshStandardMaterial color={trussBlack} metalness={0.82} roughness={0.28} />
          </mesh>
          {[-1.78, 0, 1.78].map((cy, idx) => (
            <mesh key={idx} position={[0, cy, 0]}>
              <boxGeometry args={[0.072, 0.036, 0.055]} />
              <meshStandardMaterial color={chromeHex} metalness={0.92} roughness={0.18} />
            </mesh>
          ))}
          {/* Glowing Architectural Neon/LED Tube in config.palette.accent */}
          <mesh position={[0, 0, 0.012]}>
            <cylinderGeometry args={[0.016, 0.016, 3.62, 20]} />
            <meshBasicMaterial color={accentHex} toneMapped={false} />
          </mesh>
          {/* Soft Outer Glow Halo Plane on Concrete Behind Tube */}
          <mesh position={[0, 0, -0.036]}>
            <planeGeometry args={[0.26, 3.74]} />
            <meshBasicMaterial
              color={accentHex}
              transparent
              opacity={0.34}
              toneMapped={false}
            />
          </mesh>
        </group>

        {/* Complementary Asymmetric Low Accent Strike on Left Concrete Seam */}
        <group position={[-1.56, 2.22, -1.9]} name="brutalist-secondary-seam-glow">
          <mesh>
            <boxGeometry args={[0.014, 3.4, 0.018]} />
            <meshBasicMaterial color={accentHex} toneMapped={false} />
          </mesh>
        </group>

        {/* BOLD BRUTALIST STENCIL / RAW STEEL BRAND MONOLITH SIGNAGE */}
        <group position={[0, 2.52, -1.84]} name="brutalist-brand-signage">
          {/* Heavy Industrial Gunmetal Steel Plate */}
          <mesh castShadow receiveShadow>
            <boxGeometry args={[2.18, 0.52, 0.036]} />
            <meshStandardMaterial color="#141518" metalness={0.78} roughness={0.28} />
          </mesh>

          {/* Raw Brushed-Chrome Industrial Perimeter Bezel */}
          <mesh position={[0, 0.262, 0]}>
            <boxGeometry args={[2.2, 0.012, 0.042]} />
            <meshStandardMaterial color={chromeHex} metalness={0.94} roughness={0.16} />
          </mesh>
          <mesh position={[0, -0.262, 0]}>
            <boxGeometry args={[2.2, 0.012, 0.042]} />
            <meshStandardMaterial color={chromeHex} metalness={0.94} roughness={0.16} />
          </mesh>

          {/* 4 Heavy Hex Standoff Bolts */}
          {[
            [-1.01, 0.19],
            [1.01, 0.19],
            [-1.01, -0.19],
            [1.01, -0.19],
          ].map(([bx, by], idx) => (
            <mesh key={idx} position={[bx, by, 0.024]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.016, 0.016, 0.018, 6]} />
              <meshStandardMaterial color={chromeHex} metalness={0.95} roughness={0.16} />
            </mesh>
          ))}

          {/* Stark Brutalist Stencil Typography */}
          <ArchetypeBrandSignagePlane
            brandName={config.brandName}
            tagline={config.tagline}
            textColor="#F6F8FC"
            subColor={chromeHex}
            accentColor={accentHex}
            variant="avant_garde_concrete_loft"
            width={2.06}
            height={0.46}
            zOffset={0.022}
          />
        </group>

        {/* Framed Constructivist Exhibition Print on Outer Left Concrete Slab Bay */}
        <FramedExhibitionArt
          config={config}
          posterMap={posterMap}
          archetype="avant_garde_concrete_loft"
          position={[-3.92, 1.9, -1.9]}
        />
      </group>

      {/* =====================================================================
          CEILING RIG: Matte-Black Industrial Box-Truss Grid + Spotlight Cans
         ===================================================================== */}
      <group position={[0, 3.78, 0.25]} name="loft-industrial-box-truss">
        {/* Longitudinal Front & Rear Double-Chord Box Trusses */}
        {[-1.0, 1.0].map((tz, idx) => (
          <group key={idx} position={[0, 0, tz]}>
            {/* Upper & Lower Horizontal Steel Truss Chords */}
            <mesh position={[0, 0.1, 0]} castShadow>
              <boxGeometry args={[4.6, 0.036, 0.036]} />
              <meshStandardMaterial color={trussBlack} metalness={0.75} roughness={0.32} />
            </mesh>
            <mesh position={[0, -0.1, 0]} castShadow>
              <boxGeometry args={[4.6, 0.036, 0.036]} />
              <meshStandardMaterial color={trussBlack} metalness={0.75} roughness={0.32} />
            </mesh>
            {/* Vertical Truss Web Struts */}
            {[-2.2, -1.46, -0.73, 0, 0.73, 1.46, 2.2].map((vx, vIdx) => (
              <mesh key={vIdx} position={[vx, 0, 0]}>
                <boxGeometry args={[0.024, 0.2, 0.024]} />
                <meshStandardMaterial color={trussBlack} metalness={0.75} roughness={0.34} />
              </mesh>
            ))}
          </group>
        ))}

        {/* Side & Center Cross-Truss Bridges */}
        {[-2.2, 0, 2.2].map((cx, idx) => (
          <group key={idx} position={[cx, 0, 0]}>
            <mesh position={[0, 0.1, 0]}>
              <boxGeometry args={[0.036, 0.036, 2.04]} />
              <meshStandardMaterial color={trussBlack} metalness={0.75} roughness={0.32} />
            </mesh>
            <mesh position={[0, -0.1, 0]}>
              <boxGeometry args={[0.036, 0.036, 2.04]} />
              <meshStandardMaterial color={trussBlack} metalness={0.75} roughness={0.32} />
            </mesh>
          </group>
        ))}

        {/* 4 Heavy Aircraft Suspension Rods to Ceiling */}
        {[
          [-2.15, 1.0],
          [2.15, 1.0],
          [-2.15, -1.0],
          [2.15, -1.0],
        ].map(([rx, rz], idx) => (
          <mesh key={idx} position={[rx, 0.45, rz]}>
            <cylinderGeometry args={[0.01, 0.01, 0.72, 10]} />
            <meshStandardMaterial color={chromeHex} metalness={0.88} roughness={0.22} />
          </mesh>
        ))}

        {/* 6 Theatrical Gallery Spotlight Canisters with Chrome Clamps */}
        {trussSpots.map((spot, idx) => (
          <group key={idx} position={spot.pos}>
            <mesh position={[0, 0.02, 0]}>
              <cylinderGeometry args={[0.026, 0.026, 0.045, 14]} />
              <meshStandardMaterial color={chromeHex} metalness={0.92} roughness={0.18} />
            </mesh>
            <group position={[0, -0.08, 0]} rotation={spot.rot}>
              <mesh castShadow>
                <cylinderGeometry args={[0.052, 0.052, 0.21, 20]} />
                <meshStandardMaterial color={trussBlack} metalness={0.7} roughness={0.3} />
              </mesh>
              <mesh position={[0, -0.1, 0]}>
                <cylinderGeometry args={[0.056, 0.056, 0.024, 20]} />
                <meshStandardMaterial color={chromeHex} metalness={0.92} roughness={0.18} />
              </mesh>
              <mesh position={[0, -0.113, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <circleGeometry args={[0.044, 18]} />
                <meshBasicMaterial color={config.palette.spotLight} toneMapped={false} />
              </mesh>
            </group>
          </group>
        ))}
      </group>

      {/* =====================================================================
          STANDARDIZED DISPLAY FIXTURES (Exact Anchor Tops!)
         ===================================================================== */}
      {/* 1. CENTER TABLE ([1.55, 0, 0.65], exact top y = 0.78) */}
      <group position={[1.55, 0, 0.65]} name="fixture-center-table">
        {/* Monolithic Cast-Concrete Pier Legs */}
        {[-0.31, 0.31].map((lx, idx) => (
          <mesh key={idx} position={[lx, 0.358, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.16, 0.716, 0.46]} />
            <meshStandardMaterial
              map={plinthConcreteMap}
              color="#ffffff"
              roughness={0.76}
            />
          </mesh>
        ))}
        {/* Industrial Brushed-Chrome Tie Rod */}
        <mesh position={[0, 0.24, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.018, 0.018, 0.82, 18]} />
          <meshStandardMaterial color={chromeHex} metalness={0.95} roughness={0.15} />
        </mesh>
        {/* Heavy Poured-Concrete Slab Top -> Exact top at 0.748 + 0.032 = 0.780 */}
        <mesh position={[0, 0.748, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.94, 0.064, 0.56]} />
          <meshStandardMaterial
            map={plinthConcreteMap}
            color="#ffffff"
            roughness={0.58}
            metalness={0.06}
          />
        </mesh>
      </group>

      {/* 2. RIGHT PEDESTAL ([2.35, 0, -0.85], exact top y = 0.96) */}
      <group position={[2.35, 0, -0.85]} name="fixture-right-pedestal">
        {/* Recessed Matte-Black Steel Shadow Toe-Kick */}
        <mesh position={[0, 0.015, 0]} receiveShadow>
          <boxGeometry args={[0.5, 0.03, 0.5]} />
          <meshStandardMaterial color={trussBlack} metalness={0.8} roughness={0.3} />
        </mesh>
        {/* Monolithic Raw Concrete Cube Column */}
        <mesh position={[0, 0.48, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.56, 0.9, 0.56]} />
          <meshStandardMaterial
            map={plinthConcreteMap}
            color="#ffffff"
            roughness={0.78}
          />
        </mesh>
        {/* Honed Basalt/Steel Top Slab -> Exact top at 0.945 + 0.015 = 0.960 */}
        <mesh position={[0, 0.945, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.565, 0.03, 0.565]} />
          <meshStandardMaterial
            color={config.palette.plinth}
            roughness={0.42}
            metalness={0.18}
          />
        </mesh>
      </group>

      {/* 3. LEFT PEDESTAL ([-2.45, 0, 0.75], exact top y = 0.92) */}
      <group position={[-2.45, 0, 0.75]} name="fixture-left-pedestal">
        <mesh position={[0, 0.015, 0]} receiveShadow>
          <boxGeometry args={[0.48, 0.03, 0.48]} />
          <meshStandardMaterial color={trussBlack} metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.46, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.54, 0.86, 0.54]} />
          <meshStandardMaterial
            map={plinthConcreteMap}
            color="#ffffff"
            roughness={0.78}
          />
        </mesh>
        {/* Honed Concrete/Steel Top Slab -> Exact top at 0.905 + 0.015 = 0.920 */}
        <mesh position={[0, 0.905, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.545, 0.03, 0.545]} />
          <meshStandardMaterial
            color={config.palette.plinth}
            roughness={0.42}
            metalness={0.18}
          />
        </mesh>
      </group>
    </group>
  );
}

/* ============================================================================
   ARCHETYPE 4: HERITAGE ARCH FLAGSHIP (Aimé Leon Dore / Rowing Blazers / GSC)
   - Extruded semi-circular recessed fluted arch alcove + hidden warm LED cove
   - Upper-arch brushed brass & matte plaque 2048×512 signage (y = 2.42)
   - Venetian limewash walls, crown cornices, framed brand archive lithograph
   - Overhead black/brass track lighting rig
   - Fluted travertine & walnut club table & pedestals at exact anchor heights
   ============================================================================ */
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

function HeritageArchFlagshipWorld({
  config,
  wallMap,
  accentFlutedMap,
  posterMap,
}: {
  config: StoreConfig;
  wallMap: THREE.Texture;
  accentFlutedMap: THREE.Texture;
  posterMap: THREE.Texture;
}) {
  const archRadius = 1.36;
  const springY = 2.04;
  const wallWidth = 11.6;
  const wallHeight = 4.6;

  const { outerWallGeo, archTrimGeo, ledCoveGeo, flutes, pedestalFlutes } = useMemo(() => {
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

    const fluteItems: Array<{ x: number; height: number }> = [];
    const step = 0.074;
    for (let x = -archRadius + 0.045; x <= archRadius - 0.045; x += step) {
      const inside = Math.max(0, (archRadius + 0.03) ** 2 - x * x);
      const h = springY + Math.sqrt(inside);
      fluteItems.push({ x, height: h });
    }

    const pFlutes: number[] = [];
    for (let x = -0.21; x <= 0.211; x += 0.06) {
      pFlutes.push(Number(x.toFixed(3)));
    }

    return {
      outerWallGeo: wGeo,
      archTrimGeo: tGeo,
      ledCoveGeo: cGeo,
      flutes: fluteItems,
      pedestalFlutes: pFlutes,
    };
  }, []);

  useEffect(() => {
    return () => {
      outerWallGeo.dispose();
      archTrimGeo.dispose();
      ledCoveGeo.dispose();
    };
  }, [outerWallGeo, archTrimGeo, ledCoveGeo]);

  const isDarkRoom = getLuminance(config.palette.wall) < 0.35;
  const rackMetalLum = getLuminance(config.palette.rackMetal);
  const signageTextColor = isDarkRoom ? '#F6F7FA' : '#FAF6EE';
  const signageSubColor =
    rackMetalLum < 0.42 ? config.palette.secondaryAccent : config.palette.rackMetal;
  const coveGlowHex = '#FFE8BE';
  const trackBlack = '#191A1D';

  const hasProducts = Boolean(config.products && config.products.length > 0);

  const canisterPositions: Array<{ x: number; rotZ: number; rotX: number }> = [
    { x: -1.12, rotZ: -0.34, rotX: -0.58 },
    { x: 0, rotZ: 0, rotX: -0.62 },
    { x: 1.12, rotZ: 0.34, rotX: -0.58 },
  ];

  return (
    <group name="heritage-arch-flagship-world">
      <EnclosedPerimeterWalls
        wallMap={wallMap}
        ceilingColor={config.palette.secondaryAccent}
        trimColor={config.palette.plinth}
        roughness={0.88}
        showClassicalMoldings={true}
      />

      {/* =====================================================================
          BACK FEATURE WALL: Recessed Semi-Circular Fluted Arch Alcove
         ===================================================================== */}
      <group name="heritage-arch-back-wall">
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

        {/* Physical 3D Vertical Fluted Ribs */}
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

        {/* Hidden Warm LED Cove Diffuser Strip */}
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

        {/* Extruded Venetian Limewash Back Wall */}
        <mesh geometry={outerWallGeo} position={[0, 0, -2.07]} receiveShadow>
          <meshStandardMaterial
            map={wallMap}
            color="#ffffff"
            roughness={0.86}
            metalness={0.02}
          />
        </mesh>

        {/* Stepped Architrave Molding around the Arch Opening */}
        <mesh geometry={archTrimGeo} position={[0, 0, -1.852]} receiveShadow castShadow>
          <meshStandardMaterial
            color={config.palette.secondaryAccent}
            roughness={0.72}
            metalness={0.04}
          />
        </mesh>

        {/* Flanking Back-Wall Baseboards */}
        <mesh position={[-3.62, 0.075, -1.832]} receiveShadow>
          <boxGeometry args={[4.35, 0.15, 0.028]} />
          <meshStandardMaterial color={config.palette.plinth} roughness={0.62} />
        </mesh>
        <mesh position={[3.62, 0.075, -1.832]} receiveShadow>
          <boxGeometry args={[4.35, 0.15, 0.028]} />
          <meshStandardMaterial color={config.palette.plinth} roughness={0.62} />
        </mesh>

        {/* 3D Brand Signage Mounted Inside Upper Arch (y = 2.42) */}
        <group position={[0, 2.42, -2.065]} name="brand-arch-signage">
          <RoundedBox
            args={[1.92, 0.48, 0.012]}
            radius={0.04}
            smoothness={4}
            position={[0, 0, -0.012]}
          >
            <meshBasicMaterial
              color={coveGlowHex}
              transparent
              opacity={0.38}
              toneMapped={false}
            />
          </RoundedBox>

          <RoundedBox args={[1.88, 0.44, 0.022]} radius={0.036} smoothness={4} castShadow>
            <meshStandardMaterial
              color={config.palette.rackMetal}
              metalness={Math.min(0.68, config.metalness)}
              roughness={Math.max(0.48, config.metalRoughness)}
            />
          </RoundedBox>

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

          <mesh position={[0, -0.042, 0.02]}>
            <boxGeometry args={[0.72, 0.004, 0.004]} />
            <meshStandardMaterial
              color={signageSubColor}
              metalness={0.72}
              roughness={0.42}
            />
          </mesh>

          <ArchetypeBrandSignagePlane
            brandName={config.brandName}
            tagline={config.tagline}
            textColor={signageTextColor}
            subColor={signageSubColor}
            accentColor={config.palette.accent}
            variant="heritage_arch_flagship"
            width={1.76}
            height={0.44}
            zOffset={0.021}
          />
        </group>

        {/* Framed Brand Archive Lithograph + Brass Picture Light */}
        <FramedExhibitionArt
          config={config}
          posterMap={posterMap}
          archetype="heritage_arch_flagship"
          position={[-2.32, 1.88, -1.815]}
        />
      </group>

      {/* =====================================================================
          CEILING RIG: Overhead Black & Brushed-Brass Track Lighting H-Grid
         ===================================================================== */}
      <group position={[0, 3.65, 0]} name="overhead-track-rig">
        <mesh position={[0, 0, 0.92]} castShadow>
          <boxGeometry args={[3.4, 0.036, 0.042]} />
          <meshStandardMaterial color={trackBlack} roughness={0.35} metalness={0.65} />
        </mesh>
        <mesh position={[0, 0, -0.82]}>
          <boxGeometry args={[3.4, 0.036, 0.042]} />
          <meshStandardMaterial color={trackBlack} roughness={0.35} metalness={0.65} />
        </mesh>
        <mesh position={[-1.68, 0, 0.05]}>
          <boxGeometry args={[0.042, 0.036, 1.78]} />
          <meshStandardMaterial color={trackBlack} roughness={0.35} metalness={0.65} />
        </mesh>
        <mesh position={[1.68, 0, 0.05]}>
          <boxGeometry args={[0.042, 0.036, 1.78]} />
          <meshStandardMaterial color={trackBlack} roughness={0.35} metalness={0.65} />
        </mesh>

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

        {canisterPositions.map((spot, idx) => (
          <group key={idx} position={[spot.x, -0.02, 0.92]}>
            <mesh position={[0, -0.025, 0]}>
              <cylinderGeometry args={[0.024, 0.024, 0.05, 16]} />
              <meshStandardMaterial
                color={config.palette.rackMetal}
                metalness={config.metalness}
                roughness={config.metalRoughness}
              />
            </mesh>
            <group position={[0, -0.095, 0]} rotation={[spot.rotX, 0, spot.rotZ]}>
              <mesh position={[0, 0.04, 0]}>
                <boxGeometry args={[0.11, 0.014, 0.022]} />
                <meshStandardMaterial color={trackBlack} roughness={0.4} metalness={0.7} />
              </mesh>
              <mesh castShadow>
                <cylinderGeometry args={[0.046, 0.046, 0.19, 24]} />
                <meshStandardMaterial color={trackBlack} roughness={0.32} metalness={0.68} />
              </mesh>
              <mesh position={[0, -0.092, 0]}>
                <cylinderGeometry args={[0.048, 0.048, 0.022, 24]} />
                <meshStandardMaterial
                  color={config.palette.rackMetal}
                  metalness={config.metalness}
                  roughness={config.metalRoughness}
                />
              </mesh>
              <mesh position={[0, -0.102, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <circleGeometry args={[0.039, 20]} />
                <meshBasicMaterial color={config.palette.spotLight} toneMapped={false} />
              </mesh>
            </group>
          </group>
        ))}
      </group>

      {/* =====================================================================
          STANDARDIZED DISPLAY FIXTURES (Exact Anchor Tops!)
         ===================================================================== */}
      {/* 1. CENTER TABLE ([1.55, 0, 0.65], exact top y = 0.78) */}
      <group position={[1.55, 0, 0.65]} name="fixture-center-table">
        {/* 4 Tapered American Walnut Club Table Legs + Brushed Brass Sabot Feet */}
        {[
          [-0.39, -0.21],
          [0.39, -0.21],
          [-0.39, 0.21],
          [0.39, 0.21],
        ].map(([lx, lz], idx) => (
          <group key={idx} position={[lx, 0, lz]}>
            <mesh position={[0, 0.035, 0]}>
              <cylinderGeometry args={[0.02, 0.017, 0.07, 14]} />
              <meshStandardMaterial
                color={config.palette.rackMetal}
                metalness={config.metalness}
                roughness={config.metalRoughness}
              />
            </mesh>
            <mesh position={[0, 0.39, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[0.026, 0.02, 0.64, 16]} />
              <meshStandardMaterial color={config.palette.hangerWood} roughness={0.48} />
            </mesh>
          </group>
        ))}
        {/* Lower Walnut H-Stretcher Rails */}
        <mesh position={[0, 0.2, 0]}>
          <boxGeometry args={[0.78, 0.026, 0.03]} />
          <meshStandardMaterial color={config.palette.hangerWood} roughness={0.5} />
        </mesh>
        {[-0.39, 0.39].map((lx, idx) => (
          <mesh key={idx} position={[lx, 0.2, 0]}>
            <boxGeometry args={[0.028, 0.026, 0.42]} />
            <meshStandardMaterial color={config.palette.hangerWood} roughness={0.5} />
          </mesh>
        ))}
        {/* Sculpted Walnut Apron + Brass Fillet Trim */}
        <mesh position={[0, 0.724, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.88, 0.036, 0.52]} />
          <meshStandardMaterial color={config.palette.hangerWood} roughness={0.48} />
        </mesh>
        <mesh position={[0, 0.743, 0]}>
          <boxGeometry args={[0.9, 0.006, 0.54]} />
          <meshStandardMaterial
            color={config.palette.rackMetal}
            metalness={config.metalness}
            roughness={config.metalRoughness}
          />
        </mesh>
        {/* Honed Roman Travertine Top Slab -> Exact top at 0.762 + 0.018 = 0.780 */}
        <RoundedBox
          args={[0.92, 0.036, 0.56]}
          radius={0.008}
          smoothness={3}
          position={[0, 0.762, 0]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial color={config.palette.plinth} roughness={0.46} metalness={0.04} />
        </RoundedBox>
      </group>

      {/* 2. RIGHT PEDESTAL ([2.35, 0, -0.85], exact top y = 0.96) */}
      <group position={[2.35, 0, -0.85]} name="fixture-right-pedestal">
        {/* Brushed Brass Recessed Toe-Kick */}
        <mesh position={[0, 0.02, 0]} receiveShadow>
          <boxGeometry args={[0.48, 0.04, 0.48]} />
          <meshStandardMaterial
            color={config.palette.rackMetal}
            metalness={config.metalness}
            roughness={0.36}
          />
        </mesh>
        {/* Fluted Roman Travertine Column Core */}
        <RoundedBox
          args={[0.52, 0.88, 0.52]}
          radius={0.012}
          smoothness={3}
          position={[0, 0.48, 0]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial color={config.palette.plinth} roughness={0.62} metalness={0.03} />
        </RoundedBox>
        {pedestalFlutes.map((fx, idx) => (
          <React.Fragment key={idx}>
            <mesh position={[fx, 0.48, 0.262]} scale={[1, 1, 0.45]} castShadow receiveShadow>
              <cylinderGeometry args={[0.018, 0.018, 0.82, 10]} />
              <meshStandardMaterial color={config.palette.plinth} roughness={0.58} />
            </mesh>
            <mesh position={[fx, 0.48, -0.262]} scale={[1, 1, 0.45]} receiveShadow>
              <cylinderGeometry args={[0.018, 0.018, 0.82, 10]} />
              <meshStandardMaterial color={config.palette.plinth} roughness={0.58} />
            </mesh>
          </React.Fragment>
        ))}
        {/* Honed Travertine Top Slab -> Exact top at 0.940 + 0.020 = 0.960 */}
        <RoundedBox
          args={[0.56, 0.04, 0.56]}
          radius={0.008}
          smoothness={3}
          position={[0, 0.94, 0]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial color={config.palette.plinth} roughness={0.44} metalness={0.04} />
        </RoundedBox>

        {/* Legacy Folded Knitwear ONLY if `config.products` is absent */}
        {!hasProducts && (
          <group position={[0, 0.96, 0]}>
            <RoundedBox
              args={[0.32, 0.052, 0.34]}
              radius={0.02}
              smoothness={4}
              position={[0, 0.026, 0]}
              castShadow
            >
              <meshStandardMaterial color={config.palette.rug} roughness={0.92} />
            </RoundedBox>
            <RoundedBox
              args={[0.3, 0.048, 0.32]}
              radius={0.02}
              smoothness={4}
              position={[0.006, 0.076, -0.004]}
              rotation={[0, 0.04, 0]}
              castShadow
            >
              <meshStandardMaterial color={config.palette.accent} roughness={0.9} />
            </RoundedBox>
          </group>
        )}
      </group>

      {/* 3. LEFT PEDESTAL ([-2.45, 0, 0.75], exact top y = 0.92) */}
      <group position={[-2.45, 0, 0.75]} name="fixture-left-pedestal">
        <mesh position={[0, 0.02, 0]} receiveShadow>
          <boxGeometry args={[0.46, 0.04, 0.46]} />
          <meshStandardMaterial
            color={config.palette.rackMetal}
            metalness={config.metalness}
            roughness={0.36}
          />
        </mesh>
        <RoundedBox
          args={[0.5, 0.84, 0.5]}
          radius={0.012}
          smoothness={3}
          position={[0, 0.46, 0]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial color={config.palette.plinth} roughness={0.62} metalness={0.03} />
        </RoundedBox>
        {pedestalFlutes.map((fx, idx) => (
          <mesh
            key={idx}
            position={[fx * 0.94, 0.46, 0.252]}
            scale={[1, 1, 0.45]}
            castShadow
            receiveShadow
          >
            <cylinderGeometry args={[0.017, 0.017, 0.78, 10]} />
            <meshStandardMaterial color={config.palette.plinth} roughness={0.58} />
          </mesh>
        ))}
        {/* Walnut Reveal Band under Top Slab */}
        <mesh position={[0, 0.875, 0]}>
          <boxGeometry args={[0.51, 0.016, 0.51]} />
          <meshStandardMaterial color={config.palette.hangerWood} roughness={0.48} />
        </mesh>
        {/* Honed Travertine Top Slab -> Exact top at 0.900 + 0.020 = 0.920 */}
        <RoundedBox
          args={[0.54, 0.04, 0.54]}
          radius={0.008}
          smoothness={3}
          position={[0, 0.9, 0]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial color={config.palette.plinth} roughness={0.44} metalness={0.04} />
        </RoundedBox>
      </group>
    </group>
  );
}

/**
 * Dynamic Multi-Archetype 3D Boutique Showroom
 */
export const BoutiqueWorld: React.FC<BoutiqueWorldProps> = ({ config, children }) => {
  const { gl, scene } = useThree();
  const maxAniso = useMemo(() => Math.min(8, gl.capabilities.getMaxAnisotropy()), [gl]);
  const archetype = resolveWorldArchetype(config);

  useEffect(() => {
    scene.background = new THREE.Color(config.palette.wall);
    scene.fog = new THREE.Fog(config.palette.wall, 10.5, 21.5);
  }, [scene, config.palette.wall]);

  // Only load static Good Shot Club PNGs when in heritage_arch_flagship AND palette matches
  const isHeritage = archetype === 'heritage_arch_flagship';

  const usePresetFloorPng =
    isHeritage &&
    Boolean(config.textures.floorUrl) &&
    (config.textures.floorUrl !== '/assets/textures/travertine-floor.png' ||
      config.palette.floor.toLowerCase() === '#ddd5c7');

  const usePresetWallPng =
    isHeritage &&
    Boolean(config.textures.wallUrl) &&
    (config.textures.wallUrl !== '/assets/textures/limewash-wall.png' ||
      config.palette.wall.toLowerCase() === '#f3efe6');

  const usePresetFlutedPng =
    isHeritage &&
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

  // Fast, cached procedural CanvasTextures (<15ms first synthesis, 0ms cached)
  const procFloorTex = useMemo(
    () =>
      getProceduralFloorTexture(
        config.palette.floor,
        config.palette.secondaryAccent,
        archetype,
        maxAniso
      ),
    [config.palette.floor, config.palette.secondaryAccent, archetype, maxAniso]
  );

  const procWallTex = useMemo(
    () => getProceduralWallTexture(config.palette.wall, archetype, maxAniso),
    [config.palette.wall, archetype, maxAniso]
  );

  const procFlutedTex = useMemo(
    () => getProceduralFlutedTexture(config.palette.accent, maxAniso),
    [config.palette.accent, maxAniso]
  );

  const procPosterTex = useMemo(
    () => getProceduralPosterTexture(config, archetype, maxAniso),
    [config, archetype, maxAniso]
  );

  const rugTextures = useMemo(
    () =>
      getRugTextures(
        config.palette.rug,
        config.palette.secondaryAccent,
        config.palette.accent,
        archetype,
        maxAniso
      ),
    [
      config.palette.rug,
      config.palette.secondaryAccent,
      config.palette.accent,
      archetype,
      maxAniso,
    ]
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
    archetype === 'minimalist_tech_pavilion'
      ? 0.36
      : archetype === 'avant_garde_concrete_loft'
        ? 0.34
        : archetype === 'warm_artisanal_atelier'
          ? 0.62
          : 0.54;

  const floorClearcoat =
    archetype === 'avant_garde_concrete_loft'
      ? 0.28
      : archetype === 'minimalist_tech_pavilion'
        ? 0.22
        : 0.12;

  return (
    <group name="boutique-world" userData={{ archetype }}>
      {/* Archetype-Calibrated Studio Lighting Rig + ContactShadows */}
      <StudioLightingRig config={config} archetype={archetype} />

      {/* Spacious Showroom Floor (y = 0) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 1.8]} receiveShadow>
        <planeGeometry args={[18, 16]} />
        <meshPhysicalMaterial
          ref={floorMatRef}
          map={activeFloorMap}
          color="#ffffff"
          roughness={floorRoughness}
          metalness={archetype === 'minimalist_tech_pavilion' ? 0.08 : 0.03}
          clearcoat={floorClearcoat}
          clearcoatRoughness={0.48}
        />
      </mesh>

      {/* Archetype-Styled Area Rug / Architectural Mat Framing Hero Rack Zone */}
      <group position={[0, 0, 0.08]} name="archetype-area-rug">
        <mesh position={[0, 0.0014, 0]} receiveShadow>
          <boxGeometry args={[3.52, 0.0028, 2.46]} />
          <meshStandardMaterial
            color={
              archetype === 'minimalist_tech_pavilion'
                ? config.palette.rackMetal
                : config.palette.secondaryAccent
            }
            roughness={archetype === 'minimalist_tech_pavilion' ? 0.35 : 0.92}
            metalness={archetype === 'minimalist_tech_pavilion' ? 0.75 : 0.04}
          />
        </mesh>
        <mesh position={[0, 0.0024, 0]} receiveShadow>
          <boxGeometry args={[3.42, 0.0038, 2.36]} />
          <meshStandardMaterial
            map={rugTextures.map}
            bumpMap={rugTextures.bumpMap}
            bumpScale={archetype === 'minimalist_tech_pavilion' ? 0.003 : 0.007}
            color="#ffffff"
            roughness={0.94}
            metalness={0.01}
          />
        </mesh>
      </group>

      {/* Render Distinct Architectural 3D World Based on WorldArchetypeId */}
      {archetype === 'minimalist_tech_pavilion' && (
        <MinimalistTechPavilionWorld
          config={config}
          wallMap={activeWallMap}
          posterMap={activePosterMap}
        />
      )}

      {archetype === 'warm_artisanal_atelier' && (
        <WarmArtisanalAtelierWorld
          config={config}
          wallMap={activeWallMap}
          posterMap={activePosterMap}
          maxAniso={maxAniso}
        />
      )}

      {archetype === 'avant_garde_concrete_loft' && (
        <AvantGardeConcreteLoftWorld
          config={config}
          wallMap={activeWallMap}
          posterMap={activePosterMap}
          maxAniso={maxAniso}
        />
      )}

      {archetype === 'heritage_arch_flagship' && (
        <HeritageArchFlagshipWorld
          config={config}
          wallMap={activeWallMap}
          accentFlutedMap={activeFlutedMap}
          posterMap={activePosterMap}
        />
      )}

      {/* Nested Racks, 3D Parametric Products, Walkable Avatar & Shopper Swarm */}
      {children}
    </group>
  );
};

export default BoutiqueWorld;
