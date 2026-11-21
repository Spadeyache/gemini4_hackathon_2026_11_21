import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import {
  Camera,
  ChevronDown,
  ChevronUp,
  Compass,
  Eye,
  Layers,
  Scale,
  Sliders,
  Sparkles,
  Upload,
  Wand2,
} from 'lucide-react';
import { BoutiqueWorld, DISPLAY_FIXTURE_ANCHORS } from './components/BoutiqueWorld';
import {
  BoutiqueRack,
  type GarmentResolvedTextures,
  type RackGarmentItem,
} from './components/BoutiqueRack';
import { PhotorealObjectStand3D } from './components/products/PhotorealObjectStand3D';
import { StudioProductModal } from './components/products/StudioProductModal';
import { CAMERA_PRESETS, CameraRig, type CameraPresetId } from './components/CameraRig';
import { DEFAULT_PRESET_ID, DEFAULT_TUNING_PARAMS, STORE_PRESETS } from './data/presets';
import { UrlIngestBar } from './features/ingestion/UrlIngestBar';
import type {
  BrandWebsiteIngestResult,
  IngestedGarmentTextures,
} from './features/ingestion/urlBrandIngest';
import {
  RobloxControlsHint,
  RobloxPlayerController,
  type PlayerPovMode,
} from './features/player/RobloxPlayerController';
import { ShopifyConciergeDrawer } from './features/shopify/ShopifyConciergeDrawer';
import {
  ShopperSwarmLayer,
  type ShopperConversionStats,
} from './features/shoppers/ShopperSwarmLayer';
import { processGarmentInBrowser, type ProcessedGarmentTextures } from './lib/garmentProcessor';
import { extractLivePaletteFromImage } from './services/boutiquePipeline';
import type {
  GarmentAssetSet,
  GarmentRenderMode,
  GarmentSourceMode,
  GarmentTuningParams,
  InventedProductSpec,
  StoreConfig,
} from './types/storeConfig';

type RackLayoutMode = 'split_racks' | 'hero_trio' | 'solo';

const ARCHETYPE_BADGES: Record<string, string> = {
  heritage_arch_flagship: 'Heritage Arch Flagship',
  minimalist_tech_pavilion: 'Minimalist Tech Pavilion',
  warm_artisanal_atelier: 'Warm Timber & Clay Atelier',
  avant_garde_concrete_loft: 'Avant-Garde Concrete Loft',
};

function getInitialQueryParams() {
  if (typeof window === 'undefined') {
    return {
      cam: 'hero' as CameraPresetId,
      preset: DEFAULT_PRESET_ID,
      render: undefined as GarmentRenderMode | undefined,
      source: undefined as GarmentSourceMode | undefined,
      layout: 'split_racks' as RackLayoutMode,
      sway: undefined as number | undefined,
      walk: false,
      swarm: false,
      openStudioModal: false,
      hideHud: false,
      instantCam: false,
    };
  }
  const params = new URLSearchParams(window.location.search);
  const camParam = params.get('cam') as CameraPresetId | null;
  const presetParam = params.get('preset');
  const renderParam = params.get('render') as GarmentRenderMode | null;
  const sourceParam = params.get('source') as GarmentSourceMode | null;
  const layoutParam = params.get('layout') as RackLayoutMode | null;
  const swayParam = params.get('sway');

  return {
    cam: camParam && camParam in CAMERA_PRESETS ? camParam : ('hero' as CameraPresetId),
    preset: presetParam && presetParam in STORE_PRESETS ? presetParam : DEFAULT_PRESET_ID,
    render:
      renderParam === 'volumetric' || renderParam === 'naive_flat' ? renderParam : undefined,
    source:
      sourceParam === 'ai_normalized' || sourceParam === 'raw_cutout' ? sourceParam : undefined,
    layout:
      layoutParam === 'split_racks' || layoutParam === 'hero_trio' || layoutParam === 'solo'
        ? layoutParam
        : ('split_racks' as RackLayoutMode),
    sway: swayParam !== null ? Number(swayParam) : undefined,
    walk: params.get('walk') === '1',
    swarm: params.get('swarm') === '1' || params.get('judges') === '1',
    openStudioModal: params.get('modal') === '1',
    hideHud: params.get('hud') === '0',
    instantCam: params.has('cam'),
  };
}

function loadThreeTexture(
  url: string | undefined,
  isNormal = false
): Promise<THREE.Texture | undefined> {
  if (!url) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = isNormal ? THREE.NoColorSpace : THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        tex.needsUpdate = true;
        resolve(tex);
      },
      undefined,
      () => resolve(undefined)
    );
  });
}

function getImageAspect(tex: THREE.Texture | undefined, fallback = 0.86): number {
  const img = tex?.image as { width?: number; height?: number } | undefined;
  if (img && img.width && img.height && img.height > 0) {
    return img.width / img.height;
  }
  return fallback;
}

