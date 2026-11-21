import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Box,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Globe,
  Layers,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';
import {
  formatWorldArchetypeLabel,
  ingestBrandWebsite,
  type BrandIngestSummary,
  type BrandWebsiteIngestResult,
  type IngestProgressUpdate,
} from './urlBrandIngest';

export interface UrlIngestBarProps {
  /** Invoked when the synthesized StoreConfig + invented 3D product line are ready */
  onIngestComplete: (result: BrandWebsiteIngestResult) => void;
  /** Perceptual CIELAB cutout tolerance passed if an explicit customCutoutUrl is present (default 24) */
  cutoutTolerance?: number;
  /** Placement style: floating top-center glassmorphic HUD bar (default) or inline block */
  variant?: 'floating' | 'inline';
  /** Whether the 4 quick-demo URL chips start visible */
  defaultExpandedChips?: boolean;
  /** Optional initial URL text */
  initialUrl?: string;
}

interface QuickBrandChip {
  label: string;
  url: string;
  vibeHint: string;
  swatchHex: string;
}

const QUICK_TEST_BRANDS: readonly QuickBrandChip[] = [
  {
    label: 'linear.app',
    url: 'linear.app',
    vibeHint: 'Tech Pavilion',
    swatchHex: '#5E6AD2',
  },
  {
    label: 'bluebottlecoffee.com',
    url: 'bluebottlecoffee.com',
    vibeHint: 'Artisanal Cafe',
    swatchHex: '#00A5DF',
  },
  {
    label: 'a24films.com',
    url: 'a24films.com',
    vibeHint: 'Concrete Loft',
    swatchHex: '#E04836',
  },
  {
    label: 'rowingblazers.com',
    url: 'rowingblazers.com',
    vibeHint: 'Heritage Club',
    swatchHex: '#23395B',
  },
];

const PROGRESS_STEPS: ReadonlyArray<{ stepNumber: 1 | 2 | 3; title: string }> = [
  { stepNumber: 1, title: '1. Analyzing Website Identity & Ethos...' },
  { stepNumber: 2, title: '2. Designing Store Theme & Product Line...' },
  { stepNumber: 3, title: '3. Building 3D World & Merchandising Fixtures...' },
];

