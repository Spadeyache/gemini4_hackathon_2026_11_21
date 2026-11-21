import fs from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_ROOT } from "../env";
import {
  clearSessionAdapterPromptCache,
  createHydrogenClient,
  getSessionAdapterPromptPath,
  loadSessionAdapterPrompt,
} from "./hydrogen";
import { SessionManager } from "./manager";
import type {
  AdapterCallResult,
  SessionAdapterClient,
  SessionAdapterInput,
} from "./types";

const managersToClean: SessionManager[] = [];

function createTestManager(
  options: Partial<ConstructorParameters<typeof SessionManager>[0]> = {}
): SessionManager {
  const manager = new SessionManager({
    workspaceRoot: WORKSPACE_ROOT,
    tickIntervalMs: 0,
    idleSweepIntervalMs: 0,
    logger: () => {},
    ...options,
  });
  managersToClean.push(manager);
  return manager;
}

afterEach(() => {
  while (managersToClean.length > 0) {
    managersToClean.pop()?.destroy();
  }
});

describe("SessionManager & Hydrogen runtime integration", () => {
  it("loads prompts/session_adapter.md directly from disk at runtime", async () => {
    clearSessionAdapterPromptCache();
    const diskContent = await fs.readFile(
      getSessionAdapterPromptPath(WORKSPACE_ROOT),
      "utf-8"
    );
    const loaded = await loadSessionAdapterPrompt(WORKSPACE_ROOT);
    expect(loaded).toBe(diskContent);
    expect(loaded).toContain("gemini-4-hydrogen");
  });

  it("reports unavailable gracefully when GEMINI_API_KEY is missing", async () => {
    const client = createHydrogenClient({ workspaceRoot: WORKSPACE_ROOT });
    expect(client.isAvailable()).toBe(false);
    const result = await client.propose(
      {} as SessionAdapterInput,
      2500
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.timedOut).toBe(false);
      expect(result.error).toContain("GEMINI_API_KEY");
    }
  });

  it("applies validated model ops with source='model' and updates in-memory session state", async () => {
    let nowMs = 1_000_000;
    const propose = vi.fn<SessionAdapterClient["propose"]>(
      async (input): Promise<AdapterCallResult> => {
        expect(input.brand_card).toContain("Kestrel & Clay");
        expect(input.now_s).toBe(16);
        return {
          ok: true,
          latency_ms: 412,
          output: {
            ops: [
              {
                op: "replace",
                path: "/zones/zone_gallery/lighting",
                value: "gallery_spot",
                reason: "12s dwell in gallery",
              },
              {
                op: "replace",
                path: "/host_note",
                value: "Brought the gallery spot up so you can see the woodblock grain.",
                reason: "explain lighting shift",
              },
            ],
            visitor_read: "collector studying prints",
            confidence: 0.82,
          },
        };
      }
    );
    const mockClient: SessionAdapterClient = {
      isAvailable: () => true,
      propose,
    };

    const manager = createTestManager({
      adapterClient: mockClient,
      clock: () => nowMs,
    });
    const created = await manager.createSession("demo-brand");
    expect(created).not.toBeNull();

    manager.ingestEvents(created!.sessionId, [
      { t: 4, type: "enter_zone", zone: "zone_gallery" },
    ]);

    nowMs += 16_000;
    const emitted = await manager.tickSession(created!.sessionId);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.source).toBe("model");
    expect(emitted[0]?.latency_ms).toBe(412);
    expect(emitted[0]?.ops).toHaveLength(2);
    expect(emitted[0]?.ops[0]?.source).toBe("model");

    const session = manager.getSession(created!.sessionId);
    expect(session?.state["/zones/zone_gallery/lighting"]).toBe("gallery_spot");
    expect(session?.applied).toHaveLength(2);
  });

  it("falls back to rules on model timeout, model error, missing API key, or empty ops while rule fires", async () => {
    const modes: Array<{ label: string; client: SessionAdapterClient }> = [
      {
        label: "missing API key",
        client: {
          isAvailable: () => false,
          propose: vi.fn<SessionAdapterClient["propose"]>(
            async (): Promise<AdapterCallResult> => ({
              ok: false,
              error: "missing key",
              timedOut: false,
              latency_ms: 0,
            })
          ),
        },
      },
      {
        label: "deadline timeout",
        client: {
          isAvailable: () => true,
          propose: vi.fn<SessionAdapterClient["propose"]>(
            async (): Promise<AdapterCallResult> => ({
              ok: false,
              error: "Hydrogen request exceeded deadline (2500ms)",
              timedOut: true,
              latency_ms: 2501,
            })
          ),
        },
      },
      {
        label: "bad JSON / error",
        client: {
          isAvailable: () => true,
          propose: vi.fn<SessionAdapterClient["propose"]>(
            async (): Promise<AdapterCallResult> => ({
              ok: false,
              error: "Invalid JSON from model",
              timedOut: false,
              latency_ms: 300,
            })
          ),
        },
      },
      {
        label: "model returns empty ops while rule fires",
        client: {
          isAvailable: () => true,
          propose: vi.fn<SessionAdapterClient["propose"]>(
            async (): Promise<AdapterCallResult> => ({
              ok: true,
              latency_ms: 250,
              output: { ops: [], visitor_read: "unsure", confidence: 0.4 },
            })
          ),
        },
      },
    ];

    for (const { client } of modes) {
      let nowMs = 500_000;
      const manager = createTestManager({
        adapterClient: client,
        clock: () => nowMs,
      });
      const created = await manager.createSession("demo-brand");
      manager.ingestEvents(created!.sessionId, [
        { t: 0, type: "enter_zone", zone: "zone_gallery" },
      ]);
      nowMs += 15_000;

      const emitted = await manager.tickSession(created!.sessionId);
      expect(emitted).toHaveLength(1);
      expect(emitted[0]?.source).toBe("rules");
      expect(emitted[0]?.ops[0]?.path).toBe("/zones/zone_gallery/lighting");
      expect(emitted[0]?.ops[0]?.value).toBe("gallery_spot");
    }
  });

  it("supports rules_plus_host_note mode (rules drive scene ops; model writes only /host_note)", async () => {
    let nowMs = 1_000_000;
    const propose = vi.fn<SessionAdapterClient["propose"]>(
      async (_input, _deadlineMs, opts): Promise<AdapterCallResult> => {
        expect(opts?.hostNoteOnly).toBe(true);
        return {
          ok: true,
          latency_ms: 600,
          output: {
            ops: [
              // Non-host_note op must be stripped in rules_plus_host_note mode:
              {
                op: "replace",
                path: "/hero_plinth/product_id",
                value: "p_basalt_vessel",
                reason: "should be rejected",
              },
              {
                op: "replace",
                path: "/host_note",
                value:
                  "Shifted the gallery lights so the woodblock texture reads clearly.",
                reason: "announce lighting change",
              },
            ],
            visitor_read: "gallery browser",
            confidence: 0.78,
          },
        };
      }
    );

    const manager = createTestManager({
      adapterClient: { isAvailable: () => true, propose },
      adapterMode: "rules_plus_host_note",
      clock: () => nowMs,
    });
    const created = await manager.createSession("demo-brand");
    manager.ingestEvents(created!.sessionId, [
      { t: 0, type: "enter_zone", zone: "zone_gallery" },
    ]);
    nowMs += 15_000;

    const emitted = await manager.tickSession(created!.sessionId);
    expect(emitted).toHaveLength(2);
    expect(emitted[0]?.source).toBe("rules");
    expect(emitted[0]?.ops[0]?.path).toBe("/zones/zone_gallery/lighting");
    expect(emitted[1]?.source).toBe("model");
    expect(emitted[1]?.ops).toHaveLength(1);
    expect(emitted[1]?.ops[0]?.path).toBe("/host_note");
    expect(
      manager.getSession(created!.sessionId)?.state["/hero_plinth/product_id"]
    ).toBe("p_glaze_swatch_zine");
  });

  it("supports hybrid mode (live gemini-4-hydrogen swaps matching-theme products across levers even without a matching rule, with thematic fallback on error)", async () => {
    let nowMs = 1_000_000;
    const propose = vi.fn<SessionAdapterClient["propose"]>(
      async (): Promise<AdapterCallResult> => ({
        ok: true,
        latency_ms: 1200,
        output: {
          ops: [
            {
              op: "replace",
              path: "/hero_plinth/product_id",
              value: "p_woodblock_kiln_print",
              reason: "inspected kiln postcards; spotlight matching woodblock print",
            },
            {
              op: "replace",
              path: "/guide_path/target_zone",
              value: "zone_gallery",
              reason: "guide visitor toward print editions",
            },
            {
              op: "replace",
              path: "/host_note",
              value: "Into the kiln prints? Moved our numbered woodblock edition up front.",
              reason: "announce theme shift in host voice",
            },
          ],
          visitor_read: "exploring kiln prints",
          confidence: 0.84,
        },
      })
    );

    const manager = createTestManager({
      adapterClient: { isAvailable: () => true, propose },
      adapterMode: "hybrid",
      clock: () => nowMs,
    });
    const created = await manager.createSession("demo-brand");
    manager.ingestEvents(created!.sessionId, [
      { t: 2, type: "enter_zone", zone: "zone_gallery" },
      { t: 10, type: "inspect", zone: "zone_gallery", product_id: "p_kiln_postcard_set" },
    ]);
    nowMs += 14_000;

    const emitted = await manager.tickSession(created!.sessionId);
    expect(propose).toHaveBeenCalledTimes(1);
    expect(emitted.some((p) => p.source === "model")).toBe(true);
    const state = manager.getSession(created!.sessionId)?.state;
    expect(state?.["/hero_plinth/product_id"]).toBe("p_woodblock_kiln_print");
    expect(state?.["/guide_path/target_zone"]).toBe("zone_gallery");
  });

  it("triggers immediate tick on inspect/add_to_cart only after first_change_after_s and cooldown", async () => {
    let nowMs = 1_000_000;
    const manager = createTestManager({
      adapterMode: "rules_only",
      clock: () => nowMs,
    });
    const created = await manager.createSession("demo-brand");
    const sid = created!.sessionId;

    // Before first_change_after_s (12s): inspect must NOT trigger a tick.
    const early = manager.ingestEvents(sid, [
      { t: 4, type: "enter_zone", zone: "zone_table" },
      { t: 8, type: "inspect", zone: "zone_table", product_id: "p_ash_glaze_dripper" },
    ]);
    expect(early?.triggeredImmediateTick).toBe(false);

    // At 15s: add_to_cart triggers immediate tick and fires r3.
    nowMs += 15_000;
    const ready = manager.ingestEvents(sid, [
      { t: 15, type: "add_to_cart", zone: "zone_table", product_id: "p_espresso_cup" },
    ]);
    expect(ready?.triggeredImmediateTick).toBe(true);

    // Flush microtask for async immediate tick.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(manager.getSession(sid)?.state["/hero_plinth/product_id"]).toBe(
      "p_ash_glaze_dripper"
    );

    // Within 8s cooldown (at 18s): inspect does NOT trigger immediate tick.
    nowMs += 3_000;
    const cooling = manager.ingestEvents(sid, [
      { t: 18, type: "inspect", zone: "zone_table", product_id: "p_espresso_cup" },
    ]);
    expect(cooling?.triggeredImmediateTick).toBe(false);
  });

  it("runs periodic ticks automatically while visitor is active", async () => {
    let nowMs = 1_000_000;
    const manager = createTestManager({
      adapterMode: "rules_only",
      clock: () => nowMs,
      tickIntervalMs: 25,
    });
    const created = await manager.createSession("demo-brand");
    const sid = created!.sessionId;

    manager.ingestEvents(sid, [
      { t: 0, type: "enter_zone", zone: "zone_gallery" },
    ]);
    nowMs += 14_000;

    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(
      manager.getSession(sid)?.state["/zones/zone_gallery/lighting"]
    ).toBe("gallery_spot");
  });

  it("drops sessions after 10 minutes of inactivity", async () => {
    let nowMs = 2_000_000;
    const manager = createTestManager({
      adapterMode: "rules_only",
      clock: () => nowMs,
    });
    const created = await manager.createSession("demo-brand");
    const sid = created!.sessionId;
    expect(manager.getSessionCount()).toBe(1);

    nowMs += 9 * 60 * 1000;
    expect(manager.sweepIdleSessions()).toBe(0);
    expect(manager.getSession(sid)).toBeDefined();

    nowMs += 60 * 1000;
    expect(manager.sweepIdleSessions()).toBe(1);
    expect(manager.getSessionCount()).toBe(0);
    expect(manager.getSession(sid)).toBeUndefined();
  });
});
