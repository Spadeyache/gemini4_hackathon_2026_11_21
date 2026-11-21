export type LightingPreset =
  | 'warm_court_sunlight'
  | 'cool_gallery_spot'
  | 'kyoto_golden_hour';

export type GarmentRenderMode = 'volumetric' | 'naive_flat';
export type GarmentSourceMode = 'ai_normalized' | 'raw_cutout' | 'custom_upload';

export interface GarmentAssetSet {
  id: string;
  sku: string;
  title: string;
  subtitle?: string;
  price: number;
  featured?: boolean;
  /** Raw source image before cutout */
  rawUrl: string;
  /** Pre-processed RGBA cutout front (optional, falls back to client cutout) */
  frontCutoutUrl?: string;
  /** Pre-processed RGBA cutout back (optional, falls back to synthesized back) */
  backCutoutUrl?: string;
  /** Tangent-space normal map URL (optional, falls back to client Sobel normal map) */
  normalMapUrl?: string;
  /** AI-normalized hanging front cutout URL */
  normalizedFrontCutoutUrl?: string;
  /** AI-normalized hanging back cutout URL */
  normalizedBackCutoutUrl?: string;
  /** AI-normalized normal map URL */
  normalizedNormalMapUrl?: string;
  /** Base garment body hex for hanger/edge fallback */
  dominantHex?: string;
  /** Aspect ratio width / height */
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
  palette: StorePalette;
  metalRoughness: number;
  metalness: number;
  lightingPreset: LightingPreset;
  textures: StoreTextures;
  racks: RackPlacement[];
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