export function UrlIngestBar({
  onIngestComplete,
  cutoutTolerance = 24,
  variant = 'floating',
  defaultExpandedChips = true,
  initialUrl = '',
}: UrlIngestBarProps) {
  const [urlInput, setUrlInput] = useState<string>(initialUrl);
  const [chipsExpanded, setChipsExpanded] = useState<boolean>(defaultExpandedChips);
  const [isIngesting, setIsIngesting] = useState<boolean>(false);
  const [progress, setProgress] = useState<IngestProgressUpdate | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [themeBrief, setThemeBrief] = useState<{
    summary: BrandIngestSummary;
    swatches: string[];
  } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const briefTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (briefTimerRef.current !== null) {
        window.clearTimeout(briefTimerRef.current);
      }
    };
  }, []);

  const triggerIngest = useCallback(
    async (rawTargetUrl: string) => {
      const cleaned = rawTargetUrl.trim();
      if (!cleaned || isIngesting) {
        if (!cleaned) {
          setErrorMessage(
            'Enter any website URL first (e.g. linear.app, bluebottlecoffee.com, a24films.com).'
          );
        }
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (briefTimerRef.current !== null) {
        window.clearTimeout(briefTimerRef.current);
        briefTimerRef.current = null;
      }

      setErrorMessage(null);
      setThemeBrief(null);
      setIsIngesting(true);
      setProgress({
        stage: 'analyzing_identity',
        stepNumber: 1,
        label: '1. Analyzing Website Identity & Ethos...',
        detail: `Connecting to ${cleaned}...`,
      });

      try {
        const result = await ingestBrandWebsite(cleaned, cutoutTolerance, {
          signal: controller.signal,
          onProgress: (update) => {
            setProgress(update);
          },
        });

        setIsIngesting(false);
        setProgress(null);
        if (!defaultExpandedChips) {
          setChipsExpanded(false);
        }

        const p = result.storeConfig.palette;
        setThemeBrief({
          summary: result.summary,
          swatches: [p.wall, p.floor, p.accent, p.rackMetal],
        });

        onIngestComplete(result);

        briefTimerRef.current = window.setTimeout(() => {
          setThemeBrief(null);
        }, 16000);
      } catch (err) {
        if (controller.signal.aborted) return;
        setIsIngesting(false);
        setProgress(null);
        setErrorMessage(
          err instanceof Error
            ? err.message
            : 'Unable to generate 3D shop from that URL. Try another public website.'
        );
      }
    },
    [cutoutTolerance, defaultExpandedChips, isIngesting, onIngestComplete]
  );

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void triggerIngest(urlInput);
  };

  const handleChipClick = (chipUrl: string) => {
    setUrlInput(chipUrl);
    void triggerIngest(chipUrl);
  };

  const containerStyle: React.CSSProperties =
    variant === 'floating'
      ? {
          position: 'fixed',
          top: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 25,
          width: 'min(560px, calc(100vw - 620px))',
          minWidth: 350,
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
          fontFamily: 'inherit',
        }
      : {
          position: 'relative',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
          fontFamily: 'inherit',
        };

  return (
    <div style={containerStyle}>
      <style>{`
        @keyframes urlIngestSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .agy-ingest-chip:hover:not(:disabled) {
          background: rgba(212, 175, 55, 0.18) !important;
          border-color: rgba(212, 175, 55, 0.55) !important;
          color: #f7f4ec !important;
        }
        .agy-ingest-cta:hover:not(:disabled) {
          filter: brightness(1.07);
          transform: translateY(-0.5px);
        }
      `}</style>

      {/* Main Compact Glassmorphic URL Input Bar */}
      <div
        style={{
          background: 'rgba(18, 18, 17, 0.84)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          border: '1px solid rgba(255, 255, 255, 0.13)',
          borderRadius: 13,
          padding: '7px 8px 7px 11px',
          boxShadow: '0 10px 32px rgba(0, 0, 0, 0.36)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <form
          onSubmit={handleFormSubmit}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
          }}
        >
          <Globe
            size={15}
            color="#d4af37"
            style={{ flexShrink: 0, opacity: 0.9 }}
          />

          <input
            type="text"
            value={urlInput}
            disabled={isIngesting}
            onFocus={() => {
              if (!chipsExpanded && !isIngesting) {
                setChipsExpanded(true);
              }
            }}
            onChange={(e) => {
              setUrlInput(e.target.value);
              if (errorMessage) setErrorMessage(null);
            }}
            placeholder="Enter any website URL (linear.app, bluebottlecoffee.com, a24films.com...)"
            aria-label="Website or brand URL"
            style={{
              flex: 1,
              minWidth: 0,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#f7f4ec',
              fontSize: 12,
              letterSpacing: '0.01em',
              padding: '4px 2px',
            }}
          />

          {urlInput && !isIngesting && (
            <button
              type="button"
              onClick={() => setUrlInput('')}
              title="Clear URL"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'rgba(245, 242, 235, 0.5)',
                cursor: 'pointer',
                padding: 2,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <X size={13} />
            </button>
          )}

          <button
            type="button"
            onClick={() => setChipsExpanded((v) => !v)}
            title={chipsExpanded ? 'Hide demo website chips' : 'Show demo website URLs'}
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: 7,
              color: 'rgba(245, 242, 235, 0.72)',
              cursor: 'pointer',
              padding: '5px 6px',
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
            }}
          >
            {chipsExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>

          <button
            type="submit"
            disabled={isIngesting}
            className="agy-ingest-cta"
            style={{
              flexShrink: 0,
              border: 'none',
              borderRadius: 9,
              padding: '7px 12px',
              cursor: isIngesting ? 'wait' : 'pointer',
              background: isIngesting
                ? 'rgba(212, 175, 55, 0.35)'
                : 'linear-gradient(135deg, #dfbe52 0%, #c59b27 100%)',
              color: isIngesting ? '#f7f4ec' : '#161512',
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: '0.02em',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.15s ease',
              boxShadow: isIngesting ? 'none' : '0 2px 10px rgba(212, 175, 55, 0.28)',
            }}
          >
            {isIngesting ? (
              <>
                <Loader2
                  size={13}
                  style={{ animation: 'urlIngestSpin 0.9s linear infinite' }}
                />
                <span>Designing World...</span>
              </>
            ) : (
              <>
                <Sparkles size={13} />
                <span>Generate 3D Brand Shop</span>
              </>
            )}
          </button>
        </form>

        {/* 4 Diverse Non-Store & Brand Quick-Demo Chips */}
        {chipsExpanded && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              flexWrap: 'wrap',
              paddingTop: 4,
              borderTop: '1px solid rgba(255, 255, 255, 0.07)',
            }}
          >
            <span
              style={{
                fontSize: 9.5,
                textTransform: 'uppercase',
                letterSpacing: '0.09em',
                color: 'rgba(245, 242, 235, 0.48)',
                fontWeight: 600,
                marginRight: 2,
              }}
            >
              Demo Worlds:
            </span>
            {QUICK_TEST_BRANDS.map((chip) => (
              <button
                key={chip.url}
                type="button"
                disabled={isIngesting}
                onClick={() => handleChipClick(chip.url)}
                className="agy-ingest-chip"
                title={`Design a bespoke ${chip.vibeHint} 3D flagship & 6-product line for ${chip.url}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4.5,
                  padding: '3px 7.5px',
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 500,
                  cursor: isIngesting ? 'not-allowed' : 'pointer',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.11)',
                  color: 'rgba(245, 242, 235, 0.86)',
                  transition: 'all 0.14s ease',
                  opacity: isIngesting ? 0.55 : 1,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: chip.swatchHex,
                    border: '1px solid rgba(255,255,255,0.45)',
                  }}
                />
                <span>{chip.label}</span>
                <span style={{ opacity: 0.56, fontSize: 9.2 }}>· {chip.vibeHint}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Step-by-Step Creative Director Pipeline Popover */}
      {isIngesting && progress && (
        <div
          role="status"
          aria-live="polite"
          style={{
            background: 'rgba(16, 16, 15, 0.91)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid rgba(212, 175, 55, 0.35)',
            borderRadius: 12,
            padding: '10px 13px',
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {PROGRESS_STEPS.map((step) => {
            const isDone = progress.stepNumber > step.stepNumber;
            const isCurrent = progress.stepNumber === step.stepNumber;
            return (
              <div
                key={step.stepNumber}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 11.5,
                  fontWeight: isCurrent ? 600 : 500,
                  color: isDone
                    ? '#a6e094'
                    : isCurrent
                      ? '#f7f4ec'
                      : 'rgba(245, 242, 235, 0.38)',
                  transition: 'color 0.18s ease',
                }}
              >
                <span
                  style={{
                    width: 15,
                    height: 15,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {isDone ? (
                    <Check size={13} color="#a6e094" strokeWidth={2.6} />
                  ) : isCurrent ? (
                    <Loader2
                      size={13}
                      color="#d4af37"
                      style={{ animation: 'urlIngestSpin 0.85s linear infinite' }}
                    />
                  ) : (
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: 'rgba(255,255,255,0.22)',
                      }}
                    />
                  )}
                </span>
                <span>{step.title}</span>
              </div>
            );
          })}

          {progress.detail && (
            <div
              style={{
                marginTop: 2,
                paddingTop: 6,
                borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                fontSize: 10.5,
                color: 'rgba(231, 201, 107, 0.9)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {progress.detail}
            </div>
          )}
        </div>
      )}

      {/* Sleek Dismissible Brand Theme Brief Popover */}
      {!isIngesting && themeBrief && (
        <div
          role="region"
          aria-label="Brand Theme Brief"
          style={{
            background: 'rgba(17, 19, 18, 0.90)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid rgba(212, 175, 55, 0.36)',
            borderRadius: 12,
            padding: '10px 13px',
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.42)',
            display: 'flex',
            flexDirection: 'column',
            gap: 7,
            color: '#f7f4ec',
          }}
        >
          {/* Top Header: Brand Name + Archetype Pill + Product Count Pill + Swatches + Dismiss */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', minWidth: 0 }}>
              <CheckCircle2 size={14} color="#a6e094" style={{ flexShrink: 0 }} />
              <strong
                style={{
                  fontSize: 12,
                  letterSpacing: '0.06em',
                  color: '#e7c96b',
                }}
              >
                {themeBrief.summary.brandName}
              </strong>

              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 7px',
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 600,
                  background: 'rgba(212, 175, 55, 0.14)',
                  border: '1px solid rgba(212, 175, 55, 0.34)',
                  color: '#f3dfb0',
                }}
              >
                <Layers size={10} />
                {formatWorldArchetypeLabel(themeBrief.summary.archetype)}
              </span>

              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 7px',
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 600,
                  background: 'rgba(166, 224, 148, 0.12)',
                  border: '1px solid rgba(166, 224, 148, 0.30)',
                  color: '#c8f0bc',
                }}
              >
                <Box size={10} />
                {themeBrief.summary.inventedProductCount} 3D Products (
                {(themeBrief.summary.elapsedMs / 1000).toFixed(1)}s)
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
              {themeBrief.swatches.map((hex, i) => (
                <span
                  key={i}
                  title={hex}
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: hex,
                    border: '1px solid rgba(255,255,255,0.38)',
                  }}
                />
              ))}
              <button
                type="button"
                onClick={() => setThemeBrief(null)}
                aria-label="Dismiss Brand Theme Brief"
                title="Dismiss Brand Theme Brief"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'rgba(245, 242, 235, 0.6)',
                  cursor: 'pointer',
                  padding: 2,
                  marginLeft: 2,
                  display: 'flex',
                }}
              >
                <X size={13} />
              </button>
            </div>
          </div>

          {/* Brand Ethos Creative Brief */}
          <div
            style={{
              fontSize: 11,
              lineHeight: 1.42,
              color: 'rgba(247, 244, 236, 0.88)',
              paddingTop: 5,
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            {themeBrief.summary.brandEthos}
          </div>
        </div>
      )}

      {/* Error Toast */}
      {errorMessage && (
        <div
          role="alert"
          style={{
            background: 'rgba(42, 18, 16, 0.90)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            border: '1px solid rgba(255, 120, 102, 0.45)',
            borderRadius: 11,
            padding: '8px 12px',
            boxShadow: '0 10px 28px rgba(0, 0, 0, 0.4)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 9,
            fontSize: 11.5,
            color: '#ffd9d2',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <AlertCircle size={15} color="#ff8b7b" style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ lineHeight: 1.38 }}>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            aria-label="Dismiss error"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(255, 217, 210, 0.7)',
              cursor: 'pointer',
              padding: 2,
              flexShrink: 0,
              display: 'flex',
            }}
          >
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

export default UrlIngestBar;
