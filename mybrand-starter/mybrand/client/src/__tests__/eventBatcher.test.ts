import type { BoutiqueEvent } from "@mybrand/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBatcher } from "../api/eventBatcher";

describe("EventBatcher", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("batches events and sends them on a 1-second interval without sending empty batches", async () => {
    vi.useFakeTimers();
    const sentBatches: BoutiqueEvent[][] = [];
    const batcher = new EventBatcher({
      intervalMs: 1000,
      sender: async (events) => {
        sentBatches.push(events);
      },
    });

    batcher.start();

    // First second with no events: should not invoke sender
    await vi.advanceTimersByTimeAsync(1000);
    expect(sentBatches).toHaveLength(0);

    batcher.enqueue({ t: 1.2, type: "enter_zone", zone: "zone_kiln" });
    batcher.enqueue({
      t: 1.9,
      type: "look",
      zone: "zone_kiln",
      product_id: "p_glaze_swatch_zine",
      ms: 700,
    });
    expect(batcher.getPendingCount()).toBe(2);

    await vi.advanceTimersByTimeAsync(1000);
    expect(sentBatches).toHaveLength(1);
    expect(sentBatches[0]).toHaveLength(2);
    expect(batcher.getPendingCount()).toBe(0);

    // Next interval with no new events should remain quiet
    await vi.advanceTimersByTimeAsync(1000);
    expect(sentBatches).toHaveLength(1);

    batcher.stop();
  });

  it("flushes immediately when requested for high-intent events", async () => {
    const sentBatches: BoutiqueEvent[][] = [];
    const batcher = new EventBatcher({
      sender: async (events) => {
        sentBatches.push(events);
      },
    });

    batcher.enqueue(
      {
        t: 5.4,
        type: "inspect",
        zone: "zone_table",
        product_id: "p_espresso_cup",
      },
      true
    );

    await Promise.resolve();
    expect(sentBatches).toHaveLength(1);
    expect(sentBatches[0][0].type).toBe("inspect");
  });

  it("handles offline fallback (no sender) cleanly while keeping recent event history", async () => {
    const batcher = new EventBatcher({ sender: null });
    batcher.enqueue({ t: 2.0, type: "enter_zone", zone: "zone_gallery" });
    const count = await batcher.flush();
    expect(count).toBe(1);
    expect(batcher.getPendingCount()).toBe(0);
    expect(batcher.getRecentEvents()).toHaveLength(1);
  });
});
