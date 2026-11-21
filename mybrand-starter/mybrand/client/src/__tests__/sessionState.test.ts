import fs from "node:fs";
import path from "node:path";
import {
  ProductsSchema,
  SessionConfigSchema,
  WorldSpecSchema,
} from "@mybrand/shared";
import { describe, expect, it } from "vitest";
import { parseSseFrame } from "../api/boutiqueApi";
import {
  applyOpsToState,
  buildInitialSessionState,
  getGuideTargetZone,
  getHeroProductId,
  getHostNote,
  getProductBlurbIndex,
  getSlotProductId,
  getZoneLightingId,
  getZoneSignage,
  parseManualOpInput,
} from "../state/sessionState";

function loadFixtures() {
  const root = path.resolve(process.cwd(), "fixtures/demo-brand");
  const worldSpec = WorldSpecSchema.parse(
    JSON.parse(fs.readFileSync(path.join(root, "world_spec.json"), "utf-8"))
  );
  const products = ProductsSchema.parse(
    JSON.parse(fs.readFileSync(path.join(root, "products.json"), "utf-8"))
  );
  const sessionConfig = SessionConfigSchema.parse(
    JSON.parse(fs.readFileSync(path.join(root, "session_config.json"), "utf-8"))
  );
  return { worldSpec, products, sessionConfig };
}

describe("sessionState & applyOpsToState", () => {
  const { worldSpec, products, sessionConfig } = loadFixtures();
  const baseState = buildInitialSessionState(worldSpec, sessionConfig.base_state);

  it("applies all 7 §5 lever ops cleanly", () => {
    const ops = [
      {
        op: "replace" as const,
        path: "/hero_plinth/product_id",
        value: "p_ash_glaze_dripper",
        reason: "promote coffee dripper on hero plinth",
      },
      {
        op: "replace" as const,
        path: "/zones/zone_table/slots/s_table_1/product_id",
        value: "p_tableware_commission",
        reason: "surface bespoke table set in coffee zone",
      },
      {
        op: "replace" as const,
        path: "/zones/zone_gallery/lighting",
        value: "gallery_spot",
        reason: "shift gallery to focused spotlight",
      },
      {
        op: "replace" as const,
        path: "/zones/zone_table/signage",
        value: "Built for Morning Coffee — wheel-thrown to hold heat",
        reason: "highlight morning coffee angle",
      },
      {
        op: "replace" as const,
        path: "/blurbs/p_ash_glaze_dripper",
        value: 1 as const,
        reason: "flip dripper blurb to brewing fit",
      },
      {
        op: "replace" as const,
        path: "/host_note",
        value: "Pulled the pour-over set front and center for you.",
        reason: "explain change in host voice",
      },
      {
        op: "replace" as const,
        path: "/guide_path/target_zone",
        value: "zone_table",
        reason: "point path toward daily coffee zone",
      },
    ];

    const result = applyOpsToState(
      baseState,
      ops,
      { worldSpec, products },
      { source: "model", latency_ms: 420, now_s: 25.5 }
    );

    expect(result.rejected).toHaveLength(0);
    expect(result.applied).toHaveLength(7);
    expect(getHeroProductId(result.nextState, worldSpec)).toBe("p_ash_glaze_dripper");
    expect(
      getSlotProductId(result.nextState, "zone_table", "s_table_1", "p_espresso_cup")
    ).toBe("p_tableware_commission");
    expect(getZoneLightingId(result.nextState, "zone_gallery", "warm_clay")).toBe(
      "gallery_spot"
    );
    expect(getZoneSignage(result.nextState, "zone_table", "")).toBe(
      "Built for Morning Coffee — wheel-thrown to hold heat"
    );
    expect(
      getProductBlurbIndex(result.nextState, "p_ash_glaze_dripper", worldSpec)
    ).toBe(1);
    expect(getHostNote(result.nextState, worldSpec)).toBe(
      "Pulled the pour-over set front and center for you."
    );
    expect(getGuideTargetZone(result.nextState, worldSpec)).toBe("zone_table");
    expect(result.applied[0].source).toBe("model");
    expect(result.applied[0].latency_ms).toBe(420);
  });

  it("rejects invalid paths, cross-zone slot assignments, and length violations", () => {
    const badOps = [
      {
        op: "replace",
        path: "/products/p_espresso_cup/price",
        value: "1.00",
        reason: "frozen price",
      },
      {
        op: "replace",
        path: "/zones/zone_table/slots/s_table_1/product_id",
        value: "p_basalt_vessel", // belongs to zone_gallery, not zone_table
        reason: "wrong zone",
      },
      {
        op: "replace",
        path: "/zones/zone_gallery/lighting",
        value: "neon_rave",
        reason: "unknown lighting preset",
      },
      {
        op: "replace",
        path: "/zones/zone_table/signage",
        value: "x".repeat(65),
        reason: "signage too long",
      },
      {
        op: "replace",
        path: "/host_note",
        value: "y".repeat(95),
        reason: "host note too long",
      },
      {
        op: "replace",
        path: "/blurbs/p_espresso_cup",
        value: 2,
        reason: "blurb out of range",
      },
    ];

    const result = applyOpsToState(
      baseState,
      badOps,
      { worldSpec, products },
      { source: "manual", latency_ms: 0 }
    );

    expect(result.applied).toHaveLength(0);
    expect(result.rejected).toHaveLength(6);
    expect(result.nextState).toEqual(baseState);
  });

  it("parses manual op JSON in single, array, and envelope formats", () => {
    const single = parseManualOpInput(
      JSON.stringify({
        op: "replace",
        path: "/guide_path/target_zone",
        value: "zone_gallery",
        reason: "single op test",
      })
    );
    expect(single.ops).toHaveLength(1);

    const envelope = parseManualOpInput(
      JSON.stringify({
        ops: [
          {
            op: "replace",
            path: "/host_note",
            value: "Try the woodblock prints on the right wall.",
            reason: "envelope test",
          },
        ],
        visitor_read: "print collector",
        confidence: 0.78,
      })
    );
    expect(envelope.ops).toHaveLength(1);
    expect(envelope.visitor_read).toBe("print collector");
    expect(envelope.confidence).toBe(0.78);
  });

  it("parses agreed M1<->M2 SSE connected and ops frames", () => {
    const connected = parseSseFrame(
      JSON.stringify({ type: "connected", sessionId: "sess_123" })
    );
    expect(connected).toEqual({ type: "connected", sessionId: "sess_123" });

    const opsFrame = parseSseFrame(
      JSON.stringify({
        type: "ops",
        ops: [
          {
            op: "replace",
            path: "/zones/zone_gallery/lighting",
            value: "gallery_spot",
            reason: "lingering in gallery",
            source: "rules",
            latency_ms: 4,
          },
        ],
        visitor_read: "collector examining gallery",
        confidence: 0.82,
        source: "rules",
        latency_ms: 4,
        now_s: 22.1,
      })
    );
    expect(opsFrame?.type).toBe("ops");
    if (opsFrame && opsFrame.type === "ops") {
      expect(opsFrame.ops).toHaveLength(1);
      expect(opsFrame.ops[0].source).toBe("rules");
      expect(opsFrame.ops[0].latency_ms).toBe(4);
      expect(opsFrame.visitor_read).toBe("collector examining gallery");
    }
  });
});
