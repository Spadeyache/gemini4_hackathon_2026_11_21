import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type {
  GarmentAssetSet,
  InventedProductSpec,
  ProductPlacementZone,
  StoreConfig,
} from '../../types/storeConfig';

export type ShopperVerdict = 'BUY' | 'SKIP';

export type SuggestedStoreMutation =
  | 'swap_hero_sku'
  | 'declutter_aisle'
  | 'adjust_lighting'
  | 'reprice';

export interface ShopperPersona {
  id: string;
  name: string;
  roleTag: string;
  jacketColor: string;
  trimColor: string;
  pantsColor: string;
  shoeColor: string;
  hairColor: string;
  skinTone: string;
  accessory: 'beret' | 'headphones' | 'cap' | 'beanie' | 'sunglasses' | 'glasses';
  walkSpeed: number;
  priceCeiling: number;
  favoritePresets: string[];
  preferredLighting: StoreConfig['lightingPreset'][];
  monolithFinish?: 'frosted_alabaster' | 'smoked_obsidian';
}

export interface ShopperDecisionEvent {
  id: string;
  timestamp: number;
  personaId: string;
  personaName: string;
  roleTag: string;
  garmentId: string;
  garmentTitle: string;
  garmentPrice: number;
  rackId: string;
  decision: ShopperVerdict;
  thought: string;
  score: number;
  suggestedMutation?: SuggestedStoreMutation;
}

export interface ShopperConversionStats {
  totalDecisions: number;
  buys: number;
  /** Ratio in [0, 1] (buys / totalDecisions) */
  conversionRate: number;
  recentFeed: ShopperDecisionEvent[];
}

export interface ShopperSwarmLayerProps {
  /** Active Boutique StoreConfig */
  config: StoreConfig;
  /** Enables/disables the 3D architectural product judge ensemble (defaults to true) */
  enabled?: boolean;
  /** Whether secondary capsule rack is visible in scene (defaults to true) */
  showSecondaryRack?: boolean;
  /** Optional simulation speed multiplier (defaults to 1.0) */
  speedMultiplier?: number;
  /** Optional subset of persona IDs (e.g. for Held-Out Eval vs Training split) */
  activePersonaIds?: string[];
  /** Optional key to reset cumulative conversion telemetry on store optimization round start */
  resetKey?: string | number;
  /** Optional custom synchronous evaluator hook (e.g. cached Gemini 4 / Decisions API overrides) */
  customDecisionResolver?: (
    persona: ShopperPersona,
    garment: GarmentAssetSet,
    config: StoreConfig
  ) => {
    decision: ShopperVerdict;
    thought: string;
    score?: number;
    suggestedMutation?: SuggestedStoreMutation;
  } | null;
  /** Live telemetry callback fired whenever a Judge emits an APPROVE (BUY) / REVISE (SKIP) verdict */
  onConversionUpdate?: (stats: ShopperConversionStats) => void;
}

/**
 * 4 Formal, Composed Architectural Product Judges
 */
export const SHOPPER_PERSONAS: ShopperPersona[] = [
  {
    id: 'brand-alignment-director',
    name: 'Brand Alignment Director',
    roleTag: 'Ethos & Identity Fit',
    jacketColor: '#ECE8DF',
    trimColor: '#C5A059',
    pantsColor: '#D8D2C5',
    shoeColor: '#B8B0A2',
    hairColor: '#DED9CE',
    skinTone: '#ECE8DF',
    accessory: 'glasses',
    walkSpeed: 0.94,
    priceCeiling: 220,
    favoritePresets: ['good-shot-club', 'kyoto-atelier', 'kinetic-concrete'],
    preferredLighting: ['warm_court_sunlight', 'kyoto_golden_hour', 'cool_gallery_spot'],
    monolithFinish: 'frosted_alabaster',
  },
  {
    id: 'merchandising-form-critic',
    name: 'Merchandising & Form Critic',
    roleTag: 'Product Mix & Silhouette Quality',
    jacketColor: '#2B2F35',
    trimColor: '#C5A059',
    pantsColor: '#23262B',
    shoeColor: '#1E2024',
    hairColor: '#2B2F35',
    skinTone: '#2B2F35',
    accessory: 'glasses',
    walkSpeed: 0.92,
    priceCeiling: 250,
    favoritePresets: ['kyoto-atelier', 'kinetic-concrete', 'good-shot-club'],
    preferredLighting: ['cool_gallery_spot', 'kyoto_golden_hour', 'warm_court_sunlight'],
    monolithFinish: 'smoked_obsidian',
  },
  {
    id: 'commercial-viability-analyst',
    name: 'Commercial Viability Analyst',
    roleTag: 'Price Elasticity & Margin',
    jacketColor: '#E6E1D6',
    trimColor: '#B89B5E',
    pantsColor: '#CFC8BA',
    shoeColor: '#B2AA9B',
    hairColor: '#E6E1D6',
    skinTone: '#E6E1D6',
    accessory: 'glasses',
    walkSpeed: 0.96,
    priceCeiling: 148,
    favoritePresets: ['good-shot-club', 'kinetic-concrete'],
    preferredLighting: ['warm_court_sunlight', 'cool_gallery_spot'],
    monolithFinish: 'frosted_alabaster',
  },
  {
    id: 'core-audience-buyer',
    name: 'Core Audience Buyer',
    roleTag: 'Desirability & Repeat Purchase',
    jacketColor: '#32363D',
    trimColor: '#C5A059',
    pantsColor: '#272A30',
    shoeColor: '#202328',
    hairColor: '#32363D',
    skinTone: '#32363D',
    accessory: 'glasses',
    walkSpeed: 0.95,
    priceCeiling: 185,
    favoritePresets: ['good-shot-club', 'kyoto-atelier'],
    preferredLighting: ['warm_court_sunlight', 'kyoto_golden_hour'],
    monolithFinish: 'smoked_obsidian',
  },
];

interface ObstacleBox2D {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  rotY: number;
}

interface ViewingStation {
  stationIndex: number;
  stationId: string;
  zoneLabel: string;
  placementPreferences: ProductPlacementZone[];
  standX: number;
  standZ: number;
  lookX: number;
  lookZ: number;
  rackId: string;
  garment: GarmentAssetSet;
  productSpec?: InventedProductSpec;
}

type JudgePhase = 'GLIDING' | 'STUDYING' | 'HOLDING_VERDICT';

interface JudgeAgentRuntime {
  persona: ShopperPersona;
  x: number;
  z: number;
  yaw: number;
  glideLean: number;
  phase: JudgePhase;
  phaseTimer: number;
  stationIndex: number;
  waypoints: Array<[number, number]>;
  waypointIdx: number;
  visitCount: number;
  lastDecision: ShopperVerdict | null;
  lastScore: number | null;
  liveThought: string;
}

