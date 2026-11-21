export type LightingPreset =
  | 'warm_court_sunlight'
  | 'cool_gallery_spot'
  | 'kyoto_golden_hour';

export type WorldArchetypeId =
  | 'heritage_arch_flagship'
  | 'minimalist_tech_pavilion'
  | 'warm_artisanal_atelier'
  | 'avant_garde_concrete_loft';

export type ProductCategory3D =
  | 'heavyweight_hoodie'
  | 'structured_tshirt'
  | 'varsity_jacket'
  | 'ceramic_mug'
  | 'structured_cap'
  | 'canvas_tote'
  | 'hardcover_book'
  | 'apothecary_bottle';

export type ProductGraphicMotif =
  | 'monogram_crest'
  | 'geometric_grid'
  | 'botanical_line'
  | 'minimal_typo'
  | 'archival_seal'
  | 'orbital_rings';

export type ProductPlacementZone =
  | 'hero_rack'
  | 'capsule_rack'
  | 'center_table'
  | 'left_pedestal'
  | 'right_pedestal';

export interface InventedProductSpec {
  id: string;
  sku: string;
  title: string;
  subtitle: string;
  category: ProductCategory3D;
  placement: ProductPlacementZone;
  price: number;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  graphicHeadline: string;
  graphicSubtext?: string;
  graphicMotif: ProductGraphicMotif;
  materialFinish?:
    | 'combed_cotton'
    | 'brushed_fleece'
    | 'merino_knit'
    | 'matte_stoneware'
    | 'frosted_glass'
    | 'heavy_canvas';
  designRationale: string;
  shopifyProductUrl?: string;
  shopifyVariantId?: string;
  featured?: boolean;
  /** Optional photo texture URL only when rendering an explicit uploaded/catalog garment cutout */
  customCutoutUrl?: string;
}

export type GarmentRenderMode = 'volumetric' | 'naive_flat';
export type GarmentSourceMode = 'ai_normalized' | 'raw_cutout' | 'custom_upload';

export interface GarmentAssetSet {
  id: string;
  sku: string;
  title: string;
  subtitle?: string;
  price: number;
  featured?: boolean;
  /** Optional 3D product specification for bespoke parametric apparel silhouettes */
  productSpec?: InventedProductSpec;
  /** Raw source image before cutout (optional for pure 3D parametric products) */
  rawUrl: string;
  frontCutoutUrl?: string;
  backCutoutUrl?: string;
  normalMapUrl?: string;
  normalizedFrontCutoutUrl?: string;
  normalizedBackCutoutUrl?: string;
  normalizedNormalMapUrl?: string;
  dominantHex?: string;
  aspect?: number;
}

export interface RackPlacement {
  id: string;
  label: string;
  position: [number, number, number];
  rotationY: number;
  style: 'hero_faceout' | 'capsule_rail';
  items: GarmentAssetSet[];
}

export interface StorePalette {
  wall: string;
  floor: string;
  accent: string;
  secondaryAccent: string;
  rackMetal: string;
  hangerWood: string;
  plinth: string;
  rug: string;
  ambientLight: string;
  spotLight: string;
}

export interface StoreTextures {
  floorUrl?: string;
  wallUrl?: string;
  accentPanelUrl?: string;
  posterUrl?: string;
}

export interface StoreConfig {
  id: string;
  brandName: string;
  tagline: string;
  vibe: string;
  archetype?: WorldArchetypeId;
  sourceUrl?: string;
  brandEthos?: string;
  palette: StorePalette;
  metalRoughness: number;
  metalness: number;
  lightingPreset: LightingPreset;
  textures: StoreTextures;
  racks: RackPlacement[];
  /** Multi-category 3D products (hanging apparel + pedestal/table objects) invented for this brand */
  products?: InventedProductSpec[];
  architectNotes: string[];
}

export interface GarmentTuningParams {
  cutoutTolerance: number;
  curveDepth: number;
  sleeveRelax: number;
  fabricSheen: number;
  normalStrength: number;
  swayIntensity: number;
  shellThickness: number;
  renderMode: GarmentRenderMode;
  sourceMode: GarmentSourceMode;
  showCapsuleCompanions: boolean;
}
