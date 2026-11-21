import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import type { Product } from "@mybrand/shared";
import * as THREE from "three";
import { resolveAssetUrl, type BrandPalette } from "../../world/geometryUtils";
import { useCachedTexture } from "../../world/textureCache";

export interface ProductHitData {
  isProductTarget: true;
  productId: string;
  slotId: string;
  zoneId: string;
}

interface ProductDisplayProps {
  productId: string;
  slotId: string;
  zoneId: string;
  position: [number, number, number];
  rotationY?: number;
  scale?: number;
  productById: Map<string, Product>;
  assetUrlById: Map<string, string>;
  palette: BrandPalette;
  isTargeted: boolean;
  onSelectProduct: (product: Product, zoneId: string) => void;
}

const HALF_SWAP_DURATION_S = 0.2; // 200 ms fade/scale out + 200 ms fade/scale in = 400 ms total

export function ProductDisplay({
  productId,
  slotId,
  zoneId,
  position,
  rotationY = 0,
  scale = 1,
  productById,
  assetUrlById,
  palette,
  isTargeted,
  onSelectProduct,
}: ProductDisplayProps) {
  const [displayedId, setDisplayedId] = useState(productId);
  const animGroupRef = useRef<THREE.Group>(null);
  const cardMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const baseMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const hitMeshRef = useRef<THREE.Mesh>(null);

  const swapStateRef = useRef<{
    phase: "idle" | "out" | "in";
    elapsed: number;
    pendingId: string;
  }>({
    phase: "idle",
    elapsed: 0,
    pendingId: productId,
  });

  useEffect(() => {
    if (productId !== displayedId) {
      swapStateRef.current.pendingId = productId;
      if (swapStateRef.current.phase === "idle") {
        swapStateRef.current.phase = "out";
        swapStateRef.current.elapsed = 0;
      } else if (swapStateRef.current.phase === "in") {
        // Restart smoothly from current progress
        swapStateRef.current.phase = "out";
        swapStateRef.current.elapsed = 0;
      }
    }
  }, [productId, displayedId]);

  const product = productById.get(displayedId) ?? productById.get(productId);
  const imageUrl = resolveAssetUrl(product?.image_asset_ids[0], assetUrlById);

  const productTexture = useCachedTexture(imageUrl, 1, 1);

  const tierRimColor = useMemo(() => {
    if (!product) return palette.wood;
    switch (product.tier) {
      case "signature":
        return palette.accent;
      case "core":
        return palette.secondary;
      case "entry":
        return palette.wood;
    }
  }, [product, palette]);

  const hitData = useMemo<ProductHitData>(
    () => ({
      isProductTarget: true,
      productId: product?.id ?? productId,
      slotId,
      zoneId,
    }),
    [product?.id, productId, slotId, zoneId]
  );

  useEffect(() => {
    if (hitMeshRef.current) {
      hitMeshRef.current.userData = hitData;
    }
  }, [hitData]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const anim = swapStateRef.current;
    const group = animGroupRef.current;
    const cardMat = cardMatRef.current;
    const baseMat = baseMatRef.current;

    let animScale = 1;
    let animOpacity = 1;

    if (anim.phase === "out") {
      anim.elapsed += dt;
      const t = Math.min(1, anim.elapsed / HALF_SWAP_DURATION_S);
      const ease = t * t;
      animScale = 1 - 0.28 * ease;
      animOpacity = 1 - ease;

      if (t >= 1) {
        setDisplayedId(anim.pendingId);
        anim.phase = "in";
        anim.elapsed = 0;
        animScale = 0.72;
        animOpacity = 0;
      }
    } else if (anim.phase === "in") {
      anim.elapsed += dt;
      const t = Math.min(1, anim.elapsed / HALF_SWAP_DURATION_S);
      const easeOut = 1 - Math.pow(1 - t, 3);
      animScale = 0.72 + 0.28 * easeOut;
      animOpacity = easeOut;

      if (t >= 1) {
        anim.phase = "idle";
        anim.elapsed = 0;
        animScale = 1;
        animOpacity = 1;
      }
    }

    if (group) {
      const targetHoverBoost = isTargeted ? 1.05 : 1;
      const finalScale = scale * animScale * targetHoverBoost;
      group.scale.setScalar(finalScale);
      // Gentle hover float on targeted piece
      group.position.y =
        position[1] +
        (isTargeted ? 0.025 + Math.sin(state.clock.elapsedTime * 3.5) * 0.01 : 0);
    }

    if (cardMat) {
      const needsAlpha = animOpacity < 0.995;
      if (cardMat.transparent !== needsAlpha) {
        cardMat.transparent = needsAlpha;
        cardMat.needsUpdate = true;
      }
      cardMat.opacity = animOpacity;
      cardMat.emissiveIntensity = isTargeted ? 0.18 : 0.03;
    }

    if (baseMat) {
      const needsAlpha = animOpacity < 0.995;
      if (baseMat.transparent !== needsAlpha) {
        baseMat.transparent = needsAlpha;
        baseMat.needsUpdate = true;
      }
      baseMat.opacity = animOpacity;
      baseMat.emissiveIntensity = isTargeted ? 0.65 : 0.1;
    }
  });

  if (!product) return null;

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelectProduct(product, zoneId);
  };

  return (
    <group
      ref={animGroupRef}
      position={position}
      rotation={[0, rotationY, 0]}
      scale={scale}
      name={`product-slot-${slotId}`}
    >
      {/* Gallery-grade framed product showcase block */}
      <mesh
        ref={hitMeshRef}
        position={[0, 0.43, 0]}
        onClick={handleClick}
        userData={hitData}
        name={`product-card-${slotId}`}
      >
        <boxGeometry args={[0.64, 0.72, 0.085]} />
        <meshStandardMaterial
          key={productTexture ? `prod-tex-${displayedId}` : `prod-flat-${displayedId}`}
          ref={cardMatRef}
          color={productTexture ? "#ffffff" : palette.floor}
          map={productTexture}
          emissive={palette.accent}
          emissiveIntensity={0.04}
          roughness={0.42}
          metalness={0.06}
        />
      </mesh>

      {/* Tier plinth disc & focus halo */}
      <mesh
        position={[0, 0.032, 0]}
        onClick={handleClick}
        userData={hitData}
        name={`product-base-${slotId}`}
      >
        <cylinderGeometry args={[0.34, 0.38, 0.065, 24]} />
        <meshStandardMaterial
          ref={baseMatRef}
          color={isTargeted ? palette.accent : tierRimColor}
          emissive={isTargeted ? palette.accent : tierRimColor}
          emissiveIntensity={0.14}
          roughness={0.38}
          metalness={0.18}
        />
      </mesh>
    </group>
  );
}
