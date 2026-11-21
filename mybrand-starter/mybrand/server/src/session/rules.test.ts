import { beforeAll, describe, expect, it } from "vitest";
import type { BoutiqueEvent, SessionConfig, SessionState } from "@mybrand/shared";
import { loadSessionConfig } from "../boot";
import { WORKSPACE_ROOT } from "../env";
import { evaluateRules, evaluateWhen, resolveRuleValue, type RuleEvalContext } from "./rules";
import { computeSignals } from "./signals";
import type { AppliedOp } from "./types";

let config: SessionConfig;

beforeAll(async () => {
  const loaded = await loadSessionConfig(WORKSPACE_ROOT, "demo-brand");
  if (!loaded) throw new Error("demo-brand fixture missing");
  config = loaded;
});

function makeRuleCtx(
  events: BoutiqueEvent[],
  nowS: number,
  overrides: Partial<RuleEvalContext> = {}
): RuleEvalContext {
  return {
    config,
    state: { ...config.base_state },
    signals: computeSignals(events, config.catalog, nowS),
    applied: [],
    now_s: nowS,
    lastChangeAtS: null,
    leverLastChangedAtS: {},
    ...overrides,
  };
}

describe("rules engine — all 6 demo-brand fixture rules", () => {
  it("r1: promotes top unfeatured coffee product in zone_table after 2 coffee inspects", () => {
    const events: BoutiqueEvent[] = [
      { t: 2, type: "enter_zone", zone: "zone_table" },
      { t: 10, type: "inspect", zone: "zone_table", product_id: "p_ash_glaze_dripper" },
      { t: 16, type: "inspect", zone: "zone_table", product_id: "p_espresso_cup" },
    ];
    const match = evaluateRules(makeRuleCtx(events, 16));
    expect(match?.rule.id).toBe("r1");
    expect(match?.op).toEqual({
      op: "replace",
      path: "/zones/zone_table/slots/s_table_1/product_id",
      value: "p_tableware_commission",
      reason: "comparing coffee stoneware in daily table zone",
    });
  });

  it("r2: promotes top unfeatured print in zone_gallery after 2 print inspects", () => {
    const events: BoutiqueEvent[] = [
      { t: 5, type: "enter_zone", zone: "zone_gallery" },
      { t: 12, type: "inspect", zone: "zone_gallery", product_id: "p_kiln_postcard_set" },
      { t: 18, type: "inspect", zone: "zone_gallery", product_id: "p_kiln_postcard_set" },
    ];
    const match = evaluateRules(makeRuleCtx(events, 18));
    expect(match?.rule.id).toBe("r2");
    expect(match?.op).toEqual({
      op: "replace",
      path: "/zones/zone_gallery/slots/s_gallery_1/product_id",
      value: "p_woodblock_kiln_print",
      reason: "comparing woodblock kiln prints in gallery zone",
    });
  });

  it("r3: puts a coffee complement (different tier, ignoring boilerplate tags) on hero_plinth after add_to_cart(p_espresso_cup)", () => {
    const events: BoutiqueEvent[] = [
      { t: 4, type: "enter_zone", zone: "zone_table" },
      { t: 10, type: "inspect", zone: "zone_table", product_id: "p_ash_glaze_dripper" },
      { t: 15, type: "add_to_cart", zone: "zone_table", product_id: "p_espresso_cup" },
    ];
    const match = evaluateRules(makeRuleCtx(events, 15));
    expect(match?.rule.id).toBe("r3");
    expect(match?.op.path).toBe("/hero_plinth/product_id");
    expect(match?.op.value).toBe("p_ash_glaze_dripper");
  });

  it("r4: switches zone_gallery lighting to gallery_spot after 10s dwell in zone_gallery", () => {
    const events: BoutiqueEvent[] = [
      { t: 4, type: "enter_zone", zone: "zone_gallery" },
    ];
    const match = evaluateRules(makeRuleCtx(events, 15));
    expect(match?.rule.id).toBe("r4");
    expect(match?.op).toEqual({
      op: "replace",
      path: "/zones/zone_gallery/lighting",
      value: "gallery_spot",
      reason: "lingering in gallery; shift lighting to focused gallery spotlight",
    });
  });

  it("r5: flips p_ash_glaze_dripper blurb to 1 after >=3s look_s", () => {
    const events: BoutiqueEvent[] = [
      { t: 4, type: "enter_zone", zone: "zone_table" },
      { t: 8, type: "look", zone: "zone_table", product_id: "p_ash_glaze_dripper", ms: 3400 },
    ];
    const match = evaluateRules(makeRuleCtx(events, 14));
    expect(match?.rule.id).toBe("r5");
    expect(match?.op).toEqual({
      op: "replace",
      path: "/blurbs/p_ash_glaze_dripper",
      value: 1,
      reason: "sustained look at dripper; flip blurb to practical brewing fit",
    });
  });

  it("r6: points guide_path toward top_zone(dwell_s) after quick_exits(zone_kiln) >= 1", () => {
    const events: BoutiqueEvent[] = [
      { t: 0, type: "enter_zone", zone: "zone_kiln" },
      { t: 2, type: "exit_zone", zone: "zone_kiln", ms: 2000 },
      { t: 4, type: "enter_zone", zone: "zone_table" },
    ];
    const match = evaluateRules(makeRuleCtx(events, 14));
    expect(match?.rule.id).toBe("r6");
    expect(match?.op).toEqual({
      op: "replace",
      path: "/guide_path/target_zone",
      value: "zone_table",
      reason: "skimmed kiln bench quickly; point guide path toward highest-dwell zone",
    });
  });
});