export default function App() {
  const init = useMemo(() => getInitialQueryParams(), []);

  const [presetId, setPresetId] = useState<string>(init.preset);
  const [ingestedStore, setIngestedStore] = useState<StoreConfig | null>(null);
  const [ingestedTexturesById, setIngestedTexturesById] = useState<
    Record<string, IngestedGarmentTextures>
  >({});

  // Studio-normalized cutout overrides (`gemini-nano-banana-2.1` applied back to 3D showroom!)
  const [studioCutoutUrlOverrides, setStudioCutoutUrlOverrides] = useState<
    Record<string, string>
  >({});
  const [studioRackTexturesById, setStudioRackTexturesById] = useState<
    Record<string, ProcessedGarmentTextures>
  >({});

  const [customPaletteOverride, setCustomPaletteOverride] = useState<{
    wall?: string;
    accent?: string;
  } | null>(null);
  const [autoAdaptWorld] = useState<boolean>(true);

  const [cameraPreset, setCameraPreset] = useState<CameraPresetId>(init.cam);
  const [instantCamera, setInstantCamera] = useState<boolean>(init.instantCam);
  const [walkMode, setWalkMode] = useState<boolean>(init.walk);
  const [povMode, setPovMode] = useState<PlayerPovMode>('first_person');
  const [judgesEnabled, setJudgesEnabled] = useState<boolean>(init.swarm);
  const [conversionStats, setConversionStats] = useState<ShopperConversionStats | null>(null);

  const [layoutMode, setLayoutMode] = useState<RackLayoutMode>(init.layout);
  const [selectedGarmentId, setSelectedGarmentId] = useState<string | null>(
    'good-shot-ringer-tee'
  );
  const [studioModalProductId, setStudioModalProductId] = useState<string | null>(
    init.openStudioModal ? 'good-shot-ringer-tee' : null
  );

  const [tuning, setTuning] = useState<GarmentTuningParams>(() => ({
    ...DEFAULT_TUNING_PARAMS,
    ...(init.render ? { renderMode: init.render } : {}),
    ...(init.source ? { sourceMode: init.source } : {}),
    ...(init.sway !== undefined && !Number.isNaN(init.sway)
      ? { swayIntensity: init.sway }
      : {}),
    showCapsuleCompanions: init.layout !== 'solo',
  }));

  const [hudCollapsed, setHudCollapsed] = useState<boolean>(true);
  const [showSliders, setShowSliders] = useState<boolean>(false);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);
  const [isProcessingUpload, setIsProcessingUpload] = useState<boolean>(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [uploadedSourceBlob, setUploadedSourceBlob] = useState<File | string | null>(null);

  const [bakedTextures, setBakedTextures] = useState<
    Record<string, { normalized?: GarmentResolvedTextures; raw?: GarmentResolvedTextures }>
  >({});

  const [liveHeroProcessed, setLiveHeroProcessed] =
    useState<ProcessedGarmentTextures | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeConfig: StoreConfig = useMemo(() => {
    const base = ingestedStore ?? STORE_PRESETS[presetId] ?? STORE_PRESETS[DEFAULT_PRESET_ID];
    if (!customPaletteOverride) return base;
    return {
      ...base,
      palette: {
        ...base.palette,
        ...(customPaletteOverride.wall ? { wall: customPaletteOverride.wall } : {}),
        ...(customPaletteOverride.accent ? { accent: customPaletteOverride.accent } : {}),
      },
    };
  }, [ingestedStore, presetId, customPaletteOverride]);

  // Load rack garment cutouts for active preset:
  // - Pre-baked transparent PNGs (`/assets/garments/*`) load directly via THREE.TextureLoader
  // - Real internet studio packshots (`/api/proxy-image?...` or `https://...`) run through `processGarmentInBrowser`
  //   so backgrounds are cleanly cut out in CIELAB space with 360° back synthesis & Sobel normal maps!
  useEffect(() => {
    if (ingestedStore) return;
    let cancelled = false;
    const rackItems: GarmentAssetSet[] = activeConfig.racks.flatMap((r) => r.items);

    Promise.all(
      rackItems.map(async (item) => {
        const primaryUrl =
          item.productSpec?.customCutoutUrl ||
          item.normalizedFrontCutoutUrl ||
          item.frontCutoutUrl ||
          item.rawUrl;

        const isPrebakedTransparentAsset =
          Boolean(primaryUrl) && primaryUrl.startsWith('/assets/garments/');

        if (!isPrebakedTransparentAsset && primaryUrl) {
          try {
            const processed = await processGarmentInBrowser(primaryUrl, tuning.cutoutTolerance);
            processed.normalTexture.colorSpace = THREE.NoColorSpace;
            const resolved: GarmentResolvedTextures = {
              frontMap: processed.frontTexture,
              backMap: processed.backTexture,
              normalMap: processed.normalTexture,
              aspect: processed.aspect,
            };
            return { id: item.id, normalized: resolved, raw: resolved };
          } catch {
            return { id: item.id, normalized: undefined, raw: undefined };
          }
        }

        const [normFront, normBack, normNormal, rawFront, rawBack, rawNormal] =
          await Promise.all([
            loadThreeTexture(item.normalizedFrontCutoutUrl || item.frontCutoutUrl, false),
            loadThreeTexture(item.normalizedBackCutoutUrl || item.backCutoutUrl, false),
            loadThreeTexture(item.normalizedNormalMapUrl || item.normalMapUrl, true),
            loadThreeTexture(item.frontCutoutUrl, false),
            loadThreeTexture(item.backCutoutUrl, false),
            loadThreeTexture(item.normalMapUrl, true),
          ]);

        const fallbackAspect = item.aspect ?? 0.86;
        return {
          id: item.id,
          normalized: normFront
            ? {
                frontMap: normFront,
                backMap: normBack,
                normalMap: normNormal,
                aspect: getImageAspect(normFront, fallbackAspect),
              }
            : undefined,
          raw: rawFront
            ? {
                frontMap: rawFront,
                backMap: rawBack,
                normalMap: rawNormal,
                aspect: getImageAspect(rawFront, fallbackAspect),
              }
            : undefined,
        };
      })
    ).then((results) => {
      if (cancelled) return;
      const nextMap: Record<
        string,
        { normalized?: GarmentResolvedTextures; raw?: GarmentResolvedTextures }
      > = {};
      for (const r of results) {
        if (r.normalized || r.raw) {
          nextMap[r.id] = { normalized: r.normalized, raw: r.raw };
        }
      }
      setBakedTextures((prev) => ({ ...prev, ...nextMap }));
    });

    return () => {
      cancelled = true;
    };
  }, [activeConfig.racks, ingestedStore, tuning.cutoutTolerance]);

  // Live browser cutout processor for custom uploaded clothing photo
  useEffect(() => {
    const sourceToProcess =
      tuning.sourceMode === 'custom_upload' && uploadedSourceBlob
        ? uploadedSourceBlob
        : !ingestedStore &&
            presetId === 'good-shot-club' &&
            tuning.sourceMode === 'raw_cutout'
          ? '/assets/raw-shirt.jpg'
          : null;

    if (!sourceToProcess) return;

    let cancelled = false;
    setIsProcessingUpload(true);

    const timer = window.setTimeout(() => {
      processGarmentInBrowser(sourceToProcess, tuning.cutoutTolerance)
        .then((res) => {
          if (cancelled) {
            res.dispose();
            return;
          }
          res.normalTexture.colorSpace = THREE.NoColorSpace;
          setLiveHeroProcessed((prev) => {
            if (prev) prev.dispose();
            return res;
          });
          setIsProcessingUpload(false);
        })
        .catch((err) => {
          console.error('Live garment processing error:', err);
          if (!cancelled) setIsProcessingUpload(false);
        });
    }, 45);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [tuning.sourceMode, tuning.cutoutTolerance, uploadedSourceBlob, ingestedStore, presetId]);

  const handleIngestComplete = useCallback((result: BrandWebsiteIngestResult) => {
    setIngestedTexturesById((prev) => {
      Object.values(prev).forEach((t) => t.dispose());
      return result.resolvedTexturesById;
    });
    setStudioCutoutUrlOverrides({});
    setStudioRackTexturesById((prev) => {
      Object.values(prev).forEach((t) => t.dispose());
      return {};
    });
    setCustomPaletteOverride(null);
    setUploadedFileName(null);
    setIngestedStore(result.storeConfig);
    setConversionStats(null);
    setSelectedGarmentId(result.summary.heroGarmentId);
    setStudioModalProductId(null);
    setTuning((p) => ({ ...p, sourceMode: 'ai_normalized', renderMode: 'volumetric' }));
  }, []);

  const handleApplyStudioCutoutTo3D = useCallback(
    (productId: string, cleanCutoutDataUrl: string) => {
      // Update pedestal object cutout override
      setStudioCutoutUrlOverrides((prev) => ({
        ...prev,
        [productId]: cleanCutoutDataUrl,
      }));

      // Also process for hanging 3D rack garments if this product is on a rack
      processGarmentInBrowser(cleanCutoutDataUrl, tuning.cutoutTolerance)
        .then((processed) => {
          processed.normalTexture.colorSpace = THREE.NoColorSpace;
          setStudioRackTexturesById((prev) => {
            if (prev[productId]) prev[productId].dispose();
            return { ...prev, [productId]: processed };
          });
        })
        .catch((err) => console.error('Failed to apply studio cutout to rack:', err));
    },
    [tuning.cutoutTolerance]
  );

  const handleUploadedFile = useCallback(
    (file: File) => {
      setUploadedFileName(file.name);
      setUploadedSourceBlob(file);
      setTuning((prev) => ({
        ...prev,
        sourceMode: 'custom_upload',
        renderMode: 'volumetric',
      }));

      if (autoAdaptWorld) {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          const { accentTrim } = extractLivePaletteFromImage(img);
          setCustomPaletteOverride({ accent: accentTrim });
          URL.revokeObjectURL(url);
        };
        img.src = url;
      }
    },
    [autoAdaptWorld]
  );

  // Global drag-and-drop handlers
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      setIsDraggingFile(true);
    };
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setIsDraggingFile(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setIsDraggingFile(false);
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('image/')) {
        handleUploadedFile(file);
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [handleUploadedFile]);

  const toRackGarmentItem = useCallback(
    (item: GarmentAssetSet, isHeroItem: boolean): RackGarmentItem | null => {
      // 0. `gemini-nano-banana-2.1` studio-normalized rack cutout override
      const studioOverride = studioRackTexturesById[item.id];
      if (studioOverride) {
        return {
          id: item.id,
          sku: item.sku,
          title: item.title,
          subtitle: item.subtitle,
          price: item.price,
          featured: isHeroItem,
          frontMap: studioOverride.frontTexture,
          backMap: studioOverride.backTexture,
          normalMap: studioOverride.normalTexture,
          aspect: studioOverride.aspect,
        };
      }

      // 1. Custom uploaded garment photo overrides hero stand
      if (isHeroItem && tuning.sourceMode === 'custom_upload' && liveHeroProcessed) {
        return {
          id: item.id,
          sku: item.sku,
          title: uploadedFileName ? uploadedFileName.replace(/\.[^.]+$/, '') : item.title,
          subtitle: item.subtitle,
          price: item.price,
          featured: true,
          frontMap: liveHeroProcessed.frontTexture,
          backMap: liveHeroProcessed.backTexture,
          normalMap: liveHeroProcessed.normalTexture,
          aspect: liveHeroProcessed.aspect,
        };
      }

      // 2. Live URL-ingested internet studio packshot cutout
      const ingestedCutout = ingestedTexturesById[item.id];
      if (ingestedCutout) {
        return {
          id: item.id,
          sku: item.sku,
          title: item.title,
          subtitle: item.subtitle,
          price: item.price,
          featured: isHeroItem,
          frontMap: ingestedCutout.frontMap,
          backMap: ingestedCutout.backMap,
          normalMap: ingestedCutout.normalMap,
          aspect: ingestedCutout.aspect,
        };
      }

      // 3. Explicit raw cutout mode on Good Shot Club
      if (isHeroItem && tuning.sourceMode === 'raw_cutout' && liveHeroProcessed) {
        return {
          id: item.id,
          sku: item.sku,
          title: item.title,
          subtitle: item.subtitle,
          price: item.price,
          featured: true,
          frontMap: liveHeroProcessed.frontTexture,
          backMap: liveHeroProcessed.backTexture,
          normalMap: liveHeroProcessed.normalTexture,
          aspect: liveHeroProcessed.aspect,
        };
      }

      // 4. Pre-baked or preset packshot cutout
      const entry = bakedTextures[item.id];
      const tex =
        isHeroItem && tuning.sourceMode === 'raw_cutout' && entry?.raw
          ? entry.raw
          : (entry?.normalized ?? entry?.raw);

      if (tex) {
        return {
          id: item.id,
          sku: item.sku,
          title: item.title,
          subtitle: item.subtitle,
          price: item.price,
          featured: isHeroItem,
          ...tex,
        };
      }

      return null;
    },
    [
      bakedTextures,
      ingestedTexturesById,
      liveHeroProcessed,
      studioRackTexturesById,
      tuning.sourceMode,
      uploadedFileName,
    ]
  );

  // Build resolved RackGarmentItems for hero rack & secondary rack
  const { heroRackItems, secondaryRackItems } = useMemo(() => {
    const heroRack = activeConfig.racks[0];
    const secondRack = activeConfig.racks[1];

    const heroItemSpec = heroRack?.items[0];
    const heroItem = heroItemSpec ? toRackGarmentItem(heroItemSpec, true) : null;

    const extraHeroItems: RackGarmentItem[] = (heroRack?.items.slice(1) ?? [])
      .map((c) => toRackGarmentItem(c, false))
      .filter((x): x is RackGarmentItem => x !== null);

    const secondItems: RackGarmentItem[] = (secondRack?.items ?? [])
      .map((c) => toRackGarmentItem(c, false))
      .filter((x): x is RackGarmentItem => x !== null);

    const allCompanions = [...extraHeroItems, ...secondItems];

    if (layoutMode === 'solo') {
      return {
        heroRackItems: heroItem ? [heroItem] : [],
        secondaryRackItems: [] as RackGarmentItem[],
      };
    }
    if (layoutMode === 'hero_trio') {
      return {
        heroRackItems: heroItem
          ? [heroItem, ...allCompanions.slice(0, 2)]
          : allCompanions.slice(0, 3),
        secondaryRackItems: [] as RackGarmentItem[],
      };
    }
    return {
      heroRackItems: heroItem ? [heroItem, ...extraHeroItems] : extraHeroItems,
      secondaryRackItems: secondItems,
    };
  }, [activeConfig.racks, layoutMode, toRackGarmentItem]);

  // Real Internet Physical Objects Placed on Table & Pedestals (`PhotorealObjectStand3D`)
  const pedestalProducts = useMemo(() => {
    const prods = activeConfig.products ?? [];
    return prods
      .filter(
        (
          p
        ): p is InventedProductSpec & {
          placement: 'center_table' | 'left_pedestal' | 'right_pedestal';
        } =>
          p.placement === 'center_table' ||
          p.placement === 'left_pedestal' ||
          p.placement === 'right_pedestal'
      )
      .map((p) =>
        studioCutoutUrlOverrides[p.id]
          ? { ...p, customCutoutUrl: studioCutoutUrlOverrides[p.id] }
          : p
      );
  }, [activeConfig.products, studioCutoutUrlOverrides]);

  // Resolve any clicked product ID (from rack OR pedestal) into an `InventedProductSpec` for `StudioProductModal`
  const resolveProductSpecById = useCallback(
    (productId: string | null): InventedProductSpec | null => {
      if (!productId) return null;
      const fromProducts = activeConfig.products?.find((p) => p.id === productId);
      if (fromProducts) {
        return studioCutoutUrlOverrides[productId]
          ? { ...fromProducts, customCutoutUrl: studioCutoutUrlOverrides[productId] }
          : fromProducts;
      }

      const rackItem = activeConfig.racks
        .flatMap((r) => r.items)
        .find((i) => i.id === productId);
      if (!rackItem) return null;

      if (rackItem.productSpec) {
        return studioCutoutUrlOverrides[productId]
          ? {
              ...rackItem.productSpec,
              customCutoutUrl: studioCutoutUrlOverrides[productId],
            }
          : rackItem.productSpec;
      }

      return {
        id: rackItem.id,
        sku: rackItem.sku,
        title: rackItem.title,
        subtitle: rackItem.subtitle ?? activeConfig.brandName,
        category: 'structured_tshirt',
        placement: rackItem.featured ? 'hero_rack' : 'capsule_rack',
        price: rackItem.price,
        primaryColor: rackItem.dominantHex ?? activeConfig.palette.wall,
        secondaryColor: activeConfig.palette.accent,
        accentColor: activeConfig.palette.rackMetal,
        graphicHeadline: activeConfig.brandName,
        graphicMotif: 'monogram_crest',
        designRationale: `Curated hero apparel piece for ${activeConfig.brandName}.`,
        featured: rackItem.featured,
        customCutoutUrl:
          studioCutoutUrlOverrides[productId] ||
          rackItem.normalizedFrontCutoutUrl ||
          rackItem.frontCutoutUrl ||
          rackItem.rawUrl,
      };
    },
    [activeConfig, studioCutoutUrlOverrides]
  );

  const activeStudioModalProduct = useMemo(
    () => resolveProductSpecById(studioModalProductId),
    [resolveProductSpecById, studioModalProductId]
  );

  const handleOpenProductShowcase = useCallback((id: string) => {
    setSelectedGarmentId(id);
    setStudioModalProductId(id);
  }, []);

  const effectiveTuning = useMemo(
    () => ({
      ...tuning,
      sleeveRelax:
        !ingestedStore && presetId === 'good-shot-club' && tuning.sourceMode === 'ai_normalized'
          ? Math.min(tuning.sleeveRelax, 0.22)
          : tuning.sleeveRelax,
      showCapsuleCompanions: layoutMode !== 'solo',
    }),
    [tuning, layoutMode, ingestedStore, presetId]
  );

  const selectCamera = (cam: CameraPresetId) => {
    setWalkMode(false);
    setInstantCamera(false);
    setCameraPreset(cam);
  };

  const archetypeLabel =
    ARCHETYPE_BADGES[activeConfig.archetype ?? 'heritage_arch_flagship'] ??
    'Bespoke 3D Flagship';

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      {/* Full-Bleed 3D Showroom Viewport */}
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: CAMERA_PRESETS[init.cam].position, fov: 40, near: 0.1, far: 45 }}
        gl={{
          antialias: true,
          preserveDrawingBuffer: true,
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 0.92,
        }}
      >
        <color attach="background" args={[activeConfig.palette.wall]} />
        <fog attach="fog" args={[activeConfig.palette.wall, 11.5, 24]} />

        {!walkMode && <CameraRig preset={cameraPreset} instant={instantCamera} />}

        <BoutiqueWorld config={activeConfig}>
          {/* Hero Apparel Stand (Photorealistic Studio Packshot Cutouts) */}
          {heroRackItems.length > 0 && activeConfig.racks[0] && (
            <BoutiqueRack
              rack={activeConfig.racks[0]}
              garments={heroRackItems}
              palette={activeConfig.palette}
              metalness={activeConfig.metalness}
              metalRoughness={activeConfig.metalRoughness}
              tuning={effectiveTuning}
              selectedGarmentId={selectedGarmentId}
              onSelectGarment={handleOpenProductShowcase}
            />
          )}

          {/* Companion Capsule Apparel Rail */}
          {secondaryRackItems.length > 0 && activeConfig.racks[1] && (
            <BoutiqueRack
              rack={activeConfig.racks[1]}
              garments={secondaryRackItems}
              palette={activeConfig.palette}
              metalness={activeConfig.metalness}
              metalRoughness={activeConfig.metalRoughness}
              tuning={effectiveTuning}
              selectedGarmentId={selectedGarmentId}
              onSelectGarment={handleOpenProductShowcase}
            />
          )}

          {/* Photorealistic Volumetric Cutout Objects on Table & Pedestals */}
          {pedestalProducts.map((prod) => {
            const anchorPos = DISPLAY_FIXTURE_ANCHORS[prod.placement];
            const rotY =
              prod.placement === 'right_pedestal'
                ? -0.38
                : prod.placement === 'left_pedestal'
                  ? 0.36
                  : -0.18;
            return (
              <PhotorealObjectStand3D
                key={prod.id}
                spec={prod}
                position={anchorPos}
                rotationY={rotY}
                metalColor={activeConfig.palette.rackMetal}
                metalness={activeConfig.metalness}
                metalRoughness={activeConfig.metalRoughness}
                accentColor={activeConfig.palette.accent}
                palette={activeConfig.palette}
                selected={selectedGarmentId === prod.id}
                onSelect={(s) => handleOpenProductShowcase(s.id)}
              />
            );
          })}

          {/* Clean First-Person Architectural Gallery Walkthrough */}
          {walkMode && (
            <RobloxPlayerController
              config={activeConfig}
              enabled={walkMode}
              povMode={povMode}
              onPovModeChange={setPovMode}
              showSecondaryRack={secondaryRackItems.length > 0}
              onInteractGarment={(gid) => handleOpenProductShowcase(gid)}
            />
          )}

          {/* Formal Architectural Silhouette Product Judges */}
          {judgesEnabled && (
            <ShopperSwarmLayer
              config={activeConfig}
              enabled={judgesEnabled}
              showSecondaryRack={secondaryRackItems.length > 0}
              resetKey={activeConfig.id}
              onConversionUpdate={setConversionStats}
            />
          )}
        </BoutiqueWorld>
      </Canvas>

      {/* `gemini-nano-banana-2.1` Commercial 3D Studio Product Render Showcase ("For Sale") */}
      <StudioProductModal
        product={activeStudioModalProduct}
        storeConfig={activeConfig}
        onClose={() => setStudioModalProductId(null)}
        onApplyCutoutTo3D={handleApplyStudioCutoutTo3D}
        onAddToBag={(pid) => {
          setSelectedGarmentId(pid);
          setStudioModalProductId(null);
        }}
      />

      {/* Drag-and-Drop Fullscreen Overlay */}
      {isDraggingFile && (
        <div
          style={{
            position: 'fixed',
            inset: 16,
            zIndex: 50,
            borderRadius: 18,
            border: '2px dashed #d4af37',
            background: 'rgba(14, 15, 16, 0.76)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            pointerEvents: 'none',
          }}
        >
          <Upload size={38} color="#d4af37" />
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '0.04em' }}>
            Drop Custom Product Photo onto Hero Stand
          </div>
          <div style={{ fontSize: 13, opacity: 0.78 }}>
            Auto CIELAB cutout · 360° back synthesis · PBR cotton normal map
          </div>
        </div>
      )}

      {!init.hideHud && (
        <>
          {/* Top-Center URL -> Initial Photos -> Real Internet Products -> 3D Shop */}
          <UrlIngestBar
            onIngestComplete={handleIngestComplete}
            cutoutTolerance={tuning.cutoutTolerance}
            variant="floating"
            defaultExpandedChips={false}
          />

          {/* Top-Left Brand Identity & World Architecture Badge */}
          <div
            style={{
              position: 'fixed',
              top: 16,
              left: 16,
              zIndex: 20,
              maxWidth: 300,
              background: 'rgba(15, 16, 18, 0.80)',
              backdropFilter: 'blur(14px)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 12,
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              boxShadow: '0 8px 28px rgba(0,0,0,0.32)',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 9.5,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: '#d4af37',
                  fontWeight: 600,
                }}
              >
                {archetypeLabel}
              </div>
              <div
                style={{
                  fontFamily: "'Cormorant Garamond', Georgia, serif",
                  fontSize: 19,
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  color: '#f7f4ec',
                  lineHeight: 1.15,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {activeConfig.brandName}
              </div>
              <div
                style={{
                  fontSize: 10.5,
                  color: 'rgba(245,242,235,0.68)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: 205,
                }}
              >
                {activeConfig.products
                  ? `${activeConfig.products.length} Matched Products · ${activeConfig.vibe}`
                  : activeConfig.vibe}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {[
                activeConfig.palette.wall,
                activeConfig.palette.floor,
                activeConfig.palette.accent,
                activeConfig.palette.rackMetal,
              ].map((hex, idx) => (
                <span
                  key={idx}
                  title={`Theme Swatch ${hex}`}
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: hex,
                    border: '1px solid rgba(255,255,255,0.35)',
                  }}
                />
              ))}
            </div>
          </div>

          {/* Walkthrough Controls Hint */}
          {walkMode && (
            <div
              style={{
                position: 'fixed',
                bottom: 68,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 20,
              }}
            >
              <RobloxControlsHint
                povMode={povMode}
                onTogglePov={() =>
                  setPovMode((p) => (p === 'first_person' ? 'third_person' : 'first_person'))
                }
              />
            </div>
          )}

          {/* Bottom-Center Editorial Camera, Studio Render Showcase, Walkthrough & Judges Bar */}
          <div
            style={{
              position: 'fixed',
              bottom: 16,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 20,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              flexWrap: 'nowrap',
              background: 'rgba(15, 16, 18, 0.84)',
              backdropFilter: 'blur(14px)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 999,
              padding: '6px 9px',
              boxShadow: '0 10px 30px rgba(0,0,0,0.40)',
            }}
          >
            <Camera size={13} style={{ marginLeft: 5, opacity: 0.65 }} />
            {(Object.keys(CAMERA_PRESETS) as CameraPresetId[]).map((id) => {
              const active = !walkMode && cameraPreset === id;
              return (
                <button
                  key={id}
                  onClick={() => selectCamera(id)}
                  style={{
                    border: 'none',
                    cursor: 'pointer',
                    padding: '5px 10px',
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: active ? 600 : 500,
                    background: active ? '#d4af37' : 'transparent',
                    color: active ? '#151412' : 'rgba(245,242,235,0.82)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {CAMERA_PRESETS[id].label}
                </button>
              );
            })}

            <div
              style={{
                width: 1,
                height: 18,
                background: 'rgba(255,255,255,0.15)',
                margin: '0 3px',
              }}
            />

            {/* 1-Click Open 3D Studio Render Showcase ("For Sale" via Nano Banana 2.1) */}
            <button
              onClick={() => {
                const fallbackId =
                  selectedGarmentId ||
                  activeConfig.racks[0]?.items[0]?.id ||
                  activeConfig.products?.[0]?.id ||
                  null;
                if (fallbackId) setStudioModalProductId(fallbackId);
              }}
              style={{
                border: '1px solid rgba(212, 175, 55, 0.55)',
                cursor: 'pointer',
                padding: '5px 11px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                background: 'rgba(212, 175, 55, 0.18)',
                color: '#f7f4ec',
                whiteSpace: 'nowrap',
              }}
              title="Click any product in 3D or click here to generate a commercial 3D studio product render for sale"
            >
              <Sparkles size={12} color="#e7c96b" />
              3D Studio Render
            </button>

            {/* Clean First-Person Gallery Walkthrough */}
            <button
              onClick={() => setWalkMode((w) => !w)}
              style={{
                border: walkMode
                  ? '1px solid rgba(212, 175, 55, 0.85)'
                  : '1px solid rgba(255,255,255,0.18)',
                cursor: 'pointer',
                padding: '5px 11px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                background: walkMode
                  ? 'rgba(212, 175, 55, 0.25)'
                  : 'rgba(255,255,255,0.05)',
                color: '#f7f4ec',
                whiteSpace: 'nowrap',
              }}
            >
              <Compass size={13} color="#e7c96b" />
              {walkMode ? 'Exit Walkthrough' : 'Walk Gallery'}
            </button>

            {/* Formal Silhouette Product Judges Toggle */}
            <button
              onClick={() => setJudgesEnabled((s) => !s)}
              style={{
                border: judgesEnabled
                  ? '1px solid rgba(132, 198, 155, 0.65)'
                  : '1px solid rgba(255,255,255,0.18)',
                cursor: 'pointer',
                padding: '5px 12px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                background: judgesEnabled
                  ? 'rgba(54, 118, 82, 0.36)'
                  : 'rgba(255,255,255,0.05)',
                color: '#f7f4ec',
                whiteSpace: 'nowrap',
              }}
            >
              <Scale size={13} color={judgesEnabled ? '#9be4b4' : '#d8d4ca'} />
              {judgesEnabled
                ? conversionStats && conversionStats.totalDecisions > 0
                  ? `Panel Verdict: ${Math.round(conversionStats.conversionRate * 100)}% APPROVE (${conversionStats.buys}/${conversionStats.totalDecisions})`
                  : 'Judges Convening...'
                : 'Convene Judges'}
            </button>
          </div>

          {/* Bottom-Right Shopify AI Storefront Concierge & Bag Drawer */}
          <ShopifyConciergeDrawer
            config={activeConfig}
            focusedProductId={selectedGarmentId}
            onFocusProduct={setSelectedGarmentId}
          />

          {/* Top-Right Collapsible World & Studio Drawer */}
          <div
            style={{
              position: 'fixed',
              top: 16,
              right: 16,
              zIndex: 20,
              width: 266,
              maxHeight: 'calc(100vh - 96px)',
              overflowY: 'auto',
              background: 'rgba(15, 16, 18, 0.80)',
              backdropFilter: 'blur(14px)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 12,
              padding: '10px 13px',
              boxShadow: '0 12px 34px rgba(0,0,0,0.36)',
              fontSize: 12,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
              }}
              onClick={() => setHudCollapsed((c) => !c)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 600 }}>
                <Wand2 size={14} color="#d4af37" />
                <span>World Themes & Studio</span>
              </div>
              {hudCollapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
            </div>

            {!hudCollapsed && (
              <div style={{ marginTop: 11, display: 'flex', flexDirection: 'column', gap: 11 }}>
                <div>
                  <div
                    style={{
                      fontSize: 10.5,
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      opacity: 0.65,
                      marginBottom: 5,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                    }}
                  >
                    <Eye size={11} />
                    <span>4 Reference World Archetypes</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {Object.values(STORE_PRESETS).map((preset) => {
                      const active = !ingestedStore && preset.id === presetId;
                      return (
                        <button
                          key={preset.id}
                          onClick={() => {
                            setIngestedStore(null);
                            setCustomPaletteOverride(null);
                            setPresetId(preset.id);
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '6px 9px',
                            borderRadius: 7,
                            cursor: 'pointer',
                            textAlign: 'left',
                            border: active
                              ? '1px solid rgba(212,175,55,0.75)'
                              : '1px solid rgba(255,255,255,0.08)',
                            background: active
                              ? 'rgba(212, 175, 55, 0.15)'
                              : 'rgba(255,255,255,0.03)',
                            color: '#f5f2eb',
                          }}
                        >
                          <div>
                            <div style={{ fontSize: 11.5, fontWeight: active ? 600 : 500 }}>
                              {preset.brandName}
                            </div>
                            <div style={{ fontSize: 9.5, opacity: 0.6 }}>
                              {ARCHETYPE_BADGES[preset.archetype ?? 'heritage_arch_flagship']}
                            </div>
                          </div>
                          <span style={{ display: 'flex', gap: 3 }}>
                            {[
                              preset.palette.wall,
                              preset.palette.accent,
                              preset.palette.rackMetal,
                            ].map((c, i) => (
                              <span
                                key={i}
                                style={{
                                  width: 10,
                                  height: 10,
                                  borderRadius: '50%',
                                  background: c,
                                  border: '1px solid rgba(255,255,255,0.3)',
                                }}
                              />
                            ))}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div
                    style={{
                      fontSize: 10.5,
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      opacity: 0.65,
                      marginBottom: 5,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                    }}
                  >
                    <Layers size={11} />
                    <span>Apparel Rack Layout</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                    {(
                      [
                        ['split_racks', '2-Rack Store'],
                        ['hero_trio', '3-Piece Rail'],
                        ['solo', 'Solo Hero'],
                      ] as const
                    ).map(([mode, label]) => (
                      <button
                        key={mode}
                        onClick={() => setLayoutMode(mode)}
                        style={{
                          padding: '5px 4px',
                          borderRadius: 6,
                          fontSize: 10.5,
                          fontWeight: 600,
                          cursor: 'pointer',
                          border:
                            layoutMode === mode
                              ? '1px solid #d4af37'
                              : '1px solid rgba(255,255,255,0.1)',
                          background:
                            layoutMode === mode
                              ? 'rgba(212, 175, 55, 0.18)'
                              : 'rgba(255,255,255,0.04)',
                          color: '#f5f2eb',
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: '1px dashed rgba(212, 175, 55, 0.45)',
                    borderRadius: 9,
                    padding: '8px 10px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    background: 'rgba(212, 175, 55, 0.05)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      color: '#e7c96b',
                      fontWeight: 600,
                      fontSize: 11,
                    }}
                  >
                    <Upload size={12} />
                    <span>
                      {isProcessingUpload
                        ? 'Normalizing Photo...'
                        : uploadedFileName
                          ? `Custom: ${uploadedFileName}`
                          : 'Optional: Upload Custom Garment Photo'}
                    </span>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUploadedFile(f);
                    }}
                  />
                </div>

                <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 8 }}>
                  <button
                    onClick={() => setShowSliders((s) => !s)}
                    style={{
                      width: '100%',
                      background: 'none',
                      border: 'none',
                      color: 'rgba(245,242,235,0.82)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Sliders size={12} color="#d4af37" />
                      Cutout & Drape Controls
                    </span>
                    {showSliders ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>

                  {showSliders && (
                    <div
                      style={{
                        marginTop: 8,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      <label style={{ fontSize: 11 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Cutout ΔE Tolerance</span>
                          <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                            {tuning.cutoutTolerance}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={8}
                          max={52}
                          step={1}
                          value={tuning.cutoutTolerance}
                          onChange={(e) =>
                            setTuning((p) => ({
                              ...p,
                              cutoutTolerance: Number(e.target.value),
                            }))
                          }
                        />
                      </label>

                      <label style={{ fontSize: 11 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>HVAC Air Sway</span>
                          <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                            {tuning.swayIntensity.toFixed(2)}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={tuning.swayIntensity}
                          onChange={(e) =>
                            setTuning((p) => ({
                              ...p,
                              swayIntensity: Number(e.target.value),
                            }))
                          }
                        />
                      </label>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
