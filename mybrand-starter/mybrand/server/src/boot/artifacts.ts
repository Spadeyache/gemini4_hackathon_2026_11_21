import fs from "node:fs/promises";
import path from "node:path";
import type { ZodError } from "zod";
import {
  AdaptationPolicySchema,
  BrandCardSchema,
  BrandCoreSchema,
  DemoPersonasSchema,
  ProductsSchema,
  SessionConfigSchema,
  WorldSpecSchema,
  type AdaptationPolicy,
  type BrandCore,
  type DemoPersonas,
  type Products,
  type SessionConfig,
  type WorldSpec,
} from "@mybrand/shared";
import { REQUIRED_BOOT_ARTIFACTS } from "../boot";
import { getBootDataDir } from "./inputs";
import type { BootBrandRead } from "./types";

export const SAVABLE_ARTIFACTS = [
  "brand_core",
  "brand_card",
  "products",
  "world_spec",
  "adaptation_policy",
  "demo_personas",
  "session_config",
] as const;

export type SavableArtifactName = (typeof SAVABLE_ARTIFACTS)[number];

export interface SavedArtifactCache {
  brand_core?: BrandCore;
  brand_card?: string;
  products?: Products;
  world_spec?: WorldSpec;
  adaptation_policy?: AdaptationPolicy;
  demo_personas?: DemoPersonas;
  session_config?: SessionConfig;
}

const MAX_WORLD_OBJECTS = 60;
const MAX_WORLD_TEXTURES = 12;

// Exact §5 clause patterns mirroring server/src/session/rules.ts so generated rules
// always execute cleanly in M2's deterministic rules engine.
const CURRENT_ZONE_CLAUSE_RE = /^current_zone\s*(==|!=)\s*([a-zA-Z0-9_:-]+)$/;
const SIGNAL_CLAUSE_RE =
  /^(dwell_s|look_s|quick_exits|inspects|add_to_cart|remove_from_cart)\(\s*([^)]+?)\s*\)\s*(>=|<=|>|<|==|!=)\s*(-?\d+(?:\.\d+)?)$/;

