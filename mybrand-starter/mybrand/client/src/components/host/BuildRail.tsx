import { useMemo, useState } from "react";
import type { BootActivity, BootAsset, BootJobStatus } from "../../api/hostApi";
import { REQUIRED_ARTIFACTS } from "../../state/bootJobReducer";

interface BuildRailProps {
  bootId: string;
  status: BootJobStatus;
  artifacts: readonly string[];
  assets: readonly BootAsset[];
  activities: readonly BootActivity[];
  readyToOpen: boolean;
  onOpenBoutique: () => void;
}

function formatActivityTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatAssetKind(kind?: string): string {
  if (!kind) return "image";
  return kind.replace(/_/g, " ");
}

export function BuildRail({
  bootId,
  status,
  artifacts,
  assets,
  activities,
  readyToOpen,
  onOpenBoutique,
}: BuildRailProps) {
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [lightboxAsset, setLightboxAsset] = useState<BootAsset | null>(null);

  const savedSet = useMemo(() => new Set(artifacts), [artifacts]);
  const savedRequiredCount = useMemo(
    () =>
      REQUIRED_ARTIFACTS.filter((item) => savedSet.has(item.name)).length,
    [savedSet]
  );

  const isGeneratingImages = useMemo(() => {
    if (status !== "running") return false;
    const recent = activities.slice(-4);
    return recent.some(
      (a) =>
        a.kind === "tool_call" &&
        a.label.toLowerCase().includes("generate_image")
    );
  }, [activities, status]);

  const latestActivity =
    activities.length > 0 ? activities[activities.length - 1] : null;

  return (
    <aside className="build-rail" aria-label="Live build progress">
      {/* Artifact Checklist */}
      <section className="rail-card">
        <div className="rail-card-header">
          <div>
            <h3>Artifacts</h3>
            <span className="rail-sub">
              {savedRequiredCount} / {REQUIRED_ARTIFACTS.length} saved
            </span>
          </div>
          <span
            className={`rail-progress-pill ${readyToOpen ? "ready" : ""}`}
          >
            {readyToOpen ? "Ready" : `${Math.round((savedRequiredCount / REQUIRED_ARTIFACTS.length) * 100)}%`}
          </span>
        </div>

        <div className="rail-progress-bar" aria-hidden="true">
          <div
            className="rail-progress-fill"
            style={{
              width: `${(savedRequiredCount / REQUIRED_ARTIFACTS.length) * 100}%`,
            }}
          />
        </div>

        <ul className="artifact-checklist">
          {REQUIRED_ARTIFACTS.map((item) => {
            const saved = savedSet.has(item.name);
            return (
              <li
                key={item.name}
                className={`artifact-row ${saved ? "saved" : "pending"}`}
              >
                <span className="artifact-check" aria-hidden="true">
                  {saved ? "✓" : "○"}
                </span>
                <div className="artifact-copy">
                  <div className="artifact-name">
                    {item.label} <code>{item.name}</code>
                  </div>
                  <div className="artifact-desc">{item.description}</div>
                </div>
              </li>
            );
          })}
        </ul>

        {readyToOpen && (
          <div className="rail-ready-banner">
            <div className="rail-ready-copy">
              <strong>Your 3D boutique is ready!</strong>
              <span>All required artifacts validated and saved.</span>
            </div>
            <button
              type="button"
              className="primary-cta rail-open-btn"
              onClick={onOpenBoutique}
            >
              Open boutique →
            </button>
          </div>
        )}
      </section>

      {/* Generated Image Thumbnails Gallery */}
      <section className="rail-card">
        <div className="rail-card-header">
          <div>
            <h3>Generated Images</h3>
            <span className="rail-sub">
              {assets.length} asset{assets.length === 1 ? "" : "s"} rendered
            </span>
          </div>
          {isGeneratingImages && (
            <span className="rail-rendering-pill">Rendering…</span>
          )}
        </div>

        {assets.length === 0 && !isGeneratingImages ? (
          <p className="rail-empty">
            Textures, posters, and product visuals will stream here as Phase 3
            generates them.
          </p>
        ) : (
          <div className="asset-thumb-grid">
            {assets.map((asset) => (
              <button
                key={asset.asset_id}
                type="button"
                className="asset-thumb-card"
                onClick={() => setLightboxAsset(asset)}
                title={asset.prompt || asset.asset_id}
              >
                <div className="asset-thumb-media">
                  <img
                    src={asset.url}
                    alt={asset.prompt || asset.asset_id}
                    loading="lazy"
                  />
                  {asset.fallback && (
                    <span className="asset-fallback-tag">fallback</span>
                  )}
                </div>
                <div className="asset-thumb-meta">
                  <span className="asset-kind-tag">
                    {formatAssetKind(asset.kind)}
                  </span>
                  <span className="asset-id-label">{asset.asset_id}</span>
                </div>
              </button>
            ))}

            {isGeneratingImages && (
              <>
                <div className="asset-thumb-skeleton" aria-hidden="true" />
                <div className="asset-thumb-skeleton" aria-hidden="true" />
              </>
            )}
          </div>
        )}
      </section>

      {/* Collapsible Tool / Activity Feed */}
      <section className="rail-card rail-activity-card">
        <button
          type="button"
          className="rail-activity-toggle"
          onClick={() => setActivityExpanded((v) => !v)}
          aria-expanded={activityExpanded}
        >
          <div>
            <h3>Activity Feed ({activities.length})</h3>
            {!activityExpanded && latestActivity && (
              <div className="rail-activity-preview">{latestActivity.label}</div>
            )}
          </div>
          <span className="rail-chevron">{activityExpanded ? "▾" : "▸"}</span>
        </button>

        {activityExpanded && (
          <div className="activity-feed-list">
            {activities.length === 0 ? (
              <p className="rail-empty">Waiting for tool events…</p>
            ) : (
              activities
                .slice()
                .reverse()
                .map((activity) => (
                  <div
                    key={activity.id}
                    className={`activity-item activity-${activity.kind}`}
                  >
                    <div className="activity-top">
                      <span className={`activity-dot dot-${activity.kind}`} />
                      <span className="activity-label">{activity.label}</span>
                      <span className="activity-time">
                        {formatActivityTime(activity.timestamp)}
                      </span>
                    </div>
                    {activity.detail && (
                      <div className="activity-detail">{activity.detail}</div>
                    )}
                  </div>
                ))
            )}
          </div>
        )}
      </section>

      {/* Full-Resolution Asset Lightbox */}
      {lightboxAsset && (
        <div
          className="asset-lightbox-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={`Asset preview ${lightboxAsset.asset_id}`}
          onClick={() => setLightboxAsset(null)}
        >
          <div
            className="asset-lightbox-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="asset-lightbox-header">
              <div>
                <span className="asset-kind-tag">
                  {formatAssetKind(lightboxAsset.kind)}
                </span>{" "}
                <strong>{lightboxAsset.asset_id}</strong>{" "}
                <span className="asset-lightbox-model">
                  ({lightboxAsset.model})
                </span>
              </div>
              <button
                type="button"
                className="inspect-close"
                onClick={() => setLightboxAsset(null)}
                aria-label="Close preview"
              >
                ✕
              </button>
            </div>
            <div className="asset-lightbox-body">
              <img
                src={lightboxAsset.url}
                alt={lightboxAsset.prompt || lightboxAsset.asset_id}
              />
            </div>
            <div className="asset-lightbox-footer">
              <div className="asset-lightbox-prompt">
                {lightboxAsset.prompt || `Generated asset for ${bootId}`}
              </div>
              <a
                href={lightboxAsset.url}
                target="_blank"
                rel="noopener noreferrer"
                className="landing-direct-link"
              >
                Open image ↗
              </a>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
