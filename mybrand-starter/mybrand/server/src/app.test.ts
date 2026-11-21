import fs from "node:fs";
import http from "node:http";
import type { Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { Duplex } from "node:stream";
import type { Express } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { createPaletteFallbackPng } from "./boot/fallbackPng";
import type { BootJobManager } from "./boot/manager";
import type {
  BootJobSnapshot,
  BootListItem,
  BootSseEvent,
  CarbonClient,
  ImageGenClient,
} from "./boot/types";
import { loadServerEnv, parseServerEnv, WORKSPACE_ROOT } from "./env";
import type { SessionManager } from "./session/manager";
import type { SseConnectedPayload, SseOpsPayload } from "./session/types";

interface MockResponse {
  status: number;
  headers: http.OutgoingHttpHeaders;
  bodyBuffer: Buffer;
  text: string;
  json: <T = unknown>() => T;
}

interface DispatchOptions {
  body?: unknown;
  headers?: Record<string, string>;
}

function dispatch(
  app: Express,
  method: string,
  urlPath: string,
  options: DispatchOptions = {}
): Promise<MockResponse> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const rawSocket = new Duplex({
      read() {},
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        callback();
      },
    });
    Object.assign(rawSocket, {
      remoteAddress: "127.0.0.1",
      writable: true,
      cork() {},
      uncork() {},
    });

    const socket = rawSocket as unknown as Socket;
    const req = new http.IncomingMessage(socket);
    req.method = method;
    req.url = urlPath;
    req.httpVersion = "1.0";
    req.httpVersionMajor = 1;
    req.httpVersionMinor = 0;

    const payloadBuffer =
      options.body !== undefined
        ? Buffer.from(JSON.stringify(options.body), "utf-8")
        : null;

    req.headers = {
      host: "127.0.0.1",
      ...(payloadBuffer
        ? {
            "content-type": "application/json",
            "content-length": String(payloadBuffer.length),
          }
        : {}),
      ...(options.headers ?? {}),
    };

    req.on("end", () => {
      req.complete = true;
    });

    const res = new http.ServerResponse(req);
    res.assignSocket(socket);

    res.on("error", reject);
    res.on("finish", () => {
      const wire = Buffer.concat(chunks);
      const separator = wire.indexOf("\r\n\r\n");
      const bodyBuffer = separator >= 0 ? wire.subarray(separator + 4) : wire;
      const text = bodyBuffer.toString("utf-8");
      resolve({
        status: res.statusCode,
        headers: res.getHeaders(),
        bodyBuffer,
        text,
        json: <T = unknown>() => JSON.parse(text) as T,
      });
    });

    req._read = () => {};
    app(req, res);
    process.nextTick(() => {
      if (payloadBuffer) {
        req.push(payloadBuffer);
      }
      req.push(null);
    });
  });
}

interface MockSseConnection<TEvent = SseConnectedPayload | SseOpsPayload> {
  status: number;
  headers: http.OutgoingHttpHeaders;
  events: TEvent[];
  close: () => void;
}

function openSse<TEvent = SseConnectedPayload | SseOpsPayload>(
  app: Express,
  urlPath: string
): Promise<MockSseConnection<TEvent>> {
  return new Promise((resolve, reject) => {
    let rawText = "";
    let headerParsed = false;
    let bodyBuffer = "";
    const events: TEvent[] = [];
    let resolved = false;

    const rawSocket = new Duplex({
      read() {},
      write(chunk, _encoding, callback) {
        const piece = Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : String(chunk);
        rawText += piece;
        if (!headerParsed) {
          const sep = rawText.indexOf("\r\n\r\n");
          if (sep >= 0) {
            headerParsed = true;
            bodyBuffer = rawText.slice(sep + 4);
          }
        } else {
          bodyBuffer += piece;
        }

        if (headerParsed) {
          let frameEnd = bodyBuffer.indexOf("\n\n");
          while (frameEnd >= 0) {
            const frame = bodyBuffer.slice(0, frameEnd);
            bodyBuffer = bodyBuffer.slice(frameEnd + 2);
            for (const line of frame.split("\n")) {
              if (line.startsWith("data: ")) {
                events.push(JSON.parse(line.slice(6)) as TEvent);
              }
            }
            frameEnd = bodyBuffer.indexOf("\n\n");
          }

          if (!resolved && (events.length > 0 || res.statusCode >= 400)) {
            resolved = true;
            resolve({
              status: res.statusCode,
              headers: res.getHeaders(),
              events,
              close: () => {
                req.emit("close");
                res.end();
              },
            });
          }
        }

        callback();
      },
    });
    Object.assign(rawSocket, {
      remoteAddress: "127.0.0.1",
      writable: true,
      cork() {},
      uncork() {},
    });

    const socket = rawSocket as unknown as Socket;
    const req = new http.IncomingMessage(socket);
    req.method = "GET";
    req.url = urlPath;
    req.headers = { host: "127.0.0.1", accept: "text/event-stream" };
    req.httpVersion = "1.0";
    req.httpVersionMajor = 1;
    req.httpVersionMinor = 0;

    req.on("end", () => {
      req.complete = true;
    });

    const res = new http.ServerResponse(req);
    res.assignSocket(socket);
    res.on("error", reject);
    res.on("finish", () => {
      if (!resolved) {
        resolved = true;
        resolve({
          status: res.statusCode,
          headers: res.getHeaders(),
          events,
          close: () => {},
        });
      }
    });

    req._read = () => {};
    req.push(null);
    app(req, res);
  });
}

