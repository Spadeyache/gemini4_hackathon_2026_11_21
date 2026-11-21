import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import {
  Camera,
  ChevronDown,
  ChevronUp,
  Eye,
  Gamepad2,
  Layers,
  Sparkles,
  Sliders,
  Upload,
  Users,
  Wand2,
} from 'lucide-react';
import { BoutiqueWorld } from './components/BoutiqueWorld';
import {
  BoutiqueRack,
  type GarmentResolvedTextures,
  type RackGarmentItem,
} from './components/BoutiqueRack';
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
  StoreConfig,
} from './types/storeConfig';

type RackLayoutMode = 'split_racks' | 'hero_trio' | 'solo';

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
    swarm: params.get('swarm') === '1',
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

  const [customPaletteOverride, setCustomPaletteOverride] = useState<{
    wall?: string;
    accent?: string;
  } | null>(null);
  const [autoAdaptWorld] = useState<boolean>(true);

  const [cameraPreset, setCameraPreset] = useState<CameraPresetId>(init.cam);
  const [instantCamera, setInstantCamera] = useState<boolean>(init.instantCam);
  const [walkMode, setWalkMode] = useState<boolean>(init.walk);
  const [povMode, setPovMode] = useState<PlayerPovMode>('third_person');
  const [swarmEnabled, setSwarmEnabled] = useState<boolean>(init.swarm);
  const [conversionStats, setConversionStats] = useState<ShopperConversionStats | null>(null);

  const [layoutMode, setLayoutMode] = useState<RackLayoutMode>(init.layout);
  const [selectedGarmentId, setSelectedGarmentId] = useState<string | null>(
    'good-shot-ringer-tee'
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

  const [hudCollapsed, setHudCollapsed] = useState<boolean>(false);
  const [showSliders, setShowSliders] = useState<boolean>(false);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);
  const [isProcessingUpload, setIsProcessingUpload] = useState<boolean>(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [uploadedSourceBlob, setUploadedSourceBlob] = useState<File | string | null>(null);

  // Pre-baked asset textures keyed by garment ID & source mode
  const [bakedTextures, setBakedTextures] = useState<
    Record<string, { normalized?: GarmentResolvedTextures; raw?: GarmentResolvedTextures }>
  >({});

  // Live browser-processed textures (for raw_cutout tolerance tuning or custom drag-and-drop image)
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

  // Load pre-baked cutout & normal textures for preset items (skip items already in ingestedTexturesById)
  useEffect(() => {
    if (ingestedStore) return;
    let cancelled = false;
    const allItems: GarmentAssetSet[] = activeConfig.racks.flatMap((r) => r.items);

    Promise.all(
      allItems.map(async (item) => {
        const [normFront, normBack, normNormal, rawFront, rawBack, rawNormal] =
          await Promise.all([
            loadThreeTexture(item.normalizedFrontCutoutUrl || item.frontCutoutUrl, false),
            loadThreeTexture(item.normalizedBackCutoutUrl || item.backCutoutUrl, false),
            loadThreeTexture(item.normalizedNormalMapUrl || item.normalMapUrl, true),
            loadThreeTexture(item.frontCutoutUrl, false),
            loadThreeTexture(item.backCutoutUrl, false),
            loadThreeTexture(item.normalMapUrl, true),
          ]);

        return {
          id: item.id,
          fallbackAspect: item.aspect ?? 0.86,
          normFront,
          normBack,
          normNormal,
          rawFront,
          rawBack,
          rawNormal,
        };
      })
    ).then((results) => {
      if (cancelled) return;
      const nextMap: Record<
        string,
        { normalized?: GarmentResolvedTextures; raw?: GarmentResolvedTextures }
      > = {};
      for (const r of results) {
        if (r.normFront) {
          nextMap[r.id] = {
            ...nextMap[r.id],
            normalized: {
              frontMap: r.normFront,
              backMap: r.normBack,
              normalMap: r.normNormal,
              aspect: getImageAspect(r.normFront, r.fallbackAspect),
            },
          };
        }
        if (r.rawFront) {
          nextMap[r.id] = {
            ...nextMap[r.id],
            raw: {
              frontMap: r.rawFront,
              backMap: r.rawBack,
              normalMap: r.rawNormal,
              aspect: getImageAspect(r.rawFront, r.fallbackAspect),
            },
          };
        }
      }
      setBakedTextures(nextMap);
    });

    return () => {
      cancelled = true;
    };
  }, [activeConfig.racks, ingestedStore]);

  // Run live browser cutout processor when user uploads a custom file OR switches to live raw cutout tuning
  useEffect(() => {
    const sourceToProcess =
      tuning.sourceMode === 'custom_upload' && uploadedSourceBlob
        ? uploadedSourceBlob
        : !ingestedStore && tuning.sourceMode === 'raw_cutout'
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
  }, [tuning.sourceMode, tuning.cutoutTolerance, uploadedSourceBlob, ingestedStore]);

  const handleIngestComplete = useCallback((result: BrandWebsiteIngestResult) => {
    setIngestedTexturesById((prev) => {
      Object.values(prev).forEach((t) => t.dispose());
      return result.resolvedTexturesById;
    });
    setCustomPaletteOverride(null);
    setUploadedFileName(null);
    setIngestedStore(result.storeConfig);
    setConversionStats(null);
    setSelectedGarmentId(result.summary.heroGarmentId);
    setTuning((p) => ({ ...p, sourceMode: 'ai_normalized', renderMode: 'volumetric' }));
  }, []);

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

  const resolveItemTextures = useCallback(
    (item: GarmentAssetSet, isHeroItem: boolean): GarmentResolvedTextures | undefined => {
      if (isHeroItem && tuning.sourceMode === 'custom_upload' && liveHeroProcessed) {
        return {
          frontMap: liveHeroProcessed.frontTexture,
          backMap: liveHeroProcessed.backTexture,
          normalMap: liveHeroProcessed.normalTexture,
          aspect: liveHeroProcessed.aspect,
        };
      }

      // Live URL-ingested brand garments
      const ingested = ingestedTexturesById[item.id];
      if (ingested) {
        return {
          frontMap: ingested.frontMap,
          backMap: ingested.backMap,
          normalMap: ingested.normalMap,
          aspect: ingested.aspect,
        };
      }

      if (isHeroItem && tuning.sourceMode === 'raw_cutout' && liveHeroProcessed) {
        return {
          frontMap: liveHeroProcessed.frontTexture,
          backMap: liveHeroProcessed.backTexture,
          normalMap: liveHeroProcessed.normalTexture,
          aspect: liveHeroProcessed.aspect,
        };
      }

      const entry = bakedTextures[item.id];
      if (isHeroItem && tuning.sourceMode === 'raw_cutout' && entry?.raw) {
        return entry.raw;
      }
      return entry?.normalized ?? entry?.raw;
    },
    [bakedTextures, ingestedTexturesById, liveHeroProcessed, tuning.sourceMode]
  );

  // Build resolved RackGarmentItems for hero rack & secondary rack
  const { heroRackItems, secondaryRackItems } = useMemo(() => {
    const heroRack = activeConfig.racks[0];
    const secondRack = activeConfig.racks[1];

    const heroItemSpec = heroRack?.items[0];
    const heroTex = heroItemSpec ? resolveItemTextures(heroItemSpec, true) : undefined;

    const heroItem: RackGarmentItem | null =
      heroItemSpec && heroTex
        ? {
            id: heroItemSpec.id,
            sku: heroItemSpec.sku,
            title:
              tuning.sourceMode === 'custom_upload' && uploadedFileName
                ? uploadedFileName.replace(/\.[^.]+$/, '')
                : heroItemSpec.title,
            subtitle: heroItemSpec.subtitle,
            price: heroItemSpec.price,
            featured: true,
            ...heroTex,
          }
        : null;

    const extraHeroItems: RackGarmentItem[] = (heroRack?.items.slice(1) ?? [])
      .map((c) => {
        const tex = resolveItemTextures(c, false);
        if (!tex) return null;
        return {
          id: c.id,
          sku: c.sku,
          title: c.title,
          subtitle: c.subtitle,
          price: c.price,
          featured: false,
          ...tex,
        } as RackGarmentItem;
      })
      .filter((x): x is RackGarmentItem => x !== null);

    const secondItems: RackGarmentItem[] = (secondRack?.items ?? [])
      .map((c) => {
        const tex = resolveItemTextures(c, false);
        if (!tex) return null;
        return {
          id: c.id,
          sku: c.sku,
          title: c.title,
          subtitle: c.subtitle,
          price: c.price,
          featured: false,
          ...tex,
        } as RackGarmentItem;
      })
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
    // split_racks: Hero rack items on rack[0] + secondary rack items on rack[1]
    return {
      heroRackItems: heroItem ? [heroItem, ...extraHeroItems] : extraHeroItems,
      secondaryRackItems: secondItems,
    };
  }, [
    activeConfig.racks,
    layoutMode,
    resolveItemTextures,
    tuning.sourceMode,
    uploadedFileName,
  ]);

  const effectiveTuning = useMemo(
    () => ({
      ...tuning,
      sleeveRelax:
        !ingestedStore && tuning.sourceMode === 'ai_normalized'
          ? Math.min(tuning.sleeveRelax, 0.22)
          : tuning.sleeveRelax,
      showCapsuleCompanions: layoutMode !== 'solo',
    }),
    [tuning, layoutMode, ingestedStore]
  );

  const selectCamera = (cam: CameraPresetId) => {
    setWalkMode(false);
    setInstantCamera(false);
    setCameraPreset(cam);
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      {/* Full-Screen 3D Boutique Viewport (≥85% screen open per Hackathon Rule) */}
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: CAMERA_PRESETS[init.cam].position, fov: 40, near: 0.1, far: 45 }}
        gl={{
          antialias: true,
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 0.9,
        }}
      >
        <color attach="background" args={[activeConfig.palette.wall]} />
        <fog attach="fog" args={[activeConfig.palette.wall, 11, 23]} />

        {!walkMode && <CameraRig preset={cameraPreset} instant={instantCamera} />}

        <BoutiqueWorld config={activeConfig}>
          {/* Centre Court Hero Stand */}
          {heroRackItems.length > 0 && activeConfig.racks[0] && (
            <BoutiqueRack
              rack={activeConfig.racks[0]}
              garments={heroRackItems}
              palette={activeConfig.palette}
              metalness={activeConfig.metalness}
              metalRoughness={activeConfig.metalRoughness}
              tuning={effectiveTuning}
              selectedGarmentId={selectedGarmentId}
              onSelectGarment={setSelectedGarmentId}
            />
          )}

          {/* Secondary Capsule Rail in Background */}
          {secondaryRackItems.length > 0 && activeConfig.racks[1] && (
            <BoutiqueRack
              rack={activeConfig.racks[1]}
              garments={secondaryRackItems}
              palette={activeConfig.palette}
              metalness={activeConfig.metalness}
              metalRoughness={activeConfig.metalRoughness}
              tuning={effectiveTuning}
              selectedGarmentId={selectedGarmentId}
              onSelectGarment={setSelectedGarmentId}
            />
          )}

          {/* Roblox-Style 3rd/1st-Person Walkable Avatar Mode */}
          {walkMode && (
            <RobloxPlayerController
              config={activeConfig}
              enabled={walkMode}
              povMode={povMode}
              onPovModeChange={setPovMode}
              showSecondaryRack={secondaryRackItems.length > 0}
              onInteractGarment={(gid) => setSelectedGarmentId(gid)}
            />
          )}

          {/* Live Synthetic Shopper Swarm (6 Personas Walking & Voting YES/NO) */}
          {swarmEnabled && (
            <ShopperSwarmLayer
              config={activeConfig}
              enabled={swarmEnabled}
              showSecondaryRack={secondaryRackItems.length > 0}
              resetKey={activeConfig.id}
              onConversionUpdate={setConversionStats}
            />
          )}
        </BoutiqueWorld>
      </Canvas>

      {/* Drag-and-Drop Fullscreen Overlay */}
      {isDraggingFile && (
        <div
          style={{
            position: 'fixed',
            inset: 16,
            zIndex: 50,
            borderRadius: 18,
            border: '2px dashed #d4af37',
            background: 'rgba(18, 22, 18, 0.72)',
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
            Drop Any Clothing Photo to Hang in 3D
          </div>
          <div style={{ fontSize: 13, opacity: 0.78 }}>
            Auto CIELAB cutout · Un-mirrored back synthesis · Sobel cotton normal map
          </div>
        </div>
      )}

      {!init.hideHud && (
        <>
          {/* Top-Center Live Website-to-3D-Brand-Shop Generator */}
          <UrlIngestBar
            onIngestComplete={handleIngestComplete}
            cutoutTolerance={tuning.cutoutTolerance}
            variant="floating"
            defaultExpandedChips={false}
          />

          {/* Top-Left Brand DNA Badge */}
          <div
            style={{
              position: 'fixed',
              top: 16,
              left: 16,
              zIndex: 20,
              maxWidth: 290,
              background: 'rgba(18, 18, 17, 0.78)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(255, 255, 255, 0.11)',
              borderRadius: 12,
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              boxShadow: '0 8px 28px rgba(0,0,0,0.28)',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 9.5,
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  color: '#d4af37',
                  fontWeight: 600,
                }}
              >
                GEMINI 4 · ELEMENT 119 ENGINE
              </div>
              <div
                style={{
                  fontFamily: "'Cormorant Garamond', Georgia, serif",
                  fontSize: 19,
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  color: '#f7f4ec',
                  lineHeight: 1.15,
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
                  maxWidth: 195,
                }}
              >
                {activeConfig.vibe}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 4 }}>
              {[
                activeConfig.palette.wall,
                activeConfig.palette.floor,
                activeConfig.palette.accent,
                activeConfig.palette.rackMetal,
              ].map((hex, idx) => (
                <span
                  key={idx}
                  title={`Brand DNA ${hex}`}
                  style={{
                    width: 13,
                    height: 13,
                    borderRadius: '50%',
                    background: hex,
                    border: '1px solid rgba(255,255,255,0.35)',
                  }}
                />
              ))}
            </div>
          </div>

          {/* Roblox Controls Hint Pill when Walk Mode is Active */}
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
                  setPovMode((p) => (p === 'third_person' ? 'first_person' : 'third_person'))
                }
              />
            </div>
          )}

          {/* Bottom-Center Camera, Roblox Walk Mode, Shopper Swarm & Quality Compare Bar */}
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
              background: 'rgba(18, 18, 17, 0.84)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 999,
              padding: '6px 9px',
              boxShadow: '0 10px 30px rgba(0,0,0,0.38)',
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

            {/* Roblox Walkable Mode Toggle */}
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
                  ? 'rgba(212, 175, 55, 0.28)'
                  : 'rgba(255,255,255,0.06)',
                color: '#f7f4ec',
                whiteSpace: 'nowrap',
              }}
            >
              <Gamepad2 size={13} color="#e7c96b" />
              {walkMode ? 'Walking Store (WASD)' : 'Walk Store (Roblox)'}
            </button>

            {/* Synthetic Shopper Swarm Toggle */}
            <button
              onClick={() => setSwarmEnabled((s) => !s)}
              style={{
                border: swarmEnabled
                  ? '1px solid rgba(110, 210, 145, 0.7)'
                  : '1px solid rgba(255,255,255,0.18)',
                cursor: 'pointer',
                padding: '5px 11px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                background: swarmEnabled
                  ? 'rgba(54, 138, 85, 0.38)'
                  : 'rgba(255,255,255,0.06)',
                color: '#f7f4ec',
                whiteSpace: 'nowrap',
              }}
            >
              <Users size={13} color={swarmEnabled ? '#8ef0b0' : '#d8d4ca'} />
              {swarmEnabled
                ? conversionStats && conversionStats.totalDecisions > 0
                  ? `Shoppers: ${Math.round(conversionStats.conversionRate * 100)}% YES (${conversionStats.buys}/${conversionStats.totalDecisions})`
                  : 'Shoppers Active...'
                : 'Release Shoppers'}
            </button>

            {/* 1-Click Judge Compare Toggle */}
            <button
              onClick={() =>
                setTuning((p) => ({
                  ...p,
                  renderMode: p.renderMode === 'volumetric' ? 'naive_flat' : 'volumetric',
                }))
              }
              title="Compare our 3D Volumetric Dual-Shell Cloth + Hanger vs. a standard flat 2D cutout"
              style={{
                border:
                  tuning.renderMode === 'volumetric'
                    ? '1px solid rgba(124, 184, 108, 0.55)'
                    : '1px solid rgba(235, 110, 90, 0.55)',
                cursor: 'pointer',
                padding: '5px 11px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                background:
                  tuning.renderMode === 'volumetric'
                    ? 'rgba(84, 112, 73, 0.42)'
                    : 'rgba(180, 62, 48, 0.35)',
                color: '#f7f4ec',
                whiteSpace: 'nowrap',
              }}
            >
              <Sparkles
                size={12}
                color={tuning.renderMode === 'volumetric' ? '#a6e094' : '#ff9b8a'}
              />
              {tuning.renderMode === 'volumetric' ? '3D Cloth: ON' : 'Flat Cutout'}
            </button>
          </div>

          {/* Top-Right Compact Boutique Inspector */}
          <div
            style={{
              position: 'fixed',
              top: 16,
              right: 16,
              zIndex: 20,
              width: 274,
              maxHeight: 'calc(100vh - 96px)',
              overflowY: 'auto',
              background: 'rgba(18, 18, 17, 0.80)',
              backdropFilter: 'blur(14px)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 14,
              padding: '12px 14px',
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
                <span>Garment & World Studio</span>
              </div>
              {hudCollapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
            </div>

            {!hudCollapsed && (
              <div style={{ marginTop: 11, display: 'flex', flexDirection: 'column', gap: 11 }}>
                {/* Upload / Dropzone */}
                <div
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: '1px dashed rgba(212, 175, 55, 0.5)',
                    borderRadius: 9,
                    padding: '9px 10px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    background: 'rgba(212, 175, 55, 0.06)',
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
                      fontSize: 11.5,
                    }}
                  >
                    <Upload size={13} />
                    <span>
                      {isProcessingUpload
                        ? 'Normalizing Garment...'
                        : uploadedFileName
                          ? `Loaded: ${uploadedFileName}`
                          : 'Drop or Upload Clothing Photo'}
                    </span>
                  </div>
                  <div style={{ fontSize: 10.5, opacity: 0.65, marginTop: 2 }}>
                    Instant CIELAB cutout + 360° back + normal map
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

                {/* Garment Pipeline Source Mode */}
                <div>
                  <div
                    style={{
                      fontSize: 10.5,
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      opacity: 0.65,
                      marginBottom: 5,
                    }}
                  >
                    Garment Normalization Stage
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                    <button
                      onClick={() => {
                        setCustomPaletteOverride(null);
                        setTuning((p) => ({ ...p, sourceMode: 'ai_normalized' }));
                      }}
                      style={{
                        padding: '6px 8px',
                        borderRadius: 7,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                        border:
                          tuning.sourceMode === 'ai_normalized'
                            ? '1px solid #d4af37'
                            : '1px solid rgba(255,255,255,0.12)',
                        background:
                          tuning.sourceMode === 'ai_normalized'
                            ? 'rgba(212, 175, 55, 0.2)'
                            : 'rgba(255,255,255,0.04)',
                        color: '#f5f2eb',
                      }}
                    >
                      Physics Hanging
                    </button>
                    <button
                      onClick={() => setTuning((p) => ({ ...p, sourceMode: 'raw_cutout' }))}
                      style={{
                        padding: '6px 8px',
                        borderRadius: 7,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                        border:
                          tuning.sourceMode === 'raw_cutout'
                            ? '1px solid #d4af37'
                            : '1px solid rgba(255,255,255,0.12)',
                        background:
                          tuning.sourceMode === 'raw_cutout'
                            ? 'rgba(212, 175, 55, 0.2)'
                            : 'rgba(255,255,255,0.04)',
                        color: '#f5f2eb',
                      }}
                    >
                      Raw Flat-Lay Cutout
                    </button>
                  </div>
                </div>

                {/* Rack Merchandising Layout */}
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
                    <span>Boutique Rack Merchandising</span>
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

                {/* Boutique Brand DNA World Presets */}
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
                    <span>Preset Brand Worlds</span>
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
                          <span style={{ fontSize: 11.5, fontWeight: active ? 600 : 500 }}>
                            {preset.brandName}
                          </span>
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

                {/* Collapsible Fine-Tuning Sliders */}
                <div
                  style={{
                    borderTop: '1px solid rgba(255,255,255,0.1)',
                    paddingTop: 8,
                  }}
                >
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
                      Cloth Physics & Cutout Controls
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
                          <span>3D Torso Drape Curve</span>
                          <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                            {tuning.curveDepth.toFixed(2)}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={0.22}
                          step={0.005}
                          value={tuning.curveDepth}
                          onChange={(e) =>
                            setTuning((p) => ({
                              ...p,
                              curveDepth: Number(e.target.value),
                            }))
                          }
                        />
                      </label>

                      <label style={{ fontSize: 11 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Cotton Micro-Sheen</span>
                          <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                            {tuning.fabricSheen.toFixed(2)}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={tuning.fabricSheen}
                          onChange={(e) =>
                            setTuning((p) => ({
                              ...p,
                              fabricSheen: Number(e.target.value),
                            }))
                          }
                        />
                      </label>

                      <label style={{ fontSize: 11 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Normal Fold Relief</span>
                          <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                            {tuning.normalStrength.toFixed(2)}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={1.4}
                          step={0.05}
                          value={tuning.normalStrength}
                          onChange={(e) =>
                            setTuning((p) => ({
                              ...p,
                              normalStrength: Number(e.target.value),
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
