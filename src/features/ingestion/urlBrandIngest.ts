import * as THREE from 'three';
import type { GarmentResolvedTextures } from '../../components/BoutiqueRack';
import { processGarmentInBrowser } from '../../lib/garmentProcessor';
import type { GarmentAssetSet, RackPlacement, StoreConfig } from '../../types/storeConfig';

export type IngestSourceType = 'shopify' | 'jsonld' | 'html_meta';

export type IngestProgressStage =
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
 * End-to-end client ingestion pipeline:
 * 1. Calls `POST /api/ingest-url` to scrape Shopify JSON / JSON-LD / HTML & synthesize Brand DNA `StoreConfig`
 * 2. Runs `processGarmentInBrowser` in parallel across every scraped garment via `/api/proxy-image`
 *    (CIELAB studio cutout + un-mirrored 360° back synthesis + Sobel cotton micro-weave normal map)
 * 3. Returns `{ storeConfig, resolvedTexturesById, summary }` ready for instant 3D boutique rendering
 */
export async function ingestBrandWebsite(
  url: string,
  tolerance = 24,
  options?: IngestBrandOptions
): Promise<BrandWebsiteIngestResult> {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    throw new Error('Please enter a store or brand website URL.');
  }

  const startedAt = performance.now();
  const onProgress = options?.onProgress;

  onProgress?.({
    stage: 'scraping_catalog',
    stepNumber: 1,
    label: '1. Scraping Brand & Catalog...',
    detail: `Probing ${trimmedUrl} storefront & catalog endpoints`,
  });

  // Transition UI smoothly to Step 2 if server probe + optional Gemini call takes >420ms
  let enteredStep2 = false;
  const step2Timer = window.setTimeout(() => {
    enteredStep2 = true;
    onProgress?.({
      stage: 'extracting_dna',
      stepNumber: 2,
      label: '2. Extracting Brand DNA...',
      detail: 'Synthesizing spatial palette, lighting rig & architectural materials',
    });
  }, 420);

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
          `Failed to ingest ${trimmedUrl} (HTTP ${response.status}). Check that the Vite server plugin is enabled.`
      );
    }
    apiPayload = data as IngestApiResponse;
  } finally {
    window.clearTimeout(step2Timer);
  }

  if (!enteredStep2) {
    onProgress?.({
      stage: 'extracting_dna',
      stepNumber: 2,
      label: '2. Extracting Brand DNA...',
      detail: `${apiPayload.storeConfig.brandName} · ${apiPayload.storeConfig.vibe}`,
    });
    await delay(180);
  }

  const rawItems: GarmentAssetSet[] = apiPayload.storeConfig.racks.flatMap((r) => r.items);
  if (rawItems.length === 0) {
    throw new Error(`No wearable product images were found on ${trimmedUrl}.`);
  }

  let completedCount = 0;
  onProgress?.({
    stage: 'normalizing_garments',
    stepNumber: 3,
    label: '3. Normalizing Garments for 3D Racks...',
    detail: `Processing ${rawItems.length} garments (CIELAB cutout + 360° back + Sobel normal)`,
    completedGarments: 0,
    totalGarments: rawItems.length,
  });

  const settled = await Promise.allSettled(
    rawItems.map(async (item) => {
      const processed = await processGarmentInBrowser(item.rawUrl, tolerance);
      processed.normalTexture.colorSpace = THREE.NoColorSpace;
      const normalDataUrl = canvasTextureToDataUrl(processed.normalTexture);

      completedCount += 1;
      onProgress?.({
        stage: 'normalizing_garments',
        stepNumber: 3,
        label: '3. Normalizing Garments for 3D Racks...',
        detail: `Normalized ${completedCount}/${rawItems.length}: ${item.title}`,
        completedGarments: completedCount,
        totalGarments: rawItems.length,
      });

      const enrichedItem: GarmentAssetSet = {
        ...item,
        frontCutoutUrl: processed.previewDataUrl,
        backCutoutUrl: processed.backPreviewDataUrl,
        normalMapUrl: normalDataUrl,
        normalizedFrontCutoutUrl: processed.previewDataUrl,
        normalizedBackCutoutUrl: processed.backPreviewDataUrl,
        normalizedNormalMapUrl: normalDataUrl,
        dominantHex: processed.dominantHex,
        aspect: processed.aspect,
      };

      const resolvedEntry: IngestedGarmentTextures = {
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

      return { enrichedItem, resolvedEntry };
    })
  );

  const succeeded = settled
    .filter(
      (
        r
      ): r is PromiseFulfilledResult<{
        enrichedItem: GarmentAssetSet;
        resolvedEntry: IngestedGarmentTextures;
      }> => r.status === 'fulfilled'
    )
    .map((r) => r.value);

  if (succeeded.length === 0) {
    throw new Error(
      `Product images from ${trimmedUrl} could not be decoded for 3D cutout processing. Try another storefront URL.`
    );
  }

  const resolvedTexturesById: Record<string, IngestedGarmentTextures> = {};
  for (const { enrichedItem, resolvedEntry } of succeeded) {
    resolvedTexturesById[enrichedItem.id] = resolvedEntry;
  }

  // Ensure Rack 0 has the primary hero garment and Rack 1 holds up to 3 capsule companions
  const heroAsset: GarmentAssetSet = {
    ...succeeded[0].enrichedItem,
    featured: true,
  };
  const companionAssets: GarmentAssetSet[] = succeeded.slice(1, 4).map((s) => ({
    ...s.enrichedItem,
    featured: false,
  }));

  const baseHeroRack = apiPayload.storeConfig.racks[0];
  const baseCapsuleRack = apiPayload.storeConfig.racks[1];

  const updatedRacks: RackPlacement[] = [
    {
      id: baseHeroRack?.id ?? 'ingested-hero-faceout',
      label: baseHeroRack?.label ?? `${apiPayload.storeConfig.brandName} Hero Stand`,
      position: baseHeroRack?.position ?? [0, 0, 0],
      rotationY: baseHeroRack?.rotationY ?? 0,
      style: 'hero_faceout',
      items: [heroAsset],
    },
  ];

  if (companionAssets.length > 0) {
    updatedRacks.push({
      id: baseCapsuleRack?.id ?? 'ingested-capsule-rail',
      label: baseCapsuleRack?.label ?? `${apiPayload.storeConfig.brandName} Capsule Rail`,
      position: baseCapsuleRack?.position ?? [-1.58, 0, -0.58],
      rotationY: baseCapsuleRack?.rotationY ?? 0.34,
      style: 'capsule_rail',
      items: companionAssets,
    });
  }

  const finalStoreConfig: StoreConfig = {
    ...apiPayload.storeConfig,
    racks: updatedRacks,
  };

  const elapsedMs = Math.round(performance.now() - startedAt);

  const summary: BrandIngestSummary = {
    url: trimmedUrl,
    brandName: finalStoreConfig.brandName,
    tagline: finalStoreConfig.tagline,
    vibe: finalStoreConfig.vibe,
    sourceType: apiPayload.sourceType,
    usedGemini: apiPayload.usedGemini,
    rawProductCount: apiPayload.rawProductCount,
    processedGarmentCount: succeeded.length,
    heroGarmentId: heroAsset.id,
    heroTitle: heroAsset.title,
    elapsedMs,
  };

  return {
    storeConfig: finalStoreConfig,
    resolvedTexturesById,
    summary,
  };
}
