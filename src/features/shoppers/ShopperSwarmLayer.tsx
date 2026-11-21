import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html, RoundedBox } from '@react-three/drei';
import type { GarmentAssetSet, StoreConfig } from '../../types/storeConfig';

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
  /** Enables/disables the 3D synthetic shopper swarm (defaults to true) */
  enabled?: boolean;
  /** Whether secondary capsule rack is visible in scene (defaults to true) */
  showSecondaryRack?: boolean;
  /** Optional simulation speed multiplier (defaults to 1.0) */
  speedMultiplier?: number;
  /** Optional subset of persona IDs (e.g. for Held-Out Eval vs Training split) */
  activePersonaIds?: string[];
  /** Optional key to reset cumulative conversion telemetry on store optimization round start */
  resetKey?: string | number;
  /** Optional custom synchronous evaluator hook (e.g. cached Gemini 4 Neon / Decisions API overrides) */
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
  /** Live telemetry callback fired whenever an NPC shopper emits a BUY / SKIP decision */
  onConversionUpdate?: (stats: ShopperConversionStats) => void;
}

export const SHOPPER_PERSONAS: ShopperPersona[] = [
  {
    id: 'minimalist-mia',
    name: 'Minimalist Mia',
    roleTag: 'Warm Minimalist',
    jacketColor: '#E6DDD0',
    trimColor: '#FAF7F0',
    pantsColor: '#2E3136',
    shoeColor: '#F4F0E6',
    hairColor: '#3A2820',
    skinTone: '#F4D2B8',
    accessory: 'beret',
    walkSpeed: 1.58,
    priceCeiling: 195,
    favoritePresets: ['good-shot-club', 'kyoto-atelier'],
    preferredLighting: ['warm_court_sunlight', 'kyoto_golden_hour'],
  },
  {
    id: 'archivist-leo',
    name: 'Archivist Leo',
    roleTag: 'Textile Collector',
    jacketColor: '#4A5745',
    trimColor: '#E8E0CF',
    pantsColor: '#232D3F',
    shoeColor: '#EAE4D7',
    hairColor: '#221C18',
    skinTone: '#E0B899',
    accessory: 'headphones',
    walkSpeed: 1.44,
    priceCeiling: 260,
    favoritePresets: ['kyoto-atelier', 'kinetic-concrete', 'good-shot-club'],
    preferredLighting: ['kyoto_golden_hour', 'cool_gallery_spot'],
  },
  {
    id: 'budget-maya',
    name: 'Budget Maya',
    roleTag: 'Value Hunter',
    jacketColor: '#EED382',
    trimColor: '#FFF9EC',
    pantsColor: '#5B7594',
    shoeColor: '#FAF7F2',
    hairColor: '#4A2F23',
    skinTone: '#C9936B',
    accessory: 'cap',
    walkSpeed: 1.78,
    priceCeiling: 68,
    favoritePresets: ['good-shot-club', 'kinetic-concrete'],
    preferredLighting: ['warm_court_sunlight', 'cool_gallery_spot'],
  },
  {
    id: 'hypebeast-devon',
    name: 'Hypebeast Devon',
    roleTag: 'Streetwear Drop',
    jacketColor: '#1E2025',
    trimColor: '#FF5A1F',
    pantsColor: '#2C2F36',
    shoeColor: '#F2F4F8',
    hairColor: '#18181A',
    skinTone: '#8D5B3E',
    accessory: 'beanie',
    walkSpeed: 1.88,
    priceCeiling: 255,
    favoritePresets: ['kinetic-concrete'],
    preferredLighting: ['cool_gallery_spot'],
  },
  {
    id: 'impulse-chloe',
    name: 'Impulse Chloe',
    roleTag: 'Vibe & Hero Buyer',
    jacketColor: '#7EA674',
    trimColor: '#F7F3EA',
    pantsColor: '#DED6C6',
    shoeColor: '#FFFFFF',
    hairColor: '#8C5832',
    skinTone: '#F6D7C0',
    accessory: 'sunglasses',
    walkSpeed: 1.94,
    priceCeiling: 175,
    favoritePresets: ['good-shot-club', 'kyoto-atelier'],
    preferredLighting: ['warm_court_sunlight', 'kyoto_golden_hour'],
  },
  {
    id: 'skeptical-arthur',
    name: 'Skeptical Arthur',
    roleTag: 'Tailoring Critic',
    jacketColor: '#2B384B',
    trimColor: '#E8DFCE',
    pantsColor: '#B59B78',
    shoeColor: '#4A3525',
    hairColor: '#6D6E72',
    skinTone: '#ECC7AC',
    accessory: 'glasses',
    walkSpeed: 1.34,
    priceCeiling: 155,
    favoritePresets: ['kyoto-atelier', 'good-shot-club'],
    preferredLighting: ['warm_court_sunlight', 'kyoto_golden_hour'],
  },
];

interface ObstacleBox2D {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  rotY: number;
}

interface InspectionSlot {
  slotId: string;
  rackId: string;
  garment: GarmentAssetSet;
  standX: number;
  standZ: number;
  lookX: number;
  lookZ: number;
}

type AgentPhase = 'WALKING_TO_RACK' | 'INSPECTING' | 'REACTING' | 'STROLLING';

interface ShopperAgentRuntime {
  persona: ShopperPersona;
  x: number;
  y: number;
  z: number;
  vy: number;
  yaw: number;
  walkPhase: number;
  swingAmp: number;
  phase: AgentPhase;
  phaseTimer: number;
  targetSlot: InspectionSlot | null;
  waypoints: Array<[number, number]>;
  waypointIdx: number;
  visitCount: number;
  lastDecision: ShopperVerdict | null;
  liveThought: string;
  activeGarmentTitle: string | null;
}

interface ShopperBadgeSnapshot {
  personaId: string;
  personaName: string;
  roleTag: string;
  phase: AgentPhase;
  decision: ShopperVerdict | null;
  thought: string;
}

