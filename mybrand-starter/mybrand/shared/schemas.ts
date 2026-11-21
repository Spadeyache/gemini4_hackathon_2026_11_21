import { z } from "zod";

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

const KebabCaseSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Must be kebab-case");

const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Must be a 6-digit hex color like #C46D4E");

const PriceStringSchema = z
  .string()
  .regex(/^\d+(?:\.\d{2})?$/, "Must be a decimal price string like 28.00");

const CurrencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "Must be a 3-letter ISO currency code like USD");

const Vec2Schema = z.tuple([z.number(), z.number()]);
const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);

export const HostTypeSchema = z.enum(["person", "company"]);
export const ProductTierSchema = z.enum(["entry", "core", "signature"]);
export const ProductKindSchema = z.enum(["physical", "digital", "service"]);
export const ShopifyStatusSchema = z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]);
export const FixtureTypeSchema = z.enum([
  "plinth",
  "rack",
  "wall_shelf",
  "table",
  "display_case",
  "poster_frame",
  "screen",
]);
export const AssetKindSchema = z.enum([
  "texture",
  "poster",
  "product_image",
  "logo",
]);
export const BlurbIndexSchema = z.union([z.literal(0), z.literal(1)]);
export const LeverValueSchema = z.union([z.string(), BlurbIndexSchema]);

// ---------------------------------------------------------------------------
// brand_core & brand_card (orchestrator.md §5)
// ---------------------------------------------------------------------------

export const AudienceSegmentSchema = z.object({
  id: z.string().min(1),
  who: z.string().min(1),
  wants: z.string().min(1),
  entry_tier: ProductTierSchema,
});

export const StoryBeatSchema = z.object({
  zone_id: z.string().min(1),
  beat: z.string().min(1),
});

export const ClaimSchema = z.object({
  claim: z.string().min(1),
  source: z.string().min(1),
});

export const BrandCoreSchema = z.object({
  brand_slug: KebabCaseSchema,
  host: z.object({
    type: HostTypeSchema,
    name: z.string().min(1),
  }),
  positioning: z.string().min(1),
  values: z.array(z.string().min(1)).min(1),
  audience_segments: z.array(AudienceSegmentSchema).min(1),
  dynamic: z.object({
    label: z.string().min(1),
    evidence: z.array(z.string().min(1)).min(1),
  }),
  strategy: z.string().min(1),
  voice: z.object({
    traits: z.array(z.string().min(1)).min(1),
    do: z.array(z.string().min(1)).min(1),
    dont: z.array(z.string().min(1)).min(1),
    samples: z.array(z.string().min(1)).min(1),
  }),
  visual: z.object({
    palette_hex: z.array(HexColorSchema).min(1),
    fonts: z.object({
      display: z.string().min(1),
      body: z.string().min(1),
    }),
    materials: z.array(z.string().min(1)).min(1),
    lighting_mood: z.string().min(1),
    motifs: z.array(z.string().min(1)).min(1),
  }),
  story_beats: z.array(StoryBeatSchema).min(1),
  claims: z.array(ClaimSchema),
  low_confidence: z.array(z.string()),
});

export const BrandCardSchema = z
  .string()
  .min(1)
  .refine(
    (value) => countWords(value) <= 150,
    "brand_card must be at most 150 words"
  );

// ---------------------------------------------------------------------------
// products (orchestrator.md §5)
// ---------------------------------------------------------------------------

export const ProductOptionSchema = z.object({
  name: z.string().min(1),
  values: z.array(z.string().min(1)).min(1),
});

export const ProductVariantSchema = z.object({
  options: z.record(z.string(), z.string()),
  price: PriceStringSchema,
  sku: z.string(),
});

export const ProductShopifySchema = z.object({
  product_id: z.string().nullable(),
  variant_ids: z.record(z.string(), z.string()),
  status: ShopifyStatusSchema,
  checkout_url: z.string().url().nullable(),
});

export const ProductBlurbsSchema = z.tuple([
  z.string().min(1).max(140),
  z.string().min(1).max(140),
]);

