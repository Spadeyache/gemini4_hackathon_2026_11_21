import type { BrandCore, WorldSpec, Zone } from "@mybrand/shared";
import type { SessionMode, StreamStatus } from "../../state/useBoutiqueSession";
import type { CameraMode, TargetGazeInfo } from "../scene/BoutiqueScene";

interface CrosshairHudProps {
  brandCore: BrandCore;
  worldSpec: WorldSpec;
  currentZone: Zone | null;
  currentZoneSignage: string | null;
  cameraMode: CameraMode;
  focusedZoneId: string | null;
  targetGaze: TargetGazeInfo | null;
  pointerLocked: boolean;
  devOverlayOpen: boolean;
  inspectOpen: boolean;
  bagCount: number;
  sessionMode: SessionMode;
  streamStatus: StreamStatus;
  isAdapting: boolean;
  onAdaptNow: () => void;
  onChangeCameraMode: (mode: CameraMode) => void;
  onFocusZone: (zoneId: string | null) => void;
  onToggleDevOverlay: () => void;
  onBackHome: () => void;
}

function formatPrice(price: string, currency: string): string {
  if (currency === "USD") return `$${price}`;
  return `${price} ${currency}`;
}

function formatZoneLabel(zoneId: string): string {
  return zoneId.replace(/^zone_/, "").replace(/[_-]+/g, " ");
}