interface JudgeBadgeSnapshot {
  personaId: string;
  personaName: string;
  roleTag: string;
  phase: JudgePhase;
  decision: ShopperVerdict | null;
  score: number | null;
  thought: string;
}

interface LiveDecisionsApiPayload {
  usedGeminiDecisions?: boolean;
  personaScores?: Record<
    string,
    {
      buyProbability: number;
      confidence: number;
      decision: ShopperVerdict;
      thought?: string;
    }
  >;
  mutation?: {
    choice?: SuggestedStoreMutation;
    confidence?: number;
  } | null;
}

const ROOM_BOUNDS = {
  minX: -4.15,
  maxX: 4.15,
  minZ: -1.32,
  maxZ: 6.2,
};

const JUDGE_RADIUS = 0.24;
const MIN_JUDGE_SEPARATION = 1.56; // Strictly >= 1.55m at all times
const STATION_ROTATION_INTERVAL = 6.0; // Staggered 6-second formal station transitions

function lerpAngle(current: number, target: number, alpha: number): number {
  let diff = (target - current + Math.PI) % (Math.PI * 2);
  if (diff < 0) diff += Math.PI * 2;
  diff -= Math.PI;
  return current + diff * alpha;
}

function resolveCircleObb(
  px: number,
  pz: number,
  radius: number,
  box: ObstacleBox2D
): [number, number] {
  const dx = px - box.cx;
  const dz = pz - box.cz;
  const cosR = Math.cos(box.rotY);
  const sinR = Math.sin(box.rotY);

  let lx = dx * cosR - dz * sinR;
  let lz = dx * sinR + dz * cosR;

  const cx = Math.max(-box.hx, Math.min(box.hx, lx));
  const cz = Math.max(-box.hz, Math.min(box.hz, lz));

  const nx = lx - cx;
  const nz = lz - cz;
  const distSq = nx * nx + nz * nz;

  if (distSq >= radius * radius) return [px, pz];

  if (distSq > 1e-8) {
    const dist = Math.sqrt(distSq);
    const push = radius - dist;
    lx += (nx / dist) * push;
    lz += (nz / dist) * push;
  } else {
    const penX = box.hx - Math.abs(lx);
    const penZ = box.hz - Math.abs(lz);
    if (penX < penZ) {
      lx = (lx >= 0 ? 1 : -1) * (box.hx + radius);
    } else {
      lz = (lz >= 0 ? 1 : -1) * (box.hz + radius);
    }
  }

  return [box.cx + lx * cosR + lz * sinR, box.cz - lx * sinR + lz * cosR];
}

function buildSwarmObstacles(config: StoreConfig, showSecondaryRack: boolean): ObstacleBox2D[] {
  const list: ObstacleBox2D[] = [];

  config.racks.forEach((rack, idx) => {
    if (idx > 0 && !showSecondaryRack) return;
    if (!rack.items || rack.items.length === 0) return;
    const isCapsule = rack.style === 'capsule_rail';
    list.push({
      cx: rack.position[0],
      cz: rack.position[2],
      hx: isCapsule ? 0.7 : rack.items.length >= 2 ? 0.96 : 0.68,
      hz: isCapsule ? 0.33 : 0.36,
      rotY: rack.rotationY ?? 0,
    });
  });

  // Right display pedestal & Left gallery bench
  list.push({ cx: 2.1, cz: -0.8, hx: 0.48, hz: 0.32, rotY: -0.24 });
  list.push({ cx: -2.35, cz: 0.82, hx: 0.6, hz: 0.24, rotY: 0.38 });

  if ((config.products ?? []).some((p) => p.placement === 'center_table')) {
    list.push({ cx: 0, cz: 1.08, hx: 0.44, hz: 0.28, rotY: 0 });
  }

  return list;
}

function specToGarmentAsset(spec: InventedProductSpec): GarmentAssetSet {
  return {
    id: spec.id,
    sku: spec.sku,
    title: spec.title,
    subtitle: spec.subtitle,
    price: spec.price,
    featured: spec.featured,
    productSpec: spec,
    rawUrl: spec.customCutoutUrl ?? '',
    dominantHex: spec.primaryColor,
  };
}

function formatMaterialLabel(
  spec: InventedProductSpec | undefined,
  garment: GarmentAssetSet
): string {
  if (spec?.materialFinish) {
    switch (spec.materialFinish) {
      case 'matte_stoneware':
        return 'matte stoneware';
      case 'frosted_glass':
        return 'frosted apothecary glass';
      case 'heavy_canvas':
        return 'heavyweight canvas';
      case 'merino_knit':
        return 'fine merino knit';
      case 'brushed_fleece':
        return 'heavyweight brushed fleece';
      case 'combed_cotton':
        return 'combed cotton jersey';
    }
  }
  const text = `${garment.title} ${garment.subtitle ?? ''}`.toLowerCase();
  if (text.includes('stoneware') || text.includes('mug') || text.includes('ceramic')) {
    return 'matte stoneware';
  }
  if (text.includes('cardigan') || text.includes('merino') || text.includes('knit')) {
    return 'structured gauge knit';
  }
  if (text.includes('polo') || text.includes('pique')) {
    return 'mercerized pique';
  }
  if (text.includes('tote') || text.includes('canvas')) {
    return 'heavyweight canvas';
  }
  if (text.includes('hoodie') || text.includes('fleece')) {
    return 'heavyweight fleece';
  }
  if (text.includes('jacket') || text.includes('varsity')) {
    return 'tailored wool-blend';
  }
  if (text.includes('bottle') || text.includes('scent') || text.includes('apothecary')) {
    return 'architectural glass';
  }
  if (text.includes('book') || text.includes('monograph')) {
    return 'linen-bound archival';
  }
  return 'combed cotton';
}

/**
 * Builds the 5 well-separated gallery stations (4 primary fixture stations + 1 verso alcove station
 * so one judge can glide cleanly into the single open station every 6s with >= 1.58m separation).
 *
 * Pairwise distances:
 *   S0 [-2.12, 1.40] <-> S1 [-0.64, 1.96] = 1.582m
 *   S1 [-0.64, 1.96] <-> S2 [ 0.96, 1.85] = 1.604m
 *   S2 [ 0.96, 1.85] <-> S3 [ 2.15, 0.35] = 1.915m
 *   S3 [ 2.15, 0.35] <-> S4 [ 0.88,-0.98] = 1.839m
 */