export const ProductSchema = z.object({
  id: z.string().min(1),
  handle: KebabCaseSchema,
  title: z.string().min(1),
  tier: ProductTierSchema,
  kind: ProductKindSchema,
  product_type: z.string().min(1),
  zone_id: z.string().min(1),
  tags: z.array(z.string().min(1)).min(1),
  description: z
    .string()
    .min(1)
    .refine(
      (value) => countWords(value) <= 120,
      "description must be at most 120 words"
    ),
  blurbs: ProductBlurbsSchema,
  price: PriceStringSchema,
  currency: CurrencyCodeSchema,
  options: z.array(ProductOptionSchema),
  variants: z.array(ProductVariantSchema).min(1),
  image_asset_ids: z.array(z.string().min(1)),
  evidence: z.array(z.string().min(1)).min(1),
  shopify: ProductShopifySchema,
});

export const ProductsSchema = z.array(ProductSchema).min(1);

// ---------------------------------------------------------------------------
// world_spec (orchestrator.md §5)
// ---------------------------------------------------------------------------

export const FixtureSchema = z.object({
  id: z.string().min(1),
  type: FixtureTypeSchema,
  position: Vec3Schema,
  rotation_deg: z.number(),
  slot_ids: z.array(z.string().min(1)),
});

export const SlotSchema = z.object({
  id: z.string().min(1),
  product_id: z.string().min(1),
});

export const ZoneSchema = z.object({
  id: z.string().min(1),
  beat: z.string().min(1),
  center: Vec2Schema,
  size: z.tuple([z.number().positive(), z.number().positive()]),
  lighting: z.string().min(1),
  signage: z.string().min(1).max(60),
  fixtures: z.array(FixtureSchema),
  slots: z.array(SlotSchema),
});

export const AssetSchema = z.object({
  id: z.string().min(1),
  kind: AssetKindSchema,
  model: z.string().min(1),
  prompt: z.string(),
  url: z.string().min(1),
});

export const LightingPresetSchema = z.object({
  id: z.string().min(1),
  color_temp_k: z.number().positive(),
  intensity: z.number().min(0).max(2),
  spot: z.boolean(),
});

export const VariantPoolsSchema = z.object({
  lighting: z.array(LightingPresetSchema).min(1),
  signage: z.record(z.string(), z.array(z.string().min(1).max(60)).min(1)),
});

export const WorldSpecSchema = z.object({
  boot_id: z.string().min(1),
  version: z.number().int().positive(),
  room: z.object({
    size_m: z.tuple([
      z.number().positive(),
      z.number().positive(),
      z.number().positive(),
    ]),
    floor_asset: z.string().min(1),
    wall_asset: z.string().min(1),
  }),
  entrance: z.object({
    position: Vec2Schema,
    greeting: z.string().min(1).max(90),
  }),
  hero_plinth: z.object({
    position: Vec2Schema,
    product_id: z.string().min(1),
  }),
  guide_path: z.object({
    target_zone: z.string().min(1),
  }),
  host_note: z.string().max(90),
  zones: z.array(ZoneSchema).min(1),
  blurbs: z.record(z.string(), BlurbIndexSchema),
  assets: z.array(AssetSchema),
  variant_pools: VariantPoolsSchema,
});

// ---------------------------------------------------------------------------
// adaptation_policy (orchestrator.md §5)
// ---------------------------------------------------------------------------

export const LeverSchema = z.object({
  path: z.string().min(1),
  allowed: z.string().min(1),
});

export const RuleActionSchema = z.object({
  path: z.string().min(1),
  value: LeverValueSchema,
});

export const AdaptationRuleSchema = z.object({
  id: z.string().min(1),
  priority: z.number().int().positive(),
  when: z.string().min(1),
  do: RuleActionSchema,
  why: z.string().min(1),
});

export const AdaptationLimitsSchema = z.object({
  first_change_after_s: z.number().nonnegative(),
  max_ops_per_change: z.number().int().positive(),
  cooldown_s: z.number().nonnegative(),
  max_ops_per_session: z.number().int().positive(),
  lever_min_interval_s: z.number().nonnegative(),
  deadline_ms: z.number().int().positive(),
});

export const AdaptationPolicySchema = z.object({
  dynamic: z.string().min(1),
  objective: z.string().min(1),
  levers: z.array(LeverSchema).min(1),
  frozen: z.array(z.string().min(1)).min(1),
  rules: z.array(AdaptationRuleSchema).min(1),
  limits: AdaptationLimitsSchema,
});

// ---------------------------------------------------------------------------
// event & demo_personas (orchestrator.md §5)
// ---------------------------------------------------------------------------

