import * as THREE from 'three';
import type { GarmentResolvedTextures } from '../../components/BoutiqueRack';
import { processGarmentInBrowser } from '../../lib/garmentProcessor';
import type {
  GarmentAssetSet,
  RackPlacement,
  StoreConfig,
  WorldArchetypeId,
} from '../../types/storeConfig';

export type IngestSourceType = 'shopify' | 'jsonld' | 'html_meta';

export type IngestProgressStage =
  | 'analyzing_identity'
  | 'designing_theme'
  | 'building_world'
  | 'scraping_catalog'
  | 'extracting_dna'
  | 'normalizing_garments';

export interface IngestProgressUpdate {
  stage: IngestProgressStage;
  stepNumber: 1 | 2 | 3;
  label: string;
  detail?: string;
  completedGarments?: number;
  totalGarments?: number;
}

export interface IngestBrandOptions {
  onProgress?: (update: IngestProgressUpdate) => void;
  signal?: AbortSignal;
}

export interface IngestedGarmentTextures extends GarmentResolvedTextures {
  dominantHex: string;
  accentHex: string;
  previewDataUrl: string;
  backPreviewDataUrl: string;
  normalDataUrl?: string;
  dispose: () => void;
}

export interface BrandIngestSummary {
  url: string;
  brandName: string;
  tagline: string;
  vibe: string;
  brandEthos: string;
  archetype: WorldArchetypeId;
  inventedProductCount: number;
  hangingApparelCount: number;
  pedestalObjectCount: number;
  sourceType: IngestSourceType;
  usedGemini: boolean;
  rawProductCount: number;
  processedGarmentCount: number;
  heroGarmentId: string;
  heroTitle: string;
  elapsedMs: number;
}

export interface BrandWebsiteIngestResult {
  storeConfig: StoreConfig;
  resolvedTexturesById: Record<string, IngestedGarmentTextures>;
  summary: BrandIngestSummary;
}

interface IngestApiResponse {
  storeConfig: StoreConfig;
  rawProductCount: number;
  sourceType: IngestSourceType;
  usedGemini: boolean;
  error?: string;
}