const ROOM_BOUNDS = {
  minX: -4.2,
  maxX: 4.2,
  minZ: -1.38,
  maxZ: 6.4,
};

const NPC_RADIUS = 0.25;
const HOP_VELOCITY = 4.25;
const HOP_GRAVITY = -14.5;

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

  list.push({ cx: 2.1, cz: -0.8, hx: 0.48, hz: 0.32, rotY: -0.24 });
  list.push({ cx: -2.35, cz: 0.82, hx: 0.6, hz: 0.24, rotY: 0.38 });

  return list;
}

/**
 * Generates collision-free standing slots around every active garment in StoreConfig.racks
 */
function buildInspectionSlots(
  config: StoreConfig,
  showSecondaryRack: boolean
): InspectionSlot[] {
  const slots: InspectionSlot[] = [];

  config.racks.forEach((rack, rIdx) => {
    if (rIdx > 0 && !showSecondaryRack) return;
    const items = rack.items ?? [];
    if (items.length === 0) return;

    const rotY = rack.rotationY ?? 0;
    const cosR = Math.cos(rotY);
    const sinR = Math.sin(rotY);
    // Local +Z normal in world space
    const fwdX = sinR;
    const fwdZ = cosR;

    items.forEach((garment, idx) => {
      const localX =
        rack.style === 'capsule_rail'
          ? items.length === 1
            ? 0
            : idx === 0
              ? -0.32
              : 0.32
          : idx === 0
            ? 0
            : idx === 1
              ? -0.63
              : 0.63;
      const localZ = rack.style === 'capsule_rail' ? 0 : idx === 0 ? 0.04 : -0.08;

      const gx = rack.position[0] + localX * cosR + localZ * sinR;
      const gz = rack.position[2] - localX * sinR + localZ * cosR;

      if (rIdx === 0 && idx === 0) {
        // Multiple natural viewing angles around the centerpiece hero rack
        slots.push({
          slotId: `${rack.id}-${garment.id}-front-left`,
          rackId: rack.id,
          garment,
          standX: gx - 0.38,
          standZ: gz + 0.96,
          lookX: gx,
          lookZ: gz,
        });
        slots.push({
          slotId: `${rack.id}-${garment.id}-front-right`,
          rackId: rack.id,
          garment,
          standX: gx + 0.4,
          standZ: gz + 0.94,
          lookX: gx,
          lookZ: gz,
        });
        slots.push({
          slotId: `${rack.id}-${garment.id}-rear-360`,
          rackId: rack.id,
          garment,
          standX: gx + 0.28,
          standZ: gz - 0.92,
          lookX: gx,
          lookZ: gz,
        });
      } else {
        const standDist = 0.92;
        slots.push({
          slotId: `${rack.id}-${garment.id}-slot-${idx}`,
          rackId: rack.id,
          garment,
          standX: THREE.MathUtils.clamp(gx + fwdX * standDist, -3.8, 3.8),
          standZ: THREE.MathUtils.clamp(gz + fwdZ * standDist, -1.25, 5.8),
          lookX: gx,
          lookZ: gz,
        });
      }
    });
  });

  return slots;
}

/**
 * Plans a smooth waypoint path that routes cleanly around the central hero rack plinth [0, 0, 0]
 * whenever crossing between the front court (z > 0.35) and rear alcove/capsule zone (z < -0.35).
 */
function planSmoothWaypoints(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number
): Array<[number, number]> {
  const crossesCenterZ =
    (fromZ > 0.32 && toZ < -0.28) || (fromZ < -0.28 && toZ > 0.32);

  if (crossesCenterZ && Math.abs(fromX + toX) * 0.5 < 1.15) {
    // Route around right gallery aisle [1.28, 0.2] or left court aisle [-1.25, 0.45]
    const sideX = toX >= 0 ? 1.28 : -1.22;
    return [
      [sideX, 0.36],
      [toX, toZ],
    ];
  }

  return [[toX, toZ]];
}

/**
 * Deterministic + Brand-DNA-aware persona reaction evaluator grounded in live StoreConfig,
 * garment price, lighting preset, and aesthetic vibe.
 */