export const EventTypeSchema = z.enum([
  "enter_zone",
  "exit_zone",
  "look",
  "inspect",
  "add_to_cart",
  "remove_from_cart",
  "checkout_click",
]);

export const EventSchema = z.object({
  t: z.number().nonnegative(),
  type: EventTypeSchema,
  zone: z.string().min(1).optional(),
  product_id: z.string().min(1).optional(),
  ms: z.number().nonnegative().optional(),
});

export const DemoPersonaSchema = z.object({
  name: z.string().min(1),
  segment: z.string().min(1),
  events: z.array(EventSchema).min(1),
  expected: z.array(z.string().min(1)).min(1),
});

export const DemoPersonasSchema = z.array(DemoPersonaSchema).min(1);

// ---------------------------------------------------------------------------
// session_config (orchestrator.md §5)
// ---------------------------------------------------------------------------

export const SessionCatalogItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  tier: ProductTierSchema,
  tags: z.array(z.string().min(1)),
  zone_id: z.string().min(1),
  blurbs: ProductBlurbsSchema,
});

export const SessionStateSchema = z.record(z.string(), LeverValueSchema);

export const SessionConfigSchema = z.object({
  boot_id: z.string().min(1),
  brand_card: BrandCardSchema,
  catalog: z.array(SessionCatalogItemSchema).min(1),
  policy: AdaptationPolicySchema,
  pools: VariantPoolsSchema,
  base_state: SessionStateSchema,
  demo_personas: DemoPersonasSchema,
});

// ---------------------------------------------------------------------------
// op & Session Adapter output (session_adapter.md)
// ---------------------------------------------------------------------------

export const OpSchema = z.object({
  op: z.literal("replace"),
  path: z.string().min(1),
  value: LeverValueSchema,
  reason: z.string().min(1),
});

export const SessionAdapterOutputSchema = z.object({
  ops: z.array(OpSchema),
  visitor_read: z.string(),
  confidence: z.number().min(0).max(1),
});

export const OpSourceSchema = z.enum(["model", "rules", "manual"]);

// ---------------------------------------------------------------------------
// Inferred TypeScript types
// ---------------------------------------------------------------------------

export type HostType = z.infer<typeof HostTypeSchema>;
export type ProductTier = z.infer<typeof ProductTierSchema>;
export type ProductKind = z.infer<typeof ProductKindSchema>;
export type ShopifyStatus = z.infer<typeof ShopifyStatusSchema>;
export type FixtureType = z.infer<typeof FixtureTypeSchema>;
export type AssetKind = z.infer<typeof AssetKindSchema>;
export type BlurbIndex = z.infer<typeof BlurbIndexSchema>;
export type LeverValue = z.infer<typeof LeverValueSchema>;

export type BrandCore = z.infer<typeof BrandCoreSchema>;
export type Product = z.infer<typeof ProductSchema>;
export type Products = z.infer<typeof ProductsSchema>;
export type Fixture = z.infer<typeof FixtureSchema>;
export type Slot = z.infer<typeof SlotSchema>;
export type Zone = z.infer<typeof ZoneSchema>;
export type Asset = z.infer<typeof AssetSchema>;
export type LightingPreset = z.infer<typeof LightingPresetSchema>;
export type VariantPools = z.infer<typeof VariantPoolsSchema>;
export type WorldSpec = z.infer<typeof WorldSpecSchema>;
export type Lever = z.infer<typeof LeverSchema>;
export type AdaptationRule = z.infer<typeof AdaptationRuleSchema>;
export type AdaptationLimits = z.infer<typeof AdaptationLimitsSchema>;
export type AdaptationPolicy = z.infer<typeof AdaptationPolicySchema>;
export type EventType = z.infer<typeof EventTypeSchema>;
export type BoutiqueEvent = z.infer<typeof EventSchema>;
export type DemoPersona = z.infer<typeof DemoPersonaSchema>;
export type DemoPersonas = z.infer<typeof DemoPersonasSchema>;
export type SessionCatalogItem = z.infer<typeof SessionCatalogItemSchema>;
export type SessionState = z.infer<typeof SessionStateSchema>;
export type SessionConfig = z.infer<typeof SessionConfigSchema>;
export type Op = z.infer<typeof OpSchema>;
export type SessionAdapterOutput = z.infer<typeof SessionAdapterOutputSchema>;
export type OpSource = z.infer<typeof OpSourceSchema>;