function buildViewingStations(
  config: StoreConfig,
  showSecondaryRack: boolean
): ViewingStation[] {
  const products = config.products ?? [];
  const heroRack = config.racks[0];
  const capsuleRack = showSecondaryRack ? config.racks[1] : undefined;

  const fallbackHeroGarment: GarmentAssetSet = heroRack?.items[0] ??
    (products[0] ? specToGarmentAsset(products[0]) : undefined) ?? {
      id: 'flagship-hero-piece',
      sku: 'HERO-01',
      title: `${config.brandName} Signature Piece`,
      price: 68,
      featured: true,
      rawUrl: '',
    };

  const findProductByZone = (zones: ProductPlacementZone[]): InventedProductSpec | undefined => {
    for (const z of zones) {
      const match = products.find((p) => p.placement === z);
      if (match) return match;
    }
    return undefined;
  };

  // Station 0: Capsule Rack / Left Pedestal ([-2.12, 0, 1.40])
  const s0Spec = findProductByZone(
    showSecondaryRack ? ['capsule_rack', 'left_pedestal'] : ['left_pedestal', 'hero_rack']
  );
  const s0Garment =
    (s0Spec ? specToGarmentAsset(s0Spec) : undefined) ??
    capsuleRack?.items[0] ??
    heroRack?.items[1] ??
    fallbackHeroGarment;

  // Station 1: Centre Hero Stand ([-0.64, 0, 1.96])
  const s1Spec =
    products.find((p) => p.placement === 'hero_rack' && p.featured) ??
    findProductByZone(['hero_rack']);
  const s1Garment =
    heroRack?.items[0] ??
    (s1Spec ? specToGarmentAsset(s1Spec) : undefined) ??
    fallbackHeroGarment;

  // Station 2: Center Table / Featured Collection ([0.96, 0, 1.85])
  const s2Spec = findProductByZone(['center_table', 'hero_rack']);
  const s2Garment =
    (s2Spec && s2Spec.placement === 'center_table' ? specToGarmentAsset(s2Spec) : undefined) ??
    capsuleRack?.items[1] ??
    heroRack?.items[1] ??
    s1Garment;

  // Station 3: Right Pedestal ([2.15, 0, 0.35])
  const s3Spec = findProductByZone(['right_pedestal', 'center_table']);
  const s3Garment =
    (s3Spec ? specToGarmentAsset(s3Spec) : undefined) ??
    capsuleRack?.items[0] ??
    s1Garment;

  // Station 4: Hero Verso / 360° Construction Study ([0.88, 0, -0.98])
  const s4Spec = s1Spec ?? s0Spec;
  const s4Garment = s1Garment;

  return [
    {
      stationIndex: 0,
      stationId: 'station-capsule-left',
      zoneLabel: s0Spec?.placement === 'left_pedestal' ? 'left gallery plinth' : 'capsule rail',
      placementPreferences: ['capsule_rack', 'left_pedestal'],
      standX: -1.72,
      standZ: 0.96,
      lookX: showSecondaryRack && capsuleRack ? capsuleRack.position[0] : -1.85,
      lookZ: showSecondaryRack && capsuleRack ? capsuleRack.position[2] : 0.45,
      rackId: capsuleRack?.id ?? heroRack?.id ?? 'capsule-zone',
      garment: s0Garment,
      productSpec: s0Spec ?? s0Garment.productSpec,
    },
    {
      stationIndex: 1,
      stationId: 'station-hero-stand',
      zoneLabel: 'centre hero stand',
      placementPreferences: ['hero_rack'],
      standX: -0.84,
      standZ: 0.76,
      lookX: heroRack?.position[0] ?? 0,
      lookZ: heroRack?.position[2] ?? 0,
      rackId: heroRack?.id ?? 'hero-zone',
      garment: s1Garment,
      productSpec: s1Spec ?? s1Garment.productSpec,
    },
    {
      stationIndex: 2,
      stationId: 'station-center-table',
      zoneLabel: s2Spec?.placement === 'center_table' ? 'center display table' : 'foreground hero axis',
      placementPreferences: ['center_table', 'hero_rack'],
      standX: 0.98,
      standZ: 1.56,
      lookX: s2Spec?.placement === 'center_table' ? 1.55 : 0,
      lookZ: s2Spec?.placement === 'center_table' ? 0.65 : 0,
      rackId: s2Spec?.placement === 'center_table' ? 'center-table' : heroRack?.id ?? 'center-zone',
      garment: s2Garment,
      productSpec: s2Spec ?? s2Garment.productSpec,
    },
    {
      stationIndex: 3,
      stationId: 'station-right-pedestal',
      zoneLabel: 'right travertine pedestal',
      placementPreferences: ['right_pedestal'],
      standX: 2.34,
      standZ: -0.22,
      lookX: 2.35,
      lookZ: -0.85,
      rackId: s3Spec ? 'right-pedestal' : capsuleRack?.id ?? heroRack?.id ?? 'pedestal-zone',
      garment: s3Garment,
      productSpec: s3Spec ?? s3Garment.productSpec,
    },
    {
      stationIndex: 4,
      stationId: 'station-hero-verso',
      zoneLabel: 'verso tailoring axis',
      placementPreferences: ['hero_rack'],
      standX: 0.88,
      standZ: -0.98,
      lookX: heroRack?.position[0] ?? 0,
      lookZ: heroRack?.position[2] ?? 0,
      rackId: heroRack?.id ?? 'hero-verso-zone',
      garment: s4Garment,
      productSpec: s4Spec ?? s4Garment.productSpec,
    },
  ];
}

/**
 * Plans smooth, collision-free gallery waypoints between adjacent viewing stations
 * while maintaining >= 1.56m separation from all stationary judges.
 */
function planFormalStationTransition(
  fromIdx: number,
  toIdx: number,
  stations: ViewingStation[]
): Array<[number, number]> {
  const target = stations[toIdx];
  if (!target) return [[0, 1.9]];

  // Wraparound transition from Station 4 (Hero Verso [0.88, -0.98]) -> Station 0 (Capsule Left [-2.12, 1.40])
  // Routes behind hero stand and through the wide left gallery aisle clear of Station 1 [-0.64, 1.96]
  if (fromIdx === 4 && toIdx === 0) {
    return [
      [-0.46, -1.02],
      [-1.46, 0.24],
      [target.standX, target.standZ],
    ];
  }

  return [[target.standX, target.standZ]];
}

/**
 * Deterministic, Brand-Ethos-aware formal product judge evaluator grounded in StoreConfig,
 * InventedProductSpec, price architecture, lighting register, and spatial presentation.
 */
