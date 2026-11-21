import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Download,
  ExternalLink,
  Layers,
  Loader2,
  RefreshCw,
  Rotate3D,
  ShoppingBag,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import type {
  InventedProductSpec,
  ProductCategory3D,
  ProductPlacementZone,
  StoreConfig,
} from '../../types/storeConfig';
import { processObjectCutoutForStand } from './PhotorealObjectStand3D';
import { getOrCreateProductTextures } from './productTextureGenerator';

export interface StudioProductModalProps {
  product: InventedProductSpec | null;
  storeConfig: StoreConfig;
  onClose: () => void;
  onApplyCutoutTo3D?: (productId: string, cleanCutoutDataUrl: string) => void;
  onAddToBag?: (productId: string) => void;
}

type StudioStageView = 'commercial_showcase' | 'turntable_cutout' | 'source_photo';

interface StudioRenderApiResponse {
  dataUrl?: string;
  cachedUrl?: string;
  mode?: 'clean_cutout' | 'commercial_showcase';
  modelUsed?: string;
  fromCache?: boolean;
  error?: string;
}

interface ClientStudioCacheEntry {
  commercialUrl?: string;
  cleanCutoutRawUrl?: string;
  cleanCutoutTransparentUrl?: string;
  modelUsed?: string;
}

// Persistent session cache so reopening any inspected product in the 3D showroom is instant (0ms)
const CLIENT_STUDIO_CACHE = new Map<string, ClientStudioCacheEntry>();

const CATEGORY_DISPLAY_NAMES: Record<ProductCategory3D, string> = {
  heavyweight_hoodie: 'Heavyweight Fleece Hoodie',
  structured_tshirt: 'Structured Cotton Tee',
  varsity_jacket: 'Outerwear / Knit Layer',
  ceramic_mug: 'Artisanal Ceramic Vessel',
  structured_cap: 'Structured 6-Panel Cap',
  canvas_tote: 'Heavyweight Canvas Tote',
  hardcover_book: 'Hardcover Monograph',
  apothecary_bottle: 'Apothecary Botanical Vessel',
};

const PLACEMENT_DISPLAY_NAMES: Record<ProductPlacementZone, string> = {
  hero_rack: 'Hero Centre Stand',
  capsule_rack: 'Capsule Apparel Rail',
  center_table: 'Architectural Center Table',
  left_pedestal: 'Left Gallery Plinth',
  right_pedestal: 'Right Gallery Plinth',
};

const FINISH_DISPLAY_NAMES: Record<
  NonNullable<InventedProductSpec['materialFinish']>,
  string
> = {
  combed_cotton: '280gsm Combed Jersey',
  brushed_fleece: '480gsm Brushed Fleece',
  merino_knit: 'Structured Merino / Wool',
  matte_stoneware: 'Honed Kiln Stoneware',
  frosted_glass: 'Smoked Apothecary Glass',
  heavy_canvas: '16oz Unbleached Duck Canvas',
};

function resolveProductSourceImage(
  product: InventedProductSpec,
  storeConfig: StoreConfig
): string | undefined {
  if (product.customCutoutUrl && product.customCutoutUrl.trim()) {
    return product.customCutoutUrl.trim();
  }
  for (const rack of storeConfig.racks ?? []) {
    for (const item of rack.items ?? []) {
      if (item.id === product.id || item.productSpec?.id === product.id) {
        const candidate =
          item.productSpec?.customCutoutUrl ||
          item.normalizedFrontCutoutUrl ||
          item.frontCutoutUrl ||
          item.rawUrl;
        if (candidate && candidate.trim()) {
          return candidate.trim();
        }
      }
    }
  }
  return undefined;
}

function extractReadableDomain(rawUrl?: string): string | null {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl);
    return parsed.hostname.replace(/^www\./i, '');
  } catch {
    return null;
  }
}

function createArchivalFallbackPreview(product: InventedProductSpec): string {
  try {
    const texSet = getOrCreateProductTextures(product);
    const canvas = texSet.archivalLabelMap.image as HTMLCanvasElement | undefined;
    if (canvas && typeof canvas.toDataURL === 'function') {
      return canvas.toDataURL('image/png');
    }
  } catch {
    // Ignore fallback preview errors
  }
  return '';
}