export function evaluateShopperDecision(
  persona: ShopperPersona,
  garment: GarmentAssetSet,
  config: StoreConfig,
  visitSeed = 0
): {
  decision: ShopperVerdict;
  thought: string;
  score: number;
  suggestedMutation?: SuggestedStoreMutation;
} {
  const price = garment.price;
  const isHero = Boolean(garment.featured);
  const vibeLower = `${config.id} ${config.vibe} ${config.brandName}`.toLowerCase();
  const isBrutalist =
    config.id === 'kinetic-concrete' ||
    vibeLower.includes('brutalist') ||
    vibeLower.includes('concrete');
  const isKyoto =
    config.id === 'kyoto-atelier' ||
    vibeLower.includes('kyoto') ||
    vibeLower.includes('hinoki') ||
    vibeLower.includes('organic');
  const isHeritageCourt =
    config.id === 'good-shot-club' ||
    vibeLower.includes('wimbledon') ||
    vibeLower.includes('tennis') ||
    vibeLower.includes('court');

  let score = 0.52;

  // 1. Price vs Persona Price Ceiling
  if (price <= persona.priceCeiling * 0.65) {
    score += 0.28;
  } else if (price <= persona.priceCeiling) {
    score += 0.14;
  } else if (price <= persona.priceCeiling * 1.2) {
    score -= 0.18;
  } else {
    score -= 0.42;
  }

  // 2. Store Vibe & Preset Alignment
  if (persona.favoritePresets.includes(config.id)) {
    score += 0.18;
  } else {
    score -= 0.12;
  }

  // 3. Lighting Preset Fit
  if (persona.preferredLighting.includes(config.lightingPreset)) {
    score += 0.1;
  } else {
    score -= 0.06;
  }

  // 4. Featured Hero Face-Out Merchandising Lift
  if (isHero) {
    score += 0.09;
  }

  // Subtle deterministic variation across visits so repeat rounds stay organic
  const jitter = (((visitSeed * 37 + garment.title.length * 13) % 11) - 5) * 0.014;
  score = THREE.MathUtils.clamp(score + jitter, 0.05, 0.98);

  const decision: ShopperVerdict = score >= 0.56 ? 'BUY' : 'SKIP';

  // Rich persona-authentic thought snippets referencing actual garment & store details
  switch (persona.id) {
    case 'minimalist-mia': {
      if (decision === 'BUY') {
        if (isKyoto) {
          return {
            decision,
            score,
            thought: `Quiet hinoki palette + ${garment.title} at $${price} fits my capsule.`,
          };
        }
        return {
          decision,
          score,
          thought: `Clean ecru & sage palette — ${garment.title} ($${price}) layers effortlessly.`,
        };
      }
      return {
        decision,
        score,
        thought: isBrutalist
          ? `Concrete spot glare feels too harsh for ${garment.title} at $${price}.`
          : `$${price} feels slightly busy for my minimalist rotation right now.`,
        suggestedMutation: isBrutalist ? 'adjust_lighting' : 'reprice',
      };
    }

    case 'archivist-leo': {
      if (decision === 'BUY') {
        return {
          decision,
          score,
          thought: `Heavyweight collar drape & un-mirrored back seam on ${garment.title} — copping.`,
        };
      }
      return {
        decision,
        score,
        thought: `Construction is solid, but $${price} needs stronger hero spotlighting.`,
        suggestedMutation: 'adjust_lighting',
      };
    }

    case 'budget-maya': {
      if (decision === 'BUY') {
        return {
          decision,
          score,
          thought: `Love the Wimbledon sage ringer trim — $${price} is an instant cop!`,
        };
      }
      return {
        decision,
        score,
        thought: `Obsessed with ${garment.title}, way past my $${persona.priceCeiling} ceiling at $${price}.`,
        suggestedMutation: 'reprice',
      };
    }

    case 'hypebeast-devon': {
      if (decision === 'BUY') {
        return {
          decision,
          score,
          thought: isBrutalist
            ? `Poured concrete + chrome rail makes ${garment.title} ($${price}) pure Shibuya heat.`
            : `Boxy silhouette on ${garment.title} hits — grabbing one at $${price}.`,
        };
      }
      return {
        decision,
        score,
        thought: isHeritageCourt
          ? `Too preppy country-club for my brutalist streetwear vibe.`
          : `Needs bolder hero contrast to justify $${price} on the rail.`,
        suggestedMutation: isHeritageCourt ? 'swap_hero_sku' : 'adjust_lighting',
      };
    }

    case 'impulse-chloe': {
      if (decision === 'BUY') {
        return {
          decision,
          score,
          thought: isHero
            ? `Spotlight on the hero stand sold me from the door — $${price} yes!`
            : `That 3D cotton drape + color match is too cute to leave behind!`,
        };
      }
      return {
        decision,
        score,
        thought: isHero
          ? `Lighting feels too cool-toned for an impulse splurge at $${price}.`
          : `Tucked on the side rail at $${price} — promote a stronger hero piece!`,
        suggestedMutation: isHero ? 'adjust_lighting' : 'swap_hero_sku',
      };
    }

    case 'skeptical-arthur':
    default: {
      if (decision === 'BUY') {
        return {
          decision,
          score,
          thought: `Inspected both front & rear drape — $${price} is fair value for this knit.`,
        };
      }
      return {
        decision,
        score,
        thought:
          price > persona.priceCeiling
            ? `Fine travertine presentation, yet $${price} is steep for ${garment.title}.`
            : `Aisle feels slightly crowded around the rail — skipping for now.`,
        suggestedMutation: price > persona.priceCeiling ? 'reprice' : 'declutter_aisle',
      };
    }
  }
}

interface ShopperAvatarMeshProps {
  persona: ShopperPersona;
  badge: ShopperBadgeSnapshot;
  rootRef: (el: THREE.Group | null) => void;
  bodyRef: (el: THREE.Group | null) => void;
  headRef: (el: THREE.Group | null) => void;
  leftArmRef: (el: THREE.Group | null) => void;
  rightArmRef: (el: THREE.Group | null) => void;
  leftLegRef: (el: THREE.Group | null) => void;
  rightLegRef: (el: THREE.Group | null) => void;
}

/**
 * Stylized 3D Roblox-Inspired Shopper NPC Avatar with persona outfit, bespoke accessory,
 * and clean overhead glassmorphic live reaction badge.
 */