export function evaluateShopperDecision(
  persona: ShopperPersona,
  garment: GarmentAssetSet,
  config: StoreConfig,
  visitSeed = 0,
  productSpecOverride?: InventedProductSpec
): {
  decision: ShopperVerdict;
  thought: string;
  score: number;
  suggestedMutation?: SuggestedStoreMutation;
} {
  const spec = productSpecOverride ?? garment.productSpec;
  const price = spec?.price ?? garment.price;
  const title = spec?.title ?? garment.title;
  const isHero = Boolean(spec?.featured ?? garment.featured);
  const materialLabel = formatMaterialLabel(spec, garment);
  const ethosText = (config.brandEthos || config.vibe || 'refined retail architecture').trim();
  const vibeLower = `${config.id} ${config.vibe} ${ethosText}`.toLowerCase();
  const isBrutalist =
    config.id === 'kinetic-concrete' ||
    vibeLower.includes('brutalist') ||
    vibeLower.includes('concrete');

  let score = 0.62;

  // 1. Price elasticity relative to judge's category benchmark
  if (price <= persona.priceCeiling * 0.68) {
    score += 0.2;
  } else if (price <= persona.priceCeiling) {
    score += 0.11;
  } else if (price <= persona.priceCeiling * 1.22) {
    score -= 0.16;
  } else {
    score -= 0.34;
  }

  // 2. Store ethos & architectural preset coherence
  if (persona.favoritePresets.includes(config.id) || Boolean(config.brandEthos)) {
    score += 0.08;
  } else {
    score -= 0.06;
  }

  // 3. Lighting preset vs material harmony
  if (persona.preferredLighting.includes(config.lightingPreset)) {
    score += 0.06;
  } else {
    score -= 0.05;
  }

  // 4. Hero merchandising focal lift
  if (isHero) {
    score += 0.06;
  }

  // Subtle deterministic variation per product & station pass
  const jitter = (((visitSeed * 29 + title.length * 17 + Math.round(price)) % 9) - 4) * 0.012;
  score = THREE.MathUtils.clamp(score + jitter, 0.18, 0.96);

  const decision: ShopperVerdict = score >= 0.56 ? 'BUY' : 'SKIP';

  switch (persona.id) {
    case 'brand-alignment-director': {
      if (decision === 'BUY') {
        return {
          decision,
          score,
          thought: `Strong category extension for this brand ethos — ${title} ($${price}) translates ${materialLabel} identity cleanly.`,
        };
      }
      return {
        decision,
        score,
        thought: `${title} ($${price}) diverges slightly from the gallery lighting register — recalibrate warmth to anchor brand identity.`,
        suggestedMutation: 'adjust_lighting',
      };
    }

    case 'merchandising-form-critic': {
      if (decision === 'BUY') {
        return {
          decision,
          score,
          thought: `Composed ${materialLabel} proportion on ${title} ($${price}) anchors the fixture sightline with editorial clarity.`,
        };
      }
      return {
        decision,
        score,
        thought: `${title} ($${price}) requires stronger focal contrast on this fixture — edit surrounding rail density.`,
        suggestedMutation: isHero ? 'adjust_lighting' : 'declutter_aisle',
      };
    }

    case 'commercial-viability-analyst': {
      if (decision === 'BUY') {
        return {
          decision,
          score,
          thought: `Sound margin architecture on ${title} — the $${price} ${materialLabel} price point converts cleanly.`,
        };
      }
      return {
        decision,
        score,
        thought: `Projected price elasticity resistance on ${title} at $${price} — a 12% tier revision strengthens sell-through.`,
        suggestedMutation: 'reprice',
      };
    }

    case 'core-audience-buyer':
    default: {
      if (decision === 'BUY') {
        return {
          decision,
          score,
          thought: `Tactile ${materialLabel} execution on ${title} ($${price}) sustains strong repeat-purchase conviction.`,
        };
      }
      return {
        decision,
        score,
        thought: isBrutalist
          ? `Cool gallery contrast softens ${title} at $${price} — promote a higher-impact hero SKU to lead conversion.`
          : `${title} ($${price}) reads understated from the primary court — elevate hero placement to capture intent.`,
        suggestedMutation: price > persona.priceCeiling ? 'reprice' : 'swap_hero_sku',
      };
    }
  }
}

/**
 * Builds a single watertight manifold architectural human silhouette column (`y = 0.018m .. 1.385m`)
 * with smooth C2 spline contours, tailored shoulder breadth, and subtle overcoat drape — ZERO blocky limbs.
 */
function createArchitecturalMonolithBodyGeometry(): THREE.BufferGeometry {
  const profilePoints = [
    new THREE.Vector2(0.001, 0.018),
    new THREE.Vector2(0.132, 0.019),
    new THREE.Vector2(0.136, 0.048),
    new THREE.Vector2(0.114, 0.28),
    new THREE.Vector2(0.101, 0.58),
    new THREE.Vector2(0.105, 0.8),
    new THREE.Vector2(0.093, 0.985),
    new THREE.Vector2(0.121, 1.155),
    new THREE.Vector2(0.141, 1.272),
    new THREE.Vector2(0.112, 1.338),
    new THREE.Vector2(0.056, 1.375),
    new THREE.Vector2(0.045, 1.385),
    new THREE.Vector2(0.0, 1.385),
  ];

  const spline = new THREE.SplineCurve(profilePoints);
  const sampled = spline.getPoints(56);
  // Clamp exact cap endpoints so bottom and collar plane seal cleanly
  sampled[0].set(0, 0.018);
  sampled[sampled.length - 1].set(0, 1.385);

  const geo = new THREE.LatheGeometry(sampled, 56);
  const pos = geo.attributes.position;

  for (let i = 0; i < pos.count; i++) {
    const x0 = pos.getX(i);
    const y0 = pos.getY(i);
    const z0 = pos.getZ(i);
    const r0 = Math.hypot(x0, z0);

    if (r0 > 1e-5) {
      const cosPhi = x0 / r0;
      const sinPhi = z0 / r0;

      // Smooth cap fade near plinth hem (y=0.018) and collar rim (y=1.385)
      const hemFade = THREE.MathUtils.smoothstep(y0, 0.02, 0.12);
      const collarFade = 1 - THREE.MathUtils.smoothstep(y0, 1.33, 1.384);
      const sculptMask = hemFade * collarFade;

      // Tailored shoulder & integrated coat-sleeve silhouette along +-X
      const shoulderBell = Math.exp(-Math.pow((y0 - 1.255) / 0.102, 2));
      const sleeveDrape = Math.exp(-Math.pow((y0 - 1.03) / 0.215, 2));
      const lateralCubic = cosPhi * cosPhi * cosPhi;

      const x =
        x0 * 1.08 +
        lateralCubic * (0.036 * shoulderBell + 0.021 * sleeveDrape) * sculptMask;

      // Subtle forward (+Z) thoracic poise
      const chestPoise =
        0.013 * Math.exp(-Math.pow((y0 - 1.16) / 0.145, 2)) * Math.max(0, sinPhi);
      const z = z0 * 0.68 + chestPoise * sculptMask;

      pos.setXYZ(i, x, y0, z);
    }
  }

  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a featureless sculptural ovoid head (`height = 0.280m`) that hovers 1.5cm (`0.015m`)
 * above the collar (`y = 1.400m .. 1.680m`), bringing total figure height to exactly `1.68m`.
 */
function createFeaturelessOvoidHeadGeometry(): THREE.BufferGeometry {
  const headPoints = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.045, 0.018),
    new THREE.Vector2(0.077, 0.076),
    new THREE.Vector2(0.094, 0.156),
    new THREE.Vector2(0.085, 0.228),
    new THREE.Vector2(0.047, 0.268),
    new THREE.Vector2(0.0, 0.28),
  ];

  const spline = new THREE.SplineCurve(headPoints);
  const sampled = spline.getPoints(36);
  sampled[0].set(0, 0.0);
  sampled[sampled.length - 1].set(0, 0.28);

  const geo = new THREE.LatheGeometry(sampled, 40);
  geo.scale(0.88, 1.0, 1.02);
  geo.computeVertexNormals();
  return geo;
}