describe("rules engine — parser, resolvers, priority fall-through & demo personas", () => {
  it("resolves pool(lighting) and pool(signage) to next unused pool item", () => {
    const ctx = makeRuleCtx([], 20);
    expect(
      resolveRuleValue("pool(lighting)", "/zones/zone_gallery/lighting", ctx)
    ).toBe("studio_daylight");

    const withApplied = makeRuleCtx([], 45, {
      state: { ...config.base_state, "/zones/zone_gallery/lighting": "studio_daylight" },
      applied: [
        {
          op: {
            op: "replace",
            path: "/zones/zone_gallery/lighting",
            value: "studio_daylight",
            reason: "prior",
          },
          applied_at_s: 20,
          source: "rules",
          latency_ms: 1,
        },
      ],
    });
    expect(
      resolveRuleValue(
        "pool(lighting)",
        "/zones/zone_gallery/lighting",
        withApplied
      )
    ).toBe("gallery_spot");

    expect(
      resolveRuleValue("pool(signage)", "/zones/zone_table/signage", ctx)
    ).toBe("Built for Morning Coffee — wheel-thrown to hold heat");
  });

  it("fails closed on malformed or unknown when clauses", () => {
    const signals = computeSignals([], config.catalog, 20);
    expect(evaluateWhen("", signals)).toBe(false);
    expect(evaluateWhen("unknown_signal(zone_table) >= 0", signals)).toBe(false);
    expect(evaluateWhen("nonsense syntax", signals)).toBe(false);
  });

  it("falls through to lower-priority firing rule when higher-priority rule is already applied", () => {
    const events: BoutiqueEvent[] = [
      { t: 0, type: "enter_zone", zone: "zone_kiln" },
      { t: 2, type: "exit_zone", zone: "zone_kiln", ms: 2000 },
      { t: 4, type: "enter_zone", zone: "zone_table" },
      { t: 10, type: "inspect", zone: "zone_table", product_id: "p_ash_glaze_dripper" },
      { t: 15, type: "inspect", zone: "zone_table", product_id: "p_espresso_cup" },
      { t: 31, type: "add_to_cart", zone: "zone_table", product_id: "p_espresso_cup" },
    ];
    // r1 already applied s_table_1 -> p_tableware_commission at t=15; at t=31 r3 must fire
    const match = evaluateRules(
      makeRuleCtx(events, 31, {
        state: {
          ...config.base_state,
          "/zones/zone_table/slots/s_table_1/product_id": "p_tableware_commission",
        },
        lastChangeAtS: 15,
        leverLastChangedAtS: {
          "/zones/zone_table/slots/s_table_1/product_id": 15,
        },
      })
    );
    expect(match?.rule.id).toBe("r3");
    expect(match?.op.path).toBe("/hero_plinth/product_id");
  });

  it("diverges the two fixture demo_personas in >=3 visible ways within 60s under rules", () => {
    function simulatePersona(events: BoutiqueEvent[]): SessionState {
      const state: SessionState = { ...config.base_state };
      const applied: AppliedOp[] = [];
      let lastChangeAtS: number | null = null;
      const leverLastChangedAtS: Record<string, number> = {};

      for (let t = 12; t <= 60; t += 1) {
        const upToNow = events.filter((e) => e.t <= t);
        const signals = computeSignals(upToNow, config.catalog, t);
        const match = evaluateRules({
          config,
          state,
          signals,
          applied,
          now_s: t,
          lastChangeAtS,
          leverLastChangedAtS,
        });
        if (match) {
          state[match.op.path] = match.op.value;
          applied.push({
            op: match.op,
            applied_at_s: t,
            source: "rules",
            latency_ms: 0,
          });
          lastChangeAtS = t;
          leverLastChangedAtS[match.op.path] = t;
        }
      }
      return state;
    }

    const coffeeState = simulatePersona(config.demo_personas[0].events);
    const collectorState = simulatePersona(config.demo_personas[1].events);

    expect(coffeeState["/guide_path/target_zone"]).toBe("zone_table");
    expect(coffeeState["/blurbs/p_ash_glaze_dripper"]).toBe(1);
    expect(coffeeState["/zones/zone_table/slots/s_table_1/product_id"]).toBe(
      "p_tableware_commission"
    );
    expect(coffeeState["/hero_plinth/product_id"]).toBe("p_ash_glaze_dripper");

    expect(collectorState["/zones/zone_gallery/lighting"]).toBe("gallery_spot");
    expect(collectorState["/zones/zone_gallery/slots/s_gallery_1/product_id"]).toBe(
      "p_woodblock_kiln_print"
    );

    const diffCount = Object.keys(config.base_state).filter(
      (k) => coffeeState[k] !== collectorState[k]
    ).length;
    expect(diffCount).toBeGreaterThanOrEqual(5);
  });
});