const ShopperAvatarMesh: React.FC<ShopperAvatarMeshProps> = ({
  persona,
  badge,
  rootRef,
  bodyRef,
  headRef,
  leftArmRef,
  rightArmRef,
  leftLegRef,
  rightLegRef,
}) => {
  const isBuy = badge.decision === 'BUY';
  const isSkip = badge.decision === 'SKIP';

  const borderColor = isBuy
    ? 'rgba(52, 211, 153, 0.78)'
    : isSkip
      ? 'rgba(248, 113, 113, 0.78)'
      : 'rgba(255, 255, 255, 0.16)';

  return (
    <group ref={rootRef} name={`shopper-npc-${persona.id}`}>
      {/* Subtle Persona Floor Halo */}
      <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.19, 0.24, 24]} />
        <meshBasicMaterial
          color={isBuy ? '#34D399' : isSkip ? '#F87171' : persona.jacketColor}
          transparent
          opacity={isBuy || isSkip ? 0.65 : 0.28}
        />
      </mesh>

      <group ref={bodyRef}>
        {/* Articulated Left & Right Legs (Hip Pivot at y = 0.62) */}
        <group ref={leftLegRef} position={[-0.108, 0.62, 0]}>
          <RoundedBox
            args={[0.18, 0.52, 0.19]}
            radius={0.038}
            smoothness={3}
            position={[0, -0.26, 0]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={persona.pantsColor} roughness={0.8} />
          </RoundedBox>
          <RoundedBox
            args={[0.19, 0.088, 0.245]}
            radius={0.028}
            smoothness={3}
            position={[0, -0.575, 0.02]}
            castShadow
          >
            <meshStandardMaterial color={persona.shoeColor} roughness={0.6} />
          </RoundedBox>
        </group>

        <group ref={rightLegRef} position={[0.108, 0.62, 0]}>
          <RoundedBox
            args={[0.18, 0.52, 0.19]}
            radius={0.038}
            smoothness={3}
            position={[0, -0.26, 0]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={persona.pantsColor} roughness={0.8} />
          </RoundedBox>
          <RoundedBox
            args={[0.19, 0.088, 0.245]}
            radius={0.028}
            smoothness={3}
            position={[0, -0.575, 0.02]}
            castShadow
          >
            <meshStandardMaterial color={persona.shoeColor} roughness={0.6} />
          </RoundedBox>
        </group>

        {/* Torso Outfit */}
        <group position={[0, 0.87, 0]}>
          <RoundedBox
            args={[0.43, 0.48, 0.225]}
            radius={0.05}
            smoothness={3}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={persona.jacketColor} roughness={0.66} />
          </RoundedBox>
          {/* Contrast Inner Shirt / Lapel Accent */}
          <mesh position={[0, 0.04, 0.114]}>
            <planeGeometry args={[0.12, 0.36]} />
            <meshStandardMaterial color={persona.trimColor} roughness={0.78} />
          </mesh>
          <RoundedBox
            args={[0.438, 0.052, 0.232]}
            radius={0.018}
            smoothness={2}
            position={[0, -0.21, 0]}
          >
            <meshStandardMaterial color={persona.trimColor} roughness={0.72} />
          </RoundedBox>
        </group>

        {/* Articulated Left & Right Arms */}
        <group ref={leftArmRef} position={[-0.305, 1.08, 0]}>
          <RoundedBox
            args={[0.155, 0.4, 0.165]}
            radius={0.042}
            smoothness={3}
            position={[0, -0.175, 0]}
            castShadow
          >
            <meshStandardMaterial color={persona.jacketColor} roughness={0.68} />
          </RoundedBox>
          <RoundedBox
            args={[0.135, 0.105, 0.14]}
            radius={0.04}
            smoothness={3}
            position={[0, -0.425, 0]}
          >
            <meshStandardMaterial color={persona.skinTone} roughness={0.66} />
          </RoundedBox>
        </group>

        <group ref={rightArmRef} position={[0.305, 1.08, 0]}>
          <RoundedBox
            args={[0.155, 0.4, 0.165]}
            radius={0.042}
            smoothness={3}
            position={[0, -0.175, 0]}
            castShadow
          >
            <meshStandardMaterial color={persona.jacketColor} roughness={0.68} />
          </RoundedBox>
          <RoundedBox
            args={[0.135, 0.105, 0.14]}
            radius={0.04}
            smoothness={3}
            position={[0, -0.425, 0]}
          >
            <meshStandardMaterial color={persona.skinTone} roughness={0.66} />
          </RoundedBox>
        </group>

        {/* Stylized Roblox Head + Persona Accessory */}
        <group ref={headRef} position={[0, 1.15, 0]}>
          <RoundedBox
            args={[0.295, 0.285, 0.28]}
            radius={0.082}
            smoothness={4}
            position={[0, 0.155, 0]}
            castShadow
          >
            <meshStandardMaterial color={persona.skinTone} roughness={0.64} />
          </RoundedBox>

          {/* Minimalist Eyes & Expression on +Z */}
          <group position={[0, 0.155, 0.142]}>
            <mesh position={[-0.055, 0.016, 0]}>
              <boxGeometry args={[0.028, 0.042, 0.005]} />
              <meshBasicMaterial color="#18191C" />
            </mesh>
            <mesh position={[0.055, 0.016, 0]}>
              <boxGeometry args={[0.028, 0.042, 0.005]} />
              <meshBasicMaterial color="#18191C" />
            </mesh>
            <mesh
              position={[0, -0.042, 0]}
              rotation={[0, 0, isSkip ? 0 : Math.PI]}
            >
              <torusGeometry args={[0.025, 0.005, 8, 14, Math.PI * 0.8]} />
              <meshBasicMaterial color="#2A211D" />
            </mesh>
          </group>

          {/* Base Hair */}
          <RoundedBox
            args={[0.308, 0.09, 0.295]}
            radius={0.038}
            smoothness={3}
            position={[0, 0.258, -0.01]}
            castShadow
          >
            <meshStandardMaterial color={persona.hairColor} roughness={0.82} />
          </RoundedBox>

          {/* Persona-Specific Signature 3D Accessory */}
          {persona.accessory === 'beret' && (
            <RoundedBox
              args={[0.32, 0.075, 0.31]}
              radius={0.036}
              smoothness={3}
              position={[0.02, 0.305, 0]}
              rotation={[0, 0, -0.12]}
              castShadow
            >
              <meshStandardMaterial color="#2E3136" roughness={0.75} />
            </RoundedBox>
          )}

          {persona.accessory === 'beanie' && (
            <RoundedBox
              args={[0.318, 0.115, 0.302]}
              radius={0.048}
              smoothness={3}
              position={[0, 0.305, 0]}
              castShadow
            >
              <meshStandardMaterial color="#FF5A1F" roughness={0.72} />
            </RoundedBox>
          )}

          {persona.accessory === 'cap' && (
            <group position={[0, 0.295, 0]}>
              <RoundedBox args={[0.312, 0.08, 0.298]} radius={0.038} smoothness={3}>
                <meshStandardMaterial color={persona.jacketColor} roughness={0.62} />
              </RoundedBox>
              <RoundedBox
                args={[0.24, 0.02, 0.12]}
                radius={0.008}
                smoothness={2}
                position={[0, -0.022, 0.17]}
              >
                <meshStandardMaterial color={persona.trimColor} roughness={0.62} />
              </RoundedBox>
            </group>
          )}

          {persona.accessory === 'headphones' && (
            <group position={[0, 0.165, 0]}>
              <mesh position={[-0.162, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.052, 0.052, 0.032, 16]} />
                <meshStandardMaterial color="#25272C" metalness={0.5} roughness={0.35} />
              </mesh>
              <mesh position={[0.162, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.052, 0.052, 0.032, 16]} />
                <meshStandardMaterial color="#25272C" metalness={0.5} roughness={0.35} />
              </mesh>
              <mesh position={[0, 0.145, 0]}>
                <boxGeometry args={[0.33, 0.022, 0.035]} />
                <meshStandardMaterial color="#25272C" metalness={0.5} roughness={0.35} />
              </mesh>
            </group>
          )}

          {persona.accessory === 'sunglasses' && (
            <group position={[0, 0.174, 0.147]}>
              <RoundedBox
                args={[0.095, 0.052, 0.012]}
                radius={0.01}
                smoothness={2}
                position={[-0.058, 0, 0]}
              >
                <meshStandardMaterial color="#181A1F" roughness={0.2} metalness={0.4} />
              </RoundedBox>
              <RoundedBox
                args={[0.095, 0.052, 0.012]}
                radius={0.01}
                smoothness={2}
                position={[0.058, 0, 0]}
              >
                <meshStandardMaterial color="#181A1F" roughness={0.2} metalness={0.4} />
              </RoundedBox>
              <mesh>
                <boxGeometry args={[0.04, 0.008, 0.01]} />
                <meshStandardMaterial color="#D4AF37" metalness={0.8} roughness={0.25} />
              </mesh>
            </group>
          )}

          {persona.accessory === 'glasses' && (
            <group position={[0, 0.172, 0.147]}>
              <mesh position={[-0.056, 0, 0]}>
                <torusGeometry args={[0.034, 0.005, 8, 20]} />
                <meshStandardMaterial color="#5C3A21" roughness={0.45} />
              </mesh>
              <mesh position={[0.056, 0, 0]}>
                <torusGeometry args={[0.034, 0.005, 8, 20]} />
                <meshStandardMaterial color="#5C3A21" roughness={0.45} />
              </mesh>
              <mesh>
                <boxGeometry args={[0.042, 0.006, 0.006]} />
                <meshStandardMaterial color="#C5A059" metalness={0.8} roughness={0.3} />
              </mesh>
            </group>
          )}
        </group>
      </group>

      {/* Floating Overhead Shopper Persona + Live Thought + YES/NO Pill Badge */}
      <Html
        position={[0, 1.76, 0]}
        center
        distanceFactor={6}
        zIndexRange={[12, 0]}
        pointerEvents="none"
      >
        <div
          style={{
            width: 208,
            padding: '7px 10px',
            borderRadius: 11,
            background: 'rgba(15, 16, 15, 0.86)',
            backdropFilter: 'blur(10px)',
            border: `1.5px solid ${borderColor}`,
            boxShadow: '0 8px 22px rgba(0, 0, 0, 0.36)',
            color: '#F6F3EB',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            pointerEvents: 'none',
            userSelect: 'none',
            transition: 'border-color 0.2s ease',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 6,
              marginBottom: 4,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: persona.jacketColor,
                  border: '1px solid rgba(255,255,255,0.55)',
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.01em',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {badge.personaName}
              </span>
            </div>

            {badge.decision ? (
              <span
                style={{
                  padding: '1.5px 7px',
                  borderRadius: 999,
                  fontSize: 9.5,
                  fontWeight: 800,
                  letterSpacing: '0.06em',
                  background: isBuy
                    ? 'rgba(16, 185, 129, 0.26)'
                    : 'rgba(239, 68, 68, 0.26)',
                  color: isBuy ? '#6EE7B7' : '#FCA5A5',
                  border: isBuy
                    ? '1px solid rgba(52, 211, 153, 0.65)'
                    : '1px solid rgba(248, 113, 113, 0.65)',
                  flexShrink: 0,
                }}
              >
                {isBuy ? 'YES · BUY' : 'NO · SKIP'}
              </span>
            ) : (
              <span
                style={{
                  padding: '1px 6px',
                  borderRadius: 999,
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  background: 'rgba(212, 175, 55, 0.16)',
                  color: '#E7C96B',
                  flexShrink: 0,
                }}
              >
                {badge.phase === 'INSPECTING' ? 'INSPECTING' : 'BROWSING'}
              </span>
            )}
          </div>

          <div
            style={{
              fontSize: 10.2,
              lineHeight: 1.32,
              color: 'rgba(245, 242, 235, 0.86)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            “{badge.thought}”
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

  const obstacles = useMemo(
    () => buildSwarmObstacles(config, showSecondaryRack),
    [config, showSecondaryRack]
  );

  const inspectionSlots = useMemo(
    () => buildInspectionSlots(config, showSecondaryRack),
    [config, showSecondaryRack]
  );

  // Latest refs so useFrame never stales on config/callbacks
  const configRef = useRef(config);
  configRef.current = config;
  const slotsRef = useRef(inspectionSlots);
  slotsRef.current = inspectionSlots;
  const obstaclesRef = useRef(obstacles);
  obstaclesRef.current = obstacles;
  const onConversionRef = useRef(onConversionUpdate);
  onConversionRef.current = onConversionUpdate;
  const customResolverRef = useRef(customDecisionResolver);
  customResolverRef.current = customDecisionResolver;

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

  // Reset telemetry when resetKey changes
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

  // Mutable agent runtime states
  const agentsRef = useRef<ShopperAgentRuntime[]>([]);

  // Low-frequency React state ONLY for badge text / YES-NO pill updates
  const [badges, setBadges] = useState<Record<string, ShopperBadgeSnapshot>>({});

  // Three.js limb refs keyed by persona ID
  const rootRefs = useRef<Record<string, THREE.Group | null>>({});
  const bodyRefs = useRef<Record<string, THREE.Group | null>>({});
  const headRefs = useRef<Record<string, THREE.Group | null>>({});
  const leftArmRefs = useRef<Record<string, THREE.Group | null>>({});
  const rightArmRefs = useRef<Record<string, THREE.Group | null>>({});
  const leftLegRefs = useRef<Record<string, THREE.Group | null>>({});
  const rightLegRefs = useRef<Record<string, THREE.Group | null>>({});

  // Spawn / initialize NPC shoppers near boutique entrance (z ≈ 4.8) when enabled
  useEffect(() => {
    if (!enabled) {
      agentsRef.current = [];
      return;
    }

    const slots = slotsRef.current;
    const initialBadges: Record<string, ShopperBadgeSnapshot> = {};

    const initialized: ShopperAgentRuntime[] = activePersonas.map((persona, idx) => {
      // Spread cleanly across the boutique entrance foyer around z ≈ 4.8
      const laneOffset = (idx - (activePersonas.length - 1) * 0.5) * 0.82;
      const spawnX = THREE.MathUtils.clamp(laneOffset, -2.5, 2.5);
      const spawnZ = 4.65 + (idx % 2) * 0.42;

      const initialSlot = slots.length > 0 ? slots[idx % slots.length] : null;
      const waypoints = initialSlot
        ? planSmoothWaypoints(spawnX, spawnZ, initialSlot.standX, initialSlot.standZ)
        : ([[0, 2.2]] as Array<[number, number]>);

      const enterThought = initialSlot
        ? `Walking in to check ${initialSlot.garment.title}...`
        : `Entering ${configRef.current.brandName}...`;

      initialBadges[persona.id] = {
        personaId: persona.id,
        personaName: persona.name,
        roleTag: persona.roleTag,
        phase: 'WALKING_TO_RACK',
        decision: null,
        thought: enterThought,
      };

      return {
        persona,
        x: spawnX,
        y: 0,
        z: spawnZ,
        vy: 0,
        yaw: Math.PI, // Facing -Z into boutique
        walkPhase: idx * 1.1,
        swingAmp: 0,
        phase: 'WALKING_TO_RACK',
        phaseTimer: idx * 0.35, // Gentle stagger on entry
        targetSlot: initialSlot,
        waypoints,
        waypointIdx: 0,
        visitCount: 0,
        lastDecision: null,
        liveThought: enterThought,
        activeGarmentTitle: initialSlot?.garment.title ?? null,
      };
    });

    agentsRef.current = initialized;
    setBadges(initialBadges);
  }, [enabled, activePersonas]);

  // Re-assign valid slots cleanly if StoreConfig racks change dynamically while shoppers are active
  useEffect(() => {
    if (!enabled || inspectionSlots.length === 0) return;
    agentsRef.current.forEach((agent, idx) => {
      const stillExists =
        agent.targetSlot &&
        inspectionSlots.some((s) => s.slotId === agent.targetSlot?.slotId);
      if (!stillExists) {
        const nextSlot = inspectionSlots[idx % inspectionSlots.length];
        agent.targetSlot = nextSlot;
        agent.waypoints = planSmoothWaypoints(
          agent.x,
          agent.z,
          nextSlot.standX,
          nextSlot.standZ
        );
        agent.waypointIdx = 0;
      }
    });
  }, [enabled, inspectionSlots]);

  useFrame((state, rawDelta) => {
    if (!enabled || agentsRef.current.length === 0) return;

    const dt = Math.min(rawDelta, 0.05) * Math.max(0.25, speedMultiplier);
    const elapsed = state.clock.elapsedTime;
    const agents = agentsRef.current;
    const slots = slotsRef.current;
    const obsList = obstaclesRef.current;

    const badgeUpdates: Record<string, ShopperBadgeSnapshot> = {};
    let hasBadgeUpdates = false;

    const queueBadgeUpdate = (agent: ShopperAgentRuntime) => {
      hasBadgeUpdates = true;
      badgeUpdates[agent.persona.id] = {
        personaId: agent.persona.id,
        personaName: agent.persona.name,
        roleTag: agent.persona.roleTag,
        phase: agent.phase,
        decision: agent.lastDecision,
        thought: agent.liveThought,
      };
    };

    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      let moveVx = 0;
      let moveVz = 0;
      let isMoving = false;

      if (agent.phase === 'WALKING_TO_RACK' || agent.phase === 'STROLLING') {
        if (agent.phaseTimer > 0) {
          agent.phaseTimer = Math.max(0, agent.phaseTimer - dt);
        } else {
          const wp = agent.waypoints[agent.waypointIdx];
          if (wp) {
            const dx = wp[0] - agent.x;
            const dz = wp[1] - agent.z;
            const dist = Math.hypot(dx, dz);

            if (dist < 0.2) {
              if (agent.waypointIdx < agent.waypoints.length - 1) {
                agent.waypointIdx += 1;
              } else if (agent.phase === 'WALKING_TO_RACK' && agent.targetSlot) {
                // Arrived at garment rack -> pause & inspect for ~2.5s!
                agent.phase = 'INSPECTING';
                agent.phaseTimer = 2.45 + (i % 3) * 0.12;
                agent.lastDecision = null;
                agent.liveThought = `Inspecting ${agent.targetSlot.garment.title} ($${agent.targetSlot.garment.price})...`;
                queueBadgeUpdate(agent);
              } else {
                // Completed entrance/gallery stroll -> pick next rack slot that isn't crowded!
                if (slots.length > 0) {
                  const occupied = new Set(
                    agents
                      .filter((other) => other !== agent && other.targetSlot)
                      .map((other) => other.targetSlot!.slotId)
                  );
                  const freeSlots = slots.filter((s) => !occupied.has(s.slotId));
                  const pool = freeSlots.length > 0 ? freeSlots : slots;
                  const nextSlot =
                    pool[(agent.visitCount + i) % pool.length];

                  agent.targetSlot = nextSlot;
                  agent.waypoints = planSmoothWaypoints(
                    agent.x,
                    agent.z,
                    nextSlot.standX,
                    nextSlot.standZ
                  );
                  agent.waypointIdx = 0;
                  agent.phase = 'WALKING_TO_RACK';
                  agent.lastDecision = null;
                  agent.liveThought = `Heading over to ${nextSlot.garment.title}...`;
                  queueBadgeUpdate(agent);
                }
              }
            } else {
              moveVx = (dx / dist) * agent.persona.walkSpeed;
              moveVz = (dz / dist) * agent.persona.walkSpeed;
              isMoving = true;
            }
          }
        }
      } else if (agent.phase === 'INSPECTING') {
        agent.phaseTimer -= dt;
        if (agent.targetSlot) {
          const lookYaw = Math.atan2(
            agent.targetSlot.lookX - agent.x,
            agent.targetSlot.lookZ - agent.z
          );
          agent.yaw = lerpAngle(agent.yaw, lookYaw, Math.min(1, dt * 8));
        }

        if (agent.phaseTimer <= 0 && agent.targetSlot) {
          const garment = agent.targetSlot.garment;
          agent.visitCount += 1;

          const custom = customResolverRef.current?.(
            agent.persona,
            garment,
            configRef.current
          );
          const evaluated =
            custom ??
            evaluateShopperDecision(
              agent.persona,
              garment,
              configRef.current,
              agent.visitCount
            );

          agent.lastDecision = evaluated.decision;
          agent.liveThought = evaluated.thought;
          agent.phase = 'REACTING';
          agent.phaseTimer = 2.55;

          // Celebratory Roblox hop on BUY!
          if (evaluated.decision === 'BUY') {
            agent.vy = HOP_VELOCITY;
          }

          queueBadgeUpdate(agent);

          // Record event & emit real-time conversion update
          const event: ShopperDecisionEvent = {
            id: `${agent.persona.id}-${Date.now()}-${agent.visitCount}`,
            timestamp: Date.now(),
            personaId: agent.persona.id,
            personaName: agent.persona.name,
            roleTag: agent.persona.roleTag,
            garmentId: garment.id,
            garmentTitle: garment.title,
            garmentPrice: garment.price,
            rackId: agent.targetSlot.rackId,
            decision: evaluated.decision,
            thought: evaluated.thought,
            score: evaluated.score ?? (evaluated.decision === 'BUY' ? 0.82 : 0.34),
            suggestedMutation: evaluated.suggestedMutation,
          };

          const st = statsRef.current;
          st.totalDecisions += 1;
          if (evaluated.decision === 'BUY') {
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
      } else if (agent.phase === 'REACTING') {
        agent.phaseTimer -= dt;
        // Second excited mini-hop mid-celebration on BUY!
        if (
          agent.lastDecision === 'BUY' &&
          agent.y <= 0.001 &&
          agent.vy === 0 &&
          agent.phaseTimer > 0.9 &&
          agent.phaseTimer < 1.35
        ) {
          agent.vy = HOP_VELOCITY * 0.78;
        }

        if (agent.phaseTimer <= 0) {
          // Stroll briefly toward entrance / gallery lounge (z ≈ 3.8..4.8) or next rack
          const strollToEntrance = agent.visitCount % 2 === 0;
          if (strollToEntrance) {
            const loungeX = ((i % 3) - 1) * 1.45 + (i % 2 === 0 ? 0.25 : -0.25);
            const loungeZ = 4.35 + (i % 2) * 0.55;
            agent.phase = 'STROLLING';
            agent.waypoints = planSmoothWaypoints(agent.x, agent.z, loungeX, loungeZ);
            agent.waypointIdx = 0;
          } else if (slots.length > 0) {
            const occupied = new Set(
              agents
                .filter((other) => other !== agent && other.targetSlot)
                .map((other) => other.targetSlot!.slotId)
            );
            const freeSlots = slots.filter((s) => !occupied.has(s.slotId));
            const pool = freeSlots.length > 0 ? freeSlots : slots;
            const nextSlot = pool[(agent.visitCount + i + 1) % pool.length];
            agent.targetSlot = nextSlot;
            agent.waypoints = planSmoothWaypoints(
              agent.x,
              agent.z,
              nextSlot.standX,
              nextSlot.standZ
            );
            agent.waypointIdx = 0;
            agent.phase = 'WALKING_TO_RACK';
            agent.lastDecision = null;
            agent.liveThought = `Checking ${nextSlot.garment.title} next...`;
            queueBadgeUpdate(agent);
          }
        }
      }

      // Soft NPC-to-NPC separation so shoppers never overlap each other
      let sepX = 0;
      let sepZ = 0;
      for (let j = 0; j < agents.length; j++) {
        if (i === j) continue;
        const other = agents[j];
        const dx = agent.x - other.x;
        const dz = agent.z - other.z;
        const d = Math.hypot(dx, dz);
        const minSep = 0.68;
        if (d > 1e-4 && d < minSep) {
          const push = ((minSep - d) / minSep) * ( isMoving ? 1.45 : 0.45 );
          sepX += (dx / d) * push;
          sepZ += (dz / d) * push;
        }
      }

      const totalVx = moveVx + sepX;
      const totalVz = moveVz + sepZ;

      if (isMoving || Math.hypot(sepX, sepZ) > 0.05) {
        let nx = agent.x + totalVx * dt;
        let nz = agent.z + totalVz * dt;

        for (const box of obsList) {
          [nx, nz] = resolveCircleObb(nx, nz, NPC_RADIUS, box);
        }
        nx = THREE.MathUtils.clamp(nx, ROOM_BOUNDS.minX, ROOM_BOUNDS.maxX);
        nz = THREE.MathUtils.clamp(nz, ROOM_BOUNDS.minZ, ROOM_BOUNDS.maxZ);

        agent.x = nx;
        agent.z = nz;

        if (isMoving) {
          const moveYaw = Math.atan2(totalVx, totalVz);
          agent.yaw = lerpAngle(agent.yaw, moveYaw, Math.min(1, dt * 10));
        }
      }

      // Vertical hop physics (celebratory Roblox hop on BUY)
      if (agent.y > 0 || agent.vy > 0) {
        agent.y += agent.vy * dt;
        agent.vy += HOP_GRAVITY * dt;
        if (agent.y <= 0) {
          agent.y = 0;
          agent.vy = 0;
        }
      }

      // Procedural Limb & Head Animation
      const targetSwing = isMoving ? 0.58 : 0;
      agent.swingAmp = THREE.MathUtils.lerp(agent.swingAmp, targetSwing, Math.min(1, dt * 11));
      if (isMoving) {
        agent.walkPhase += dt * (agent.persona.walkSpeed * 5.2);
      }
      const sinP = Math.sin(agent.walkPhase);

      const root = rootRefs.current[agent.persona.id];
      const body = bodyRefs.current[agent.persona.id];
      const head = headRefs.current[agent.persona.id];
      const lArm = leftArmRefs.current[agent.persona.id];
      const rArm = rightArmRefs.current[agent.persona.id];
      const lLeg = leftLegRefs.current[agent.persona.id];
      const rLeg = rightLegRefs.current[agent.persona.id];

      if (root) {
        root.position.set(agent.x, agent.y, agent.z);
        root.rotation.y = agent.yaw;
      }

      if (body) {
        body.position.y = isMoving
          ? Math.abs(sinP) * 0.022
          : Math.sin(elapsed * 2.1 + i) * 0.008;
      }

      if (lLeg && rLeg) {
        if (agent.y > 0.02) {
          lLeg.rotation.x = -0.25;
          rLeg.rotation.x = 0.28;
        } else {
          lLeg.rotation.x = sinP * agent.swingAmp;
          rLeg.rotation.x = -sinP * agent.swingAmp;
        }
      }

      if (lArm && rArm) {
        if (agent.phase === 'REACTING' && agent.lastDecision === 'BUY') {
          // Celebratory raised Roblox arms!
          lArm.rotation.x = THREE.MathUtils.lerp(lArm.rotation.x, -2.5, Math.min(1, dt * 14));
          rArm.rotation.x = THREE.MathUtils.lerp(rArm.rotation.x, -2.5, Math.min(1, dt * 14));
          lArm.rotation.z = 0.22;
          rArm.rotation.z = -0.22;
        } else if (agent.phase === 'INSPECTING') {
          // Thoughtful chin-pondering inspection gesture
          rArm.rotation.x = THREE.MathUtils.lerp(rArm.rotation.x, -0.92, Math.min(1, dt * 8));
          lArm.rotation.x = THREE.MathUtils.lerp(lArm.rotation.x, 0.08, Math.min(1, dt * 8));
          lArm.rotation.z = 0.06;
          rArm.rotation.z = -0.08;
        } else {
          lArm.rotation.x = -sinP * agent.swingAmp * 0.82;
          rArm.rotation.x = sinP * agent.swingAmp * 0.82;
          lArm.rotation.z = 0.05;
          rArm.rotation.z = -0.05;
        }
      }

      if (head) {
        if (agent.phase === 'REACTING' && agent.lastDecision === 'SKIP') {
          // Subtle skeptical head shake on NO/SKIP
          head.rotation.y = Math.sin(elapsed * 13) * 0.18;
          head.rotation.z = 0;
        } else if (agent.phase === 'INSPECTING') {
          head.rotation.y = Math.sin(elapsed * 1.8 + i) * 0.08;
          head.rotation.z = 0.06;
        } else {
          head.rotation.y = THREE.MathUtils.lerp(head.rotation.y, 0, Math.min(1, dt * 8));
          head.rotation.z = THREE.MathUtils.lerp(head.rotation.z, 0, Math.min(1, dt * 8));
        }
      }
    }

    if (hasBadgeUpdates) {
      setBadges((prev) => ({ ...prev, ...badgeUpdates }));
    }
  });

  if (!enabled) return null;

  return (
    <group name="synthetic-shopper-swarm-layer">
      {activePersonas.map((persona) => {
        const badge: ShopperBadgeSnapshot = badges[persona.id] ?? {
          personaId: persona.id,
          personaName: persona.name,
          roleTag: persona.roleTag,
          phase: 'WALKING_TO_RACK',
          decision: null,
          thought: `Browsing ${config.brandName}...`,
        };

        return (
          <ShopperAvatarMesh
            key={persona.id}
            persona={persona}
            badge={badge}
            rootRef={(el) => {
              rootRefs.current[persona.id] = el;
            }}
            bodyRef={(el) => {
              bodyRefs.current[persona.id] = el;
            }}
            headRef={(el) => {
              headRefs.current[persona.id] = el;
            }}
            leftArmRef={(el) => {
              leftArmRefs.current[persona.id] = el;
            }}
            rightArmRef={(el) => {
              rightArmRefs.current[persona.id] = el;
            }}
            leftLegRef={(el) => {
              leftLegRefs.current[persona.id] = el;
            }}
            rightLegRef={(el) => {
              rightLegRefs.current[persona.id] = el;
            }}
          />
        );
      })}
    </group>
  );
};
