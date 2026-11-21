import { beforeAll, describe, expect, it } from "vitest";
import type { Op, SessionConfig } from "@mybrand/shared";
import { loadSessionConfig } from "../boot";
import { WORKSPACE_ROOT } from "../env";
import { computeSignals } from "./signals";
import { validateOps, type ValidationContext } from "./validator";

let config: SessionConfig;

beforeAll(async () => {
  const loaded = await loadSessionConfig(WORKSPACE_ROOT, "demo-brand");
  if (!loaded) throw new Error("demo-brand fixture missing");
  config = loaded;
});

function makeCtx(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    config,
    state: { ...config.base_state },
    signals: computeSignals([], config.catalog, 25),
    now_s: 25,
    appliedCount: 0,
    lastChangeAtS: null,
    leverLastChangedAtS: {},
    ...overrides,
  };
}

describe("validateOps", () => {
  it("1. accepts valid ops across all 7 lever types", () => {
    const ops: Op[] = [
      {
        op: "replace",
        path: "/hero_plinth/product_id",
        value: "p_ash_glaze_dripper",
        reason: "coffee interest",
      },
      {
        op: "replace",
        path: "/zones/zone_table/slots/s_table_1/product_id",
        value: "p_tableware_commission",
        reason: "comparing coffee pieces",
      },
      {
        op: "replace",
        path: "/zones/zone_gallery/lighting",
        value: "gallery_spot",
        reason: "lingering in gallery",
      },
    ];
    const res1 = validateOps(ops, makeCtx());
    expect(res1.accepted).toHaveLength(3);
    expect(res1.rejected).toHaveLength(0);

    const moreOps: Op[] = [
      {
        op: "replace",
        path: "/zones/zone_table/signage",
        value: "Built for Morning Coffee — wheel-thrown to hold heat",
        reason: "coffee focus",
      },
      {
        op: "replace",
        path: "/blurbs/p_ash_glaze_dripper",
        value: 1,
        reason: "sustained look",
      },
      {
        op: "replace",
        path: "/host_note",
        value: "The fluted dripper pairs cleanly with the speckled espresso cup.",
        reason: "highlight coffee pairing",
      },
    ];
    const res2 = validateOps(moreOps, makeCtx());
    expect(res2.accepted).toHaveLength(3);

    const guideRes = validateOps(
      [
        {
          op: "replace",
          path: "/guide_path/target_zone",
          value: "zone_table",
          reason: "point toward coffee table",
        },
      ],
      makeCtx()
    );
    expect(guideRes.accepted).toHaveLength(1);
  });

  it("2. rejects frozen and non-lever paths (prices, room, entrance)", () => {
    const res = validateOps(
      [
        {
          op: "replace",
          path: "/products/p_espresso_cup/price",
          value: "10.00",
          reason: "discount",
        },
        {
          op: "replace",
          path: "/room/size_m",
          value: "20",
          reason: "resize room",
        },
        {
          op: "replace",
          path: "/entrance/greeting",
          value: "Hi",
          reason: "change static greeting",
        },
      ],
      makeCtx()
    );
    expect(res.accepted).toHaveLength(0);
    expect(res.rejected).toHaveLength(3);
  });

  it("3. rejects cross-zone product placement in a zone slot", () => {
    const res = validateOps(
      [
        {
          op: "replace",
          path: "/zones/zone_table/slots/s_table_1/product_id",
          value: "p_basalt_vessel", // belongs to zone_gallery
          reason: "cross-zone swap",
        },
      ],
      makeCtx()
    );
    expect(res.accepted).toHaveLength(0);
    expect(res.rejected[0]?.reason).toContain("zone_gallery");
  });

  it("4. rejects unknown slot, unknown product, and unknown guide zone", () => {
    const res = validateOps(
      [
        {
          op: "replace",
          path: "/zones/zone_table/slots/s_missing/product_id",
          value: "p_tableware_commission",
          reason: "bad slot",
        },
        {
          op: "replace",
          path: "/hero_plinth/product_id",
          value: "p_does_not_exist",
          reason: "bad product",
        },
        {
          op: "replace",
          path: "/guide_path/target_zone",
          value: "zone_nowhere",
          reason: "bad zone",
        },
      ],
      makeCtx()
    );
    expect(res.accepted).toHaveLength(0);
    expect(res.rejected).toHaveLength(3);
  });

  it("5. rejects disallowed lighting preset not in variant_pools.lighting", () => {
    const res = validateOps(
      [
        {
          op: "replace",
          path: "/zones/zone_gallery/lighting",
          value: "neon_rave",
          reason: "invalid preset",
        },
      ],
      makeCtx()
    );
    expect(res.accepted).toHaveLength(0);
    expect(res.rejected[0]?.reason).toContain("variant_pools.lighting");
  });

  it("6. rejects signage longer than 60 chars or empty", () => {
    const res = validateOps(
      [
        {
          op: "replace",
          path: "/zones/zone_table/signage",
          value: "A".repeat(61),
          reason: "too long signage",
        },
        {
          op: "replace",
          path: "/zones/zone_table/signage",
          value: "   ",
          reason: "blank signage",
        },
      ],
      makeCtx()
    );
    expect(res.accepted).toHaveLength(0);
    expect(res.rejected).toHaveLength(2);
  });

  it("7. rejects host_note longer than 90 chars or empty", () => {
    const res = validateOps(
      [
        {
          op: "replace",
          path: "/host_note",
          value: "B".repeat(91),
          reason: "too long host note",
        },
        {
          op: "replace",
          path: "/host_note",
          value: "",
          reason: "empty host note",
        },
      ],
      makeCtx()
    );
    expect(res.accepted).toHaveLength(0);
    expect(res.rejected).toHaveLength(2);
  });

  it("8. rejects blurb values other than numeric 0 or 1", () => {
    const res = validateOps(
      [
        {
          op: "replace",
          path: "/blurbs/p_ash_glaze_dripper",
          value: "1" as unknown as 1,
          reason: "string instead of number",
        },
        {
          op: "replace",
          path: "/blurbs/p_ash_glaze_dripper",
          value: 2 as unknown as 1,
          reason: "out of range index",
        },
      ],
      makeCtx()
    );
    expect(res.accepted).toHaveLength(0);
    expect(res.rejected).toHaveLength(2);
  });

  it("9. rejects no-op changes and duplicate paths within the same batch", () => {
    const res = validateOps(
      [
        {
          op: "replace",
          path: "/zones/zone_gallery/lighting",
          value: "warm_clay", // already warm_clay in base_state
          reason: "no-op",
        },
        {
          op: "replace",
          path: "/zones/zone_gallery/lighting",
          value: "gallery_spot",
          reason: "first valid change",
        },
        {
          op: "replace",
          path: "/zones/zone_gallery/lighting",
          value: "studio_daylight",
          reason: "duplicate path in batch",
        },
      ],
      makeCtx()
    );
    expect(res.accepted).toHaveLength(1);
    expect(res.accepted[0]?.value).toBe("gallery_spot");
    expect(res.rejected).toHaveLength(2);
  });

  it("10. blocks swapping out a currently-looked-at product while allowing blurb flips", () => {
    const signals = computeSignals(
      [
        {
          t: 23,
          type: "look",
          zone: "zone_table",
          product_id: "p_ash_glaze_dripper",
          ms: 2500,
        },
      ],
      config.catalog,
      25
    );

    const res = validateOps(
      [
        {
          op: "replace",
          path: "/zones/zone_table/slots/s_table_2/product_id",
          value: "p_tableware_commission",
          reason: "swap active gaze product",
        },
        {
          op: "replace",
          path: "/blurbs/p_ash_glaze_dripper",
          value: 1,
          reason: "flip blurb while looking",
        },
      ],
      makeCtx({ signals, now_s: 25 })
    );
    expect(res.accepted).toHaveLength(1);
    expect(res.accepted[0]?.path).toBe("/blurbs/p_ash_glaze_dripper");
    expect(res.rejected[0]?.reason).toContain("currently-looked-at");
  });

  it("11. enforces first_change_after_s (12s)", () => {
    const res = validateOps(
      [
        {
          op: "replace",
          path: "/zones/zone_gallery/lighting",
          value: "gallery_spot",
          reason: "too early",
        },
      ],
      makeCtx({ now_s: 11.9 })
    );
    expect(res.accepted).toHaveLength(0);
    expect(res.rejected[0]?.reason).toContain("first_change_after_s");
  });

  it("12. enforces cooldown_s (8s) between changes", () => {
    const res = validateOps(
      [
        {
          op: "replace",
          path: "/zones/zone_gallery/lighting",
          value: "gallery_spot",
          reason: "during cooldown",
        },
      ],
      makeCtx({ now_s: 27, lastChangeAtS: 20 })
    );
    expect(res.accepted).toHaveLength(0);
    expect(res.rejected[0]?.reason).toContain("cooldown_s");

    const allowed = validateOps(
      [
        {
          op: "replace",
          path: "/zones/zone_gallery/lighting",
          value: "gallery_spot",
          reason: "after cooldown",
        },
      ],
      makeCtx({ now_s: 28, lastChangeAtS: 20 })
    );
    expect(allowed.accepted).toHaveLength(1);
  });

  it("13. enforces max_ops_per_change (3)", () => {
    const res = validateOps(
      [
        {
          op: "replace",
          path: "/hero_plinth/product_id",
          value: "p_ash_glaze_dripper",
          reason: "op 1",
        },
        {
          op: "replace",
          path: "/zones/zone_gallery/lighting",
          value: "gallery_spot",
          reason: "op 2",
        },
        {
          op: "replace",
          path: "/blurbs/p_ash_glaze_dripper",
          value: 1,
          reason: "op 3",
        },
        {
          op: "replace",
          path: "/guide_path/target_zone",
          value: "zone_table",
          reason: "op 4 exceeds cap",
        },
      ],
      makeCtx()
    );
    expect(res.accepted).toHaveLength(3);
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0]?.reason).toContain("max_ops_per_change");
  });

  it("14. enforces max_ops_per_session (15)", () => {
    const atLimit = validateOps(
      [
        {
          op: "replace",
          path: "/zones/zone_gallery/lighting",
          value: "gallery_spot",
          reason: "at cap",
        },
      ],
      makeCtx({ appliedCount: 15 })
    );
    expect(atLimit.accepted).toHaveLength(0);
    expect(atLimit.rejected[0]?.reason).toContain("max_ops_per_session");

    const oneRemaining = validateOps(
      [
        {
          op: "replace",
          path: "/zones/zone_gallery/lighting",
          value: "gallery_spot",
          reason: "last allowed op",
        },
        {
          op: "replace",
          path: "/guide_path/target_zone",
          value: "zone_table",
          reason: "overflow op",
        },
      ],
      makeCtx({ appliedCount: 14 })
    );
    expect(oneRemaining.accepted).toHaveLength(1);
    expect(oneRemaining.rejected).toHaveLength(1);
  });

  it("15. enforces lever_min_interval_s (20s) per lever while permitting other levers", () => {
    const res = validateOps(
      [
        {
          op: "replace",
          path: "/zones/zone_gallery/lighting",
          value: "gallery_spot",
          reason: "same lever too soon",
        },
        {
          op: "replace",
          path: "/guide_path/target_zone",
          value: "zone_table",
          reason: "different lever allowed",
        },
      ],
      makeCtx({
        now_s: 35,
        lastChangeAtS: 20,
        leverLastChangedAtS: { "/zones/zone_gallery/lighting": 20 },
      })
    );
    expect(res.accepted).toHaveLength(1);
    expect(res.accepted[0]?.path).toBe("/guide_path/target_zone");
    expect(res.rejected[0]?.reason).toContain("lever_min_interval_s");
  });
});