interface JudgeSilhouetteFigureProps {
  persona: ShopperPersona;
  config: StoreConfig;
  badge: JudgeBadgeSnapshot;
  bodyGeo: THREE.BufferGeometry;
  headGeo: THREE.BufferGeometry;
  rootRef: (el: THREE.Group | null) => void;
  figureRef: (el: THREE.Group | null) => void;
  headRef: (el: THREE.Mesh | null) => void;
}

/**
 * Museum-Grade Faceless Architectural Scale Silhouette Figure (`height = 1.68m`)
 * with frosted-alabaster / smoked-obsidian `MeshPhysicalMaterial`, thin brushed-brass plinth disc,
 * and clean dark-glass verdict pill at `y = 1.84m`.
 */
const JudgeSilhouetteFigure: React.FC<JudgeSilhouetteFigureProps> = ({
  persona,
  config,
  badge,
  bodyGeo,
  headGeo,
  rootRef,
  figureRef,
  headRef,
}) => {
  const isApprove = badge.decision === 'BUY';
  const isRevise = badge.decision === 'SKIP';

  const { monolithColor, sheenTint } = useMemo(() => {
    const accent = new THREE.Color(config.palette.accent);
    const isObsidian = persona.monolithFinish === 'smoked_obsidian';
    const base = new THREE.Color(isObsidian ? '#282C32' : '#EFECE4');
    base.lerp(accent, isObsidian ? 0.12 : 0.08);

    const sheen = new THREE.Color(isObsidian ? '#D8D4CA' : '#FFFFFF').lerp(accent, 0.45);
    return {
      monolithColor: `#${base.getHexString()}`,
      sheenTint: `#${sheen.getHexString()}`,
    };
  }, [config.palette.accent, persona.monolithFinish]);

  const pct =
    badge.score !== null
      ? Math.round(THREE.MathUtils.clamp(badge.score, 0.01, 0.99) * 100)
      : isApprove
        ? 84
        : 42;

  const cardBorderColor = isApprove
    ? 'rgba(118, 178, 145, 0.44)'
    : isRevise
      ? 'rgba(214, 142, 108, 0.44)'
      : 'rgba(255, 255, 255, 0.15)';

  const plinthRingColor = isApprove
    ? '#76B291'
    : isRevise
      ? '#D68E6C'
      : config.palette.accent;

  return (
    <group ref={rootRef} name={`judge-silhouette-${persona.id}`}>
      {/* Thin Brushed-Brass / Anodized-Ring Floor Plinth Disc */}
      <mesh position={[0, 0.007, 0]} receiveShadow>
        <cylinderGeometry args={[0.186, 0.198, 0.014, 48]} />
        <meshStandardMaterial
          color={config.palette.rackMetal}
          metalness={0.84}
          roughness={0.28}
        />
      </mesh>
      <mesh position={[0, 0.0085, 0]} receiveShadow>
        <cylinderGeometry args={[0.162, 0.162, 0.017, 48]} />
        <meshStandardMaterial
          color={config.palette.plinth}
          roughness={0.52}
          metalness={0.06}
        />
      </mesh>
      <mesh position={[0, 0.0176, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.165, 0.181, 48]} />
        <meshBasicMaterial
          color={plinthRingColor}
          transparent
          opacity={isApprove || isRevise ? 0.72 : 0.36}
        />
      </mesh>

      {/* Composed Sculptural Monolith Silhouette (Height = 1.68m) */}
      <group ref={figureRef}>
        {/* Smooth LatheGeometry Sculpted Torso / Overcoat Column (y = 0.018 .. 1.385m) */}
        <mesh geometry={bodyGeo} castShadow receiveShadow>
          <meshPhysicalMaterial
            color={monolithColor}
            roughness={0.32}
            metalness={0.08}
            opacity={0.88}
            transparent
            clearcoat={0.5}
            clearcoatRoughness={0.22}
            sheen={0.52}
            sheenRoughness={0.36}
            sheenColor={sheenTint}
            ior={1.48}
          />
        </mesh>

        {/* Subtle Brushed-Brass Collar Bezel Ring at y = 1.385m */}
        <mesh
          position={[0, 1.385, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[1.06, 0.68, 1]}
        >
          <torusGeometry args={[0.045, 0.003, 12, 36]} />
          <meshStandardMaterial
            color={config.palette.rackMetal}
            metalness={0.85}
            roughness={0.26}
          />
        </mesh>

        {/* Featureless Ovoid Sculptural Head Hovering 1.5cm Above Collar (y = 1.400 .. 1.680m) */}
        <mesh
          ref={headRef}
          geometry={headGeo}
          position={[0, 1.4, 0.004]}
          castShadow
          receiveShadow
        >
          <meshPhysicalMaterial
            color={monolithColor}
            roughness={0.32}
            metalness={0.08}
            opacity={0.88}
            transparent
            clearcoat={0.5}
            clearcoatRoughness={0.22}
            sheen={0.52}
            sheenRoughness={0.36}
            sheenColor={sheenTint}
            ior={1.48}
          />
        </mesh>
      </group>

      {/* Refined Formal Dark-Glass Verdict Card (without distanceFactor) */}
      <Html
        position={[0, 1.84, 0]}
        center
        zIndexRange={[12, 0]}
        pointerEvents="none"
      >
        <div
          style={{
            width: 248,
            padding: '7px 11px',
            borderRadius: 10,
            background: 'rgba(14, 15, 16, 0.86)',
            backdropFilter: 'blur(12px)',
            border: `1px solid ${cardBorderColor}`,
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.34)',
            color: '#F4F1EA',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            pointerEvents: 'none',
            userSelect: 'none',
            transform: 'scale(0.84)',
            transformOrigin: 'center bottom',
            transition: 'border-color 0.25s ease',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              marginBottom: 4,
            }}
          >
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                letterSpacing: '0.02em',
                color: '#F7F4EC',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {badge.personaName}
            </span>

            {badge.decision ? (
              <span
                style={{
                  padding: '2px 7px',
                  borderRadius: 999,
                  fontSize: 9.2,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  background: isApprove
                    ? 'rgba(74, 124, 98, 0.28)'
                    : 'rgba(168, 98, 68, 0.28)',
                  color: isApprove ? '#B7DEC8' : '#EBC0A8',
                  border: isApprove
                    ? '1px solid rgba(118, 178, 145, 0.52)'
                    : '1px solid rgba(214, 142, 108, 0.52)',
                  flexShrink: 0,
                }}
              >
                {isApprove ? `APPROVE · ${pct}%` : `REVISE · ${pct}%`}
              </span>
            ) : (
              <span
                style={{
                  padding: '2px 7px',
                  borderRadius: 999,
                  fontSize: 8.8,
                  fontWeight: 600,
                  letterSpacing: '0.07em',
                  background: 'rgba(197, 160, 89, 0.16)',
                  color: '#DFC99B',
                  border: '1px solid rgba(197, 160, 89, 0.34)',
                  flexShrink: 0,
                }}
              >
                EVALUATING
              </span>
            )}
          </div>

          <div
            style={{
              fontSize: 10.2,
              lineHeight: 1.35,
              color: 'rgba(244, 241, 234, 0.84)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {badge.thought}
          </div>
        </div>
      </Html>
    </group>
  );
};

export const ShopperSwarmLayer: React.FC<ShopperSwarmLayerProps> = ({
  config,
  enabled = true,
  showSecondaryRack = true,
  speedMultiplier = 1,
  activePersonaIds,
  resetKey,
  customDecisionResolver,
  onConversionUpdate,
}) => {
  const activePersonas = useMemo(() => {
    if (!activePersonaIds || activePersonaIds.length === 0) {
      return SHOPPER_PERSONAS;
    }
    const set = new Set(activePersonaIds);
    const filtered = SHOPPER_PERSONAS.filter((p) => set.has(p.id));
    return filtered.length > 0 ? filtered : SHOPPER_PERSONAS;
  }, [activePersonaIds]);

  // Shared museum-grade sculptural geometries
  const bodyGeo = useMemo(() => createArchitecturalMonolithBodyGeometry(), []);
  const headGeo = useMemo(() => createFeaturelessOvoidHeadGeometry(), []);

  useEffect(() => {
    return () => {
      bodyGeo.dispose();
      headGeo.dispose();
    };
  }, [bodyGeo, headGeo]);

  const obstacles = useMemo(
    () => buildSwarmObstacles(config, showSecondaryRack),
    [config, showSecondaryRack]
  );

  const viewingStations = useMemo(
    () => buildViewingStations(config, showSecondaryRack),
    [config, showSecondaryRack]
  );

  // Refs for zero-stale useFrame access
  const configRef = useRef(config);
  configRef.current = config;
  const stationsRef = useRef(viewingStations);
  stationsRef.current = viewingStations;
  const obstaclesRef = useRef(obstacles);
  obstaclesRef.current = obstacles;
  const onConversionRef = useRef(onConversionUpdate);
  onConversionRef.current = onConversionUpdate;
  const customResolverRef = useRef(customDecisionResolver);
  customResolverRef.current = customDecisionResolver;

  // Live Gemini Decision 1 + Gemini 4 Hydrogen calibration cache per config.id
  const liveDecisionsRef = useRef<{
    configId: string;
    personaScores: NonNullable<LiveDecisionsApiPayload['personaScores']>;
    recommendedMutation?: SuggestedStoreMutation;
  } | null>(null);

  // Asynchronously query POST /api/decisions-eval once in the background when enabled for a config.id
  useEffect(() => {
    if (!enabled) return;

    const targetConfigId = config.id;
    const controller = new AbortController();

    fetch('/api/decisions-eval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeConfig: configRef.current,
        personas: activePersonas.map((p) => ({
          id: p.id,
          name: p.name,
          roleTag: p.roleTag,
          priceCeiling: p.priceCeiling,
        })),
      }),
      signal: controller.signal,
    })
      .then((res) => (res.ok ? (res.json() as Promise<LiveDecisionsApiPayload>) : null))
      .then((payload) => {
        if (
          !controller.signal.aborted &&
          payload?.usedGeminiDecisions &&
          payload.personaScores
        ) {
          liveDecisionsRef.current = {
            configId: targetConfigId,
            personaScores: payload.personaScores,
            recommendedMutation: payload.mutation?.choice,
          };
          // Nudge stationary judges to refresh their verdict with live calibrated Gemini scores
          agentsRef.current.forEach((agent, idx) => {
            if (agent.phase === 'HOLDING_VERDICT') {
              agent.phase = 'STUDYING';
              agent.phaseTimer = 0.18 + idx * 0.22;
            }
          });
        }
      })
      .catch(() => {
        // Graceful deterministic merchandising fallback when offline or GEMINI_API_KEY is unset
      });

    return () => {
      controller.abort();
    };
  }, [enabled, config.id, activePersonas]);

  // Cumulative conversion stats ref
  const statsRef = useRef<{
    totalDecisions: number;
    buys: number;
    recentFeed: ShopperDecisionEvent[];
  }>({
    totalDecisions: 0,
    buys: 0,
    recentFeed: [],
  });

  useEffect(() => {
    if (resetKey === undefined) return;
    statsRef.current = { totalDecisions: 0, buys: 0, recentFeed: [] };
    onConversionRef.current?.({
      totalDecisions: 0,
      buys: 0,
      conversionRate: 0,
      recentFeed: [],
    });
  }, [resetKey]);

  const agentsRef = useRef<JudgeAgentRuntime[]>([]);
  const rotationTimerRef = useRef<number>(STATION_ROTATION_INTERVAL);
  const emptyStationIdxRef = useRef<number>(4);

  const [badges, setBadges] = useState<Record<string, JudgeBadgeSnapshot>>({});

  const rootRefs = useRef<Record<string, THREE.Group | null>>({});
  const figureRefs = useRef<Record<string, THREE.Group | null>>({});
  const headRefs = useRef<Record<string, THREE.Mesh | null>>({});

  // Initialize the 4 Formal Judges at the 4 primary viewing stations with staggered initial study timers
  useEffect(() => {
    if (!enabled) {
      agentsRef.current = [];
      return;
    }

    const stations = stationsRef.current;
    const initialBadges: Record<string, JudgeBadgeSnapshot> = {};

    const initialized: JudgeAgentRuntime[] = activePersonas.map((persona, idx) => {
      const station = stations[idx % Math.min(4, stations.length)];
      const yaw = Math.atan2(
        station.lookX - station.standX,
        station.lookZ - station.standZ
      );
      const studyNote = `Reviewing ${station.garment.title} ($${station.garment.price}) at the ${station.zoneLabel}.`;

      initialBadges[persona.id] = {
        personaId: persona.id,
        personaName: persona.name,
        roleTag: persona.roleTag,
        phase: 'STUDYING',
        decision: null,
        score: null,
        thought: studyNote,
      };

      return {
        persona,
        x: station.standX,
        z: station.standZ,
        yaw,
        glideLean: 0,
        phase: 'STUDYING',
        phaseTimer: 0.85 + idx * 0.75,
        stationIndex: station.stationIndex,
        waypoints: [],
        waypointIdx: 0,
        visitCount: 0,
        lastDecision: null,
        lastScore: null,
        liveThought: studyNote,
      };
    });

    agentsRef.current = initialized;
    emptyStationIdxRef.current = 4;
    rotationTimerRef.current = STATION_ROTATION_INTERVAL;
    setBadges(initialBadges);
  }, [enabled, activePersonas, config.id, resetKey]);

  useFrame((state, rawDelta) => {
    if (!enabled || agentsRef.current.length === 0) return;

    const dt = Math.min(rawDelta, 0.05) * Math.max(0.25, speedMultiplier);
    const elapsed = state.clock.elapsedTime;
    const agents = agentsRef.current;
    const stations = stationsRef.current;
    const obsList = obstaclesRef.current;

    const badgeUpdates: Record<string, JudgeBadgeSnapshot> = {};
    let hasBadgeUpdates = false;

    const queueBadgeUpdate = (agent: JudgeAgentRuntime) => {
      hasBadgeUpdates = true;
      badgeUpdates[agent.persona.id] = {
        personaId: agent.persona.id,
        personaName: agent.persona.name,
        roleTag: agent.persona.roleTag,
        phase: agent.phase,
        decision: agent.lastDecision,
        score: agent.lastScore,
        thought: agent.liveThought,
      };
    };

    // Staggered 6-second station advancement: step the single adjacent judge into the open station
    const anyGliding = agents.some((a) => a.phase === 'GLIDING');
    if (!anyGliding && stations.length >= 5) {
      rotationTimerRef.current -= dt;
      if (rotationTimerRef.current <= 0) {
        rotationTimerRef.current = STATION_ROTATION_INTERVAL;
        const openIdx = emptyStationIdxRef.current;

        // Walk backward around the 5-station loop to find the nearest stationed judge
        let mover: JudgeAgentRuntime | undefined;
        for (let step = 1; step < stations.length; step++) {
          const candidateIdx = (openIdx - step + stations.length) % stations.length;
          const found = agents.find(
            (a) => a.stationIndex === candidateIdx && a.phase === 'HOLDING_VERDICT'
          );
          if (found) {
            mover = found;
            break;
          }
        }

        if (mover) {
          const prevIdx = mover.stationIndex;
          const nextStation = stations[openIdx];
          mover.stationIndex = openIdx;
          emptyStationIdxRef.current = prevIdx;
          mover.waypoints = planFormalStationTransition(prevIdx, openIdx, stations);
          mover.waypointIdx = 0;
          mover.phase = 'GLIDING';
          mover.lastDecision = null;
          mover.lastScore = null;
          mover.liveThought = `Proceeding to evaluate ${nextStation.garment.title} ($${nextStation.garment.price}).`;
          queueBadgeUpdate(mover);
        }
      }
    }

    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      const station = stations[agent.stationIndex] ?? stations[0];
      let moveVx = 0;
      let moveVz = 0;
      let isGliding = false;

      if (agent.phase === 'GLIDING') {
        const wp = agent.waypoints[agent.waypointIdx];
        if (wp) {
          const dx = wp[0] - agent.x;
          const dz = wp[1] - agent.z;
          const dist = Math.hypot(dx, dz);

          if (dist < 0.06) {
            if (agent.waypointIdx < agent.waypoints.length - 1) {
              agent.waypointIdx += 1;
            } else {
              agent.x = station.standX;
              agent.z = station.standZ;
              agent.phase = 'STUDYING';
              agent.phaseTimer = 1.65;
              agent.liveThought = `Evaluating ${station.garment.title} ($${station.garment.price}) at the ${station.zoneLabel}.`;
              queueBadgeUpdate(agent);
            }
          } else {
            // Smooth arrival ease-out over final 35cm
            const ease = THREE.MathUtils.clamp(dist / 0.35, 0.35, 1.0);
            const speed = agent.persona.walkSpeed * ease;
            moveVx = (dx / dist) * speed;
            moveVz = (dz / dist) * speed;
            isGliding = true;
          }
        }
      } else if (agent.phase === 'STUDYING') {
        agent.phaseTimer -= dt;
        const lookYaw = Math.atan2(
          station.lookX - agent.x,
          station.lookZ - agent.z
        );
        agent.yaw = lerpAngle(agent.yaw, lookYaw, Math.min(1, dt * 5.5));

        if (agent.phaseTimer <= 0) {
          const garment = station.garment;
          agent.visitCount += 1;

          const custom = customResolverRef.current?.(
            agent.persona,
            garment,
            configRef.current
          );

          const deterministic = evaluateShopperDecision(
            agent.persona,
            garment,
            configRef.current,
            agent.visitCount,
            station.productSpec
          );

          // Blend live POST /api/decisions-eval calibration when available for active config
          const liveCache =
            liveDecisionsRef.current?.configId === configRef.current.id
              ? liveDecisionsRef.current
              : null;
          const livePersona = liveCache?.personaScores[agent.persona.id];

          let resolvedDecision = custom?.decision ?? deterministic.decision;
          let resolvedScore =
            custom?.score ?? deterministic.score;
          let resolvedThought = custom?.thought ?? deterministic.thought;
          let resolvedMutation =
            custom?.suggestedMutation ??
            liveCache?.recommendedMutation ??
            deterministic.suggestedMutation;

          if (!custom && livePersona) {
            const isHeroStation =
              station.stationIndex === 1 || Boolean(garment.featured);
            resolvedScore = isHeroStation
              ? THREE.MathUtils.clamp(livePersona.buyProbability, 0.04, 0.98)
              : THREE.MathUtils.clamp(
                  livePersona.buyProbability * 0.65 + deterministic.score * 0.35,
                  0.05,
                  0.97
                );
            resolvedDecision = resolvedScore >= 0.54 ? 'BUY' : 'SKIP';
            if (isHeroStation && livePersona.thought && livePersona.thought.trim().length > 8) {
              const rawCritique = livePersona.thought.trim();
              resolvedThought = rawCritique.includes(garment.title)
                ? rawCritique
                : `${garment.title} ($${garment.price}) — ${rawCritique}`;
            } else {
              // Ensure deterministic critique sign matches calibrated decision
              if (resolvedDecision !== deterministic.decision) {
                resolvedThought =
                  resolvedDecision === 'BUY'
                    ? `Calibrated review approves ${garment.title} ($${garment.price}) — cohesive fit for ${configRef.current.brandName}.`
                    : `Calibrated review flags ${garment.title} ($${garment.price}) — refine merchandising contrast or pricing.`;
              }
            }
          }

          agent.lastDecision = resolvedDecision;
          agent.lastScore = resolvedScore;
          agent.liveThought = resolvedThought;
          agent.phase = 'HOLDING_VERDICT';
          queueBadgeUpdate(agent);

          const event: ShopperDecisionEvent = {
            id: `${agent.persona.id}-${Date.now()}-${agent.visitCount}`,
            timestamp: Date.now(),
            personaId: agent.persona.id,
            personaName: agent.persona.name,
            roleTag: agent.persona.roleTag,
            garmentId: garment.id,
            garmentTitle: garment.title,
            garmentPrice: garment.price,
            rackId: station.rackId,
            decision: resolvedDecision,
            thought: resolvedThought,
            score: resolvedScore,
            suggestedMutation: resolvedMutation,
          };

          const st = statsRef.current;
          st.totalDecisions += 1;
          if (resolvedDecision === 'BUY') {
            st.buys += 1;
          }
          st.recentFeed = [event, ...st.recentFeed].slice(0, 18);

          onConversionRef.current?.({
            totalDecisions: st.totalDecisions,
            buys: st.buys,
            conversionRate: st.totalDecisions > 0 ? st.buys / st.totalDecisions : 0,
            recentFeed: st.recentFeed,
          });
        }
      } else {
        // HOLDING_VERDICT: remain composed & oriented toward fixture
        const lookYaw = Math.atan2(
          station.lookX - agent.x,
          station.lookZ - agent.z
        );
        agent.yaw = lerpAngle(agent.yaw, lookYaw, Math.min(1, dt * 4.5));
      }

      // Enforce strict minimum separation >= 1.56m so two judges never crowd
      if (isGliding) {
        let nx = agent.x + moveVx * dt;
        let nz = agent.z + moveVz * dt;

        for (let j = 0; j < agents.length; j++) {
          if (i === j) continue;
          const other = agents[j];
          const dx = nx - other.x;
          const dz = nz - other.z;
          const d = Math.hypot(dx, dz);
          if (d > 1e-5 && d < MIN_JUDGE_SEPARATION) {
            const push = MIN_JUDGE_SEPARATION - d;
            nx += (dx / d) * push;
            nz += (dz / d) * push;
          }
        }

        for (const box of obsList) {
          [nx, nz] = resolveCircleObb(nx, nz, JUDGE_RADIUS, box);
        }

        nx = THREE.MathUtils.clamp(nx, ROOM_BOUNDS.minX, ROOM_BOUNDS.maxX);
        nz = THREE.MathUtils.clamp(nz, ROOM_BOUNDS.minZ, ROOM_BOUNDS.maxZ);

        const actualVx = (nx - agent.x) / Math.max(dt, 1e-4);
        const actualVz = (nz - agent.z) / Math.max(dt, 1e-4);
        agent.x = nx;
        agent.z = nz;

        if (Math.hypot(actualVx, actualVz) > 0.08) {
          const moveYaw = Math.atan2(actualVx, actualVz);
          agent.yaw = lerpAngle(agent.yaw, moveYaw, Math.min(1, dt * 5.2));
        }
      }

      // Serene, museum-grade silhouette transform (zero leg-kicking, zero jumping!)
      const root = rootRefs.current[agent.persona.id];
      const figure = figureRefs.current[agent.persona.id];
      const head = headRefs.current[agent.persona.id];

      if (root) {
        root.position.set(agent.x, 0, agent.z);
        root.rotation.y = agent.yaw;
      }

      const targetLean = isGliding ? 0.016 : 0;
      agent.glideLean = THREE.MathUtils.lerp(
        agent.glideLean,
        targetLean,
        Math.min(1, dt * 6)
      );

      if (figure) {
        figure.rotation.x = agent.glideLean;
      }

      if (head) {
        // Subtle 1.5mm levitation poise above the 1.5cm collar gap
        head.position.y = 1.4 + Math.sin(elapsed * 1.35 + i * 1.4) * 0.0018;
        head.rotation.y =
          agent.phase === 'STUDYING'
            ? Math.sin(elapsed * 1.1 + i) * 0.045
            : THREE.MathUtils.lerp(head.rotation.y, 0, Math.min(1, dt * 5));
      }
    }

    if (hasBadgeUpdates) {
      setBadges((prev) => ({ ...prev, ...badgeUpdates }));
    }
  });

  if (!enabled) return null;

  return (
    <group name="architectural-product-judges-layer">
      {activePersonas.map((persona) => {
        const badge: JudgeBadgeSnapshot = badges[persona.id] ?? {
          personaId: persona.id,
          personaName: persona.name,
          roleTag: persona.roleTag,
          phase: 'STUDYING',
          decision: null,
          score: null,
          thought: `Evaluating ${config.brandName} collection...`,
        };

        return (
          <JudgeSilhouetteFigure
            key={persona.id}
            persona={persona}
            config={config}
            badge={badge}
            bodyGeo={bodyGeo}
            headGeo={headGeo}
            rootRef={(el) => {
              rootRefs.current[persona.id] = el;
            }}
            figureRef={(el) => {
              figureRefs.current[persona.id] = el;
            }}
            headRef={(el) => {
              headRefs.current[persona.id] = el;
            }}
          />
        );
      })}
    </group>
  );
};
