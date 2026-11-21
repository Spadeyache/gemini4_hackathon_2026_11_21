import { useEffect, useMemo, useRef, useState } from "react";
import type { Product, WorldSpec } from "@mybrand/shared";
import type { AppliedOpRecord } from "../../state/sessionState";

interface AdaptationToastProps {
  opLog: AppliedOpRecord[];
  visitorRead: string;
  productById: Map<string, Product>;
  worldSpec: WorldSpec;
}

function summarizeOpForVisitor(
  entry: AppliedOpRecord,
  productById: Map<string, Product>,
  worldSpec: WorldSpec
): string {
  const { path, value } = entry.op;

  if (path === "/hero_plinth/product_id" && typeof value === "string") {
    const prod = productById.get(value);
    return `Hero spotlight → ${prod?.title ?? value}`;
  }

  const slotMatch = /^\/zones\/([^/]+)\/slots\/[^/]+\/product_id$/.exec(path);
  if (slotMatch && typeof value === "string") {
    const prod = productById.get(value);
    return `Featured → ${prod?.title ?? value}`;
  }

  const lightingMatch = /^\/zones\/([^/]+)\/lighting$/.exec(path);
  if (lightingMatch && typeof value === "string") {
    const zoneName = lightingMatch[1]!.replace(/^zone_/, "");
    return `Lighting (${zoneName}) → ${value.replace(/_/g, " ")}`;
  }

  const signageMatch = /^\/zones\/([^/]+)\/signage$/.exec(path);
  if (signageMatch) {
    const zoneName = signageMatch[1]!.replace(/^zone_/, "");
    return `Signage (${zoneName}) updated`;
  }

  if (path === "/guide_path/target_zone" && typeof value === "string") {
    const zone = worldSpec.zones.find((z) => z.id === value);
    const label = zone ? zone.id.replace(/^zone_/, "") : value;
    return `Guide path → ${label}`;
  }

  if (path.startsWith("/blurbs/")) {
    const pid = path.slice("/blurbs/".length);
    const prod = productById.get(pid);
    return `Copy angle → ${prod?.title ?? pid}`;
  }

  if (path === "/host_note") {
    return "Host note updated";
  }

  return entry.op.reason;
}

function formatSourceLabel(source: AppliedOpRecord["source"]): string {
  switch (source) {
    case "model":
      return "Gemini 4 Hydrogen";
    case "rules":
      return "Instant Rules";
    case "manual":
      return "Manual Op";
  }
}

export function AdaptationToast({
  opLog,
  visitorRead,
  productById,
  worldSpec,
}: AdaptationToastProps) {
  const [visible, setVisible] = useState(false);
  const lastSeenIdRef = useRef<string | null>(null);

  const latestBatch = useMemo(() => {
    if (opLog.length === 0) return [];
    const newest = opLog[0]!;
    // Collect ops applied in the same tick (matching timestamp/source)
    return opLog
      .filter(
        (entry) =>
          entry.source === newest.source &&
          Math.abs(entry.now_s - newest.now_s) <= 0.15
      )
      .slice(0, 3);
  }, [opLog]);

  const newestId = latestBatch[0]?.id ?? null;

  useEffect(() => {
    if (!newestId || newestId === lastSeenIdRef.current) return;
    lastSeenIdRef.current = newestId;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 6200);
    return () => window.clearTimeout(timer);
  }, [newestId]);

  if (!visible || latestBatch.length === 0) return null;

  const primary = latestBatch[0]!;
  const summaries = latestBatch.map((entry) =>
    summarizeOpForVisitor(entry, productById, worldSpec)
  );

  return (
    <div
      className={`adaptation-toast adaptation-toast-${primary.source}`}
      role="status"
      aria-live="polite"
    >
      <div className="adaptation-toast-header">
        <span className="adaptation-toast-badge">
          <span className="adaptation-toast-dot" />
          {formatSourceLabel(primary.source)}
        </span>
        <span className="adaptation-toast-latency">
          {primary.latency_ms >= 1000
            ? `${(primary.latency_ms / 1000).toFixed(1)}s`
            : `${primary.latency_ms}ms`}
        </span>
      </div>
      {visitorRead && (
        <div className="adaptation-toast-read">
          Tailored for: <strong>{visitorRead}</strong>
        </div>
      )}
      <div className="adaptation-toast-changes">
        {summaries.map((line, i) => (
          <span key={i} className="adaptation-toast-chip">
            {line}
          </span>
        ))}
      </div>
    </div>
  );
}
