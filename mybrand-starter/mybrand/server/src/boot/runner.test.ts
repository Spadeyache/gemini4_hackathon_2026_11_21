import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadBootArtifacts } from "../boot";
import { WORKSPACE_ROOT } from "../env";
import { createPaletteFallbackPng } from "./fallbackPng";
import { saveBootInputs } from "./inputs";
import { BootJobRunner } from "./runner";
import type { CarbonClient, CarbonTurnParams, ImageGenClient } from "./types";

const tempDirs: string[] = [];

function makeTempWorkspaceWithPrompt(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mybrand-runner-"));
  tempDirs.push(dir);
  const promptsDir = path.join(dir, "prompts");
  fs.mkdirSync(promptsDir, { recursive: true });
  fs.copyFileSync(
    path.join(WORKSPACE_ROOT, "prompts", "orchestrator.md"),
    path.join(promptsDir, "orchestrator.md")
  );
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 3000
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((r) => setTimeout(r, 15));
  }
}

function makeCompleteArtifactSet(bootId: string) {
  const brand_core = {
    brand_slug: "sol-craft",
    host: { type: "person" as const, name: "Sol Rivera" },
    positioning: "For coffee lovers, Sol Rivera crafts hand-carved wooden pour-over stands.",
    values: ["timber honesty", "slow brew"],
    audience_segments: [
      { id: "seg_brew", who: "home brewers", wants: "tactile gear", entry_tier: "entry" as const },
    ],
    dynamic: { label: "maker→collector", evidence: ["voice_1: answers brewing questions directly"] },
    strategy: "Start visitors with oak coasters, step up to pour-over stands and bespoke trays.",
    voice: { traits: ["warm", "direct"], do: ["name wood species"], dont: ["hype"], samples: ["Carved from kiln-dried white oak."] },
    visual: {
      palette_hex: ["#D8C5A8", "#5E432C", "#2A241F"],
      fonts: { display: "Fraunces", body: "Inter" },
      materials: ["white oak", "brass"],
      lighting_mood: "golden workshop light",
      motifs: ["hand plane shavings"],
    },
    story_beats: [
      { zone_id: "zone_bench", beat: "Timber selection and daily table tools" },
    ],
    claims: [{ claim: "White oak workshop", source: "img_01" }],
    low_confidence: [],
  };

  const brand_card =
    "Sol Craft is Sol Rivera's white-oak coffee woodworking studio. Voice: warm, direct, grounded in wood grain. Dynamic: maker→collector.";

  const products = [
    {
      id: "p_oak_coaster",
      handle: "mybrand-sol-craft-oak-coaster",
      title: "White Oak Coaster Pair",
      tier: "entry" as const,
      kind: "physical" as const,
      product_type: "Coasters",
      zone_id: "zone_bench",
      tags: ["mybrand", "mybrand:sol-craft", `boot:${bootId}`, "oak", "coffee"],
      description: "Two hand-chamfered white oak coasters finished in food-safe oil.",
      blurbs: [
        "Cut from white oak offcuts from our pour-over stand bench.",
        "Water-resistant natural oil finish built for daily espresso rings.",
      ] as [string, string],
      price: "22.00",
      currency: "USD",
      options: [{ name: "Finish", values: ["Natural"] }],
      variants: [{ options: { Finish: "Natural" }, price: "22.00", sku: "SC-01" }],
      image_asset_ids: ["asset_03"],
      evidence: ["img_01: oak timber on bench"],
      shopify: { product_id: null, variant_ids: {}, status: "DRAFT" as const, checkout_url: null },
    },
    {
      id: "p_oak_stand",
      handle: "mybrand-sol-craft-oak-stand",
      title: "Brass & Oak Pour-Over Stand",
      tier: "core" as const,
      kind: "physical" as const,
      product_type: "Coffee Stand",
      zone_id: "zone_bench",
      tags: ["mybrand", "mybrand:sol-craft", `boot:${bootId}`, "oak", "coffee"],
      description: "Mortise-and-tenon oak pour-over frame with brushed brass dripper ring.",
      blurbs: [
        "Hand-joined white oak paired with a solid turned brass ring.",
        "Fits V60 and Kalita brewers with clearance for tall carafes.",
      ] as [string, string],
      price: "110.00",
      currency: "USD",
      options: [{ name: "Ring", values: ["Brass"] }],
      variants: [{ options: { Ring: "Brass" }, price: "110.00", sku: "SC-02" }],
      image_asset_ids: ["asset_03"],
      evidence: ["url_1: brass and oak coffee tools"],
      shopify: { product_id: null, variant_ids: {}, status: "DRAFT" as const, checkout_url: null },
    },
  ];

  const world_spec = {
    boot_id: bootId,
    version: 1,
    room: { size_m: [12, 10, 4] as [number, number, number], floor_asset: "asset_02", wall_asset: "asset_01" },
    entrance: { position: [0, 0] as [number, number], greeting: "Welcome to Sol Craft — white oak & brass." },
    hero_plinth: { position: [0, 3] as [number, number], product_id: "p_oak_coaster" },
    guide_path: { target_zone: "zone_bench" },
    host_note: "Start at the oak bench and check the brass pour-over joinery.",
    zones: [
      {
        id: "zone_bench",
        beat: "Timber selection and daily table tools",
        center: [0, 6] as [number, number],
        size: [6, 4] as [number, number],
        lighting: "workshop_warm",
        signage: "Oak Bench — coffee joinery",
        fixtures: [
          { id: "f_bench", type: "table" as const, position: [0, 0, 6] as [number, number, number], rotation_deg: 0, slot_ids: ["s_1"] },
        ],
        slots: [{ id: "s_1", product_id: "p_oak_coaster" }],
      },
    ],
    blurbs: { p_oak_coaster: 0 as const, p_oak_stand: 0 as const },
    assets: [
      { id: "asset_01", kind: "texture" as const, model: "gemini-nano-banana-2.1", prompt: "16:9 panoramic sunlit woodshop backdrop", url: `/data/${bootId}/assets/asset_01.png` },
      { id: "asset_02", kind: "texture" as const, model: "gemini-nano-banana-2.1", prompt: "Oiled workshop oak floor", url: `/data/${bootId}/assets/asset_02.png` },
      { id: "asset_03", kind: "product_image" as const, model: "gemini-nano-banana-2.1", prompt: "Studio photo of oak coffee stand", url: `/data/${bootId}/assets/asset_03.png` },
    ],
    variant_pools: {
      lighting: [
        { id: "workshop_warm", color_temp_k: 3200, intensity: 0.85, spot: false },
        { id: "bench_spot", color_temp_k: 2800, intensity: 0.75, spot: true },
      ],
      signage: { zone_bench: ["Oak Bench — coffee joinery", "Built for Morning Pour-Over"] },
    },
  };

  const adaptation_policy = {
    dynamic: "maker→collector",
    objective: "help each visitor find what fits them",
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
        when: "inspects(tag:coffee) >= 1 AND current_zone == zone_bench",
        do: { path: "/zones/zone_bench/slots/s_1/product_id", value: "top_product(tag:coffee, zone:zone_bench)" },
        why: "interested in coffee woodcraft; feature pour-over stand",
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
      name: "Casual Visitor",
      segment: "seg_brew",
      events: [{ t: 0, type: "enter_zone" as const, zone: "zone_bench" }],
      expected: ["sees entry oak coaster"],
    },
    {
      name: "Pour-Over Enthusiast",
      segment: "seg_brew",
      events: [
        { t: 0, type: "enter_zone" as const, zone: "zone_bench" },
        { t: 14, type: "inspect" as const, zone: "zone_bench", product_id: "p_oak_coaster" },
      ],
      expected: ["promotes p_oak_stand"],
    },
  ];

  const session_config = {
    boot_id: bootId,
    brand_card,
    catalog: products.map((p) => ({
      id: p.id,
      title: p.title,
      tier: p.tier,
      tags: p.tags,
      zone_id: p.zone_id,
      blurbs: p.blurbs,
    })),
    policy: adaptation_policy,
    pools: world_spec.variant_pools,
    base_state: {
      "/hero_plinth/product_id": "p_oak_coaster",
      "/guide_path/target_zone": "zone_bench",
      "/host_note": world_spec.host_note,
      "/zones/zone_bench/slots/s_1/product_id": "p_oak_coaster",
      "/zones/zone_bench/lighting": "workshop_warm",
      "/zones/zone_bench/signage": "Oak Bench — coffee joinery",
      "/blurbs/p_oak_coaster": 0 as const,
      "/blurbs/p_oak_stand": 0 as const,
    },
    demo_personas,
  };

  return {
    brand_core,
    brand_card,
    products,
    world_spec,
    adaptation_policy,
    demo_personas,
    session_config,
  };
}