export function CrosshairHud({
  brandCore,
  worldSpec,
  currentZone,
  currentZoneSignage,
  cameraMode,
  focusedZoneId,
  targetGaze,
  pointerLocked,
  devOverlayOpen,
  inspectOpen,
  bagCount,
  sessionMode,
  streamStatus,
  isAdapting,
  onAdaptNow,
  onChangeCameraMode,
  onFocusZone,
  onToggleDevOverlay,
  onBackHome,
}: CrosshairHudProps) {
  const ringRadius = 15;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const dashOffset =
    ringCircumference * (1 - (targetGaze?.progress01 ?? 0));

  const miniRadius = 9;
  const miniCircumference = 2 * Math.PI * miniRadius;
  const miniDashOffset =
    miniCircumference * (1 - (targetGaze?.progress01 ?? 0));

  const isDiorama = cameraMode === "diorama";

  const cursorTooltipStyle = (() => {
    if (
      !isDiorama ||
      !targetGaze ||
      typeof targetGaze.cursorX !== "number" ||
      typeof targetGaze.cursorY !== "number"
    ) {
      return undefined;
    }
    const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
    const clampedX = Math.max(130, Math.min(vw - 130, targetGaze.cursorX));
    const clampedY = Math.max(96, targetGaze.cursorY - 22);
    return {
      left: `${clampedX}px`,
      top: `${clampedY}px`,
    };
  })();

  return (
    <>
      {/* Top-Left Brand & Zone Header */}
      <header className="hud-topbar">
        <div className="hud-brand-group">
          <button
            type="button"
            className="hud-back-btn"
            onClick={onBackHome}
            title="Back to lobby"
          >
            ←
          </button>
          <div>
            <div className="hud-brand-name">{brandCore.host.name}</div>
            <div className="hud-brand-sub">
              {currentZoneSignage ?? worldSpec.entrance.greeting}
            </div>
          </div>
        </div>

        <div className="hud-status-pills">
          {/* Camera Mode Toggle: 2.5D Diorama (default) <-> First-Person Walk */}
          <div
            className="hud-mode-toggle"
            role="group"
            aria-label="Camera mode"
            title="Switch view (V)"
          >
            <button
              type="button"
              className={`hud-mode-btn ${isDiorama ? "active" : ""}`}
              onClick={() => onChangeCameraMode("diorama")}
              aria-pressed={isDiorama}
            >
              2.5D View
            </button>
            <button
              type="button"
              className={`hud-mode-btn ${!isDiorama ? "active" : ""}`}
              onClick={() => onChangeCameraMode("walk")}
              aria-pressed={!isDiorama}
            >
              Walk
            </button>
          </div>

          <span className="hud-pill hud-pill-zone">
            {currentZone ? formatZoneLabel(currentZone.id) : isDiorama ? "overview" : "entrance"}
          </span>
          {bagCount > 0 && (
            <span className="hud-pill hud-pill-bag">Bag · {bagCount}</span>
          )}
          <span
            className={`hud-pill hud-pill-session hud-pill-${sessionMode}`}
            title={`Session: ${sessionMode} · Stream: ${streamStatus}`}
          >
            {sessionMode === "live"
              ? streamStatus === "connected"
                ? "Live"
                : "Connecting"
              : "Local"}
          </span>
          {sessionMode === "live" && (
            <button
              type="button"
              className={`hud-adapt-btn ${isAdapting ? "adapting" : ""}`}
              onClick={onAdaptNow}
              disabled={isAdapting}
              title="Update boutique now based on your recent selections using Gemini 4 Hydrogen (Ctrl+U)"
            >
              {isAdapting ? "✦ Adapting…" : "✦ Adapt [Ctrl+U]"}
            </button>
          )}
          <button
            type="button"
            className={`hud-dev-toggle ${devOverlayOpen ? "active" : ""}`}
            onClick={onToggleDevOverlay}
          >
            Dev [O]
          </button>
        </div>
      </header>

      {/* Walk Mode: Center Reticle & Product Hover Callout */}
      {!isDiorama && !inspectOpen && (
        <div className="hud-reticle-wrap" aria-hidden="true">
          <div className={`hud-reticle ${targetGaze ? "targeting" : ""}`}>
            <svg width="38" height="38" viewBox="0 0 38 38">
              <circle
                cx="19"
                cy="19"
                r={ringRadius}
                fill="none"
                stroke="rgba(255,255,255,0.32)"
                strokeWidth="2"
              />
              {targetGaze && (
                <circle
                  cx="19"
                  cy="19"
                  r={ringRadius}
                  fill="none"
                  stroke="var(--brand-accent)"
                  strokeWidth="2.5"
                  strokeDasharray={ringCircumference}
                  strokeDashoffset={dashOffset}
                  strokeLinecap="round"
                  transform="rotate(-90 19 19)"
                />
              )}
              <circle
                cx="19"
                cy="19"
                r={targetGaze ? 3.2 : 2.3}
                fill={targetGaze ? "var(--brand-accent)" : "#ffffff"}
              />
            </svg>
          </div>

          {targetGaze && (
            <div className="hud-target-tooltip">
              <div className="hud-target-title">{targetGaze.product.title}</div>
              <div className="hud-target-meta">
                <span>
                  {formatPrice(
                    targetGaze.product.price,
                    targetGaze.product.currency
                  )}
                </span>
                <span>·</span>
                <span>Click to inspect</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2.5D Diorama Mode: Direct Mouse-Hover Product Tooltip with 600ms Look Ring */}
      {isDiorama && !inspectOpen && targetGaze && (
        <div
          className="hud-diorama-tooltip"
          style={cursorTooltipStyle}
          aria-hidden="true"
        >
          <svg
            className="hud-mini-ring"
            width="24"
            height="24"
            viewBox="0 0 24 24"
          >
            <circle
              cx="12"
              cy="12"
              r={miniRadius}
              fill="none"
              stroke="rgba(255,255,255,0.25)"
              strokeWidth="2"
            />
            <circle
              cx="12"
              cy="12"
              r={miniRadius}
              fill="none"
              stroke="var(--brand-accent)"
              strokeWidth="2.4"
              strokeDasharray={miniCircumference}
              strokeDashoffset={miniDashOffset}
              strokeLinecap="round"
              transform="rotate(-90 12 12)"
            />
          </svg>
          <div>
            <div className="hud-target-title">{targetGaze.product.title}</div>
            <div className="hud-target-meta">
              <span>
                {formatPrice(
                  targetGaze.product.price,
                  targetGaze.product.currency
                )}
              </span>
              <span>·</span>
              <span>Click to inspect</span>
            </div>
          </div>
        </div>
      )}

      {/* 2.5D Diorama Mode: Zone Quick-Focus Bar + Controls Hint */}
      {isDiorama && !inspectOpen && (
        <div className="hud-diorama-dock">
          <nav className="hud-zone-pills" aria-label="Focus boutique zone">
            <button
              type="button"
              className={`hud-zone-pill ${focusedZoneId === null ? "active" : ""}`}
              onClick={() => onFocusZone(null)}
            >
              Overview
            </button>
            {worldSpec.zones.map((zone) => (
              <button
                key={zone.id}
                type="button"
                className={`hud-zone-pill ${focusedZoneId === zone.id ? "active" : ""}`}
                onClick={() => onFocusZone(zone.id)}
                title={zone.beat}
              >
                {formatZoneLabel(zone.id)}
              </button>
            ))}
          </nav>
          <div className="hud-diorama-hint">
            Drag to orbit · Scroll to zoom · Click any piece to inspect ·{" "}
            <strong>Ctrl+U</strong> adapt now · <strong>V</strong> walk ·{" "}
            <strong>O</strong> dev
          </div>
        </div>
      )}

      {/* Walk Mode: Bottom Controls Hint */}
      {!isDiorama && !pointerLocked && !inspectOpen && (
        <div className="hud-controls-hint">
          Click floor to walk (pointer lock) · <strong>WASD</strong> move ·{" "}
          <strong>Mouse</strong> look · <strong>Click</strong> item to inspect ·{" "}
          <strong>V</strong> 2.5D view · <strong>O</strong> dev overlay
        </div>
      )}
    </>
  );
}
