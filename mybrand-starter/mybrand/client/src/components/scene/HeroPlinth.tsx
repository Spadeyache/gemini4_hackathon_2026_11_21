import { useEffect, useMemo } from "react";
import type { Product, WorldSpec } from "@mybrand/shared";
import {
  mergeBoxGeometries,
  type BrandPalette,
} from "../../world/geometryUtils";
import { ProductDisplay } from "./ProductDisplay";

interface HeroPlinthProps {
  worldSpec: WorldSpec;
  activeProductId: string;
  productById: Map<string, Product>;
  assetUrlById: Map<string, string>;
  palette: BrandPalette;
  targetedKey: string | null;
  onSelectProduct: (product: Product, zoneId: string) => void;
}

export function HeroPlinth({
  worldSpec,
  activeProductId,
  productById,
  assetUrlById,
  palette,
  targetedKey,
  onSelectProduct,
}: HeroPlinthProps) {
  const [hx, hz] = worldSpec.hero_plinth.position;
  const [ex, ez] = worldSpec.entrance.position;

  // Orient hero product card directly toward the entrance
  const facingYaw = Math.atan2(ex - hx, ez - hz);

  const plinthGeometry = useMemo(
    () =>
      mergeBoxGeometries([
        // Stepped sculptural pedestal base
        { size: [0.96, 0.1, 0.96], position: [0, 0.05, 0] },
        { size: [0.84, 0.88, 0.84], position: [0, 0.54, 0] },
        { size: [0.92, 0.07, 0.92], position: [0, 1.015, 0] },
      ]),
    []
  );

  useEffect(() => {
    return () => {
      plinthGeometry.dispose();
    };
  }, [plinthGeometry]);

  const activeProduct = productById.get(activeProductId);
  const heroZoneId = activeProduct?.zone_id ?? worldSpec.zones[0]?.id ?? "entrance";
  const heroTargetKey = `${heroZoneId}:hero_plinth`;

  return (
    <group position={[hx, 0, hz]} name="hero-plinth-group">
      <mesh geometry={plinthGeometry} name="hero-plinth-pedestal">
        <meshStandardMaterial
          color={palette.wall}
          roughness={0.62}
          metalness={0.08}
        />
      </mesh>

      {/* Warm hero overhead pool */}
      <pointLight
        position={[0, 2.75, 0]}
        color="#ffe8cc"
        intensity={10}
        distance={6}
        decay={1.4}
      />

      <ProductDisplay
        productId={activeProductId}
        slotId="hero_plinth"
        zoneId={heroZoneId}
        position={[0, 1.06, 0]}
        rotationY={facingYaw}
        scale={1.32}
        productById={productById}
        assetUrlById={assetUrlById}
        palette={palette}
        isTargeted={targetedKey === heroTargetKey}
        onSelectProduct={onSelectProduct}
      />
    </group>
  );
}