export const StudioProductModal: React.FC<StudioProductModalProps> = ({
  product,
  storeConfig,
  onClose,
  onApplyCutoutTo3D,
  onAddToBag,
}) => {
  const cacheKey = product ? `${storeConfig.id}::${product.id}` : '';

  const [stageView, setStageView] = useState<StudioStageView>('turntable_cutout');
  const [autoOrbit, setAutoOrbit] = useState<boolean>(true);
  const [isPointerInsideStage, setIsPointerInsideStage] = useState<boolean>(false);
  const [tilt, setTilt] = useState<{ rx: number; ry: number; sheenX: number; sheenY: number }>({
    rx: 3,
    ry: -8,
    sheenX: 52,
    sheenY: 36,
  });

  const [commercialRenderUrl, setCommercialRenderUrl] = useState<string | null>(null);
  const [cleanCutoutRawUrl, setCleanCutoutRawUrl] = useState<string | null>(null);
  const [turntableTransparentUrl, setTurntableTransparentUrl] = useState<string | null>(null);
  const [modelUsedLabel, setModelUsedLabel] = useState<string>('gemini-nano-banana-2.1');

  const [isRenderingCommercial, setIsRenderingCommercial] = useState<boolean>(false);
  const [isRenderingCutout, setIsRenderingCutout] = useState<boolean>(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [appliedCutoutSuccess, setAppliedCutoutSuccess] = useState<boolean>(false);
  const [bagAddedCount, setBagAddedCount] = useState<number>(0);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const activeProductIdRef = useRef<string | null>(null);

  const sourceImageUrl = useMemo(
    () => (product ? resolveProductSourceImage(product, storeConfig) : undefined),
    [product, storeConfig]
  );

  const fallbackLabelPreview = useMemo(
    () => (product && !sourceImageUrl ? createArchivalFallbackPreview(product) : ''),
    [product, sourceImageUrl]
  );

  // Close on Escape key
  useEffect(() => {
    if (!product) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [product, onClose]);

  // Smooth autonomous 3D turntable orbit when pointer is outside the studio stage
  useEffect(() => {
    if (!product || !autoOrbit || isPointerInsideStage) return;
    let rafId = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const elapsed = (now - start) * 0.001;
      const ry = Math.sin(elapsed * 0.85) * 14.5;
      const rx = 3.2 + Math.cos(elapsed * 0.62) * 3.8;
      const sheenX = 50 + Math.sin(elapsed * 0.85) * 28;
      const sheenY = 38 + Math.cos(elapsed * 0.62) * 16;
      setTilt({ rx, ry, sheenX, sheenY });
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [product, autoOrbit, isPointerInsideStage]);

  const runCommercialRender = useCallback(
    async (targetProduct: InventedProductSpec, refImgUrl: string | undefined, forceRefresh = false) => {
      const key = `${storeConfig.id}::${targetProduct.id}`;
      setIsRenderingCommercial(true);
      setRenderError(null);

      try {
        const res = await fetch('/api/studio-render', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageUrl: refImgUrl,
            title: targetProduct.title,
            subtitle: targetProduct.subtitle,
            category: targetProduct.category,
            brandName: storeConfig.brandName,
            vibe: storeConfig.vibe,
            palette: storeConfig.palette,
            mode: 'commercial_showcase',
            forceRefresh,
          }),
        });

        const data = (await res.json()) as StudioRenderApiResponse;
        if (!res.ok || !data.dataUrl) {
          throw new Error(data.error || `Studio render HTTP ${res.status}`);
        }

        const prevEntry = CLIENT_STUDIO_CACHE.get(key) ?? {};
        CLIENT_STUDIO_CACHE.set(key, {
          ...prevEntry,
          commercialUrl: data.dataUrl,
          modelUsed: data.modelUsed || 'gemini-nano-banana-2.1',
        });

        if (activeProductIdRef.current === targetProduct.id) {
          setCommercialRenderUrl(data.dataUrl);
          if (data.modelUsed) setModelUsedLabel(data.modelUsed);
          setStageView('commercial_showcase');
        }
      } catch (err) {
        if (activeProductIdRef.current === targetProduct.id) {
          setRenderError(
            err instanceof Error ? err.message : 'Unable to generate commercial studio render'
          );
        }
      } finally {
        if (activeProductIdRef.current === targetProduct.id) {
          setIsRenderingCommercial(false);
        }
      }
    },
    [storeConfig]
  );

  const runNormalizeCutoutRender = useCallback(
    async (targetProduct: InventedProductSpec, refImgUrl: string | undefined, forceRefresh = false) => {
      const key = `${storeConfig.id}::${targetProduct.id}`;
      setIsRenderingCutout(true);
      setRenderError(null);
      setAppliedCutoutSuccess(false);

      try {
        const res = await fetch('/api/studio-render', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageUrl: refImgUrl,
            title: targetProduct.title,
            subtitle: targetProduct.subtitle,
            category: targetProduct.category,
            brandName: storeConfig.brandName,
            vibe: storeConfig.vibe,
            palette: storeConfig.palette,
            mode: 'clean_cutout',
            forceRefresh,
          }),
        });

        const data = (await res.json()) as StudioRenderApiResponse;
        if (!res.ok || !data.dataUrl) {
          throw new Error(data.error || `Cutout studio render HTTP ${res.status}`);
        }

        // Strip the solid #DCDCDC studio gray into a transparent PNG for the floating 3D plinth turntable
        let transparentPreview = data.dataUrl;
        try {
          const cut = await processObjectCutoutForStand(data.dataUrl, 21);
          transparentPreview = cut.previewDataUrl;
        } catch {
          transparentPreview = data.dataUrl;
        }

        const prevEntry = CLIENT_STUDIO_CACHE.get(key) ?? {};
        CLIENT_STUDIO_CACHE.set(key, {
          ...prevEntry,
          cleanCutoutRawUrl: data.dataUrl,
          cleanCutoutTransparentUrl: transparentPreview,
          modelUsed: data.modelUsed || 'gemini-nano-banana-2.1',
        });

        // Hot-upgrade the live 3D garment/object right inside the Three.js boutique showroom!
        onApplyCutoutTo3D?.(targetProduct.id, data.dataUrl);

        if (activeProductIdRef.current === targetProduct.id) {
          setCleanCutoutRawUrl(data.dataUrl);
          setTurntableTransparentUrl(transparentPreview);
          if (data.modelUsed) setModelUsedLabel(data.modelUsed);
          setStageView('turntable_cutout');
          setAppliedCutoutSuccess(true);
        }
      } catch (err) {
        if (activeProductIdRef.current === targetProduct.id) {
          setRenderError(
            err instanceof Error ? err.message : 'Unable to normalize 3D showroom cutout'
          );
        }
      } finally {
        if (activeProductIdRef.current === targetProduct.id) {
          setIsRenderingCutout(false);
        }
      }
    },
    [storeConfig, onApplyCutoutTo3D]
  );

  // Initialize state & auto-trigger Gemini Nano Banana 2.1 commercial showcase render when product opens
  useEffect(() => {
    if (!product) {
      activeProductIdRef.current = null;
      return;
    }

    activeProductIdRef.current = product.id;
    setRenderError(null);
    setAppliedCutoutSuccess(false);
    setBagAddedCount(0);

    const cached = CLIENT_STUDIO_CACHE.get(cacheKey);
    setCommercialRenderUrl(cached?.commercialUrl ?? null);
    setCleanCutoutRawUrl(cached?.cleanCutoutRawUrl ?? null);
    setTurntableTransparentUrl(cached?.cleanCutoutTransparentUrl ?? null);
    if (cached?.modelUsed) {
      setModelUsedLabel(cached.modelUsed);
    }

    if (cached?.commercialUrl) {
      setStageView('commercial_showcase');
    } else {
      setStageView('turntable_cutout');
    }

    // Prepare transparent background cutout for the interactive 3D reflection plinth
    if (!cached?.cleanCutoutTransparentUrl && sourceImageUrl) {
      let cancelled = false;
      processObjectCutoutForStand(sourceImageUrl, 21)
        .then((processed) => {
          if (!cancelled && activeProductIdRef.current === product.id) {
            setTurntableTransparentUrl(processed.previewDataUrl);
          }
        })
        .catch(() => {
          if (!cancelled && activeProductIdRef.current === product.id) {
            setTurntableTransparentUrl(sourceImageUrl);
          }
        });

      // Auto-trigger commercial 3D studio render if not yet cached
      if (!cached?.commercialUrl) {
        void runCommercialRender(product, sourceImageUrl, false);
      }

      return () => {
        cancelled = true;
      };
    }

    if (!cached?.commercialUrl) {
      void runCommercialRender(product, sourceImageUrl, false);
    }
  }, [product, cacheKey, sourceImageUrl, runCommercialRender]);

  const handleStageMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    const nx = (e.clientX - rect.left) / rect.width; // 0..1
    const ny = (e.clientY - rect.top) / rect.height; // 0..1

    const ry = (nx - 0.5) * 32; // -16° .. +16°
    const rx = (0.5 - ny) * 20; // -10° .. +10°
    setTilt({
      rx,
      ry,
      sheenX: Math.round(nx * 100),
      sheenY: Math.round(ny * 100),
    });
  };

  const handleDownloadActiveRender = () => {
    if (!product) return;
    const downloadHref =
      stageView === 'commercial_showcase' && commercialRenderUrl
        ? commercialRenderUrl
        : cleanCutoutRawUrl || turntableTransparentUrl || commercialRenderUrl || sourceImageUrl;
    if (!downloadHref) return;

    const a = document.createElement('a');
    a.href = downloadHref;
    const safeSlug = product.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    a.download = `${safeSlug || 'product'}-${stageView}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (!product) return null;

  const accentHex = storeConfig.palette.accent || product.accentColor || '#d4af37';
  const wallHex = storeConfig.palette.wall || '#1b1c1e';
  const metalHex = storeConfig.palette.rackMetal || '#c5a059';

  const activeCutoutHeroSrc =
    turntableTransparentUrl || cleanCutoutRawUrl || sourceImageUrl || fallbackLabelPreview;

  const storeSourceDomain =
    extractReadableDomain(product.shopifyProductUrl) ||
    extractReadableDomain(storeConfig.sourceUrl);

  const buyOnlineHref =
    product.shopifyProductUrl ||
    storeConfig.sourceUrl ||
    `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(
      `${storeConfig.brandName} ${product.title}`
    )}`;

  const hasDirectProductUrl = Boolean(product.shopifyProductUrl);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${product.title} 3D Studio Render Showcase`}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 65,
        background: 'rgba(8, 9, 11, 0.78)',
        backdropFilter: 'blur(16px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(980px, 100%)',
          maxHeight: 'min(88vh, 760px)',
          background: 'rgba(16, 17, 19, 0.95)',
          border: '1px solid rgba(255, 255, 255, 0.14)',
          borderRadius: 22,
          boxShadow: '0 32px 90px rgba(0, 0, 0, 0.72), 0 0 0 1px rgba(212, 175, 55, 0.12)',
          color: '#f6f3ec',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          overflow: 'hidden',
        }}
      >
        {/* ===================================================================
            LEFT COLUMN: INTERACTIVE 3D TILT / TURNTABLE STUDIO STAGE
           =================================================================== */}
        <div
          ref={stageRef}
          onMouseEnter={() => setIsPointerInsideStage(true)}
          onMouseLeave={() => {
            setIsPointerInsideStage(false);
            if (!autoOrbit) {
              setTilt({ rx: 3, ry: -8, sheenX: 52, sheenY: 36 });
            }
          }}
          onMouseMove={handleStageMouseMove}
          style={{
            position: 'relative',
            minHeight: 440,
            background: `radial-gradient(circle at 50% 42%, ${accentHex}28 0%, ${wallHex}30 38%, #0c0d10 86%)`,
            borderRight: '1px solid rgba(255, 255, 255, 0.09)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '16px 18px 18px',
            overflow: 'hidden',
            userSelect: 'none',
          }}
        >
          {/* Top Stage Mode Switcher Pills */}
          <div
            style={{
              position: 'relative',
              zIndex: 5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <div
              style={{
                display: 'inline-flex',
                gap: 4,
                padding: 3,
                borderRadius: 999,
                background: 'rgba(10, 11, 13, 0.72)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                backdropFilter: 'blur(10px)',
              }}
            >
              <button
                type="button"
                onClick={() => setStageView('commercial_showcase')}
                style={{
                  border: 'none',
                  borderRadius: 999,
                  padding: '5px 11px',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  background:
                    stageView === 'commercial_showcase'
                      ? 'rgba(212, 175, 55, 0.24)'
                      : 'transparent',
                  color:
                    stageView === 'commercial_showcase'
                      ? '#f8e39c'
                      : 'rgba(246, 243, 236, 0.68)',
                }}
              >
                <Sparkles size={12} />
                <span>3D Commercial Render</span>
              </button>

              <button
                type="button"
                onClick={() => setStageView('turntable_cutout')}
                style={{
                  border: 'none',
                  borderRadius: 999,
                  padding: '5px 11px',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  background:
                    stageView === 'turntable_cutout'
                      ? 'rgba(255, 255, 255, 0.15)'
                      : 'transparent',
                  color:
                    stageView === 'turntable_cutout'
                      ? '#ffffff'
                      : 'rgba(246, 243, 236, 0.68)',
                }}
              >
                <Layers size={12} />
                <span>3D Plinth Cutout</span>
              </button>

              {sourceImageUrl && (
                <button
                  type="button"
                  onClick={() => setStageView('source_photo')}
                  style={{
                    border: 'none',
                    borderRadius: 999,
                    padding: '5px 10px',
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: 'pointer',
                    background:
                      stageView === 'source_photo'
                        ? 'rgba(255, 255, 255, 0.15)'
                        : 'transparent',
                    color:
                      stageView === 'source_photo'
                        ? '#ffffff'
                        : 'rgba(246, 243, 236, 0.62)',
                  }}
                >
                  Source Photo
                </button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                onClick={() => setAutoOrbit((v) => !v)}
                title="Toggle 3D Studio Turntable Motion"
                style={{
                  border: autoOrbit
                    ? '1px solid rgba(212, 175, 55, 0.5)'
                    : '1px solid rgba(255, 255, 255, 0.14)',
                  background: autoOrbit
                    ? 'rgba(212, 175, 55, 0.14)'
                    : 'rgba(12, 13, 16, 0.65)',
                  color: autoOrbit ? '#f3d882' : 'rgba(246, 243, 236, 0.72)',
                  borderRadius: 999,
                  padding: '5px 9px',
                  fontSize: 10.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Rotate3D size={12} />
                <span>{autoOrbit ? 'Turntable On' : 'Tilt Only'}</span>
              </button>

              {(commercialRenderUrl || cleanCutoutRawUrl || activeCutoutHeroSrc) && (
                <button
                  type="button"
                  onClick={handleDownloadActiveRender}
                  title="Download High-Res Studio Image"
                  style={{
                    border: '1px solid rgba(255, 255, 255, 0.14)',
                    background: 'rgba(12, 13, 16, 0.65)',
                    color: 'rgba(246, 243, 236, 0.85)',
                    borderRadius: 8,
                    width: 28,
                    height: 28,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <Download size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Center 3D Parallax Turntable Viewport */}
          <div
            style={{
              position: 'relative',
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              perspective: 1150,
              padding: '18px 8px',
            }}
          >
            {/* Ambient Studio Rim Backlight Halo */}
            <div
              style={{
                position: 'absolute',
                width: 290,
                height: 290,
                borderRadius: '50%',
                background: `radial-gradient(circle, ${accentHex}44 0%, ${metalHex}18 48%, transparent 74%)`,
                filter: 'blur(24px)',
                transform: `translate3d(${tilt.ry * -0.8}px, ${tilt.rx * 0.8}px, 0)`,
                pointerEvents: 'none',
              }}
            />

            {/* 3D Tilt Stage Container */}
            <div
              style={{
                position: 'relative',
                width: '100%',
                maxWidth: 400,
                height: 350,
                transformStyle: 'preserve-3d',
                transform: `rotateX(${tilt.rx.toFixed(2)}deg) rotateY(${tilt.ry.toFixed(2)}deg)`,
                transition: isPointerInsideStage
                  ? 'transform 0.08s ease-out'
                  : 'transform 0.22s ease-out',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {stageView === 'commercial_showcase' && commercialRenderUrl ? (
                /* Full Gemini Nano Banana 2.1 Commercial 3D Showcase Plate with Specular Light Sweep */
                <div
                  style={{
                    position: 'relative',
                    width: '100%',
                    height: '100%',
                    borderRadius: 16,
                    overflow: 'hidden',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    boxShadow:
                      '0 26px 56px rgba(0, 0, 0, 0.68), 0 0 36px rgba(212, 175, 55, 0.14)',
                    transform: 'translateZ(26px)',
                    background: '#121316',
                  }}
                >
                  <img
                    src={commercialRenderUrl}
                    alt={`${product.title} Commercial 3D Studio Render`}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                  />
                  {/* Dynamic Studio Key-Light Specular Sheen */}
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: `radial-gradient(circle at ${tilt.sheenX}% ${tilt.sheenY}%, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.03) 36%, transparent 65%)`,
                      mixBlendMode: 'screen',
                      pointerEvents: 'none',
                    }}
                  />
                </div>
              ) : stageView === 'source_photo' && sourceImageUrl ? (
                /* Original Matched Website Reference Photo */
                <div
                  style={{
                    position: 'relative',
                    width: '88%',
                    height: '90%',
                    borderRadius: 14,
                    overflow: 'hidden',
                    border: '1px solid rgba(255, 255, 255, 0.16)',
                    background: '#f3f1ec',
                    boxShadow: '0 22px 48px rgba(0, 0, 0, 0.55)',
                    transform: 'translateZ(20px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 14,
                  }}
                >
                  <img
                    src={sourceImageUrl}
                    alt={`${product.title} Reference Photo`}
                    style={{
                      maxWidth: '100%',
                      maxHeight: '100%',
                      objectFit: 'contain',
                    }}
                  />
                </div>
              ) : (
                /* Interactive 3D Floating Cutout + Illuminated Reflection Plinth */
                <div
                  style={{
                    position: 'relative',
                    width: '100%',
                    height: '100%',
                    transformStyle: 'preserve-3d',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    paddingBottom: 38,
                  }}
                >
                  {/* Sculpted 3D Illuminated Stone & Brass Reflection Plinth */}
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 20,
                      width: 268,
                      height: 62,
                      borderRadius: '50%',
                      background: `radial-gradient(ellipse at 50% 42%, rgba(255,255,255,0.22) 0%, ${
                        storeConfig.palette.plinth || '#302e2a'
                      }cc 52%, #141518 92%)`,
                      border: `1.5px solid ${metalHex}88`,
                      boxShadow: `0 14px 32px rgba(0,0,0,0.78), 0 0 24px ${accentHex}38, inset 0 2px 12px rgba(255,255,255,0.22)`,
                      transform: 'rotateX(68deg) translateZ(-12px)',
                    }}
                  />

                  {/* Inverted Plinth Mirror Reflection of Product */}
                  {activeCutoutHeroSrc && (
                    <img
                      src={activeCutoutHeroSrc}
                      alt=""
                      aria-hidden="true"
                      style={{
                        position: 'absolute',
                        bottom: -32,
                        maxWidth: 200,
                        maxHeight: 110,
                        objectFit: 'contain',
                        transform: 'scaleY(-0.55) translateZ(8px)',
                        opacity: 0.24,
                        filter: 'blur(3.5px)',
                        maskImage:
                          'linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0) 78%)',
                        WebkitMaskImage:
                          'linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0) 78%)',
                        pointerEvents: 'none',
                      }}
                    />
                  )}

                  {/* Hero Floating Cutout Product Layer in 3D Parallax Space */}
                  {activeCutoutHeroSrc && (
                    <img
                      src={activeCutoutHeroSrc}
                      alt={product.title}
                      style={{
                        position: 'relative',
                        zIndex: 3,
                        maxWidth: '78%',
                        maxHeight: 268,
                        objectFit: 'contain',
                        transform: 'translateZ(46px)',
                        filter: `drop-shadow(0 20px 24px rgba(0,0,0,0.62)) drop-shadow(0 0 18px ${accentHex}2e)`,
                      }}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Live Rendering Status Pill Overlay */}
            {(isRenderingCommercial || isRenderingCutout) && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 10,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  zIndex: 8,
                  background: 'rgba(12, 13, 16, 0.88)',
                  backdropFilter: 'blur(12px)',
                  border: '1px solid rgba(212, 175, 55, 0.5)',
                  borderRadius: 999,
                  padding: '6px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: '#f6df8e',
                  whiteSpace: 'nowrap',
                  boxShadow: '0 10px 28px rgba(0,0,0,0.5)',
                }}
              >
                <Loader2
                  size={13}
                  style={{ animation: 'studio-modal-spin 1s linear infinite' }}
                />
                <span>
                  {isRenderingCutout
                    ? 'Normalizing 3D Cutout via gemini-nano-banana-2.1…'
                    : 'Rendering 3D Studio Ad via gemini-nano-banana-2.1…'}
                </span>
              </div>
            )}
          </div>

          {/* Bottom Studio Telemetry Strip */}
          <div
            style={{
              position: 'relative',
              zIndex: 5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              fontSize: 10.5,
              color: 'rgba(246, 243, 236, 0.58)',
            }}
          >
            <span>Move cursor to inspect 3D parallax · ESC to close</span>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                color: '#d4af37',
              }}
            >
              {modelUsedLabel}
            </span>
          </div>
        </div>

        {/* ===================================================================
            RIGHT COLUMN: PRODUCT PROVENANCE, GEMINI STUDIO ENGINE & COMMERCE
           =================================================================== */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '20px 22px',
            overflowY: 'auto',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Top Category / Placement Badges + Close Button */}
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                <span
                  style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    letterSpacing: '0.13em',
                    textTransform: 'uppercase',
                    padding: '3.5px 8px',
                    borderRadius: 6,
                    background: 'rgba(212, 175, 55, 0.16)',
                    border: '1px solid rgba(212, 175, 55, 0.42)',
                    color: '#f2d675',
                  }}
                >
                  {PLACEMENT_DISPLAY_NAMES[product.placement] ?? product.placement}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '3.5px 8px',
                    borderRadius: 6,
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: 'rgba(246, 243, 236, 0.8)',
                  }}
                >
                  {CATEGORY_DISPLAY_NAMES[product.category] ?? product.category}
                </span>
                {product.sku && (
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 10,
                      color: 'rgba(246, 243, 236, 0.5)',
                    }}
                  >
                    {product.sku}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Close product studio modal"
                style={{
                  background: 'rgba(255, 255, 255, 0.07)',
                  border: '1px solid rgba(255, 255, 255, 0.14)',
                  borderRadius: 9,
                  width: 30,
                  height: 30,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: 'rgba(246, 243, 236, 0.85)',
                  flexShrink: 0,
                }}
              >
                <X size={15} />
              </button>
            </div>

            {/* Product Title, Brand/Store Source & Price */}
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'rgba(246, 243, 236, 0.64)',
                  marginBottom: 3,
                }}
              >
                {storeConfig.brandName}
                {storeSourceDomain ? ` · ${storeSourceDomain}` : ''}
              </div>

              <h2
                style={{
                  fontFamily: "'Cormorant Garamond', Georgia, serif",
                  fontSize: 27,
                  fontWeight: 600,
                  lineHeight: 1.14,
                  letterSpacing: '0.02em',
                  color: '#fbf9f4',
                  margin: 0,
                }}
              >
                {product.title}
              </h2>

              {product.subtitle && (
                <div
                  style={{
                    fontSize: 12.5,
                    color: 'rgba(246, 243, 236, 0.72)',
                    marginTop: 4,
                  }}
                >
                  {product.subtitle}
                </div>
              )}

              {/* Price + Finish + Swatches Row */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 10,
                  marginTop: 12,
                  paddingTop: 11,
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span
                    style={{
                      fontSize: 24,
                      fontWeight: 700,
                      color: '#fbf8f0',
                      letterSpacing: '-0.01em',
                    }}
                  >
                    ${product.price % 1 === 0 ? product.price.toFixed(0) : product.price.toFixed(2)}
                  </span>
                  {product.materialFinish && (
                    <span style={{ fontSize: 11, color: 'rgba(246, 243, 236, 0.6)' }}>
                      · {FINISH_DISPLAY_NAMES[product.materialFinish] ?? product.materialFinish}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  {[product.primaryColor, product.secondaryColor, product.accentColor]
                    .filter(Boolean)
                    .map((hex, i) => (
                      <span
                        key={i}
                        title={`Product Swatch ${hex}`}
                        style={{
                          width: 15,
                          height: 15,
                          borderRadius: '50%',
                          background: hex,
                          border: '1px solid rgba(255,255,255,0.38)',
                        }}
                      />
                    ))}
                </div>
              </div>
            </div>

            {/* Matched from Initial Website Photos Rationale Card */}
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 12,
                padding: '11px 13px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.11em',
                  textTransform: 'uppercase',
                  color: '#d4af37',
                  marginBottom: 5,
                }}
              >
                <Sparkles size={11} />
                <span>Matched from Initial Website Photos</span>
              </div>
              <div
                style={{
                  fontSize: 12.2,
                  lineHeight: 1.48,
                  color: 'rgba(246, 243, 236, 0.86)',
                }}
              >
                {product.designRationale}
              </div>
            </div>

            {/* Gemini Nano Banana 2.1 Studio Render Engine Controls */}
            <div
              style={{
                background:
                  'linear-gradient(180deg, rgba(212, 175, 55, 0.09) 0%, rgba(255, 255, 255, 0.03) 100%)',
                border: '1px solid rgba(212, 175, 55, 0.28)',
                borderRadius: 13,
                padding: '12px 13px',
                display: 'flex',
                flexDirection: 'column',
                gap: 9,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: '#f3d882',
                  }}
                >
                  Gemini Nano Banana 2.1 · 3D Studio Engine
                </div>
                {appliedCutoutSuccess && (
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 600,
                      color: '#95bf47',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Check size={12} />
                    Live 3D Room Updated
                  </span>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 7 }}>
                {/* Button 1: Generate Commercial 3D Studio Render */}
                <button
                  type="button"
                  disabled={isRenderingCommercial}
                  onClick={() =>
                    void runCommercialRender(
                      product,
                      cleanCutoutRawUrl || sourceImageUrl,
                      Boolean(commercialRenderUrl)
                    )
                  }
                  style={{
                    border: '1px solid rgba(212, 175, 55, 0.62)',
                    background: commercialRenderUrl
                      ? 'rgba(212, 175, 55, 0.16)'
                      : 'linear-gradient(135deg, rgba(212, 175, 55, 0.34), rgba(197, 160, 89, 0.18))',
                    color: '#fbf7ec',
                    borderRadius: 10,
                    padding: '9px 12px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: isRenderingCommercial ? 'default' : 'pointer',
                    opacity: isRenderingCommercial ? 0.68 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 7,
                  }}
                >
                  {isRenderingCommercial ? (
                    <Loader2
                      size={14}
                      style={{ animation: 'studio-modal-spin 1s linear infinite' }}
                    />
                  ) : commercialRenderUrl ? (
                    <RefreshCw size={14} color="#f2d675" />
                  ) : (
                    <Sparkles size={14} color="#f2d675" />
                  )}
                  <span>
                    {commercialRenderUrl
                      ? 'Regenerate Commercial 3D Studio Render'
                      : 'Generate Commercial 3D Studio Render'}
                  </span>
                </button>

                {/* Button 2: Normalize 3D Showroom Cutout (Hot-upgrades live Three.js boutique!) */}
                <button
                  type="button"
                  disabled={isRenderingCutout}
                  onClick={() =>
                    void runNormalizeCutoutRender(
                      product,
                      sourceImageUrl,
                      Boolean(cleanCutoutRawUrl)
                    )
                  }
                  style={{
                    border: '1px solid rgba(255, 255, 255, 0.18)',
                    background: 'rgba(255, 255, 255, 0.07)',
                    color: '#f5f2eb',
                    borderRadius: 10,
                    padding: '9px 12px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: isRenderingCutout ? 'default' : 'pointer',
                    opacity: isRenderingCutout ? 0.68 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 7,
                  }}
                >
                  {isRenderingCutout ? (
                    <Loader2
                      size={14}
                      style={{ animation: 'studio-modal-spin 1s linear infinite' }}
                    />
                  ) : (
                    <Wand2 size={14} color="#a8d45a" />
                  )}
                  <span>Normalize 3D Showroom Cutout (Apply to Room)</span>
                </button>
              </div>

              {renderError && (
                <div
                  style={{
                    fontSize: 11,
                    color: '#f59e8b',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.28)',
                    borderRadius: 8,
                    padding: '6px 9px',
                  }}
                >
                  {renderError}
                </div>
              )}
            </div>
          </div>

          {/* Primary Commerce Actions Footer */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 9,
              paddingTop: 10,
              borderTop: '1px solid rgba(255, 255, 255, 0.09)',
            }}
          >
            <a
              href={buyOnlineHref}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                textDecoration: 'none',
                border: '1px solid rgba(255, 255, 255, 0.22)',
                background: 'rgba(255, 255, 255, 0.08)',
                color: '#fbf9f3',
                borderRadius: 11,
                padding: '11px 12px',
                fontSize: 12,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                textAlign: 'center',
              }}
            >
              <span>{hasDirectProductUrl ? 'Buy Real Product Online' : 'Find Real Product'}</span>
              <ExternalLink size={13} />
            </a>

            <button
              type="button"
              onClick={() => {
                onAddToBag?.(product.id);
                setBagAddedCount((c) => c + 1);
              }}
              style={{
                border: '1px solid rgba(149, 191, 71, 0.65)',
                background:
                  bagAddedCount > 0
                    ? 'rgba(149, 191, 71, 0.28)'
                    : 'linear-gradient(135deg, #95bf47 0%, #7ea935 100%)',
                color: bagAddedCount > 0 ? '#e6f6c9' : '#11150c',
                borderRadius: 11,
                padding: '11px 12px',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {bagAddedCount > 0 ? <Check size={14} /> : <ShoppingBag size={14} />}
              <span>
                {bagAddedCount > 0
                  ? `Added to Bag (${bagAddedCount})`
                  : '+ Add to Storefront Bag'}
              </span>
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes studio-modal-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default StudioProductModal;
