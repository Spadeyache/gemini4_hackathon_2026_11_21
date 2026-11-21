import { beforeAll, describe, expect, it } from "vitest";
import type { BoutiqueEvent, SessionConfig } from "@mybrand/shared";
import { loadSessionConfig } from "../boot";
import { WORKSPACE_ROOT } from "../env";
import { computeSignals, toModelSignalsPayload } from "./signals";

let config: SessionConfig;

beforeAll(async () => {
  const loaded = await loadSessionConfig(WORKSPACE_ROOT, "demo-brand");
  if (!loaded) throw new Error("demo-brand fixture missing");
  config = loaded;
});

describe("computeSignals (§5)", () => {
  it("computes closed + open zone dwell_s, quick_exits (<=3s), and current_zone", () => {
    const events: BoutiqueEvent[] = [
      { t: 0, type: "enter_zone", zone: "zone_kiln" },
      { t: 2, type: "exit_zone", zone: "zone_kiln", ms: 2000 },
      { t: 4, type: "enter_zone", zone: "zone_gallery" },
      { t: 10, type: "exit_zone", zone: "zone_gallery", ms: 6000 },
      { t: 12, type: "enter_zone", zone: "zone_table" },
    ];

    const signals = computeSignals(events, config.catalog, 22);
    expect(signals.current_zone).toBe("zone_table");
    expect(signals.dwell_s.zone_kiln).toBe(2);
    expect(signals.dwell_s.zone_gallery).toBe(6);
    expect(signals.dwell_s.zone_table).toBe(10);
    expect(signals.quick_exits.zone_kiln).toBe(1);
    expect(signals.quick_exits.zone_gallery).toBeUndefined();
  });

  it("handles implicit zone switches and out-of-order event timestamps", () => {
    const events: BoutiqueEvent[] = [
      { t: 10, type: "enter_zone", zone: "zone_table" },
      { t: 0, type: "enter_zone", zone: "zone_kiln" },
      { t: 2.5, type: "enter_zone", zone: "zone_gallery" },
    ];

    const signals = computeSignals(events, config.catalog, 15);
    expect(signals.dwell_s.zone_kiln).toBe(2.5);
    expect(signals.quick_exits.zone_kiln).toBe(1);
    expect(signals.dwell_s.zone_gallery).toBe(7.5);
    expect(signals.quick_exits.zone_gallery).toBeUndefined();
    expect(signals.dwell_s.zone_table).toBe(5);
    expect(signals.current_zone).toBe("zone_table");
  });

  it("aggregates look_s, inspects, add_to_cart, and remove_from_cart by product and tag", () => {
    const events: BoutiqueEvent[] = [
      { t: 4, type: "look", zone: "zone_table", product_id: "p_ash_glaze_dripper", ms: 1800 },
      { t: 7, type: "look", zone: "zone_table", product_id: "p_ash_glaze_dripper", ms: 1600 },
      { t: 10, type: "inspect", zone: "zone_table", product_id: "p_ash_glaze_dripper" },
      { t: 12, type: "inspect", zone: "zone_table", product_id: "p_espresso_cup" },
      { t: 15, type: "add_to_cart", zone: "zone_table", product_id: "p_espresso_cup" },
      { t: 18, type: "remove_from_cart", zone: "zone_table", product_id: "p_espresso_cup" },
    ];

    const signals = computeSignals(events, config.catalog, 20);
    expect(signals.look_s.p_ash_glaze_dripper).toBe(3.4);
    expect(signals.inspects.p_ash_glaze_dripper).toBe(1);
    expect(signals.inspects.p_espresso_cup).toBe(1);
    expect(signals.inspects_by_tag.coffee).toBe(2);
    expect(signals.inspects_by_tag.stoneware).toBe(2);
    expect(signals.add_to_cart.p_espresso_cup).toBe(1);
    expect(signals.add_to_cart_by_tag.coffee).toBe(1);
    expect(signals.remove_from_cart.p_espresso_cup).toBe(1);
    expect(signals.remove_from_cart_by_tag.coffee).toBe(1);
  });

  it("caps recent_events to the last 20 sorted events", () => {
    const events: BoutiqueEvent[] = Array.from({ length: 28 }, (_, i) => ({
      t: i,
      type: "look" as const,
      zone: "zone_table",
      product_id: "p_espresso_cup",
      ms: 700,
    }));

    const signals = computeSignals(events, config.catalog, 30);
    expect(signals.recent_events).toHaveLength(20);
    expect(signals.recent_events[0].t).toBe(8);
    expect(signals.recent_events[19].t).toBe(27);

    const modelPayload = toModelSignalsPayload(signals);
    expect(modelPayload.recent_events).toHaveLength(20);
    expect("current_look_product_id" in modelPayload).toBe(false);
  });

  it("tracks current_look_product_id only during active gaze and clears on inspect/timeout/exit", () => {
    const lookEvents: BoutiqueEvent[] = [
      { t: 14, type: "look", zone: "zone_table", product_id: "p_espresso_cup", ms: 2000 },
    ];

    expect(
      computeSignals(lookEvents, config.catalog, 15).current_look_product_id
    ).toBe("p_espresso_cup");
    expect(
      computeSignals(lookEvents, config.catalog, 17).current_look_product_id
    ).toBe("p_espresso_cup");
    expect(
      computeSignals(lookEvents, config.catalog, 18.5).current_look_product_id
    ).toBeNull();

    const inspectedEvents: BoutiqueEvent[] = [
      ...lookEvents,
      { t: 16.5, type: "inspect", zone: "zone_table", product_id: "p_espresso_cup" },
    ];
    expect(
      computeSignals(inspectedEvents, config.catalog, 16.6).current_look_product_id
    ).toBeNull();
  });
});