describe("BootJobRunner manual function-calling loop", () => {
  it("runs all 6 tools, preserves thoughtSignature verbatim, embeds labeled host images, retries zod errors, pauses/resumes ask_host + shopify, and supports post-completion edits", async () => {
    const workspaceRoot = makeTempWorkspaceWithPrompt();
    const bootId = "sol-craft-run";
    const samplePng = createPaletteFallbackPng(["#D8C5A8"], { width: 16, height: 16 });

    const manifest = await saveBootInputs(workspaceRoot, bootId, {
      hostName: "Sol Rivera",
      hostType: "person",
      images: [
        { filename: "bench.png", mimeType: "image/png", dataBase64: samplePng.toString("base64") },
      ],
      urls: ["https://solcraft.example.com"],
      voiceSamples: ["Carved from kiln-dried white oak."],
    });

    const valid = makeCompleteArtifactSet(bootId);
    const capturedParams: CarbonTurnParams[] = [];
    let turn = 0;

    const mockCarbon: CarbonClient = {
      isAvailable: () => true,
      async generateTurn(params) {
        // Snapshot deep copy of contents sent on this turn so we can assert history integrity.
        capturedParams.push({
          ...params,
          contents: structuredClone(params.contents),
        });
        turn += 1;

        if (turn === 1) {
          // Turn 1: call read_inputs + fetch_url with a thoughtSignature on the functionCall part!
          return {
            content: {
              role: "model",
              parts: [
                { thought: true, text: "Inspecting inputs first." },
                {
                  functionCall: { id: "fc_1", name: "read_inputs", args: {} },
                  thoughtSignature: "SIG_TURN_1_ALPHA",
                },
                {
                  functionCall: {
                    id: "fc_2",
                    name: "fetch_url",
                    args: { url: "https://solcraft.example.com" },
                  },
                },
              ],
            },
          };
        }

        if (turn === 2) {
          // Turn 2: ask_host intake question
          return {
            content: {
              role: "model",
              parts: [
                {
                  functionCall: {
                    id: "fc_3",
                    name: "ask_host",
                    args: {
                      message: "How will you fulfill physical wood pieces, and may your face appear on posters?",
                      options: ["Own stock, no face", "Print on demand, yes face"],
                    },
                  },
                  thoughtSignature: "SIG_TURN_2_BETA",
                },
              ],
            },
          };
        }

        if (turn === 3) {
          // Turn 3: intentionally save invalid brand_core (bad slug) so runner returns zod error to model
          return {
            content: {
              role: "model",
              parts: [
                {
                  functionCall: {
                    id: "fc_4",
                    name: "save_artifact",
                    args: {
                      name: "brand_core",
                      json: { ...valid.brand_core, brand_slug: "BAD SLUG" },
                    },
                  },
                },
              ],
            },
          };
        }

        if (turn === 4) {
          // Turn 4: fix brand_core + save products + generate 3 images in parallel
          return {
            content: {
              role: "model",
              parts: [
                {
                  functionCall: {
                    id: "fc_5",
                    name: "save_artifact",
                    args: { name: "brand_core", json: valid.brand_core },
                  },
                },
                {
                  functionCall: {
                    id: "fc_6",
                    name: "save_artifact",
                    args: { name: "products", json: valid.products },
                  },
                },
                {
                  functionCall: {
                    id: "fc_7",
                    name: "generate_image",
                    args: {
                      prompt: "Wide 16:9 sunlit oak woodshop panoramic backdrop",
                      model: "gemini-nano-banana-2.1",
                      aspect: "16:9",
                      ref_asset_ids: ["img_01"],
                      kind: "texture",
                    },
                  },
                },
                {
                  functionCall: {
                    id: "fc_8",
                    name: "generate_image",
                    args: {
                      prompt: "Oiled workshop oak floor planks",
                      model: "gemini-nano-banana-2.1",
                      aspect: "1:1",
                      kind: "texture",
                    },
                  },
                },
                {
                  functionCall: {
                    id: "fc_9",
                    name: "generate_image",
                    args: {
                      prompt: "Studio photograph of oak and brass pour-over coffee stand",
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

        if (turn === 5) {
          // Turn 5: save world_spec, adaptation_policy, demo_personas + request_shopify_connection
          return {
            content: {
              role: "model",
              parts: [
                {
                  functionCall: {
                    id: "fc_10",
                    name: "save_artifact",
                    args: { name: "world_spec", json: valid.world_spec },
                  },
                },
                {
                  functionCall: {
                    id: "fc_11",
                    name: "save_artifact",
                    args: { name: "adaptation_policy", json: valid.adaptation_policy },
                  },
                },
                {
                  functionCall: {
                    id: "fc_12",
                    name: "save_artifact",
                    args: { name: "demo_personas", json: valid.demo_personas },
                  },
                },
                {
                  functionCall: {
                    id: "fc_13",
                    name: "request_shopify_connection",
                    args: {
                      scopes: ["read_products", "write_products"],
                    },
                  },
                },
              ],
            },
          };
        }

        if (turn === 6) {
          // Turn 6: save session_config
          return {
            content: {
              role: "model",
              parts: [
                {
                  functionCall: {
                    id: "fc_14",
                    name: "save_artifact",
                    args: { name: "session_config", json: valid.session_config },
                  },
                },
              ],
            },
          };
        }

        if (turn === 7) {
          // Turn 7: final handoff text
          return {
            content: {
              role: "model",
              parts: [{ text: "Your Sol Craft boutique is live! Items are marked coming soon." }],
            },
          };
        }

        // Turn 8: post-completion host edit response
        return {
          content: {
            role: "model",
            parts: [{ text: "Updated your welcome note tone as requested!" }],
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

    const runner = new BootJobRunner({
      workspaceRoot,
      bootId,
      manifest,
      carbonClient: mockCarbon,
      imageGenClient: mockImageGen,
      urlFetcher: async (url) => ({
        url,
        ok: true,
        status: 200,
        title: "Sol Craft Workshop",
        text: "White oak and solid brass coffee tools.",
        image_urls: ["https://solcraft.example.com/bench.jpg"],
      }),
      heartbeatIntervalMs: 0,
      imageRetryDelayMs: 0,
      apiRetryDelayMs: 0,
      logger: () => {},
    });

    const runPromise = runner.start();

    // Wait for ask_host pause on turn 2
    await waitForCondition(() => runner.getStatus() === "waiting_host");
    const snapWaitHost = runner.getSnapshot();
    expect(snapWaitHost.pendingQuestion?.kind).toBe("ask_host");
    expect(snapWaitHost.pendingQuestion?.options).toEqual([
      "Own stock, no face",
      "Print on demand, yes face",
    ]);

    const replyRes = runner.submitHostReply("Own stock, no face, you decide pricing.");
    expect(replyRes.ok).toBe(true);

    // Wait for request_shopify_connection pause on turn 5
    await waitForCondition(() => runner.getStatus() === "waiting_shopify");
    const snapWaitShopify = runner.getSnapshot();
    expect(snapWaitShopify.pendingQuestion?.kind).toBe("request_shopify_connection");
    expect(snapWaitShopify.assets).toHaveLength(3);
    expect(snapWaitShopify.brandRead?.dynamic).toBe("maker→collector");

    const shopifyRes = runner.submitShopifyResponse({ connected: false, skip: true });
    expect(shopifyRes.ok).toBe(true);

    // Wait for completion
    await runPromise;
    const completed = runner.getSnapshot();
    expect(completed.status).toBe("completed");
    expect(completed.readyToOpen).toBe(true);
    expect(completed.artifacts).toEqual(
      expect.arrayContaining([
        "brand_core",
        "products",
        "world_spec",
        "adaptation_policy",
        "demo_personas",
        "session_config",
      ])
    );

    // Verify orchestrator.md was loaded verbatim as systemInstruction
    expect(capturedParams[0]?.systemInstruction).toContain("# MyBrand Orchestrator");

    // Verify initial user turn attached uploaded photo with [img_01] label + inlineData
    const initialParts = capturedParams[0]?.contents[0]?.parts ?? [];
    expect(initialParts.some((p) => p.text?.includes("[img_01] bench.png"))).toBe(true);
    expect(initialParts.some((p) => p.inlineData?.mimeType === "image/png")).toBe(true);

    // Verify thoughtSignature from Turn 1 was preserved verbatim in Turn 2 history!
    const turn2HistoryModelParts = capturedParams[1]?.contents[1]?.parts ?? [];
    expect(
      turn2HistoryModelParts.some((p) => p.thoughtSignature === "SIG_TURN_1_ALPHA")
    ).toBe(true);

    // Verify zod error from Turn 3 was returned to Carbon in Turn 4's functionResponse!
    const turn4Contents = capturedParams[3]?.contents ?? [];
    const lastTurn4User = turn4Contents[turn4Contents.length - 1];
    const fc4Resp = lastTurn4User?.parts?.[0]?.functionResponse?.response as
      | { error?: string }
      | undefined;
    expect(fc4Resp?.error).toContain("brand_slug");

    // Verify artifacts on disk pass loadBootArtifacts
    const loaded = await loadBootArtifacts(workspaceRoot, bootId);
    expect(loaded).not.toBeNull();
    expect(loaded?.brand_core.brand_slug).toBe("sol-craft");

    // Verify post-completion follow-up host edit resumes cleanly
    const editRes = runner.submitHostReply("Make the greeting slightly warmer.");
    expect(editRes.ok).toBe(true);
    await waitForCondition(
      () =>
        runner.getStatus() === "completed" &&
        runner.getSnapshot().messages.some((m) =>
          m.text.includes("Updated your welcome note tone")
        )
    );

    runner.destroy();
  });

  it("redacts GEMINI_API_KEY if an SDK error includes the secret", async () => {
    const workspaceRoot = makeTempWorkspaceWithPrompt();
    const bootId = "redact-secret-boot";
    const manifest = await saveBootInputs(workspaceRoot, bootId, {
      hostName: "Secret Test",
      hostType: "company",
      images: [],
      urls: ["https://example.com"],
      voiceSamples: [],
    });

    const secret = "AIzaSy-SUPER-SECRET-TOKEN-999";
    const failingCarbon: CarbonClient = {
      isAvailable: () => true,
      async generateTurn() {
        throw new Error(`401 Unauthorized for key=${secret}`);
      },
    };

    const runner = new BootJobRunner({
      workspaceRoot,
      bootId,
      manifest,
      carbonClient: failingCarbon,
      imageGenClient: {
        isAvailable: () => true,
        async generateImage() {
          throw new Error("unused");
        },
      },
      urlFetcher: async (url) => ({ url, ok: false, error: "unused" }),
      secretsToRedact: [secret],
      heartbeatIntervalMs: 0,
      apiRetryDelayMs: 0,
      logger: () => {},
    });

    await runner.start();
    const snap = runner.getSnapshot();
    expect(snap.status).toBe("failed");
    expect(snap.error).toContain("[REDACTED]");
    expect(snap.error).not.toContain(secret);
    expect(JSON.stringify(snap)).not.toContain(secret);

    runner.destroy();
  });
});