const appsToClean: Express[] = [];
const tempWorkspacesToClean: string[] = [];

afterEach(() => {
  while (appsToClean.length > 0) {
    const app = appsToClean.pop();
    const manager = app?.locals.sessionManager as SessionManager | undefined;
    const bootManager = app?.locals.bootJobManager as BootJobManager | undefined;
    manager?.destroy();
    bootManager?.destroy();
  }
  while (tempWorkspacesToClean.length > 0) {
    const dir = tempWorkspacesToClean.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("server env loading", () => {
  it("boots cleanly with an empty .env file and only warns when GEMINI_API_KEY is missing", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mybrand-env-"));
    const emptyEnvPath = path.join(tempDir, ".env");
    fs.writeFileSync(emptyEnvPath, "", "utf-8");

    const warnSpy = vi.fn();
    const prevKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
      const env = loadServerEnv(emptyEnvPath, warnSpy);
      expect(env.port).toBeGreaterThan(0);
      expect(env.geminiApiKey).toBeUndefined();
      expect(env.sessionAdapterMode).toBe("rules_plus_host_note");
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toContain("GEMINI_API_KEY");
    } finally {
      if (prevKey !== undefined) {
        process.env.GEMINI_API_KEY = prevKey;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not warn or leak secrets when GEMINI_API_KEY is set and parses SESSION_ADAPTER_MODE", () => {
    const warnSpy = vi.fn();
    const env = parseServerEnv(
      {
        PORT: "4000",
        GEMINI_API_KEY: "test-secret-do-not-log",
        SESSION_ADAPTER_MODE: "full",
      },
      warnSpy
    );
    expect(env.port).toBe(4000);
    expect(env.geminiApiKey).toBe("test-secret-do-not-log");
    expect(env.sessionAdapterMode).toBe("full");
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("server HTTP endpoints (M0)", () => {
  it("GET /api/health returns ok", async () => {
    const app = createApp({ tickIntervalMs: 0, idleSweepIntervalMs: 0 });
    appsToClean.push(app);
    const res = await dispatch(app, "GET", "/api/health");
    expect(res.status).toBe(200);
    const body = res.json<{ ok: boolean; status: string }>();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("ok");
  });

  it("GET /api/boots/demo-brand returns schema-valid fixture artifacts", async () => {
    const app = createApp({ tickIntervalMs: 0, idleSweepIntervalMs: 0 });
    appsToClean.push(app);
    const res = await dispatch(app, "GET", "/api/boots/demo-brand");
    expect(res.status).toBe(200);
    const body = res.json<{
      brand_core: { brand_slug: string };
      products: unknown[];
      world_spec: { zones: unknown[] };
    }>();
    expect(body.brand_core.brand_slug).toBe("kestrel-clay");
    expect(body.products).toHaveLength(9);
    expect(body.world_spec.zones).toHaveLength(3);
  });

  it("serves static fixture palette assets", async () => {
    const app = createApp({ tickIntervalMs: 0, idleSweepIntervalMs: 0 });
    appsToClean.push(app);
    const res = await dispatch(
      app,
      "GET",
      "/fixtures/demo-brand/assets/floor_terracotta.svg"
    );
    expect(res.status).toBe(200);
    expect(res.text).toContain("#D9C9B8");
  });

  it("returns 404 for unknown bootId and 400 for invalid bootId", async () => {
    const app = createApp({ tickIntervalMs: 0, idleSweepIntervalMs: 0 });
    appsToClean.push(app);
    const missing = await dispatch(app, "GET", "/api/boots/does-not-exist");
    expect(missing.status).toBe(404);

    const invalid = await dispatch(app, "GET", "/api/boots/BAD_ID!");
    expect(invalid.status).toBe(400);
  });
});

describe("server Session & SSE endpoints (M2)", () => {
  it("POST /api/sessions creates a session with base_state and validates bootId", async () => {
    const app = createApp({
      adapterMode: "rules_only",
      tickIntervalMs: 0,
      idleSweepIntervalMs: 0,
      logger: () => {},
    });
    appsToClean.push(app);

    const created = await dispatch(app, "POST", "/api/sessions", {
      body: { bootId: "demo-brand" },
    });
    expect(created.status).toBe(201);
    const body = created.json<{
      sessionId: string;
      base_state: Record<string, string | number>;
    }>();
    expect(body.sessionId).toBeTruthy();
    expect(body.base_state["/hero_plinth/product_id"]).toBe(
      "p_glaze_swatch_zine"
    );

    const invalid = await dispatch(app, "POST", "/api/sessions", {
      body: { bootId: "INVALID!" },
    });
    expect(invalid.status).toBe(400);

    const missing = await dispatch(app, "POST", "/api/sessions", {
      body: { bootId: "no-such-boot" },
    });
    expect(missing.status).toBe(404);
  });

  it("POST /api/sessions/:id/events logs received events and streams ops over GET /api/sessions/:id/stream", async () => {
    let nowMs = 1_000_000;
    const logs: string[] = [];
    const app = createApp({
      adapterMode: "rules_only",
      clock: () => nowMs,
      tickIntervalMs: 0,
      idleSweepIntervalMs: 0,
      logger: (line) => logs.push(line),
    });
    appsToClean.push(app);

    const created = await dispatch(app, "POST", "/api/sessions", {
      body: { bootId: "demo-brand" },
    });
    const { sessionId } = created.json<{ sessionId: string }>();

    // Open SSE stream and verify connected handshake frame.
    const sse = await openSse(app, `/api/sessions/${sessionId}/stream`);
    expect(sse.status).toBe(200);
    expect(String(sse.headers["content-type"])).toContain("text/event-stream");
    expect(sse.events[0]).toEqual({ type: "connected", sessionId });

    // Send events past first_change_after_s (12s) with add_to_cart -> triggers immediate tick (r3).
    nowMs += 15_000;
    const postRes = await dispatch(
      app,
      "POST",
      `/api/sessions/${sessionId}/events`,
      {
        body: {
          events: [
            { t: 4, type: "enter_zone", zone: "zone_table" },
            {
              t: 10,
              type: "inspect",
              zone: "zone_table",
              product_id: "p_ash_glaze_dripper",
            },
            {
              t: 15,
              type: "add_to_cart",
              zone: "zone_table",
              product_id: "p_espresso_cup",
            },
          ],
        },
      }
    );
    expect(postRes.status).toBe(200);
    expect(postRes.json()).toEqual({ ok: true, accepted: 3 });

    // Verify events were logged cleanly for M1 visibility.
    expect(logs.some((line) => line.includes("+3 events:") && line.includes("add_to_cart"))).toBe(
      true
    );

    // Wait briefly for immediate tick to broadcast over SSE.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sse.events.length).toBeGreaterThanOrEqual(2);

    const opsFrame = sse.events[1] as SseOpsPayload;
    expect(opsFrame.type).toBe("ops");
    expect(opsFrame.source).toBe("rules");
    expect(typeof opsFrame.latency_ms).toBe("number");
    expect(opsFrame.now_s).toBe(15);
    expect(opsFrame.ops).toHaveLength(1);
    expect(opsFrame.ops[0]?.path).toBe("/hero_plinth/product_id");
    expect(opsFrame.ops[0]?.value).toBe("p_ash_glaze_dripper");
    expect(opsFrame.ops[0]?.source).toBe("rules");
    expect(typeof opsFrame.ops[0]?.latency_ms).toBe("number");

    sse.close();
  });

  it("returns 400 on invalid events payload and 404 on unknown session id", async () => {
    const app = createApp({
      adapterMode: "rules_only",
      tickIntervalMs: 0,
      idleSweepIntervalMs: 0,
      logger: () => {},
    });
    appsToClean.push(app);

    const created = await dispatch(app, "POST", "/api/sessions", {
      body: { bootId: "demo-brand" },
    });
    const { sessionId } = created.json<{ sessionId: string }>();

    const badEvents = await dispatch(
      app,
      "POST",
      `/api/sessions/${sessionId}/events`,
      {
        body: { events: [{ t: -5, type: "not_a_real_event" }] },
      }
    );
    expect(badEvents.status).toBe(400);

    const missingEvents = await dispatch(
      app,
      "POST",
      "/api/sessions/nonexistent/events",
      {
        body: { events: [] },
      }
    );
    expect(missingEvents.status).toBe(404);

    const missingStream = await dispatch(
      app,
      "GET",
      "/api/sessions/nonexistent/stream"
    );
    expect(missingStream.status).toBe(404);
  });
});

function makeIsolatedWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mybrand-m3-app-"));
  tempWorkspacesToClean.push(dir);
  fs.mkdirSync(path.join(dir, "prompts"), { recursive: true });
  fs.copyFileSync(
    path.join(WORKSPACE_ROOT, "prompts", "orchestrator.md"),
    path.join(dir, "prompts", "orchestrator.md")
  );
  fs.cpSync(
    path.join(WORKSPACE_ROOT, "fixtures", "demo-brand"),
    path.join(dir, "fixtures", "demo-brand"),
    { recursive: true }
  );
  return dir;
}

async function waitUntil(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 4000
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for async boot state");
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("server Boot Agent HTTP & SSE endpoints (M3)", () => {
  it("GET /api/boots lists demo-brand fixture and validates POST /api/boots payloads", async () => {
    const workspaceRoot = makeIsolatedWorkspace();
    const app = createApp({
      workspaceRoot,
      tickIntervalMs: 0,
      idleSweepIntervalMs: 0,
      bootHeartbeatIntervalMs: 0,
      logger: () => {},
    });
    appsToClean.push(app);

    const listRes = await dispatch(app, "GET", "/api/boots");
    expect(listRes.status).toBe(200);
    const { boots } = listRes.json<{ boots: BootListItem[] }>();
    expect(boots).toHaveLength(1);
    expect(boots[0]).toEqual({
      bootId: "demo-brand",
      name: "Maren Solis",
      brandSlug: "kestrel-clay",
      source: "fixture",
      ready: true,
    });

    // Reject empty inputs
    const emptyRes = await dispatch(app, "POST", "/api/boots", {
      body: {
        hostName: "Empty Host",
        hostType: "person",
        images: [],
        urls: [],
        voiceSamples: [],
      },
    });
    expect(emptyRes.status).toBe(400);

    // Reject >20 images
    const tooManyImages = Array.from({ length: 21 }, (_, idx) => ({
      filename: `p_${idx}.png`,
      mimeType: "image/png",
      dataBase64: "AAAA",
    }));
    const tooManyRes = await dispatch(app, "POST", "/api/boots", {
      body: {
        hostName: "Many Photos",
        hostType: "person",
        images: tooManyImages,
        urls: [],
        voiceSamples: [],
      },
    });
    expect(tooManyRes.status).toBe(400);
  });

  it("handles missing GEMINI_API_KEY gracefully without crashing the server", async () => {
    const workspaceRoot = makeIsolatedWorkspace();
    const app = createApp({
      workspaceRoot,
      env: { geminiApiKey: undefined },
      tickIntervalMs: 0,
      idleSweepIntervalMs: 0,
      bootHeartbeatIntervalMs: 0,
      logger: () => {},
    });
    appsToClean.push(app);

    const startRes = await dispatch(app, "POST", "/api/boots", {
      body: {
        hostName: "No Key Studio",
        hostType: "company",
        images: [],
        urls: ["https://example.com"],
        voiceSamples: [],
      },
    });
    expect(startRes.status).toBe(201);
    const { bootId } = startRes.json<{ bootId: string; status: string }>();

    await waitUntil(async () => {
      const jobRes = await dispatch(app, "GET", `/api/boots/${bootId}/job`);
      const snap = jobRes.json<BootJobSnapshot>();
      return snap.status === "failed";
    });

    const failedJob = (
      await dispatch(app, "GET", `/api/boots/${bootId}/job`)
    ).json<BootJobSnapshot>();
    expect(failedJob.status).toBe("failed");
    expect(failedJob.error).toContain("GEMINI_API_KEY");
  });

  it("executes full HTTP + SSE boot lifecycle (stream, ask_host, shopify skip, PNG asset serving, GET /api/boots/:bootId, and M2 session creation)", async () => {
    const workspaceRoot = makeIsolatedWorkspace();
    const samplePng = createPaletteFallbackPng(["#1E3A5F", "#E8DCC8"], {
      width: 32,
      height: 32,
    });

    let activeBootId = "";
    let turn = 0;

    const mockCarbon: CarbonClient = {
      isAvailable: () => true,
      async generateTurn(params) {
        turn += 1;
        if (turn === 1) {
          // Slight delay so SSE connection catches live events + heartbeats
          await new Promise((r) => setTimeout(r, 35));
          return {
            content: {
              role: "model",
              parts: [
                {
                  functionCall: { id: "c1", name: "read_inputs", args: {} },
                  thoughtSignature: "SIG_E2E_1",
                },
              ],
            },
          };
        }

        // Grab bootId from read_inputs response
        const prevUser = params.contents[params.contents.length - 1];
        const readOut = prevUser?.parts?.[0]?.functionResponse?.response as
          | { output?: { boot_id?: string } }
          | undefined;
        if (readOut?.output?.boot_id) {
          activeBootId = readOut.output.boot_id;
        }

        if (turn === 2) {
          return {
            content: {
              role: "model",
              parts: [
                {
                  functionCall: {
                    id: "c2",
                    name: "ask_host",
                    args: {
                      message: "Own stock or print-on-demand?",
                      options: ["Own stock", "Print-on-demand"],
                    },
                  },
                },
              ],
            },
          };
        }

        if (turn === 3) {
          const brand_core = {
            brand_slug: "jetstream-atelier",
            host: { type: "company", name: "Jetstream Atelier" },
            positioning: "For aviation travelers, Jetstream Atelier builds sleek cabin goods.",
            values: ["precision", "lightweight"],
            audience_segments: [
              { id: "seg_fly", who: "frequent flyers", wants: "durable travel goods", entry_tier: "entry" },
            ],
            dynamic: { label: "expert→client", evidence: ["voice_1: flight-tested cabin specs"] },
            strategy: "Lead with anodized luggage tags, bridge to leather passport folios.",
            voice: { traits: ["crisp", "calm"], do: ["cite weights"], dont: ["clutter"], samples: ["Machined to 18 grams."] },
            visual: {
              palette_hex: ["#1E3A5F", "#E8DCC8", "#C86D51"],
              fonts: { display: "Space Grotesk", body: "Inter" },
              materials: ["anodized aluminum", "terrazzo"],
              lighting_mood: "crisp terminal glass daylight",
              motifs: ["runway markings"],
            },
            story_beats: [{ zone_id: "zone_gate", beat: "Departure lounge essentials" }],
            claims: [{ claim: "Aviation cabin design", source: "img_01" }],
            low_confidence: [],
          };

          const products = [
            {
              id: "p_luggage_tag",
              handle: "mybrand-jetstream-atelier-luggage-tag",
              title: "Machined Aluminum Luggage Tag",
              tier: "entry",
              kind: "physical",
              product_type: "Travel Gear",
              zone_id: "zone_gate",
              tags: ["mybrand", "mybrand:jetstream-atelier", `boot:${activeBootId}`, "cabin"],
              description: "18-gram bead-blasted aluminum tag with braided steel loop.",
              blurbs: [
                "Inspired by aircraft fuselage rivets for quiet durability.",
                "Laser-etched ID plate hides contact details inside a recessed sleeve.",
              ],
              price: "32.00",
              currency: "USD",
              options: [{ name: "Color", values: ["Slate"] }],
              variants: [{ options: { Color: "Slate" }, price: "32.00", sku: "JA-01" }],
              image_asset_ids: ["asset_03"],
              evidence: ["img_01: aviation hardware"],
              shopify: { product_id: null, variant_ids: {}, status: "DRAFT", checkout_url: null },
            },
          ];

          return {
            content: {
              role: "model",
              parts: [
                { functionCall: { id: "c3", name: "save_artifact", args: { name: "brand_core", json: brand_core } } },
                { functionCall: { id: "c4", name: "save_artifact", args: { name: "products", json: products } } },
                {
                  functionCall: {
                    id: "c5",
                    name: "generate_image",
                    args: {
                      prompt: "Wide 16:9 departure terminal panoramic glass overlooking jets and runway",
                      model: "gemini-nano-banana-2.1",
                      aspect: "16:9",
                      ref_asset_ids: ["img_01"],
                      kind: "texture",
                    },
                  },
                },
                {
                  functionCall: {
                    id: "c6",
                    name: "generate_image",
                    args: {
                      prompt: "Polished terrazzo airport terminal floor surface texture",
                      model: "gemini-nano-banana-2.1",
                      aspect: "1:1",
                      kind: "texture",
                    },
                  },
                },
                {
                  functionCall: {
                    id: "c7",
                    name: "generate_image",
                    args: {
                      prompt: "Studio product photo of anodized slate aluminum luggage tag",
                      model: "gemini-nano-banana-2.1",
                      aspect: "1:1",
                      kind: "product_image",
                    },
                  },
                },
              ],
            },
          };
        }

        if (turn === 4) {
          const world_spec = {
            boot_id: activeBootId,
            version: 1,
            room: { size_m: [14, 12, 4], floor_asset: "asset_02", wall_asset: "asset_01" },
            entrance: { position: [0, 0], greeting: "Welcome aboard Jetstream Atelier." },
            hero_plinth: { position: [0, 3], product_id: "p_luggage_tag" },
            guide_path: { target_zone: "zone_gate" },
            host_note: "Start at Gate 1 for cabin-tested aluminum pieces.",
            zones: [
              {
                id: "zone_gate",
                beat: "Departure lounge essentials",
                center: [0, 6],
                size: [6, 5],
                lighting: "terminal_day",
                signage: "Gate 1 — Cabin Essentials",
                fixtures: [
                  { id: "f_gate", type: "plinth", position: [0, 0, 6], rotation_deg: 0, slot_ids: ["s_1"] },
                ],
                slots: [{ id: "s_1", product_id: "p_luggage_tag" }],
              },
            ],
            blurbs: { p_luggage_tag: 0 },
            assets: [
              { id: "asset_01", kind: "texture", model: "gemini-nano-banana-2.1", prompt: "Panoramic terminal", url: `/data/${activeBootId}/assets/asset_01.png` },
              { id: "asset_02", kind: "texture", model: "gemini-nano-banana-2.1", prompt: "Terrazzo floor", url: `/data/${activeBootId}/assets/asset_02.png` },
              { id: "asset_03", kind: "product_image", model: "gemini-nano-banana-2.1", prompt: "Luggage tag", url: `/data/${activeBootId}/assets/asset_03.png` },
            ],
            variant_pools: {
              lighting: [
                { id: "terminal_day", color_temp_k: 4800, intensity: 0.9, spot: false },
                { id: "dusk_runway", color_temp_k: 3000, intensity: 0.78, spot: true },
              ],
              signage: { zone_gate: ["Gate 1 — Cabin Essentials", "Flight-Tested Aluminum"] },
            },
          };

          const adaptation_policy = {
            dynamic: "expert→client",
            objective: "guide frequent flyers to durable travel goods",
            levers: [
              { path: "/hero_plinth/product_id", allowed: "any product id" },
              { path: "/zones/{zone}/slots/{slot}/product_id", allowed: "ids of products assigned to {zone}" },
              { path: "/zones/{zone}/lighting", allowed: "ids in variant_pools.lighting" },
              { path: "/zones/{zone}/signage", allowed: "variant_pools.signage[{zone}]" },
              { path: "/blurbs/{product}", allowed: "0 or 1" },
              { path: "/host_note", allowed: "rewrite <=90 chars" },
              { path: "/guide_path/target_zone", allowed: "any zone id" },
            ],
            frozen: ["brand_core", "room", "prices"],
            rules: [
              {
                id: "r1",
                priority: 1,
                when: "dwell_s(zone_gate) >= 10 AND current_zone == zone_gate",
                do: { path: "/zones/zone_gate/lighting", value: "dusk_runway" },
                why: "lingering at gate; shift to warm dusk runway spotlight",
              },
            ],
            limits: {
              first_change_after_s: 12,
              max_ops_per_change: 3,
              cooldown_s: 8,
              max_ops_per_session: 15,
              lever_min_interval_s: 20,
              deadline_ms: 2500,
            },
          };

          const demo_personas = [
            {
              name: "Quick Commuter",
              segment: "seg_fly",
              events: [{ t: 0, type: "enter_zone", zone: "zone_gate" }],
              expected: ["bright terminal lighting"],
            },
            {
              name: "Gear Inspector",
              segment: "seg_fly",
              events: [
                { t: 0, type: "enter_zone", zone: "zone_gate" },
                { t: 14, type: "inspect", zone: "zone_gate", product_id: "p_luggage_tag" },
              ],
              expected: ["shifts zone_gate lighting to dusk_runway"],
            },
          ];

          return {
            content: {
              role: "model",
              parts: [
                { functionCall: { id: "c8", name: "save_artifact", args: { name: "world_spec", json: world_spec } } },
                { functionCall: { id: "c9", name: "save_artifact", args: { name: "adaptation_policy", json: adaptation_policy } } },
                { functionCall: { id: "c10", name: "save_artifact", args: { name: "demo_personas", json: demo_personas } } },
                {
                  functionCall: {
                    id: "c11",
                    name: "request_shopify_connection",
                    args: { scopes: ["read_products", "write_products"] },
                  },
                },
              ],
            },
          };
        }

        if (turn === 5) {
          const session_config = {
            boot_id: activeBootId,
            brand_card: "Jetstream Atelier crafts lightweight cabin essentials for frequent flyers. Voice: crisp, calm, exact specs.",
            catalog: [
              {
                id: "p_luggage_tag",
                title: "Machined Aluminum Luggage Tag",
                tier: "entry",
                tags: ["mybrand", "mybrand:jetstream-atelier", `boot:${activeBootId}`, "cabin"],
                zone_id: "zone_gate",
                blurbs: [
                  "Inspired by aircraft fuselage rivets for quiet durability.",
                  "Laser-etched ID plate hides contact details inside a recessed sleeve.",
                ],
              },
            ],
            policy: {
              dynamic: "expert→client",
              objective: "guide frequent flyers to durable travel goods",
              levers: [
                { path: "/hero_plinth/product_id", allowed: "any product id" },
                { path: "/zones/{zone}/slots/{slot}/product_id", allowed: "ids of products assigned to {zone}" },
                { path: "/zones/{zone}/lighting", allowed: "ids in variant_pools.lighting" },
                { path: "/zones/{zone}/signage", allowed: "variant_pools.signage[{zone}]" },
                { path: "/blurbs/{product}", allowed: "0 or 1" },
                { path: "/host_note", allowed: "rewrite <=90 chars" },
                { path: "/guide_path/target_zone", allowed: "any zone id" },
              ],
              frozen: ["brand_core", "room", "prices"],
              rules: [
                {
                  id: "r1",
                  priority: 1,
                  when: "dwell_s(zone_gate) >= 10 AND current_zone == zone_gate",
                  do: { path: "/zones/zone_gate/lighting", value: "dusk_runway" },
                  why: "lingering at gate; shift to warm dusk runway spotlight",
                },
              ],
              limits: {
                first_change_after_s: 12,
                max_ops_per_change: 3,
                cooldown_s: 8,
                max_ops_per_session: 15,
                lever_min_interval_s: 20,
                deadline_ms: 2500,
              },
            },
            pools: {
              lighting: [
                { id: "terminal_day", color_temp_k: 4800, intensity: 0.9, spot: false },
                { id: "dusk_runway", color_temp_k: 3000, intensity: 0.78, spot: true },
              ],
              signage: { zone_gate: ["Gate 1 — Cabin Essentials", "Flight-Tested Aluminum"] },
            },
            base_state: {
              "/hero_plinth/product_id": "p_luggage_tag",
              "/guide_path/target_zone": "zone_gate",
              "/host_note": "Start at Gate 1 for cabin-tested aluminum pieces.",
              "/zones/zone_gate/slots/s_1/product_id": "p_luggage_tag",
              "/zones/zone_gate/lighting": "terminal_day",
              "/zones/zone_gate/signage": "Gate 1 — Cabin Essentials",
              "/blurbs/p_luggage_tag": 0,
            },
            demo_personas: [
              {
                name: "Quick Commuter",
                segment: "seg_fly",
                events: [{ t: 0, type: "enter_zone", zone: "zone_gate" }],
                expected: ["bright terminal lighting"],
              },
            ],
          };

          return {
            content: {
              role: "model",
              parts: [
                { functionCall: { id: "c12", name: "save_artifact", args: { name: "session_config", json: session_config } } },
              ],
            },
          };
        }

        return {
          content: {
            role: "model",
            parts: [{ text: "Jetstream Atelier boutique is live!" }],
          },
        };
      },
    };

    const mockImageGen: ImageGenClient = {
      isAvailable: () => true,
      async generateImage() {
        return { bytes: samplePng, mimeType: "image/png" };
      },
    };

    const app = createApp({
      workspaceRoot,
      adapterMode: "rules_only",
      carbonClient: mockCarbon,
      imageGenClient: mockImageGen,
      urlFetcher: async (url) => ({ url, ok: true, status: 200, text: "Cabin gear" }),
      tickIntervalMs: 0,
      idleSweepIntervalMs: 0,
      bootHeartbeatIntervalMs: 25,
      bootImageRetryDelayMs: 0,
      bootApiRetryDelayMs: 0,
      logger: () => {},
    });
    appsToClean.push(app);

    // 1. Start boot via POST /api/boots
    const startRes = await dispatch(app, "POST", "/api/boots", {
      body: {
        hostName: "Jetstream Atelier",
        hostType: "company",
        images: [
          {
            filename: "cabin.png",
            mimeType: "image/png",
            dataBase64: `data:image/png;base64,${samplePng.toString("base64")}`,
          },
        ],
        urls: ["https://jetstream.example.com"],
        voiceSamples: ["Machined to 18 grams."],
      },
    });
    expect(startRes.status).toBe(201);
    const { bootId, status } = startRes.json<{ bootId: string; status: string }>();
    expect(status).toBe("running");

    // 2. Attach SSE stream and verify immediate snapshot frame
    const sse = await openSse<BootSseEvent>(app, `/api/boots/${bootId}/stream`);
    expect(sse.status).toBe(200);
    expect(sse.events[0]?.type).toBe("snapshot");

    // 3. Wait for ask_host pause
    await waitUntil(async () => {
      const r = await dispatch(app, "GET", `/api/boots/${bootId}/job`);
      return r.json<BootJobSnapshot>().status === "waiting_host";
    });

    const replyRes = await dispatch(app, "POST", `/api/boots/${bootId}/reply`, {
      body: { text: "Own stock" },
    });
    expect(replyRes.status).toBe(200);
    expect(replyRes.json()).toEqual({ ok: true });

    // 4. Wait for request_shopify_connection pause
    await waitUntil(async () => {
      const r = await dispatch(app, "GET", `/api/boots/${bootId}/job`);
      return r.json<BootJobSnapshot>().status === "waiting_shopify";
    });

    const shopifyRes = await dispatch(
      app,
      "POST",
      `/api/boots/${bootId}/shopify-response`,
      { body: { connected: false, skip: true } }
    );
    expect(shopifyRes.status).toBe(200);
    expect(shopifyRes.json()).toEqual({ ok: true });

    // 5. Wait for completion
    await waitUntil(async () => {
      const r = await dispatch(app, "GET", `/api/boots/${bootId}/job`);
      return r.json<BootJobSnapshot>().status === "completed";
    });

    const eventTypes = new Set(sse.events.map((e) => e.type));
    expect(eventTypes.has("snapshot")).toBe(true);
    expect(eventTypes.has("heartbeat")).toBe(true);
    expect(eventTypes.has("activity")).toBe(true);
    expect(eventTypes.has("message")).toBe(true);
    expect(eventTypes.has("question")).toBe(true);
    expect(eventTypes.has("asset")).toBe(true);
    expect(eventTypes.has("artifact")).toBe(true);
    expect(eventTypes.has("status")).toBe(true);
    sse.close();

    // 6. Verify generated PNG served at GET /data/:bootId/assets/:filename
    const assetRes = await dispatch(
      app,
      "GET",
      `/data/${bootId}/assets/asset_01.png`
    );
    expect(assetRes.status).toBe(200);
    expect(String(assetRes.headers["content-type"])).toBe("image/png");
    expect(assetRes.bodyBuffer[0]).toBe(0x89);
    expect(assetRes.bodyBuffer[1]).toBe(0x50);

    // Block path traversal on assets route
    const badAssetRes = await dispatch(
      app,
      "GET",
      `/data/${bootId}/assets/..%2Fbrand_core.json`
    );
    expect(badAssetRes.status).toBe(400);

    // 7. Verify GET /api/boots lists both fixture and newly completed boot
    const bootsList = (await dispatch(app, "GET", "/api/boots")).json<{
      boots: BootListItem[];
    }>().boots;
    const generatedEntry = bootsList.find((b) => b.bootId === bootId);
    expect(generatedEntry).toMatchObject({
      bootId,
      name: "Jetstream Atelier",
      brandSlug: "jetstream-atelier",
      source: "data",
      ready: true,
      status: "completed",
    });

    // 8. Verify M1/M2 compatibility: GET /api/boots/:bootId + POST /api/sessions work seamlessly!
    const artifactsRes = await dispatch(app, "GET", `/api/boots/${bootId}`);
    expect(artifactsRes.status).toBe(200);

    const sessionRes = await dispatch(app, "POST", "/api/sessions", {
      body: { bootId },
    });
    expect(sessionRes.status).toBe(201);
    const sessionBody = sessionRes.json<{
      sessionId: string;
      base_state: Record<string, string | number>;
    }>();
    expect(sessionBody.sessionId).toBeTruthy();
    expect(sessionBody.base_state["/hero_plinth/product_id"]).toBe(
      "p_luggage_tag"
    );
  });
});
