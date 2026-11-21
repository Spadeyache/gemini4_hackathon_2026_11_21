import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadBootArtifacts } from "../boot";
import { saveBootArtifact, type SavedArtifactCache } from "./artifacts";

const tempDirs: string[] = [];

function makeTempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mybrand-artifacts-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function buildValidArtifacts(bootId: string) {
  const brand_core = {
    brand_slug: "harbor-linen",
    host: { type: "person" as const, name: "Nora Lin" },
    positioning:
      "For coastal readers, Nora Lin is the workshop studio that weaves salt-washed linen objects.",
    values: ["slow craft", "natural dye", "open studio"],
    audience_segments: [
      {
        id: "seg_home",
        who: "coastal home minimalists",
        wants: "tactile everyday textiles",
        entry_tier: "entry" as const,
      },
      {
        id: "seg_collector",
        who: "textile collectors",
        wants: "hand-loomed editions",
        entry_tier: "signature" as const,
      },
    ],
    dynamic: {
      label: "maker→collector",
      evidence: ["voice_1: shares loom notes directly with buyers"],
    },
    strategy:
      "Invite visitors with accessible linen cloth napkins, then bridge them into limited indigo runners and custom woven hangings.",
    voice: {
      traits: ["calm", "tactile", "direct"],
      do: ["name exact weave and dye bath"],
      dont: ["use hype or flash sales"],
      samples: ["Woven at 14 ends per inch on the floor loom."],
    },
    visual: {
      palette_hex: ["#EAE3D5", "#2B4662", "#B88B58"],
      fonts: { display: "Fraunces", body: "Inter" },
      materials: ["unbleached flax", "weathered cedar", "indigo pigment"],
      lighting_mood: "soft coastal morning daylight",
      motifs: ["tide lines", "selvedge stripes"],
    },
    story_beats: [
      { zone_id: "zone_pier", beat: "Salt air, flax harvest, and dye vats" },
      { zone_id: "zone_loom", beat: "Daily table linens and signature wall hangings" },
    ],
    claims: [{ claim: "Natural indigo vat dyeing", source: "img_01" }],
    low_confidence: [],
  };

  const brand_card =
    "Harbor Linen is Nora Lin's coastal weaving studio. Voice: calm, tactile, specific about flax and natural indigo—never hype. Dynamic: maker→collector. Guide newcomers from entry linen napkins to indigo runners and hand-loomed wall hangings.";

  const products = [
    {
      id: "p_flax_napkin",
      handle: "mybrand-harbor-linen-flax-napkin",
      title: "Salt-Washed Flax Napkin Pair",
      tier: "entry" as const,
      kind: "physical" as const,
      product_type: "Table Linen",
      zone_id: "zone_pier",
      tags: ["mybrand", "mybrand:harbor-linen", `boot:${bootId}`, "linen", "table"],
      description: "Two unbleached flax napkins washed soft in studio rain water.",
      blurbs: [
        "Woven with a subtle raw selvedge stripe from our pier dye house.",
        "Pre-washed Belgian flax that softens with every dinner.",
      ] as [string, string],
      price: "24.00",
      currency: "USD",
      options: [{ name: "Shade", values: ["Oat", "Sea Salt"] }],
      variants: [{ options: { Shade: "Oat" }, price: "24.00", sku: "HL-NAP-01" }],
      image_asset_ids: ["asset_03"],
      evidence: ["img_01: woven linen texture"],
      shopify: {
        product_id: null,
        variant_ids: {},
        status: "DRAFT" as const,
        checkout_url: null,
      },
    },
    {
      id: "p_indigo_runner",
      handle: "mybrand-harbor-linen-indigo-runner",
      title: "Tide-Line Indigo Table Runner",
      tier: "core" as const,
      kind: "physical" as const,
      product_type: "Table Linen",
      zone_id: "zone_loom",
      tags: ["mybrand", "mybrand:harbor-linen", `boot:${bootId}`, "indigo", "table"],
      description: "Dip-dyed table runner capturing four passes in the studio indigo vat.",
      blurbs: [
        "Four hand-dipped indigo bands inspired by harbor low tide.",
        "Generous 220 cm length fits six-to-eight seat dining tables.",
      ] as [string, string],
      price: "78.00",
      currency: "USD",
      options: [{ name: "Length", values: ["220cm"] }],
      variants: [{ options: { Length: "220cm" }, price: "78.00", sku: "HL-RUN-01" }],
      image_asset_ids: ["asset_04"],
      evidence: ["img_02: indigo dipped cloth"],
      shopify: {
        product_id: null,
        variant_ids: {},
        status: "DRAFT" as const,
        checkout_url: null,
      },
    },
    {
      id: "p_loom_hanging",
      handle: "mybrand-harbor-linen-loom-hanging",
      title: "Numbered Driftwood Loom Hanging",
      tier: "signature" as const,
      kind: "physical" as const,
      product_type: "Wall Textile",
      zone_id: "zone_loom",
      tags: ["mybrand", "mybrand:harbor-linen", `boot:${bootId}`, "indigo", "edition"],
      description: "Signed floor-loom tapestry suspended on a hand-planed cedar dowel.",
      blurbs: [
        "One-of-ten studio weaving with raw flax fringe and deep indigo strata.",
        "Arrives ready to hang on cedar dowel with signed weave log card.",
      ] as [string, string],
      price: "240.00",
      currency: "USD",
      options: [{ name: "Edition", values: ["Signed"] }],
      variants: [{ options: { Edition: "Signed" }, price: "240.00", sku: "HL-HNG-01" }],
      image_asset_ids: ["asset_05"],
      evidence: ["img_03: wall loom textile"],
      shopify: {
        product_id: null,
        variant_ids: {},
        status: "DRAFT" as const,
        checkout_url: null,
      },
    },
  ];

  const world_spec = {
    boot_id: bootId,
    version: 1,
    room: {
      size_m: [14, 12, 4] as [number, number, number],
      floor_asset: "asset_02",
      wall_asset: "asset_01",
    },
    entrance: {
      position: [0, 0] as [number, number],
      greeting: "Welcome to Harbor Linen — woven by the tide.",
    },
    hero_plinth: {
      position: [0, 3] as [number, number],
      product_id: "p_flax_napkin",
    },
    guide_path: {
      target_zone: "zone_pier",
    },
    host_note: "Feel the raw flax first, or wander toward the indigo loom.",
    zones: [
      {
        id: "zone_pier",
        beat: "Salt air, flax harvest, and dye vats",
        center: [-3.5, 6] as [number, number],
        size: [5, 5] as [number, number],
        lighting: "coastal_morning",
        signage: "Pier Dye Bench — raw flax & salt washes",
        fixtures: [
          {
            id: "f_pier_table",
            type: "table" as const,
            position: [-3.5, 0, 6] as [number, number, number],
            rotation_deg: 0,
            slot_ids: ["s_pier_1"],
          },
        ],
        slots: [{ id: "s_pier_1", product_id: "p_flax_napkin" }],
      },
      {
        id: "zone_loom",
        beat: "Daily table linens and signature wall hangings",
        center: [3.5, 6] as [number, number],
        size: [5, 5] as [number, number],
        lighting: "warm_loom",
        signage: "Loom Room — indigo runners & editions",
        fixtures: [
          {
            id: "f_loom_rack",
            type: "rack" as const,
            position: [3.5, 0, 6] as [number, number, number],
            rotation_deg: 180,
            slot_ids: ["s_loom_1"],
          },
        ],
        slots: [{ id: "s_loom_1", product_id: "p_indigo_runner" }],
      },
    ],
    blurbs: {
      p_flax_napkin: 0 as const,
      p_indigo_runner: 0 as const,
      p_loom_hanging: 0 as const,
    },
    assets: [
      {
        id: "asset_01",
        kind: "texture" as const,
        model: "gemini-nano-banana-2.1",
        prompt: "Wide 16:9 sunlit coastal ocean horizon and weathered timber pier panorama",
        url: `/data/${bootId}/assets/asset_01.png`,
      },
      {
        id: "asset_02",
        kind: "texture" as const,
        model: "gemini-nano-banana-2.1",
        prompt: "Weathered coastal cedar boardwalk planks floor texture",
        url: `/data/${bootId}/assets/asset_02.png`,
      },
      {
        id: "asset_03",
        kind: "product_image" as const,
        model: "gemini-nano-banana-2.1",
        prompt: "Folded unbleached flax linen napkins on warm studio stone",
        url: `/data/${bootId}/assets/asset_03.png`,
      },
      {
        id: "asset_04",
        kind: "product_image" as const,
        model: "gemini-nano-banana-2.1",
        prompt: "Hand-dipped indigo linen table runner draped over cedar bench",
        url: `/data/${bootId}/assets/asset_04.png`,
      },
      {
        id: "asset_05",
        kind: "product_image" as const,
        model: "gemini-nano-banana-2.1",
        prompt: "Hand-loomed indigo and raw flax tapestry on cedar dowel",
        url: `/data/${bootId}/assets/asset_05.png`,
      },
    ],
    variant_pools: {
      lighting: [
        { id: "coastal_morning", color_temp_k: 4500, intensity: 0.9, spot: false },
        { id: "warm_loom", color_temp_k: 3100, intensity: 0.82, spot: false },
        { id: "indigo_spot", color_temp_k: 2800, intensity: 0.72, spot: true },
      ],
      signage: {
        zone_pier: [
          "Pier Dye Bench — raw flax & salt washes",
          "Start with Flax — everyday woven linens",
        ],
        zone_loom: [
          "Loom Room — indigo runners & editions",
          "Indigo Vat Editions — hand-loomed pieces",
        ],
      },
    },
  };

  const adaptation_policy = {
    dynamic: "maker→collector",
    objective: "help each visitor find what fits them: look → inspect → add to cart",
    levers: [
      { path: "/hero_plinth/product_id", allowed: "any product id" },
      {
        path: "/zones/{zone}/slots/{slot}/product_id",
        allowed: "ids of products assigned to {zone}",
      },
      { path: "/zones/{zone}/lighting", allowed: "ids in variant_pools.lighting" },
      {
        path: "/zones/{zone}/signage",
        allowed: "variant_pools.signage[{zone}], or a rewrite <=60 chars",
      },
      { path: "/blurbs/{product}", allowed: "0 or 1" },
      { path: "/host_note", allowed: "rewrite <=90 chars in host voice" },
      { path: "/guide_path/target_zone", allowed: "any zone id" },
    ],
    frozen: ["brand_core", "room", "entrance", "fixtures", "prices"],
    rules: [
      {
        id: "r1",
        priority: 1,
        when: "inspects(tag:indigo) >= 1 AND current_zone == zone_loom",
        do: {
          path: "/zones/zone_loom/slots/s_loom_1/product_id",
          value: "top_product(tag:indigo, zone:zone_loom)",
        },
        why: "drawn to indigo weaving; elevate signature hanging",
      },
      {
        id: "r2",
        priority: 2,
        when: "dwell_s(zone_loom) >= 10 AND current_zone == zone_loom",
        do: {
          path: "/zones/zone_loom/lighting",
          value: "indigo_spot",
        },
        why: "lingering at the loom; bring up focused gallery spotlight",
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
      name: "Everyday Linen Shopper",
      segment: "seg_home",
      events: [
        { t: 0, type: "enter_zone" as const, zone: "zone_pier" },
        { t: 8, type: "inspect" as const, zone: "zone_pier", product_id: "p_flax_napkin" },
      ],
      expected: ["stays grounded in zone_pier with practical flax copy"],
    },
    {
      name: "Indigo Textile Collector",
      segment: "seg_collector",
      events: [
        { t: 0, type: "enter_zone" as const, zone: "zone_loom" },
        { t: 12, type: "inspect" as const, zone: "zone_loom", product_id: "p_indigo_runner" },
      ],
      expected: ["promotes p_loom_hanging and shifts zone_loom to indigo_spot"],
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
      "/hero_plinth/product_id": "p_flax_napkin",
      "/guide_path/target_zone": "zone_pier",
      "/host_note": world_spec.host_note,
      "/zones/zone_pier/slots/s_pier_1/product_id": "p_flax_napkin",
      "/zones/zone_loom/slots/s_loom_1/product_id": "p_indigo_runner",
      "/zones/zone_pier/lighting": "coastal_morning",
      "/zones/zone_loom/lighting": "warm_loom",
      "/zones/zone_pier/signage": world_spec.zones[0].signage,
      "/zones/zone_loom/signage": world_spec.zones[1].signage,
      "/blurbs/p_flax_napkin": 0 as const,
      "/blurbs/p_indigo_runner": 0 as const,
      "/blurbs/p_loom_hanging": 0 as const,
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

describe("saveBootArtifact validation and persistence", () => {
  it("validates all 7 artifacts, gates readyToOpen on all 6 required files, and round-trips through loadBootArtifacts", async () => {
    const workspaceRoot = makeTempWorkspace();
    const bootId = "harbor-linen-test";
    const cache: SavedArtifactCache = {};
    const savedNames = new Set<string>();
    const ctx = { workspaceRoot, bootId, cache, savedNames };
    const artifacts = buildValidArtifacts(bootId);

    const r1 = await saveBootArtifact("brand_core", artifacts.brand_core, ctx);
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      expect(r1.readyToOpen).toBe(false);
      expect(r1.brandRead?.dynamic).toBe("maker→collector");
      expect(r1.brandRead?.palette_hex).toEqual(["#EAE3D5", "#2B4662", "#B88B58"]);
    }

    const rCard = await saveBootArtifact("brand_card", { brand_card: artifacts.brand_card }, ctx);
    expect(rCard.ok).toBe(true);

    // Test stringified JSON payload handling as well.
    const r2 = await saveBootArtifact("products", JSON.stringify(artifacts.products), ctx);
    expect(r2.ok).toBe(true);

    const r3 = await saveBootArtifact("world_spec", artifacts.world_spec, ctx);
    expect(r3.ok).toBe(true);

    const r4 = await saveBootArtifact("adaptation_policy", artifacts.adaptation_policy, ctx);
    expect(r4.ok).toBe(true);

    const r5 = await saveBootArtifact("demo_personas", artifacts.demo_personas, ctx);
    expect(r5.ok).toBe(true);
    if (r5.ok) expect(r5.readyToOpen).toBe(false);

    const r6 = await saveBootArtifact("session_config", artifacts.session_config, ctx);
    expect(r6.ok).toBe(true);
    if (r6.ok) {
      expect(r6.readyToOpen).toBe(true);
    }

    const loaded = await loadBootArtifacts(workspaceRoot, bootId);
    expect(loaded).not.toBeNull();
    expect(loaded?.brand_core.brand_slug).toBe("harbor-linen");
    expect(loaded?.products).toHaveLength(3);
    expect(loaded?.world_spec.zones).toHaveLength(2);
  });

  it("returns actionable zod errors without writing corrupt files", async () => {
    const workspaceRoot = makeTempWorkspace();
    const bootId = "bad-zod-test";
    const ctx = {
      workspaceRoot,
      bootId,
      cache: {} as SavedArtifactCache,
      savedNames: new Set<string>(),
    };

    const badCore = {
      ...buildValidArtifacts(bootId).brand_core,
      brand_slug: "NOT KEBAB CASE!",
    };
    const res = await saveBootArtifact("brand_core", badCore, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("brand_slug");
      expect(res.error).toContain("kebab-case");
    }

    const targetPath = path.join(
      workspaceRoot,
      "server",
      "data",
      bootId,
      "brand_core.json"
    );
    expect(fs.existsSync(targetPath)).toBe(false);
  });

  it("catches cross-artifact mismatches (wrong zone, bad §5 when syntax, missing base_state keys, external asset URLs)", async () => {
    const workspaceRoot = makeTempWorkspace();
    const bootId = "cross-check-test";
    const ctx = {
      workspaceRoot,
      bootId,
      cache: {} as SavedArtifactCache,
      savedNames: new Set<string>(),
    };
    const artifacts = buildValidArtifacts(bootId);

    expect((await saveBootArtifact("brand_core", artifacts.brand_core, ctx)).ok).toBe(true);

    // Product pointing to unknown zone_id
    const badProducts = [
      { ...artifacts.products[0], zone_id: "zone_nonexistent" },
    ];
    const prodRes = await saveBootArtifact("products", badProducts, ctx);
    expect(prodRes.ok).toBe(false);
    if (!prodRes.ok) expect(prodRes.error).toContain("zone_nonexistent");

    expect((await saveBootArtifact("products", artifacts.products, ctx)).ok).toBe(true);

    // World spec with external URL
    const badWorld = {
      ...artifacts.world_spec,
      assets: [
        { ...artifacts.world_spec.assets[0], url: "https://example.com/fake.png" },
        ...artifacts.world_spec.assets.slice(1),
      ],
    };
    const worldRes = await saveBootArtifact("world_spec", badWorld, ctx);
    expect(worldRes.ok).toBe(false);
    if (!worldRes.ok) expect(worldRes.error).toContain(`/data/${bootId}/assets/`);

    expect((await saveBootArtifact("world_spec", artifacts.world_spec, ctx)).ok).toBe(true);

    // Policy with invalid §5 signal name
    const badPolicy = {
      ...artifacts.adaptation_policy,
      rules: [
        {
          ...artifacts.adaptation_policy.rules[0],
          when: "time_spent(zone_loom) >= 5",
        },
      ],
    };
    const polRes = await saveBootArtifact("adaptation_policy", badPolicy, ctx);
    expect(polRes.ok).toBe(false);
    if (!polRes.ok) expect(polRes.error).toContain("invalid §5 clause");

    // session_config missing a required base_state lever
    const badSessionBaseState = { ...artifacts.session_config.base_state };
    delete (badSessionBaseState as Record<string, unknown>)["/zones/zone_loom/lighting"];
    const badSession = {
      ...artifacts.session_config,
      base_state: badSessionBaseState,
    };
    const sessRes = await saveBootArtifact("session_config", badSession, ctx);
    expect(sessRes.ok).toBe(false);
    if (!sessRes.ok) expect(sessRes.error).toContain("/zones/zone_loom/lighting");
  });
});
