import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { RoundedBox } from '@react-three/drei';
import type {
  GarmentAssetSet,
  GarmentTuningParams,
  InventedProductSpec,
  RackPlacement,
  StorePalette,
} from '../types/storeConfig';
import { HangingGarment } from './HangingGarment';
import { HangingApparel3D } from './products/Product3DFactory';

export interface GarmentResolvedTextures {
  frontMap: THREE.Texture;
  backMap?: THREE.Texture;
  normalMap?: THREE.Texture;
  aspect?: number;
}

export interface RackGarmentItem {
  id: string;
  sku?: string;
  title?: string;
  label?: string;
  subtitle?: string;
  price?: number;
  featured?: boolean;
  productSpec?: InventedProductSpec;
  frontMap?: THREE.Texture;
  backMap?: THREE.Texture;
  normalMap?: THREE.Texture;
  aspect?: number;
}

export interface BoutiqueRackProps {
  /** Optional RackPlacement metadata from StoreConfig.racks */
  rack?: RackPlacement;
  /** Pre-resolved garment items (hero first, optional companions after) */
  garments?: RackGarmentItem[];
  /** Optional companion garments array when passed separately from hero */
  companionGarments?: RackGarmentItem[];
  /** Optional texture lookup map keyed by GarmentAssetSet.id when rendering from `rack.items` */
  texturesById?: Record<string, GarmentResolvedTextures | undefined>;
  /** Optional resolver callback for `rack.items` */
  resolveGarmentTextures?: (item: GarmentAssetSet) => GarmentResolvedTextures | undefined;

  /** Direct single-hero texture convenience props */
  frontMap?: THREE.Texture;
  backMap?: THREE.Texture;
  normalMap?: THREE.Texture;
  aspect?: number;
  heroTitle?: string;
  heroPrice?: number;

  /** Brand DNA palette from StoreConfig */
  palette: StorePalette;
  /** Brushed metal PBR parameters (supports either `roughness` or `metalRoughness` prop naming) */
  metalness?: number;
  roughness?: number;
  metalRoughness?: number;

  /** Volumetric garment & capsule tuning parameters */
  tuning: GarmentTuningParams;

  /** World placement overrides (defaults to rack.position / [0,0,0] and rack.rotationY / 0) */
  position?: [number, number, number];
  rotationY?: number;
  /** Presentation style ('hero_faceout' | 'capsule_rail') */
  style?: 'hero_faceout' | 'capsule_rail';
  /** Overhead architectural gallery tag text */
  label?: string;

  /** Interactive garment selection state */
  selectedGarmentId?: string | null;
  onSelectGarment?: (id: string) => void;
}

const RAIL_HEIGHT = 1.56; // Calibrated to CameraRig hero (1.24) & macro (1.38) targets
const PLINTH_TOP_Y = 0.08;
const RAIL_RADIUS = 0.013;
const DEG_28 = (28 * Math.PI) / 180;
const DEG_21 = (21 * Math.PI) / 180;

function shiftHexColor(hex: string, lightnessDelta: number): string {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, lightnessDelta);
  return `#${c.getHexString()}`;
}

/**
 * Generates subtle honed travertine / basalt / sandstone texture for the rack's plinth slab
 */
