import { useMemo, useState } from "react";
import type {
  BoutiqueEvent,
  Op,
  OpSource,
  Products,
  WorldSpec,
} from "@mybrand/shared";
import {
  parseManualOpInput,
  type AppliedOpRecord,
  type ApplyOpsResult,
} from "../../state/sessionState";
import type { SessionMode, StreamStatus } from "../../state/useBoutiqueSession";
import type { ScenePerfStats } from "../scene/BoutiqueScene";

interface DevOverlayProps {
  open: boolean;
  bootId: string;
  sessionId: string | null;
  sessionMode: SessionMode;
  streamStatus: StreamStatus;
  currentZoneId: string | null;
  worldSpec: WorldSpec;
  products: Products;
  visitorRead: string;
  confidence: number;
  opLog: AppliedOpRecord[];
  recentEvents: BoutiqueEvent[];
  perfStats: ScenePerfStats;
  onClose: () => void;
  onInjectOps: (
    ops: Op[],
    meta: {
      source: OpSource;
      latency_ms: number;
      visitor_read?: string;
      confidence?: number;
    }
  ) => ApplyOpsResult | null;
}

interface PresetOpSnippet {
  label: string;
  payload: unknown;
}

export function DevOverlay({
  open,
  bootId,
  sessionId,
  sessionMode,
  streamStatus,
  currentZoneId,
  worldSpec,
  products,
  visitorRead,
  confidence,
  opLog,
  recentEvents,
  perfStats,
  onClose,
  onInjectOps,
}: DevOverlayProps) {
  const presets = useMemo<PresetOpSnippet[]>(() => {
    const altHero =
      products.find((p) => p.id !== worldSpec.hero_plinth.product_id) ??
      products[0];
    const galleryZone =
      worldSpec.zones[worldSpec.zones.length - 1] ?? worldSpec.zones[0];
    const tableZone = worldSpec.zones[1] ?? worldSpec.zones[0];
    const spotPreset =
      worldSpec.variant_pools.lighting.find((l) => l.spot) ??
      worldSpec.variant_pools.lighting[worldSpec.variant_pools.lighting.length - 1];
    const altSignage =
      (tableZone && worldSpec.variant_pools.signage[tableZone.id]?.[1]) ??
      (tableZone && worldSpec.variant_pools.signage[tableZone.id]?.[0]) ??
      "Featured picks — explore this zone";
    const blurbTarget = altHero ?? products[0];

    const list: PresetOpSnippet[] = [];
    if (altHero) {
      list.push({
        label: "Swap Hero",
        payload: [
          {
            op: "replace",
            path: "/hero_plinth/product_id",
            value: altHero.id,
            reason: `manual test: feature ${altHero.title} on hero plinth`,
          },
        ],
      });
    }
    if (galleryZone && spotPreset) {
      list.push({
        label: "Zone Spot",
        payload: [
          {
            op: "replace",
            path: `/zones/${galleryZone.id}/lighting`,
            value: spotPreset.id,
            reason: `manual test: shift ${galleryZone.id} to ${spotPreset.id}`,
          },
        ],
      });
    }
    list.push({
      label: "Host Note",
      payload: [
        {
          op: "replace",
          path: "/host_note",
          value: altHero
            ? `Moved ${altHero.title} to the hero plinth — click to take a closer look.`.slice(
                0,
                90
              )
            : "Fresh highlight on the hero plinth — click any piece to inspect.",
          reason: "manual test: typewriter host note update",
        },
      ],
    });
    if (tableZone) {
      list.push({
        label: "Signage + Path",
        payload: {
          ops: [
            {
              op: "replace",
              path: `/zones/${tableZone.id}/signage`,
              value: altSignage,
              reason: "manual test: update zone signage copy",
            },
            {
              op: "replace",
              path: "/guide_path/target_zone",
              value: tableZone.id,
              reason: `manual test: redirect floor path to ${tableZone.id}`,
            },
          ],
          visitor_read: `exploring ${tableZone.id.replace(/^zone_/, "")}`,
          confidence: 0.85,
        },
      });
    }
    if (blurbTarget) {
      list.push({
        label: "Flip Blurb",
        payload: [
          {
            op: "replace",
            path: `/blurbs/${blurbTarget.id}`,
            value: 1,
            reason: `manual test: switch ${blurbTarget.id} blurb to angle 1`,
          },
        ],
      });
    }
    return list;
  }, [worldSpec, products]);

  const [jsonText, setJsonText] = useState(() =>
    JSON.stringify(presets[0]?.payload ?? [], null, 2)
  );
  const [feedback, setFeedback] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const [showEvents, setShowEvents] = useState(false);

  if (!open) return null;

  const handleApply = () => {
    try {
      const parsed = parseManualOpInput(jsonText);
      const result = onInjectOps(parsed.ops, {
        source: "manual",
        latency_ms: 0,
        visitor_read: parsed.visitor_read,
        confidence: parsed.confidence,
      });

      if (!result) {
        setFeedback({ kind: "error", text: "Boutique session not ready." });
        return;
      }

      if (result.rejected.length > 0) {
        const errors = result.rejected.map((r) => r.error).join(" | ");
        setFeedback({
          kind: "error",
          text: `Applied ${result.applied.length}, rejected ${result.rejected.length}: ${errors}`,
        });
      } else {
        setFeedback({
          kind: "ok",
          text: `Applied ${result.applied.length} op${result.applied.length === 1 ? "" : "s"}`,
        });
      }
    } catch (err) {
      setFeedback({
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <aside className="dev-overlay" aria-label="Developer adaptation overlay">
      <div className="dev-header">
        <div>
          <div className="dev-title">Adaptation Inspector</div>
          <div className="dev-subtitle">
            boot: <code>{bootId}</code> ·{" "}
            {sessionId ? (
              <>
                session: <code>{sessionId.slice(0, 8)}</code> ({streamStatus})
              </>
            ) : (
              <span>{sessionMode}</span>
            )}
          </div>
        </div>
        <button
          type="button"
          className="dev-close"
          onClick={onClose}
          title="Close overlay (O)"
        >
          ✕
        </button>
      </div>

      {/* Performance & Budget Bar */}
      <div className="dev-budget-row">
        <span className={perfStats.fps >= 50 ? "budget-ok" : "budget-warn"}>
          {perfStats.fps} FPS
        </span>
        <span className={perfStats.objects <= 60 ? "budget-ok" : "budget-warn"}>
          {perfStats.objects}/60 objs
        </span>
        <span className={perfStats.textures <= 12 ? "budget-ok" : "budget-warn"}>
          {perfStats.textures}/12 tex
        </span>
        <span className="budget-zone">zone: {currentZoneId ?? "none"}</span>
      </div>

      {/* Visitor Read & Confidence */}
      <section className="dev-section">
        <div className="dev-section-label">visitor_read</div>
        <div className="dev-read-row">
          <span className="dev-read-text">{visitorRead}</span>
          <span className="dev-confidence">
            {Math.round(confidence * 100)}% conf
          </span>
        </div>
      </section>

      {/* Applied Ops Log */}
      <section className="dev-section">
        <div className="dev-section-label">
          Applied Ops ({opLog.length})
        </div>
        <div className="dev-op-list">
          {opLog.length === 0 ? (
            <div className="dev-empty">
              No ops applied yet. Walk around or inject an op below.
            </div>
          ) : (
            opLog.map((entry) => (
              <div key={entry.id} className="dev-op-item">
                <div className="dev-op-top">
                  <span className={`source-badge source-${entry.source}`}>
                    {entry.source}
                  </span>
                  <span className="dev-op-meta">
                    {entry.latency_ms} ms · t={entry.now_s.toFixed(1)}s
                  </span>
                </div>
                <div className="dev-op-path">
                  <code>{entry.op.path}</code> →{" "}
                  <strong>{JSON.stringify(entry.op.value)}</strong>
                </div>
                <div className="dev-op-reason">{entry.op.reason}</div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Manual Op Injector */}
      <section className="dev-section">
        <div className="dev-section-label">Inject Ops (JSON)</div>
        <div className="dev-presets">
          {presets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="dev-preset-btn"
              onClick={() => {
                setJsonText(JSON.stringify(preset.payload, null, 2));
                setFeedback(null);
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <textarea
          className="dev-textarea"
          rows={6}
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          spellCheck={false}
          aria-label="Manual op JSON input"
        />
        <div className="dev-inject-footer">
          <button
            type="button"
            className="dev-apply-btn"
            onClick={handleApply}
          >
            Apply Ops
          </button>
          {feedback && (
            <span className={`dev-feedback dev-feedback-${feedback.kind}`}>
              {feedback.text}
            </span>
          )}
        </div>
      </section>

      {/* Recent Telemetry Events */}
      <section className="dev-section">
        <button
          type="button"
          className="dev-events-toggle"
          onClick={() => setShowEvents((v) => !v)}
        >
          <span>Recent Events ({recentEvents.length})</span>
          <span>{showEvents ? "▾" : "▸"}</span>
        </button>
        {showEvents && (
          <div className="dev-event-list">
            {recentEvents.length === 0 ? (
              <div className="dev-empty">No events emitted yet.</div>
            ) : (
              recentEvents
                .slice()
                .reverse()
                .slice(0, 12)
                .map((ev, idx) => (
                  <div key={`${ev.t}-${ev.type}-${idx}`} className="dev-event-row">
                    <code>t={ev.t}s</code> <strong>{ev.type}</strong>{" "}
                    {ev.zone && <span>[{ev.zone}]</span>}{" "}
                    {ev.product_id && <span>{ev.product_id}</span>}{" "}
                    {typeof ev.ms === "number" && <span>({ev.ms} ms)</span>}
                  </div>
                ))
            )}
          </div>
        )}
      </section>
    </aside>
  );
}
