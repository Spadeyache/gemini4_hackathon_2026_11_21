import { useEffect, useMemo, useRef } from "react";
import { Text } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import type {
  LightingPreset,
  Product,
  SessionState,
  WorldSpec,
  Zone,
} from "@mybrand/shared";
import * as THREE from "three";
import { useTypewriter } from "../../state/useTypewriter";
import {
  getSlotProductId,
  getZoneLightingId,
  getZoneSignage,
} from "../../state/sessionState";
import type { BrandPalette } from "../../world/geometryUtils";
import { kelvinToRgb, resolveLightingPreset } from "../../world/lightingUtils";
import {
  getFixtureSlotLocalPositions,
  localToWorldPoint,
} from "../../world/roomLayout";
import { FixtureMesh } from "./FixtureMesh";
import { ProductDisplay } from "./ProductDisplay";

interface ZoneGroupProps {
  zone: Zone;
  zoneIndex: number;
  worldSpec: WorldSpec;
  sessionState: SessionState;
  productById: Map<string, Product>;
  assetUrlById: Map<string, string>;
  palette: BrandPalette;
  targetedKey: string | null;
  cameraMode: "diorama" | "walk";
  isFocusedZone: boolean;
  onFocusZone: (zoneId: string) => void;
  onSelectProduct: (product: Product, zoneId: string) => void;
}

const LIGHTING_TWEEN_DURATION_S = 0.8; // 800 ms lighting tween

interface LightTargetValues {
  r: number;
  g: number;
  b: number;
  pointIntensity: number;
  spotIntensity: number;
  poolOpacity: number;
}

function presetToLightValues(
  preset: LightingPreset,
  isFocusedDiorama: boolean
): LightTargetValues {
  const rgb = kelvinToRgb(preset.color_temp_k);
  const baseOpacity = preset.spot ? 0.24 : 0.09;
  return {
    r: rgb.r,
    g: rgb.g,
    b: rgb.b,
    // Calibrated for Three.js r170 physical lights (decay ~1.4)
    pointIntensity: preset.spot
      ? preset.intensity * 6.5
      : preset.intensity * 13.5,
    spotIntensity: preset.spot ? preset.intensity * 26 : 0,
    poolOpacity: isFocusedDiorama ? Math.max(0.24, baseOpacity + 0.1) : baseOpacity,
  };
}

