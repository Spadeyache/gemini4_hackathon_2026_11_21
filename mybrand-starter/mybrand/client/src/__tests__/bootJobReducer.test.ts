import { describe, expect, it } from "vitest";
import { parseBootSseFrame, type BootJobSnapshot } from "../api/hostApi";
import {
  bootJobReducer,
  createInitialBootWorkspaceState,
  formatElapsedClock,
  formatPhaseLabel,
} from "../state/bootJobReducer";

function makeSnapshot(overrides: Partial<BootJobSnapshot> = {}): BootJobSnapshot {
  return {
    bootId: "boot_harbor_01",
    status: "running",
    phase: "brand_core",
    messages: [
      {
        id: "m1",
        role: "assistant",
        text: "Quick questions before I lock your catalog.",
        timestamp: "2026-11-21T20:00:00Z",
      },
    ],
    pendingQuestion: null,
    activities: [
      {
        id: "a1",
        kind: "tool_call",
        label: "read_inputs",
        timestamp: "2026-11-21T20:00:00Z",
      },
    ],
    assets: [],
    artifacts: [],
    brandRead: null,
    readyToOpen: false,
    ...overrides,
  };
}

describe("parseBootSseFrame", () => {
  it("parses all 8 agreed M3 SSE frame types", () => {
    const samples = [
      { type: "snapshot", job: makeSnapshot() },
      { type: "heartbeat", elapsed_s: 42.3, phase: "world_spec" },
      {
        type: "activity",
        activity: {
          id: "a2",
          kind: "tool_call",
          label: "generate_image",
          detail: "Ocean horizon backdrop",
          timestamp: "2026-11-21T20:01:00Z",
        },
      },
      {
        type: "message",
        message: {
          id: "m2",
          role: "host",
          text: "Print on demand works, you decide prices, yes to my face.",
          timestamp: "2026-11-21T20:01:05Z",
        },
      },
      {
        type: "question",
        pendingQuestion: {
          id: "q1",
          kind: "ask_host",
          message: "How will physical goods be fulfilled?",
          options: ["Own stock", "Print-on-demand", "Digital/services only"],
        },
      },
      {
        type: "asset",
        asset: {
          asset_id: "asset_wall_ocean",
          url: "/data/boot_harbor_01/assets/asset_wall_ocean.png",
          prompt: "Panoramic sunlit coastal pier",
          model: "gemini-nano-banana-2.1",
          kind: "texture",
        },
      },
      {
        type: "artifact",
        name: "world_spec",
        artifacts: ["brand_core", "products", "world_spec"],
        readyToOpen: false,
      },
      {
        type: "status",
        status: "completed",
        phase: "handoff",
        readyToOpen: true,
      },
    ];

    for (const sample of samples) {
      const parsed = parseBootSseFrame(JSON.stringify(sample));
      expect(parsed).not.toBeNull();
      expect(parsed?.type).toBe(sample.type);
    }
  });

  it("returns null on invalid JSON or unknown frame types", () => {
    expect(parseBootSseFrame("not json")).toBeNull();
    expect(parseBootSseFrame(JSON.stringify({ type: "unknown" }))).toBeNull();
    expect(parseBootSseFrame(JSON.stringify({ type: "heartbeat" }))).toBeNull();
  });
});

describe("bootJobReducer", () => {
  it("hydrates snapshots, streams messages/questions/assets/artifacts, and deduplicates on reconnect", () => {
    let state = createInitialBootWorkspaceState("boot_harbor_01");

    // 1. Initial snapshot
    state = bootJobReducer(state, {
      type: "sse_frame",
      frame: { type: "snapshot", job: makeSnapshot() },
      nowMs: 1000,
    });
    expect(state.hydrated).toBe(true);
    expect(state.messages).toHaveLength(1);
    expect(state.activities).toHaveLength(1);

    // 2. Heartbeat & local tick
    state = bootJobReducer(state, {
      type: "sse_frame",
      frame: { type: "heartbeat", elapsed_s: 15, phase: "intake" },
      nowMs: 2000,
    });
    expect(state.elapsedSeconds).toBe(15);
    state = bootJobReducer(state, { type: "local_tick", nowMs: 3000 });
    expect(state.elapsedSeconds).toBe(16);

    // 3. Question pauses job (local_tick should not advance while waiting_host)
    state = bootJobReducer(state, {
      type: "sse_frame",
      frame: {
        type: "question",
        pendingQuestion: {
          id: "q1",
          kind: "ask_host",
          message: "Price range?",
          options: ["You decide", "$20-$150"],
        },
      },
      nowMs: 4000,
    });
    expect(state.status).toBe("waiting_host");
    expect(state.pendingQuestion?.options).toEqual(["You decide", "$20-$150"]);
    state = bootJobReducer(state, { type: "local_tick", nowMs: 5000 });
    expect(state.elapsedSeconds).toBe(16);

    // 4. Optimistic host reply clears question and returns to running
    state = bootJobReducer(state, {
      type: "optimistic_host_reply",
      text: "You decide",
      nowMs: 6000,
    });
    expect(state.status).toBe("running");
    expect(state.pendingQuestion).toBeNull();

    // 5. Duplicate message / asset frames deduplicate cleanly
    const assetFrame = {
      type: "asset" as const,
      asset: {
        asset_id: "asset_hero_print",
        url: "/data/boot_harbor_01/assets/asset_hero_print.png",
        prompt: "Editorial studio print",
        model: "gemini-nano-banana-2.1",
        kind: "product_image",
      },
    };
    state = bootJobReducer(state, { type: "sse_frame", frame: assetFrame });
    state = bootJobReducer(state, { type: "sse_frame", frame: assetFrame });
    expect(state.assets).toHaveLength(1);

    // 6. Shopify prompt + skip
    state = bootJobReducer(state, {
      type: "sse_frame",
      frame: {
        type: "question",
        pendingQuestion: {
          id: "q_shop",
          kind: "request_shopify_connection",
          message: "Connect Shopify to draft products.",
          scopes: ["read_products", "write_products"],
        },
      },
    });
    expect(state.status).toBe("waiting_shopify");
    state = bootJobReducer(state, { type: "optimistic_shopify_skip" });
    expect(state.status).toBe("running");
    expect(state.pendingQuestion).toBeNull();

    // 7. Artifact completion flips readyToOpen
    state = bootJobReducer(state, {
      type: "sse_frame",
      frame: {
        type: "artifact",
        name: "session_config",
        artifacts: [
          "brand_core",
          "products",
          "world_spec",
          "adaptation_policy",
          "demo_personas",
          "session_config",
        ],
        readyToOpen: true,
      },
    });
    expect(state.readyToOpen).toBe(true);
    expect(state.artifacts).toHaveLength(6);

    // 8. Final status
    state = bootJobReducer(state, {
      type: "sse_frame",
      frame: {
        type: "status",
        status: "completed",
        phase: "handoff",
        readyToOpen: true,
      },
    });
    expect(state.status).toBe("completed");
    expect(state.error).toBeNull();
  });

  it("formats elapsed clocks and phase labels cleanly", () => {
    expect(formatElapsedClock(0)).toBe("00:00");
    expect(formatElapsedClock(125)).toBe("02:05");
    expect(formatPhaseLabel("brand_core")).toBe("Phase 1 · Brand Core");
    expect(formatPhaseLabel("world_spec")).toBe("Phase 3 · 3D World & Images");
    expect(formatPhaseLabel("Custom Phase")).toBe("Custom Phase");
  });
});
