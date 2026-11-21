import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AdaptationPolicySchema,
  BrandCoreSchema,
  DemoPersonasSchema,
  EventSchema,
  OpSchema,
  ProductsSchema,
  SessionAdapterOutputSchema,
  SessionConfigSchema,
  WorldSpecSchema,
} from "./schemas";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, "..", "fixtures", "demo-brand");

function loadFixtureJson(filename: string): unknown {
  const fullPath = path.join(FIXTURE_DIR, filename);
  return JSON.parse(fs.readFileSync(fullPath, "utf-8")) as unknown;
}

describe("fixtures/demo-brand schema validation", () => {
  it("parses every fixture file against its §5 zod schema", () => {
    const brandCore = BrandCoreSchema.parse(loadFixtureJson("brand_core.json"));
    const products = ProductsSchema.parse(loadFixtureJson("products.json"));
    const worldSpec = WorldSpecSchema.parse(loadFixtureJson("world_spec.json"));
    const policy = AdaptationPolicySchema.parse(
      loadFixtureJson("adaptation_policy.json")
    );
    const personas = DemoPersonasSchema.parse(
      loadFixtureJson("demo_personas.json")
    );
    const sessionConfig = SessionConfigSchema.parse(
      loadFixtureJson("session_config.json")
    );

    expect(brandCore.brand_slug).toBe("kestrel-clay");
    expect(products).toHaveLength(9);
    expect(worldSpec.zones).toHaveLength(3);
    expect(worldSpec.variant_pools.lighting).toHaveLength(3);
    expect(policy.rules).toHaveLength(6);
    expect(personas).toHaveLength(2);
    expect(sessionConfig.boot_id).toBe("demo-brand");
  });

  it("ensures every zone has ≥3 assigned products and supports slot swaps across all tiers", () => {
    const products = ProductsSchema.parse(loadFixtureJson("products.json"));
    const worldSpec = WorldSpecSchema.parse(loadFixtureJson("world_spec.json"));

    const tiers = new Set(products.map((p) => p.tier));
    expect(tiers).toEqual(new Set(["entry", "core", "signature"]));

    const zoneIds = new Set(worldSpec.zones.map((z) => z.id));
    const productsByZone = new Map<string, string[]>();
    for (const z of zoneIds) {
      productsByZone.set(z, []);
    }

    for (const product of products) {
      expect(zoneIds.has(product.zone_id)).toBe(true);
      productsByZone.get(product.zone_id)?.push(product.id);
    }

    for (const zone of worldSpec.zones) {
      const assigned = productsByZone.get(zone.id) ?? [];
      expect(assigned.length).toBeGreaterThanOrEqual(3);
      expect(assigned.length).toBeGreaterThan(zone.slots.length);

      for (const slot of zone.slots) {
        expect(assigned).toContain(slot.product_id);
      }

      const signagePool = worldSpec.variant_pools.signage[zone.id];
      expect(signagePool).toHaveLength(2);
      expect(signagePool).toContain(zone.signage);
    }
  });

  it("maintains cross-file consistency and respects asset/object budgets", () => {
    const brandCore = BrandCoreSchema.parse(loadFixtureJson("brand_core.json"));
    const products = ProductsSchema.parse(loadFixtureJson("products.json"));
    const worldSpec = WorldSpecSchema.parse(loadFixtureJson("world_spec.json"));
    const policy = AdaptationPolicySchema.parse(
      loadFixtureJson("adaptation_policy.json")
    );
    const personas = DemoPersonasSchema.parse(
      loadFixtureJson("demo_personas.json")
    );
    const sessionConfig = SessionConfigSchema.parse(
      loadFixtureJson("session_config.json")
    );

    const productIds = new Set(products.map((p) => p.id));
    const zoneIds = new Set(worldSpec.zones.map((z) => z.id));
    const lightingIds = new Set(
      worldSpec.variant_pools.lighting.map((l) => l.id)
    );
    const assetIds = new Set(worldSpec.assets.map((a) => a.id));

    expect(brandCore.story_beats.map((b) => b.zone_id)).toEqual(
      worldSpec.zones.map((z) => z.id)
    );
    expect(productIds.has(worldSpec.hero_plinth.product_id)).toBe(true);
    expect(zoneIds.has(worldSpec.guide_path.target_zone)).toBe(true);
    expect(assetIds.has(worldSpec.room.floor_asset)).toBe(true);
    expect(assetIds.has(worldSpec.room.wall_asset)).toBe(true);

    // Budget checks (≤12 textures, assets exist on disk)
    const textureAssets = worldSpec.assets.filter((a) => a.kind === "texture");
    expect(textureAssets.length).toBeLessThanOrEqual(12);
    expect(worldSpec.assets.length).toBeLessThanOrEqual(12);

    for (const asset of worldSpec.assets) {
      const filename = path.basename(asset.url);
      const onDisk = path.join(FIXTURE_DIR, "assets", filename);
      expect(fs.existsSync(onDisk)).toBe(true);
    }

    for (const product of products) {
      for (const assetId of product.image_asset_ids) {
        expect(assetIds.has(assetId)).toBe(true);
      }
      expect(worldSpec.blurbs[product.id]).toBeDefined();
      expect(sessionConfig.base_state[`/blurbs/${product.id}`]).toBe(
        worldSpec.blurbs[product.id]
      );
    }

    for (const zone of worldSpec.zones) {
      expect(lightingIds.has(zone.lighting)).toBe(true);
      expect(sessionConfig.base_state[`/zones/${zone.id}/lighting`]).toBe(
        zone.lighting
      );
      expect(sessionConfig.base_state[`/zones/${zone.id}/signage`]).toBe(
        zone.signage
      );
      for (const slot of zone.slots) {
        expect(
          sessionConfig.base_state[
            `/zones/${zone.id}/slots/${slot.id}/product_id`
          ]
        ).toBe(slot.product_id);
      }
    }

    expect(sessionConfig.base_state["/hero_plinth/product_id"]).toBe(
      worldSpec.hero_plinth.product_id
    );
    expect(sessionConfig.base_state["/guide_path/target_zone"]).toBe(
      worldSpec.guide_path.target_zone
    );
    expect(sessionConfig.base_state["/host_note"]).toBe(worldSpec.host_note);
    expect(sessionConfig.policy).toEqual(policy);
    expect(sessionConfig.pools).toEqual(worldSpec.variant_pools);
    expect(sessionConfig.demo_personas).toEqual(personas);
    expect(sessionConfig.catalog.map((c) => c.id)).toEqual(
      products.map((p) => p.id)
    );

    // Every persona event references valid zones and products
    for (const persona of personas) {
      for (const ev of persona.events) {
        if (ev.zone) expect(zoneIds.has(ev.zone)).toBe(true);
        if (ev.product_id) expect(productIds.has(ev.product_id)).toBe(true);
      }
    }
  });
});

describe("event and op schemas", () => {
  it("validates §5 event payloads and rejects invalid event types", () => {
    const valid = EventSchema.parse({
      t: 12.4,
      type: "look",
      zone: "zone_table",
      product_id: "p_ash_glaze_dripper",
      ms: 2100,
    });
    expect(valid.type).toBe("look");

    expect(() =>
      EventSchema.parse({ t: 1, type: "teleport", zone: "zone_kiln" })
    ).toThrow();
  });

  it("validates §5 op and Session Adapter output payloads", () => {
    const op = OpSchema.parse({
      op: "replace",
      path: "/blurbs/p_ash_glaze_dripper",
      value: 1,
      reason: "looked 3.4s at dripper; show practical brewing blurb",
    });
    expect(op.value).toBe(1);

    const output = SessionAdapterOutputSchema.parse({
      ops: [op],
      visitor_read: "morning pour-over brewer",
      confidence: 0.78,
    });
    expect(output.ops).toHaveLength(1);

    expect(() =>
      OpSchema.parse({
        op: "remove",
        path: "/host_note",
        value: "",
        reason: "invalid op verb",
      })
    ).toThrow();
  });
});