export function ZoneGroup({
  zone,
  zoneIndex,
  worldSpec,
  sessionState,
  productById,
  assetUrlById,
  palette,
  targetedKey,
  cameraMode,
  isFocusedZone,
  onFocusZone,
  onSelectProduct,
}: ZoneGroupProps) {
  const activeLightingId = getZoneLightingId(sessionState, zone.id, zone.lighting);
  const activeSignage = getZoneSignage(sessionState, zone.id, zone.signage);
  const preset = resolveLightingPreset(worldSpec, activeLightingId);

  const { displayed: typedSignage, isTyping } = useTypewriter(activeSignage, 26);

  const pointLightRef = useRef<THREE.PointLight>(null);
  const spotLightRef = useRef<THREE.SpotLight>(null);
  const spotTargetRef = useRef<THREE.Object3D>(null);
  const matLightDiscRef = useRef<THREE.MeshBasicMaterial>(null);

  const isFocusedDiorama = cameraMode === "diorama" && isFocusedZone;

  const initialLightValues = useMemo(
    () => presetToLightValues(preset, isFocusedDiorama),
    // Initial snapshot only; subsequent changes tween via effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [zone.id]
  );

  const tweenRef = useRef<{
    from: LightTargetValues;
    current: LightTargetValues;
    to: LightTargetValues;
    elapsed: number;
    active: boolean;
  }>({
    from: { ...initialLightValues },
    current: { ...initialLightValues },
    to: { ...initialLightValues },
    elapsed: LIGHTING_TWEEN_DURATION_S,
    active: false,
  });

  useEffect(() => {
    const nextTarget = presetToLightValues(preset, isFocusedDiorama);
    const tween = tweenRef.current;
    tween.from = { ...tween.current };
    tween.to = nextTarget;
    tween.elapsed = 0;
    tween.active = true;
  }, [
    preset.id,
    preset.color_temp_k,
    preset.intensity,
    preset.spot,
    isFocusedDiorama,
  ]);

  useEffect(() => {
    if (spotLightRef.current && spotTargetRef.current) {
      spotLightRef.current.target = spotTargetRef.current;
    }
  }, [preset.spot]);

  useFrame((_, delta) => {
    const tween = tweenRef.current;
    if (!tween.active) return;

    const dt = Math.min(delta, 0.05);
    tween.elapsed += dt;
    const rawT = Math.min(1, tween.elapsed / LIGHTING_TWEEN_DURATION_S);
    // Smooth cubic ease-in-out
    const t =
      rawT < 0.5 ? 4 * rawT * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 3) / 2;

    const lerp = (a: number, b: number) => a + (b - a) * t;
    tween.current.r = lerp(tween.from.r, tween.to.r);
    tween.current.g = lerp(tween.from.g, tween.to.g);
    tween.current.b = lerp(tween.from.b, tween.to.b);
    tween.current.pointIntensity = lerp(
      tween.from.pointIntensity,
      tween.to.pointIntensity
    );
    tween.current.spotIntensity = lerp(
      tween.from.spotIntensity,
      tween.to.spotIntensity
    );
    tween.current.poolOpacity = lerp(
      tween.from.poolOpacity,
      tween.to.poolOpacity
    );

    const { r, g, b, pointIntensity, spotIntensity, poolOpacity } = tween.current;

    if (pointLightRef.current) {
      pointLightRef.current.color.setRGB(r, g, b);
      pointLightRef.current.intensity = pointIntensity;
    }
    if (spotLightRef.current) {
      spotLightRef.current.color.setRGB(r, g, b);
      spotLightRef.current.intensity = spotIntensity;
    }
    if (matLightDiscRef.current) {
      matLightDiscRef.current.color.setRGB(r, g, b);
      matLightDiscRef.current.opacity = poolOpacity;
    }

    if (rawT >= 1) {
      tween.active = false;
    }
  });

  const [cx, cz] = zone.center;
  const [zw, zd] = zone.size;
  const roomH = worldSpec.room.size_m[2];

  // Orient zone signage cleanly toward the viewer in 2.5D mode, or toward hero corridor in Walk mode
  const [ex, ez] = worldSpec.entrance.position;
  const lookTargetX = cameraMode === "diorama" ? ex : worldSpec.hero_plinth.position[0];
  const lookTargetZ = cameraMode === "diorama" ? ez - 10 : worldSpec.hero_plinth.position[1];
  const signageYaw = Math.atan2(lookTargetX - cx, lookTargetZ - cz);

  // Match poster per zone when multiple posters exist, falling back cleanly to logo
  const posterAssetUrl = useMemo(() => {
    const posters = worldSpec.assets.filter((a) => a.kind === "poster");
    if (posters.length > 0) {
      const zoneToken = zone.id.replace(/^zone_/, "").toLowerCase();
      const matched = posters.find(
        (p) =>
          p.id.toLowerCase().includes(zone.id.toLowerCase()) ||
          (zoneToken.length > 0 && p.id.toLowerCase().includes(zoneToken))
      );
      if (matched) return matched.url;
      return posters[zoneIndex % posters.length].url;
    }
    const logo = worldSpec.assets.find((a) => a.kind === "logo");
    return logo?.url ?? null;
  }, [worldSpec.assets, zone.id, zoneIndex]);

  const slotFallbackMap = useMemo(
    () => new Map(zone.slots.map((slot) => [slot.id, slot.product_id])),
    [zone.slots]
  );

  // Compute world transforms for every fixture slot in this zone
  const placedSlots = useMemo(() => {
    const results: Array<{
      slotId: string;
      worldPos: [number, number, number];
      rotationY: number;
    }> = [];

    for (const fixture of zone.fixtures) {
      if (fixture.slot_ids.length === 0) continue;
      const localAnchors = getFixtureSlotLocalPositions(
        fixture.type,
        fixture.slot_ids.length
      );
      const fixtureRotRad = THREE.MathUtils.degToRad(fixture.rotation_deg);

      fixture.slot_ids.forEach((slotId, index) => {
        const localPos = localAnchors[index] ?? [0, 1, 0];
        const worldPos = localToWorldPoint(fixture, localPos);
        results.push({
          slotId,
          worldPos,
          rotationY: fixtureRotRad,
        });
      });
    }

    return results;
  }, [zone.fixtures]);

  const initialColor = useMemo(
    () =>
      new THREE.Color(
        initialLightValues.r,
        initialLightValues.g,
        initialLightValues.b
      ),
    [initialLightValues]
  );

  const handleFloorMatClick = (event: ThreeEvent<MouseEvent>) => {
    if (cameraMode !== "diorama") return;
    event.stopPropagation();
    onFocusZone(zone.id);
  };

  return (
    <group name={`zone-${zone.id}`}>
      {/* Architectural zone floor mat (clickable in 2.5D Diorama mode to focus & enter_zone) */}
      <mesh
        position={[cx, 0.007, cz]}
        rotation={[-Math.PI / 2, 0, 0]}
        name={`zone-mat-${zone.id}`}
        onClick={handleFloorMatClick}
      >
        <planeGeometry
          args={[Math.max(0.2, zw - 0.16), Math.max(0.2, zd - 0.16)]}
        />
        <meshBasicMaterial
          ref={matLightDiscRef}
          color={initialColor}
          transparent
          opacity={initialLightValues.poolOpacity}
          depthWrite={false}
        />
      </mesh>

      {/* Zone ambient fill point light */}
      <pointLight
        ref={pointLightRef}
        position={[cx, Math.min(roomH - 0.45, 3.35), cz]}
        color={initialColor}
        intensity={initialLightValues.pointIntensity}
        distance={9}
        decay={1.4}
      />

      {/* Focused gallery spotlight (mounted on-demand when preset.spot is active to stay <= 60 scene objects) */}
      {preset.spot && (
        <>
          <object3D ref={spotTargetRef} position={[cx, 0.6, cz]} />
          <spotLight
            ref={spotLightRef}
            position={[cx, Math.min(roomH - 0.2, 3.75), cz]}
            color={initialColor}
            intensity={initialLightValues.spotIntensity}
            angle={0.58}
            penumbra={0.65}
            distance={10}
            decay={1.4}
          />
        </>
      )}

      {/* Refined Architectural Zone Signage Plaque + Typewriter 3D Text */}
      <group
        position={[cx, cameraMode === "diorama" ? 2.32 : Math.min(roomH - 0.85, 2.95), cz]}
        rotation={[0, signageYaw, 0]}
        name={`zone-signage-${zone.id}`}
      >
        <mesh name={`zone-signage-board-${zone.id}`}>
          <boxGeometry args={[2.55, 0.34, 0.035]} />
          <meshStandardMaterial
            color={palette.wall}
            roughness={0.58}
            metalness={0.05}
            transparent
            opacity={0.92}
          />
        </mesh>
        <Text
          position={[0, 0, 0.024]}
          fontSize={0.105}
          maxWidth={2.35}
          color={palette.dark}
          anchorX="center"
          anchorY="middle"
          textAlign="center"
        >
          {isTyping ? `${typedSignage}▍` : typedSignage}
        </Text>
      </group>

      {/* All fixtures belonging to this zone */}
      {zone.fixtures.map((fixture) => (
        <FixtureMesh
          key={fixture.id}
          fixture={fixture}
          zoneBeat={zone.beat}
          palette={palette}
          posterUrl={posterAssetUrl}
          cameraMode={cameraMode}
        />
      ))}

      {/* Products displayed on zone slots */}
      {placedSlots.map((slot) => {
        const fallbackProduct = slotFallbackMap.get(slot.slotId) ?? "";
        const activeProductId = getSlotProductId(
          sessionState,
          zone.id,
          slot.slotId,
          fallbackProduct
        );
        if (!activeProductId) return null;

        const targetKey = `${zone.id}:${slot.slotId}`;

        return (
          <ProductDisplay
            key={slot.slotId}
            productId={activeProductId}
            slotId={slot.slotId}
            zoneId={zone.id}
            position={slot.worldPos}
            rotationY={slot.rotationY}
            productById={productById}
            assetUrlById={assetUrlById}
            palette={palette}
            isTargeted={targetedKey === targetKey}
            onSelectProduct={onSelectProduct}
          />
        );
      })}
    </group>
  );
}