function createPlinthStoneTexture(plinthHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = plinthHex;
  ctx.fillRect(0, 0, 512, 256);

  // Delicate linear travertine mineral veins
  for (let i = 0; i < 110; i++) {
    ctx.fillStyle = shiftHexColor(plinthHex, i % 2 === 0 ? 0.022 : -0.026);
    const x = (i * 83) % 490;
    const y = (i * 47) % 250;
    const w = 16 + (i % 34);
    ctx.globalAlpha = 0.45;
    ctx.fillRect(x, y, w, 1.5);
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates crisp synchronous museum gallery placard texture for the overhead rail tag
 */
function createOverheadGalleryTagTexture(
  title: string,
  metalHex: string,
  accentHex: string,
  wallHex: string
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;

  const isDarkTheme = new THREE.Color(wallHex).getHSL({ h: 0, s: 0, l: 0 }).l < 0.35;
  const bg = isDarkTheme ? '#18191C' : '#F8F4EC';
  const fg = isDarkTheme ? '#F3F5F8' : '#222820';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 640, 96);

  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 3;
  ctx.strokeRect(10, 10, 620, 76);

  ctx.fillStyle = metalHex;
  ctx.fillRect(28, 46, 26, 3);
  ctx.fillRect(586, 46, 26, 3);

  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 24px Georgia, "Times New Roman", serif';
  const cleanTitle = title.trim().toUpperCase();
  const display = cleanTitle.length > 32 ? `${cleanTitle.slice(0, 31)}…` : cleanTitle;
  ctx.fillText(display, 320, 49);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export const BoutiqueRack: React.FC<BoutiqueRackProps> = ({
  rack,
  garments,
  companionGarments,
  texturesById,
  resolveGarmentTextures,
  frontMap,
  backMap,
  normalMap,
  aspect,
  heroTitle,
  heroPrice,
  palette,
  metalness = 0.86,
  roughness,
  metalRoughness,
  tuning,
  position,
  rotationY,
  style,
  label,
  selectedGarmentId,
  onSelectGarment,
}) => {
  const effectiveRoughness = roughness ?? metalRoughness ?? 0.28;
  const worldPos = position ?? rack?.position ?? [0, 0, 0];
  const worldRotY = rotationY ?? rack?.rotationY ?? 0;
  const effectiveStyle = style ?? rack?.style ?? 'hero_faceout';
  const placardLabel = label ?? rack?.label;

  // Normalize all supported garment input patterns into a clean array
  const allResolvedItems = useMemo<RackGarmentItem[]>(() => {
    const baseList: RackGarmentItem[] = [];

    if (garments && garments.length > 0) {
      baseList.push(...garments);
    } else if (rack?.items && rack.items.length > 0) {
      for (const asset of rack.items) {
        const resolved =
          resolveGarmentTextures?.(asset) ?? texturesById?.[asset.id];
        if (resolved?.frontMap || asset.productSpec) {
          baseList.push({
            id: asset.id,
            sku: asset.sku,
            title: asset.title,
            label: asset.title,
            subtitle: asset.subtitle,
            price: asset.price,
            featured: asset.featured,
            productSpec: asset.productSpec,
            frontMap: resolved?.frontMap,
            backMap: resolved?.backMap,
            normalMap: resolved?.normalMap,
            aspect: resolved?.aspect ?? asset.aspect,
          });
        }
      }
    } else if (frontMap) {
      baseList.push({
        id: 'hero-garment',
        title: heroTitle ?? 'Archive Hero Garment',
        label: heroTitle ?? 'Archive Hero Garment',
        price: heroPrice,
        featured: true,
        frontMap,
        backMap,
        normalMap,
        aspect,
      });
    }

    if (companionGarments && companionGarments.length > 0) {
      for (const comp of companionGarments) {
        if (!baseList.some((item) => item.id === comp.id)) {
          baseList.push(comp);
        }
      }
    }

    return baseList;
  }, [
    garments,
    companionGarments,
    rack,
    texturesById,
    resolveGarmentTextures,
    frontMap,
    backMap,
    normalMap,
    aspect,
    heroTitle,
    heroPrice,
  ]);

  // Determine whether this is a dedicated secondary companion-only rack (e.g. StoreConfig's `capsule_rail`)
  const hasFeaturedHero = allResolvedItems.some((item) => item.featured);
  const isDedicatedCompanionRail =
    effectiveStyle === 'capsule_rail' && !hasFeaturedHero && allResolvedItems.length <= 2;

  // Compute active garment placements for Hero Face-Out Mode vs. Curated Capsule Mode
  const layout = useMemo(() => {
    // 1. Dedicated 2-item side capsule rail (e.g. Clubhouse Capsule Rail)
    if (isDedicatedCompanionRail) {
      const visibleItems = tuning.showCapsuleCompanions ? allResolvedItems.slice(0, 2) : [];
      const railSpan = 1.2;
      const mainRailZ = 0;

      const slots =
        visibleItems.length === 1
          ? [
              {
                item: visibleItems[0],
                pos: [0, RAIL_HEIGHT, mainRailZ] as [number, number, number],
                rotY: 0,
                hookSwivelY: Math.PI * 0.5,
              },
            ]
          : visibleItems.map((item, idx) => {
              const isLeft = idx === 0;
              const yaw = isLeft ? DEG_28 : -DEG_28;
              return {
                item,
                pos: [isLeft ? -0.3 : 0.3, RAIL_HEIGHT, mainRailZ] as [
                  number,
                  number,
                  number,
                ],
                rotY: yaw,
                // Swivel hook straddles the X-axis main rail while hanger body angles ±28° toward camera
                hookSwivelY: Math.PI * 0.5 - yaw,
              };
            });

      return {
        hidden: !tuning.showCapsuleCompanions,
        railSpan,
        plinthWidth: 1.42,
        plinthDepth: 0.64,
        baseRunnerLength: 0.46,
        mainRailZ,
        hasFaceoutArm: false,
        faceoutStartZ: 0,
        faceoutEndZ: 0,
        slots,
        railSpacerX: visibleItems.length === 2 ? [-0.3, 0.3] : [0],
      };
    }

    // 2. Central Boutique Rack supporting both:
    //    - Hero Face-Out Mode (1 centerpiece garment on forward face-out display arm)
    //    - Curated Capsule Mode (hero centered & forward on face-out arm + 2 flanking ±21° companions on main rail)
    const showCapsuleThreePiece =
      tuning.showCapsuleCompanions && allResolvedItems.length >= 2;

    if (showCapsuleThreePiece) {
      const heroItem = allResolvedItems[0];
      const companions = allResolvedItems.slice(1, 3);
      const railSpan = 1.80;
      const mainRailZ = -0.08;
      const heroZ = 0.13;

      const slots: Array<{
        item: RackGarmentItem;
        pos: [number, number, number];
        rotY: number;
        hookSwivelY: number;
      }> = [
        {
          item: heroItem,
          pos: [0, RAIL_HEIGHT, heroZ],
          rotY: 0,
          // Straddles the Z-axis central face-out arm
          hookSwivelY: 0,
        },
      ];

      if (companions[0]) {
        slots.push({
          item: companions[0],
          pos: [-0.63, RAIL_HEIGHT, mainRailZ],
          rotY: DEG_21,
          hookSwivelY: Math.PI * 0.5 - DEG_21,
        });
      }
      if (companions[1]) {
        slots.push({
          item: companions[1],
          pos: [0.63, RAIL_HEIGHT, mainRailZ],
          rotY: -DEG_21,
          hookSwivelY: Math.PI * 0.5 + DEG_21,
        });
      }

      return {
        hidden: false,
        railSpan,
        plinthWidth: 2.00,
        plinthDepth: 0.74,
        baseRunnerLength: 0.52,
        mainRailZ,
        hasFaceoutArm: true,
        faceoutStartZ: mainRailZ - 0.035,
        faceoutEndZ: heroZ + 0.026,
        slots,
        railSpacerX: companions.length === 2 ? [-0.63, 0.63] : [-0.63],
      };
    }

    // Hero Face-Out Mode (single centerpiece garment)
    const heroOnly = allResolvedItems[0];
    const railSpan = 1.08;
    const mainRailZ = -0.035;
    const heroZ = 0.03;

    return {
      hidden: false,
      railSpan,
      plinthWidth: 1.32,
      plinthDepth: 0.68,
      baseRunnerLength: 0.48,
      mainRailZ,
      hasFaceoutArm: true,
      faceoutStartZ: mainRailZ - 0.032,
      faceoutEndZ: heroZ + 0.026,
      slots: heroOnly
        ? [
            {
              item: heroOnly,
              pos: [0, RAIL_HEIGHT, heroZ] as [number, number, number],
              rotY: 0,
              hookSwivelY: 0,
            },
          ]
        : [],
      railSpacerX: [] as number[],
    };
  }, [allResolvedItems, isDedicatedCompanionRail, tuning.showCapsuleCompanions]);

  const plinthTexture = useMemo(
    () => createPlinthStoneTexture(palette.plinth),
    [palette.plinth]
  );

  useEffect(() => {
    return () => {
      plinthTexture.dispose();
    };
  }, [plinthTexture]);

  const galleryTagTexture = useMemo(() => {
    if (!placardLabel) return null;
    return createOverheadGalleryTagTexture(
      placardLabel,
      palette.rackMetal,
      palette.accent,
      palette.wall
    );
  }, [placardLabel, palette.rackMetal, palette.accent, palette.wall]);

  useEffect(() => {
    return () => {
      galleryTagTexture?.dispose();
    };
  }, [galleryTagTexture]);

  // Subtle front/rear travertine flute coordinates scaled to plinth width
  const plinthFluteX = useMemo(() => {
    const xs: number[] = [];
    const half = layout.plinthWidth * 0.5 - 0.06;
    const count = Math.max(8, Math.round(layout.plinthWidth / 0.075));
    for (let i = 0; i <= count; i++) {
      xs.push(-half + (i / count) * (half * 2));
    }
    return xs;
  }, [layout.plinthWidth]);

  if (layout.hidden) {
    return null;
  }

  const halfSpan = layout.railSpan * 0.5;
  const uprightHeight = RAIL_HEIGHT - (PLINTH_TOP_Y + 0.014);
  const uprightCenterY = PLINTH_TOP_Y + 0.014 + uprightHeight * 0.5;
  const faceoutLength = layout.faceoutEndZ - layout.faceoutStartZ;
  const faceoutCenterZ = (layout.faceoutStartZ + layout.faceoutEndZ) * 0.5;

  return (
    <group position={worldPos} rotation={[0, worldRotY, 0]} name="boutique-rack">
      {/* =====================================================================
          1. ARCHITECTURAL TRAVERTINE / STONE PLINTH SLAB (y = 0 .. 0.08m)
         ===================================================================== */}
      <group name="travertine-plinth-base">
        {/* Recessed Brushed Metal Shadow Toe-Kick */}
        <mesh position={[0, 0.013, 0]} receiveShadow>
          <boxGeometry
            args={[layout.plinthWidth - 0.07, 0.022, layout.plinthDepth - 0.07]}
          />
          <meshStandardMaterial
            color={palette.rackMetal}
            metalness={metalness}
            roughness={Math.min(1, effectiveRoughness + 0.12)}
          />
        </mesh>

        {/* Perimeter Metallic Reveal Trim */}
        <mesh position={[0, 0.025, 0]} receiveShadow>
          <boxGeometry
            args={[layout.plinthWidth - 0.016, 0.004, layout.plinthDepth - 0.016]}
          />
          <meshStandardMaterial
            color={palette.rackMetal}
            metalness={metalness}
            roughness={effectiveRoughness}
          />
        </mesh>

        {/* Main Honed Travertine Stone Slab */}
        <RoundedBox
          args={[layout.plinthWidth, 0.054, layout.plinthDepth]}
          radius={0.01}
          smoothness={3}
          position={[0, 0.053, 0]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial
            map={plinthTexture}
            color="#ffffff"
            roughness={0.5}
            metalness={0.03}
          />
        </RoundedBox>

        {/* Subtle Architectural Fluting along Plinth Front & Rear Edges */}
        {plinthFluteX.map((fx, i) => (
          <React.Fragment key={i}>
            <mesh
              position={[fx, 0.052, layout.plinthDepth * 0.5 + 0.001]}
              scale={[1, 1, 0.42]}
              receiveShadow
            >
              <cylinderGeometry args={[0.012, 0.012, 0.046, 8]} />
              <meshStandardMaterial color={palette.plinth} roughness={0.56} />
            </mesh>
            <mesh
              position={[fx, 0.052, -layout.plinthDepth * 0.5 - 0.001]}
              scale={[1, 1, 0.42]}
              receiveShadow
            >
              <cylinderGeometry args={[0.012, 0.012, 0.046, 8]} />
              <meshStandardMaterial color={palette.plinth} roughness={0.56} />
            </mesh>
          </React.Fragment>
        ))}
      </group>

      {/* =====================================================================
          2. WIDE ARCHITECTURAL FLOOR BASE BARS & MACHINED MOUNTING COLLARS
         ===================================================================== */}
      <group name="rack-tubular-frame">
        {[-halfSpan, halfSpan].map((xSide, sideIdx) => (
          <group key={sideIdx} position={[xSide, 0, 0]}>
            {/* Wide Floor Base Runner Bar (Z-axis sled) */}
            <mesh
              position={[0, PLINTH_TOP_Y + 0.018, 0]}
              rotation={[Math.PI * 0.5, 0, 0]}
              castShadow
              receiveShadow
            >
              <cylinderGeometry
                args={[0.0135, 0.0135, layout.baseRunnerLength, 24]}
              />
              <meshStandardMaterial
                color={palette.rackMetal}
                metalness={metalness}
                roughness={effectiveRoughness}
              />
            </mesh>

            {/* Spherical Machined End-Caps + Turned Plinth Anchor Feet on Runner Ends */}
            {[-layout.baseRunnerLength * 0.5, layout.baseRunnerLength * 0.5].map(
              (zEnd, endIdx) => (
                <group key={endIdx} position={[0, PLINTH_TOP_Y, zEnd]}>
                  <mesh position={[0, 0.018, 0]} castShadow>
                    <sphereGeometry args={[0.0138, 18, 18]} />
                    <meshStandardMaterial
                      color={palette.rackMetal}
                      metalness={metalness}
                      roughness={effectiveRoughness}
                    />
                  </mesh>
                  <mesh position={[0, 0.006, 0]} castShadow receiveShadow>
                    <cylinderGeometry args={[0.019, 0.022, 0.012, 22]} />
                    <meshStandardMaterial
                      color={palette.rackMetal}
                      metalness={metalness}
                      roughness={effectiveRoughness}
                    />
                  </mesh>
                </group>
              )
            )}

            {/* Heavy Turned Stanchion Mounting Collar at Upright Base */}
            <group position={[0, PLINTH_TOP_Y + 0.026, layout.mainRailZ]}>
              <mesh castShadow receiveShadow>
                <cylinderGeometry args={[0.025, 0.029, 0.044, 28]} />
                <meshStandardMaterial
                  color={palette.rackMetal}
                  metalness={metalness}
                  roughness={effectiveRoughness}
                />
              </mesh>
              <mesh position={[0, 0.028, 0]} castShadow>
                <cylinderGeometry args={[0.0185, 0.021, 0.014, 26]} />
                <meshStandardMaterial
                  color={palette.rackMetal}
                  metalness={metalness}
                  roughness={effectiveRoughness}
                />
              </mesh>
            </group>

            {/* Vertical Tubular Upright Rail */}
            <mesh
              position={[0, uprightCenterY, layout.mainRailZ]}
              castShadow
              receiveShadow
            >
              <cylinderGeometry
                args={[RAIL_RADIUS, RAIL_RADIUS, uprightHeight, 28]}
              />
              <meshStandardMaterial
                color={palette.rackMetal}
                metalness={metalness}
                roughness={effectiveRoughness}
              />
            </mesh>

            {/* Precision Mid-Upright Modular Joint Collar */}
            <mesh position={[0, 0.84, layout.mainRailZ]} castShadow>
              <cylinderGeometry args={[0.0156, 0.0156, 0.024, 24]} />
              <meshStandardMaterial
                color={palette.rackMetal}
                metalness={metalness}
                roughness={effectiveRoughness}
              />
            </mesh>

            {/* Top Mitered / Spherical Corner Joint + Twin Machined Compression Collars */}
            <group position={[0, RAIL_HEIGHT, layout.mainRailZ]}>
              <mesh castShadow>
                <sphereGeometry args={[0.0162, 24, 24]} />
                <meshStandardMaterial
                  color={palette.rackMetal}
                  metalness={metalness}
                  roughness={effectiveRoughness}
                />
              </mesh>
              {/* Vertical Corner Collar */}
              <mesh position={[0, -0.022, 0]} castShadow>
                <cylinderGeometry args={[0.016, 0.016, 0.018, 24]} />
                <meshStandardMaterial
                  color={palette.rackMetal}
                  metalness={metalness}
                  roughness={effectiveRoughness}
                />
              </mesh>
              {/* Horizontal Inward Corner Collar */}
              <mesh
                position={[xSide < 0 ? 0.022 : -0.022, 0, 0]}
                rotation={[0, 0, Math.PI * 0.5]}
                castShadow
              >
                <cylinderGeometry args={[0.016, 0.016, 0.018, 24]} />
                <meshStandardMaterial
                  color={palette.rackMetal}
                  metalness={metalness}
                  roughness={effectiveRoughness}
                />
              </mesh>
            </group>
          </group>
        ))}

        {/* Full-Width Lower Rear Structural Tie-Bar */}
        <mesh
          position={[0, PLINTH_TOP_Y + 0.018, -layout.baseRunnerLength * 0.36]}
          rotation={[0, 0, Math.PI * 0.5]}
          castShadow
          receiveShadow
        >
          <cylinderGeometry args={[0.0105, 0.0105, layout.railSpan, 24]} />
          <meshStandardMaterial
            color={palette.rackMetal}
            metalness={metalness}
            roughness={effectiveRoughness}
          />
        </mesh>

        {/* Top Horizontal Gallery Rail */}
        <mesh
          position={[0, RAIL_HEIGHT, layout.mainRailZ]}
          rotation={[0, 0, Math.PI * 0.5]}
          castShadow
          receiveShadow
        >
          <cylinderGeometry args={[RAIL_RADIUS, RAIL_RADIUS, layout.railSpan, 28]} />
          <meshStandardMaterial
            color={palette.rackMetal}
            metalness={metalness}
            roughness={effectiveRoughness}
          />
        </mesh>

        {/* Machined Rail Stop Rings flanking Companion Hanger Slots */}
        {layout.railSpacerX.map((sx, idx) => (
          <React.Fragment key={idx}>
            <mesh
              position={[sx - 0.024, RAIL_HEIGHT, layout.mainRailZ]}
              rotation={[0, 0, Math.PI * 0.5]}
            >
              <cylinderGeometry args={[0.0155, 0.0155, 0.005, 22]} />
              <meshStandardMaterial
                color={palette.rackMetal}
                metalness={metalness}
                roughness={effectiveRoughness}
              />
            </mesh>
            <mesh
              position={[sx + 0.024, RAIL_HEIGHT, layout.mainRailZ]}
              rotation={[0, 0, Math.PI * 0.5]}
            >
              <cylinderGeometry args={[0.0155, 0.0155, 0.005, 22]} />
              <meshStandardMaterial
                color={palette.rackMetal}
                metalness={metalness}
                roughness={effectiveRoughness}
              />
            </mesh>
          </React.Fragment>
        ))}

        {/* Custom Central Boutique Face-Out Display Arm (Waterfall / T-Arm) */}
        {layout.hasFaceoutArm && (
          <group name="central-faceout-display-arm">
            {/* Machined T-Junction Clamp Collar on Main Rail */}
            <mesh
              position={[0, RAIL_HEIGHT, layout.mainRailZ]}
              rotation={[0, 0, Math.PI * 0.5]}
              castShadow
            >
              <cylinderGeometry args={[0.0185, 0.0185, 0.044, 26]} />
              <meshStandardMaterial
                color={palette.rackMetal}
                metalness={metalness}
                roughness={effectiveRoughness}
              />
            </mesh>

            {/* Forward-Projecting Cylindrical Face-Out Bar */}
            <mesh
              position={[0, RAIL_HEIGHT, faceoutCenterZ]}
              rotation={[Math.PI * 0.5, 0, 0]}
              castShadow
            >
              <cylinderGeometry args={[0.0125, 0.0125, faceoutLength, 26]} />
              <meshStandardMaterial
                color={palette.rackMetal}
                metalness={metalness}
                roughness={effectiveRoughness}
              />
            </mesh>

            {/* Rear Machined Counter-Cap */}
            <mesh
              position={[0, RAIL_HEIGHT, layout.faceoutStartZ]}
              rotation={[Math.PI * 0.5, 0, 0]}
              castShadow
            >
              <cylinderGeometry args={[0.0155, 0.0155, 0.008, 22]} />
              <meshStandardMaterial
                color={palette.rackMetal}
                metalness={metalness}
                roughness={effectiveRoughness}
              />
            </mesh>

            {/* Front Subtle Disc Finial Stop (keeps curved brass hook as the hero detail) */}
            <mesh
              position={[0, RAIL_HEIGHT, layout.faceoutEndZ]}
              rotation={[Math.PI * 0.5, 0, 0]}
              castShadow
            >
              <cylinderGeometry args={[0.0135, 0.0135, 0.005, 24]} />
              <meshStandardMaterial
                color={palette.rackMetal}
                metalness={metalness}
                roughness={effectiveRoughness}
              />
            </mesh>
          </group>
        )}

        {/* Subtle Overhead Architectural Gallery Placard */}
        {galleryTagTexture && (
          <group position={[0, RAIL_HEIGHT + 0.052, layout.mainRailZ]} name="overhead-gallery-tag">
            {/* Twin Slender Brass Mounting Pins */}
            <mesh position={[-0.085, -0.024, 0]}>
              <cylinderGeometry args={[0.0028, 0.0028, 0.032, 12]} />
              <meshStandardMaterial
                color={palette.rackMetal}
                metalness={metalness}
                roughness={effectiveRoughness}
              />
            </mesh>
            <mesh position={[0.085, -0.024, 0]}>
              <cylinderGeometry args={[0.0028, 0.0028, 0.032, 12]} />
              <meshStandardMaterial
                color={palette.rackMetal}
                metalness={metalness}
                roughness={effectiveRoughness}
              />
            </mesh>

            {/* Brushed Metallic Outer Placard Frame */}
            <RoundedBox
              args={[0.31, 0.046, 0.008]}
              radius={0.004}
              smoothness={2}
              castShadow
            >
              <meshStandardMaterial
                color={palette.rackMetal}
                metalness={metalness}
                roughness={effectiveRoughness}
              />
            </RoundedBox>

            {/* Front & Rear Exhibition Label Faces */}
            <mesh position={[0, 0, 0.0045]}>
              <planeGeometry args={[0.298, 0.038]} />
              <meshBasicMaterial map={galleryTagTexture} />
            </mesh>
            <mesh position={[0, 0, -0.0045]} rotation={[0, Math.PI, 0]}>
              <planeGeometry args={[0.298, 0.038]} />
              <meshBasicMaterial map={galleryTagTexture} />
            </mesh>
          </group>
        )}
      </group>

      {/* =====================================================================
          3. VOLUMETRIC HANGING GARMENTS (HERO FACE-OUT & CAPSULE COMPANIONS)
         ===================================================================== */}
      {layout.slots.map(({ item, pos, rotY, hookSwivelY }) => {
        if (item.productSpec && !item.frontMap) {
          return (
            <HangingApparel3D
              key={item.id}
              spec={item.productSpec}
              position={pos}
              rotationY={rotY}
              hookSwivelY={hookSwivelY}
              metalColor={palette.rackMetal}
              woodColor={palette.hangerWood}
              metalness={metalness}
              metalRoughness={effectiveRoughness}
              accentColor={palette.accent}
              tuning={tuning}
              selected={selectedGarmentId === item.id}
              onSelect={onSelectGarment ? () => onSelectGarment(item.id) : undefined}
              label={item.label ?? item.title}
              price={item.price}
            />
          );
        }

        if (!item.frontMap) {
          return null;
        }

        return (
          <HangingGarment
            key={item.id}
            frontMap={item.frontMap}
            backMap={item.backMap}
            normalMap={item.normalMap}
            aspect={item.aspect}
            position={pos}
            rotationY={rotY}
            hookSwivelY={hookSwivelY}
            metalColor={palette.rackMetal}
            woodColor={palette.hangerWood}
            metalness={metalness}
            metalRoughness={effectiveRoughness}
            accentColor={palette.accent}
            tuning={tuning}
            selected={selectedGarmentId === item.id}
            onSelect={onSelectGarment ? () => onSelectGarment(item.id) : undefined}
            label={item.label ?? item.title}
            price={item.price}
          />
        );
      })}
    </group>
  );
};

export default BoutiqueRack;