export function formatWorldArchetypeLabel(archetype?: WorldArchetypeId): string {
  switch (archetype) {
    case 'minimalist_tech_pavilion':
      return 'Minimalist Tech Pavilion';
    case 'warm_artisanal_atelier':
      return 'Warm Artisanal Atelier';
    case 'avant_garde_concrete_loft':
      return 'Avant-Garde Concrete Loft';
    case 'heritage_arch_flagship':
    default:
      return 'Heritage Arch Flagship';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function canvasTextureToDataUrl(tex: THREE.CanvasTexture): string | undefined {
  const img = tex.image as HTMLCanvasElement | undefined;
  if (img && typeof img.toDataURL === 'function') {
    try {
      return img.toDataURL('image/png');
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * End-to-end client Creative Director ingestion pipeline (~1–3s total):
 * 1. Calls `POST /api/ingest-url` to parse website identity, ethos, CSS colors & invent a 6-product 3D line + WorldArchetypeId
 * 2. Skips unnecessary slow image cutouts for parametric 3D `productSpec` garments, running browser cutouts
 *    ONLY when an item explicitly carries a verified `customCutoutUrl`
 * 3. Returns `{ storeConfig, resolvedTexturesById, summary }` ready for instant 3D showroom construction
 */
export async function ingestBrandWebsite(
  url: string,
  tolerance = 24,
  options?: IngestBrandOptions
): Promise<BrandWebsiteIngestResult> {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    throw new Error('Please enter any website or brand URL.');
  }

  const startedAt = performance.now();
  const onProgress = options?.onProgress;

  onProgress?.({
    stage: 'analyzing_identity',
    stepNumber: 1,
    label: '1. Analyzing Website Identity & Ethos...',
    detail: `Parsing ${trimmedUrl} headlines, manifesto copy & CSS brand tokens`,
  });

  let enteredStep2 = false;
  const step2Timer = window.setTimeout(() => {
    enteredStep2 = true;
    onProgress?.({
      stage: 'designing_theme',
      stepNumber: 2,
      label: '2. Designing Store Theme & Product Line...',
      detail: 'Selecting 3D architectural archetype, WCAG palette & inventing 6 bespoke products',
    });
  }, 360);

  let apiPayload: IngestApiResponse;
  try {
    const response = await fetch('/api/ingest-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: trimmedUrl }),
      signal: options?.signal,
    });

    const data = (await response.json().catch(() => ({}))) as Partial<IngestApiResponse>;
    if (!response.ok || !data.storeConfig) {
      throw new Error(
        data.error ||
          `Failed to generate 3D shop from ${trimmedUrl} (HTTP ${response.status}). Check that the Vite server plugin is running.`
      );
    }
    apiPayload = data as IngestApiResponse;
  } finally {
    window.clearTimeout(step2Timer);
  }

  const archetype: WorldArchetypeId =
    apiPayload.storeConfig.archetype ?? 'heritage_arch_flagship';
  const archetypeLabel = formatWorldArchetypeLabel(archetype);

  if (!enteredStep2) {
    onProgress?.({
      stage: 'designing_theme',
      stepNumber: 2,
      label: '2. Designing Store Theme & Product Line...',
      detail: `${apiPayload.storeConfig.brandName} · ${archetypeLabel}`,
    });
    await delay(95);
  }

  const allRackItems: GarmentAssetSet[] = apiPayload.storeConfig.racks.flatMap((r) => r.items);
  const inventedProducts = apiPayload.storeConfig.products ?? [];
  const totalProductCount = inventedProducts.length || allRackItems.length;

  onProgress?.({
    stage: 'building_world',
    stepNumber: 3,
    label: '3. Building 3D World & Merchandising Fixtures...',
    detail: `Constructing ${archetypeLabel} & merchandising ${totalProductCount} bespoke 3D products`,
    completedGarments: 0,
    totalGarments: totalProductCount,
  });

  const resolvedTexturesById: Record<string, IngestedGarmentTextures> = {};
  const enrichedItemById = new Map<string, GarmentAssetSet>();

  // Only run browser CIELAB image cutouts when an item explicitly provides a verified customCutoutUrl
  const itemsNeedingCutout = allRackItems.filter((item) =>
    Boolean(item.productSpec?.customCutoutUrl || (!item.productSpec && item.rawUrl))
  );

  if (itemsNeedingCutout.length > 0) {
    let completedCount = 0;
    await Promise.allSettled(
      itemsNeedingCutout.map(async (item) => {
        const cutoutSource = item.productSpec?.customCutoutUrl || item.rawUrl;
        if (!cutoutSource) return;

        const processed = await processGarmentInBrowser(cutoutSource, tolerance);
        processed.normalTexture.colorSpace = THREE.NoColorSpace;
        const normalDataUrl = canvasTextureToDataUrl(processed.normalTexture);

        completedCount += 1;
        onProgress?.({
          stage: 'building_world',
          stepNumber: 3,
          label: '3. Building 3D World & Merchandising Fixtures...',
          detail: `Normalized ${completedCount}/${itemsNeedingCutout.length}: ${item.title}`,
          completedGarments: completedCount,
          totalGarments: itemsNeedingCutout.length,
        });

        enrichedItemById.set(item.id, {
          ...item,
          frontCutoutUrl: processed.previewDataUrl,
          backCutoutUrl: processed.backPreviewDataUrl,
          normalMapUrl: normalDataUrl,
          normalizedFrontCutoutUrl: processed.previewDataUrl,
          normalizedBackCutoutUrl: processed.backPreviewDataUrl,
          normalizedNormalMapUrl: normalDataUrl,
          dominantHex: processed.dominantHex,
          aspect: processed.aspect,
        });

        resolvedTexturesById[item.id] = {
          frontMap: processed.frontTexture,
          backMap: processed.backTexture,
          normalMap: processed.normalTexture,
          aspect: processed.aspect,
          dominantHex: processed.dominantHex,
          accentHex: processed.accentHex,
          previewDataUrl: processed.previewDataUrl,
          backPreviewDataUrl: processed.backPreviewDataUrl,
          normalDataUrl,
          dispose: processed.dispose,
        };
      })
    );
  } else {
    // Brief visual beat so Step 3 renders crisply in HUD while parametric 3D geometries mount
    await delay(90);
  }

  const updatedRacks: RackPlacement[] = apiPayload.storeConfig.racks.map((rack, rackIdx) => ({
    ...rack,
    items: rack.items.map((item, itemIdx) => {
      const enriched = enrichedItemById.get(item.id) ?? item;
      return {
        ...enriched,
        featured: rackIdx === 0 && itemIdx === 0,
      };
    }),
  }));

  const finalStoreConfig: StoreConfig = {
    ...apiPayload.storeConfig,
    archetype,
    textures: {},
    racks: updatedRacks,
  };

  const heroItem = updatedRacks[0]?.items[0];
  const heroProductSpec = inventedProducts[0];
  const heroGarmentId = heroItem?.id ?? heroProductSpec?.id ?? 'ingested-hero-01';
  const heroTitle = heroItem?.title ?? heroProductSpec?.title ?? `${finalStoreConfig.brandName} Signature Piece`;

  const hangingApparelCount =
    inventedProducts.filter(
      (p) => p.placement === 'hero_rack' || p.placement === 'capsule_rack'
    ).length || updatedRacks.reduce((sum, r) => sum + r.items.length, 0);

  const pedestalObjectCount = inventedProducts.filter(
    (p) =>
      p.placement === 'center_table' ||
      p.placement === 'left_pedestal' ||
      p.placement === 'right_pedestal'
  ).length;

  const inventedProductCount =
    inventedProducts.length || hangingApparelCount + pedestalObjectCount;

  const elapsedMs = Math.round(performance.now() - startedAt);

  const summary: BrandIngestSummary = {
    url: trimmedUrl,
    brandName: finalStoreConfig.brandName,
    tagline: finalStoreConfig.tagline,
    vibe: finalStoreConfig.vibe,
    brandEthos:
      finalStoreConfig.brandEthos ||
      `${finalStoreConfig.brandName} reimagined as a ${archetypeLabel} with ${inventedProductCount} bespoke 3D products.`,
    archetype,
    inventedProductCount,
    hangingApparelCount,
    pedestalObjectCount,
    sourceType: apiPayload.sourceType,
    usedGemini: apiPayload.usedGemini,
    rawProductCount: apiPayload.rawProductCount,
    processedGarmentCount: inventedProductCount,
    heroGarmentId,
    heroTitle,
    elapsedMs,
  };

  return {
    storeConfig: finalStoreConfig,
    resolvedTexturesById,
    summary,
  };
}