function formatZodError(name: string, error: ZodError): string {
  const details = error.issues
    .slice(0, 12)
    .map((issue) => {
      const p = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${p}: ${issue.message}`;
    })
    .join("; ");
  return `${name} failed zod schema validation: ${details}`;
}

function leverTemplateToRegex(template: string): RegExp {
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.replace(/\\\{[^}]+\\\}/g, "[^/]+");
  return new RegExp(`^${pattern}$`);
}

function validateWhenExpression(whenExpr: string): string | null {
  const trimmed = whenExpr.trim();
  if (!trimmed) return "empty 'when' expression";
  const clauses = trimmed.split(/\s+AND\s+/);
  for (const rawClause of clauses) {
    const clause = rawClause.trim();
    if (!clause) return `empty clause in '${whenExpr}'`;
    if (CURRENT_ZONE_CLAUSE_RE.test(clause)) continue;
    if (SIGNAL_CLAUSE_RE.test(clause)) continue;
    return `invalid §5 clause '${clause}' (use current_zone == id or signal(arg) op number with signals: dwell_s, look_s, quick_exits, inspects, add_to_cart, remove_from_cart, joined by AND)`;
  }
  return null;
}

function validatePolicySemantics(
  policy: AdaptationPolicy,
  prefix: string
): string[] {
  const errors: string[] = [];
  const leverRegexes = policy.levers.map((lever) =>
    leverTemplateToRegex(lever.path)
  );

  for (const rule of policy.rules) {
    const whenErr = validateWhenExpression(rule.when);
    if (whenErr) {
      errors.push(`${prefix}.rules[${rule.id}].when: ${whenErr}`);
    }
    if (!leverRegexes.some((re) => re.test(rule.do.path))) {
      errors.push(
        `${prefix}.rules[${rule.id}].do.path '${rule.do.path}' does not match any declared lever template`
      );
    }
  }
  return errors;
}

function validateCrossArtifactInvariants(
  name: SavableArtifactName,
  parsed: unknown,
  bootId: string,
  cache: SavedArtifactCache
): string[] {
  const errors: string[] = [];

  if (name === "brand_core") {
    const core = parsed as BrandCore;
    const seenZones = new Set<string>();
    for (const beat of core.story_beats) {
      if (seenZones.has(beat.zone_id)) {
        errors.push(`brand_core.story_beats has duplicate zone_id '${beat.zone_id}'`);
      }
      seenZones.add(beat.zone_id);
    }
    return errors;
  }

  if (name === "products") {
    const products = parsed as Products;
    const ids = new Set<string>();
    const handles = new Set<string>();
    const knownStoryZones = cache.brand_core
      ? new Set(cache.brand_core.story_beats.map((b) => b.zone_id))
      : null;

    for (const product of products) {
      if (ids.has(product.id)) {
        errors.push(`products has duplicate id '${product.id}'`);
      }
      ids.add(product.id);

      if (handles.has(product.handle)) {
        errors.push(`products has duplicate handle '${product.handle}'`);
      }
      handles.add(product.handle);

      if (knownStoryZones && !knownStoryZones.has(product.zone_id)) {
        errors.push(
          `product '${product.id}' references zone_id '${product.zone_id}' not in brand_core.story_beats (${Array.from(knownStoryZones).join(", ")})`
        );
      }
    }
    return errors;
  }

  if (name === "world_spec") {
    const world = parsed as WorldSpec;
    if (world.boot_id !== bootId) {
      errors.push(
        `world_spec.boot_id must be '${bootId}', got '${world.boot_id}'`
      );
    }

    if (world.assets.length > MAX_WORLD_TEXTURES) {
      errors.push(
        `world_spec.assets exceeds texture budget (${world.assets.length} > ${MAX_WORLD_TEXTURES})`
      );
    }

    const assetIds = new Set(world.assets.map((a) => a.id));
    for (const asset of world.assets) {
      if (
        !asset.url.startsWith(`/data/${bootId}/assets/`) &&
        !asset.url.startsWith("/fixtures/")
      ) {
        errors.push(
          `world_spec.assets[${asset.id}].url must be a generated asset URL starting with '/data/${bootId}/assets/', got '${asset.url}'`
        );
      }
    }
    if (!assetIds.has(world.room.floor_asset)) {
      errors.push(
        `world_spec.room.floor_asset '${world.room.floor_asset}' is missing from world_spec.assets`
      );
    }
    if (!assetIds.has(world.room.wall_asset)) {
      errors.push(
        `world_spec.room.wall_asset '${world.room.wall_asset}' is missing from world_spec.assets`
      );
    }

    const lightingIds = new Set(world.variant_pools.lighting.map((l) => l.id));
    const zoneIds = new Set<string>();
    const productsById = cache.products
      ? new Map(cache.products.map((p) => [p.id, p]))
      : null;

    let objectCount = 7; // 6 room shell surfaces + 1 hero plinth
    for (const zone of world.zones) {
      if (zoneIds.has(zone.id)) {
        errors.push(`world_spec.zones has duplicate id '${zone.id}'`);
      }
      zoneIds.add(zone.id);

      if (!lightingIds.has(zone.lighting)) {
        errors.push(
          `zone '${zone.id}' lighting '${zone.lighting}' is not in variant_pools.lighting`
        );
      }
      if (
        !world.variant_pools.signage[zone.id] ||
        world.variant_pools.signage[zone.id].length === 0
      ) {
        errors.push(
          `world_spec.variant_pools.signage is missing entries for zone '${zone.id}'`
        );
      }

      const slotIds = new Set(zone.slots.map((s) => s.id));
      for (const fixture of zone.fixtures) {
        objectCount += 1;
        for (const sid of fixture.slot_ids) {
          if (!slotIds.has(sid)) {
            errors.push(
              `fixture '${fixture.id}' in zone '${zone.id}' references unknown slot_id '${sid}'`
            );
          }
        }
      }

      for (const slot of zone.slots) {
        objectCount += 1;
        if (productsById) {
          const prod = productsById.get(slot.product_id);
          if (!prod) {
            errors.push(
              `zone '${zone.id}' slot '${slot.id}' references unknown product_id '${slot.product_id}'`
            );
          } else if (prod.zone_id !== zone.id) {
            errors.push(
              `zone '${zone.id}' slot '${slot.id}' has product '${prod.id}' whose zone_id is '${prod.zone_id}' (slots may only hold products assigned to that zone)`
            );
          }
        }
      }
    }

    if (objectCount > MAX_WORLD_OBJECTS) {
      errors.push(
        `world_spec exceeds object budget (${objectCount} > ${MAX_WORLD_OBJECTS})`
      );
    }

    if (!zoneIds.has(world.guide_path.target_zone)) {
      errors.push(
        `world_spec.guide_path.target_zone '${world.guide_path.target_zone}' is not a valid zone id`
      );
    }

    if (productsById) {
      if (!productsById.has(world.hero_plinth.product_id)) {
        errors.push(
          `world_spec.hero_plinth.product_id '${world.hero_plinth.product_id}' is not in products`
        );
      }
      for (const product of productsById.values()) {
        if (!(product.id in world.blurbs)) {
          errors.push(
            `world_spec.blurbs is missing entry for product '${product.id}'`
          );
        }
      }
    }

    return errors;
  }

  if (name === "adaptation_policy") {
    const policy = parsed as AdaptationPolicy;
    errors.push(...validatePolicySemantics(policy, "adaptation_policy"));
    return errors;
  }

  if (name === "demo_personas") {
    const personas = parsed as DemoPersonas;
    const knownZones = cache.world_spec
      ? new Set(cache.world_spec.zones.map((z) => z.id))
      : null;
    const knownProducts = cache.products
      ? new Set(cache.products.map((p) => p.id))
      : null;

    for (const persona of personas) {
      for (const ev of persona.events) {
        if (ev.zone && knownZones && !knownZones.has(ev.zone)) {
          errors.push(
            `demo_personas '${persona.name}' event references unknown zone '${ev.zone}'`
          );
        }
        if (ev.product_id && knownProducts && !knownProducts.has(ev.product_id)) {
          errors.push(
            `demo_personas '${persona.name}' event references unknown product_id '${ev.product_id}'`
          );
        }
      }
    }
    return errors;
  }

  if (name === "session_config") {
    const config = parsed as SessionConfig;
    if (config.boot_id !== bootId) {
      errors.push(
        `session_config.boot_id must be '${bootId}', got '${config.boot_id}'`
      );
    }
    errors.push(...validatePolicySemantics(config.policy, "session_config.policy"));

    const requiredKeys = [
      "/hero_plinth/product_id",
      "/guide_path/target_zone",
      "/host_note",
    ];
    for (const item of config.catalog) {
      requiredKeys.push(`/blurbs/${item.id}`);
    }
    if (cache.world_spec) {
      for (const zone of cache.world_spec.zones) {
        requiredKeys.push(`/zones/${zone.id}/lighting`);
        requiredKeys.push(`/zones/${zone.id}/signage`);
        for (const slot of zone.slots) {
          requiredKeys.push(`/zones/${zone.id}/slots/${slot.id}/product_id`);
        }
      }
    }

    for (const key of requiredKeys) {
      if (!(key in config.base_state)) {
        errors.push(`session_config.base_state is missing required lever '${key}'`);
      }
    }

    for (const rule of config.policy.rules) {
      if (
        rule.do.path !== "/host_note" &&
        rule.do.path !== "/guide_path/target_zone" &&
        !(rule.do.path in config.base_state)
      ) {
        errors.push(
          `session_config.policy.rules[${rule.id}].do.path '${rule.do.path}' does not exist in session_config.base_state`
        );
      }
    }
    return errors;
  }

  return errors;
}

export function buildBrandRead(core: BrandCore): BootBrandRead {
  const audience = core.audience_segments.map((seg) => seg.who).join(" · ");
  const voice = core.voice.traits.join(", ");
  const lookParts = [core.visual.lighting_mood, core.visual.materials.join(", ")].filter(
    Boolean
  );
  return {
    positioning: core.positioning,
    audience,
    dynamic: core.dynamic.label,
    strategy: core.strategy,
    voice,
    look: lookParts.join(" — "),
    palette_hex: core.visual.palette_hex,
  };
}

export function isBootReady(savedNames: ReadonlySet<string>): boolean {
  return REQUIRED_BOOT_ARTIFACTS.every((req) => savedNames.has(req));
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match ? match[1]!.trim() : trimmed;
}

function stripEmptyOptionalEventFields(personas: unknown): unknown {
  if (!Array.isArray(personas)) return personas;
  return personas.map((persona) => {
    if (!persona || typeof persona !== "object" || !Array.isArray((persona as { events?: unknown }).events)) {
      return persona;
    }
    const events = (persona as { events: unknown[] }).events.map((ev) => {
      if (!ev || typeof ev !== "object") return ev;
      const copy: Record<string, unknown> = { ...(ev as Record<string, unknown>) };
      if (copy.zone === "") delete copy.zone;
      if (copy.product_id === "") delete copy.product_id;
      return copy;
    });
    return { ...(persona as Record<string, unknown>), events };
  });
}

function sanitizeParsedPayload(name: SavableArtifactName, value: unknown): unknown {
  if (name === "demo_personas") {
    return stripEmptyOptionalEventFields(value);
  }
  if (name === "session_config" && value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("demo_personas" in obj) {
      return {
        ...obj,
        demo_personas: stripEmptyOptionalEventFields(obj.demo_personas),
      };
    }
  }
  return value;
}

function normalizeArtifactPayload(
  name: SavableArtifactName,
  raw: unknown
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (name === "brand_card") {
    if (typeof raw === "string") {
      const cleaned = stripCodeFence(raw);
      if (cleaned.startsWith("{") || cleaned.startsWith("\"")) {
        try {
          const parsed = JSON.parse(cleaned) as unknown;
          if (typeof parsed === "string") {
            return { ok: true, value: parsed };
          }
          if (
            parsed &&
            typeof parsed === "object" &&
            "brand_card" in parsed &&
            typeof (parsed as { brand_card: unknown }).brand_card === "string"
          ) {
            return {
              ok: true,
              value: (parsed as { brand_card: string }).brand_card,
            };
          }
        } catch {
          // treat as plain string below
        }
      }
      return { ok: true, value: cleaned };
    }
    if (
      raw &&
      typeof raw === "object" &&
      "brand_card" in raw &&
      typeof (raw as { brand_card: unknown }).brand_card === "string"
    ) {
      return { ok: true, value: (raw as { brand_card: string }).brand_card };
    }
    return { ok: true, value: raw };
  }

  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(stripCodeFence(raw)) as unknown;
      return { ok: true, value: sanitizeParsedPayload(name, parsed) };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: `${name} JSON string could not be parsed: ${msg}`,
      };
    }
  }

  return { ok: true, value: sanitizeParsedPayload(name, raw) };
}

function parseBySchema(
  name: SavableArtifactName,
  value: unknown
): { ok: true; data: unknown } | { ok: false; error: string } {
  switch (name) {
    case "brand_core": {
      const res = BrandCoreSchema.safeParse(value);
      return res.success
        ? { ok: true, data: res.data }
        : { ok: false, error: formatZodError(name, res.error) };
    }
    case "brand_card": {
      const res = BrandCardSchema.safeParse(value);
      return res.success
        ? { ok: true, data: res.data }
        : { ok: false, error: formatZodError(name, res.error) };
    }
    case "products": {
      const res = ProductsSchema.safeParse(value);
      return res.success
        ? { ok: true, data: res.data }
        : { ok: false, error: formatZodError(name, res.error) };
    }
    case "world_spec": {
      const res = WorldSpecSchema.safeParse(value);
      return res.success
        ? { ok: true, data: res.data }
        : { ok: false, error: formatZodError(name, res.error) };
    }
    case "adaptation_policy": {
      const res = AdaptationPolicySchema.safeParse(value);
      return res.success
        ? { ok: true, data: res.data }
        : { ok: false, error: formatZodError(name, res.error) };
    }
    case "demo_personas": {
      const res = DemoPersonasSchema.safeParse(value);
      return res.success
        ? { ok: true, data: res.data }
        : { ok: false, error: formatZodError(name, res.error) };
    }
    case "session_config": {
      const res = SessionConfigSchema.safeParse(value);
      return res.success
        ? { ok: true, data: res.data }
        : { ok: false, error: formatZodError(name, res.error) };
    }
  }
}

export interface SaveArtifactContext {
  workspaceRoot: string;
  bootId: string;
  cache: SavedArtifactCache;
  savedNames: Set<string>;
}

export type SaveArtifactResult =
  | {
      ok: true;
      name: SavableArtifactName;
      savedPath: string;
      artifacts: string[];
      readyToOpen: boolean;
      brandRead?: BootBrandRead;
    }
  | {
      ok: false;
      error: string;
    };

export async function saveBootArtifact(
  rawName: string,
  rawJson: unknown,
  ctx: SaveArtifactContext
): Promise<SaveArtifactResult> {
  if (!SAVABLE_ARTIFACTS.includes(rawName as SavableArtifactName)) {
    return {
      ok: false,
      error: `Unknown artifact name '${rawName}'. Allowed names: ${SAVABLE_ARTIFACTS.join(", ")}`,
    };
  }
  const name = rawName as SavableArtifactName;

  const normalized = normalizeArtifactPayload(name, rawJson);
  if (!normalized.ok) {
    return normalized;
  }

  const zodResult = parseBySchema(name, normalized.value);
  if (!zodResult.ok) {
    return zodResult;
  }

  const semanticErrors = validateCrossArtifactInvariants(
    name,
    zodResult.data,
    ctx.bootId,
    ctx.cache
  );
  if (semanticErrors.length > 0) {
    return {
      ok: false,
      error: `${name} failed consistency checks: ${semanticErrors.slice(0, 10).join("; ")}`,
    };
  }

  const bootDir = getBootDataDir(ctx.workspaceRoot, ctx.bootId);
  await fs.mkdir(bootDir, { recursive: true });
  const targetPath = path.join(bootDir, `${name}.json`);
  const tmpPath = path.join(bootDir, `.${name}.${Date.now()}.tmp`);
  await fs.writeFile(tmpPath, JSON.stringify(zodResult.data, null, 2), "utf-8");
  await fs.rename(tmpPath, targetPath);

  switch (name) {
    case "brand_core":
      ctx.cache.brand_core = zodResult.data as BrandCore;
      break;
    case "brand_card":
      ctx.cache.brand_card = zodResult.data as string;
      break;
    case "products":
      ctx.cache.products = zodResult.data as Products;
      break;
    case "world_spec":
      ctx.cache.world_spec = zodResult.data as WorldSpec;
      break;
    case "adaptation_policy":
      ctx.cache.adaptation_policy = zodResult.data as AdaptationPolicy;
      break;
    case "demo_personas":
      ctx.cache.demo_personas = zodResult.data as DemoPersonas;
      break;
    case "session_config":
      ctx.cache.session_config = zodResult.data as SessionConfig;
      break;
  }

  ctx.savedNames.add(name);
  const artifacts = Array.from(ctx.savedNames);
  const readyToOpen = isBootReady(ctx.savedNames);
  const brandRead =
    name === "brand_core"
      ? buildBrandRead(zodResult.data as BrandCore)
      : undefined;

  return {
    ok: true,
    name,
    savedPath: `server/data/${ctx.bootId}/${name}.json`,
    artifacts,
    readyToOpen,
    ...(brandRead ? { brandRead } : {}),
  };
}
