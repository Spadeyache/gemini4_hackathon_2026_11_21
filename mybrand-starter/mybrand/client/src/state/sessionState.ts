import {
  OpSchema,
  type BlurbIndex,
  type LeverValue,
  type Op,
  type OpSource,
  type Products,
  type SessionState,
  type WorldSpec,
} from "@mybrand/shared";
import { z } from "zod";

export interface OpApplyContext {
  worldSpec: WorldSpec;
  products: Products;
}

export interface OpMetadata {
  source: OpSource;
  latency_ms: number;
  now_s?: number;
}

export interface AppliedOpRecord {
  id: string;
  op: Op;
  previousValue: LeverValue | undefined;
  source: OpSource;
  latency_ms: number;
  now_s: number;
  appliedAtMs: number;
}

export interface RejectedOpRecord {
  op: unknown;
  error: string;
}

export interface ApplyOpsResult {
  nextState: SessionState;
  applied: AppliedOpRecord[];
  rejected: RejectedOpRecord[];
}

export interface ParsedManualOps {
  ops: Op[];
  visitor_read?: string;
  confidence?: number;
}

const ZONE_SLOT_PATH = /^\/zones\/([^/]+)\/slots\/([^/]+)\/product_id$/;
const ZONE_LIGHTING_PATH = /^\/zones\/([^/]+)\/lighting$/;
const ZONE_SIGNAGE_PATH = /^\/zones\/([^/]+)\/signage$/;
const BLURB_PATH = /^\/blurbs\/([^/]+)$/;

let opCounter = 0;

export function buildInitialSessionState(
  worldSpec: WorldSpec,
  baseState?: SessionState
): SessionState {
  const derived: SessionState = {
    "/hero_plinth/product_id": worldSpec.hero_plinth.product_id,
    "/guide_path/target_zone": worldSpec.guide_path.target_zone,
    "/host_note": worldSpec.host_note,
  };

  for (const zone of worldSpec.zones) {
    derived[`/zones/${zone.id}/lighting`] = zone.lighting;
    derived[`/zones/${zone.id}/signage`] = zone.signage;
    for (const slot of zone.slots) {
      derived[`/zones/${zone.id}/slots/${slot.id}/product_id`] = slot.product_id;
    }
  }

  for (const [productId, blurbIdx] of Object.entries(worldSpec.blurbs)) {
    derived[`/blurbs/${productId}`] = blurbIdx;
  }

  return {
    ...derived,
    ...(baseState ?? {}),
  };
}

function validateOpForWorld(
  op: Op,
  context: OpApplyContext
): string | null {
  const { worldSpec, products } = context;
  const productById = new Map(products.map((p) => [p.id, p]));
  const zoneById = new Map(worldSpec.zones.map((z) => [z.id, z]));
  const lightingIds = new Set(worldSpec.variant_pools.lighting.map((l) => l.id));

  if (op.path === "/hero_plinth/product_id") {
    if (typeof op.value !== "string" || !productById.has(op.value)) {
      return `Unknown product_id '${String(op.value)}' for /hero_plinth/product_id`;
    }
    return null;
  }

  if (op.path === "/guide_path/target_zone") {
    if (typeof op.value !== "string" || !zoneById.has(op.value)) {
      return `Unknown zone '${String(op.value)}' for /guide_path/target_zone`;
    }
    return null;
  }

  if (op.path === "/host_note") {
    if (typeof op.value !== "string") {
      return "/host_note must be a string";
    }
    if (op.value.length > 90) {
      return `/host_note exceeds 90 chars (${op.value.length})`;
    }
    return null;
  }

  const slotMatch = ZONE_SLOT_PATH.exec(op.path);
  if (slotMatch) {
    const [, zoneId, slotId] = slotMatch;
    const zone = zoneById.get(zoneId);
    if (!zone) return `Unknown zone '${zoneId}'`;
    if (!zone.slots.some((s) => s.id === slotId)) {
      return `Unknown slot '${slotId}' in zone '${zoneId}'`;
    }
    if (typeof op.value !== "string") {
      return `Slot value must be a product_id string`;
    }
    const product = productById.get(op.value);
    if (!product) {
      return `Unknown product_id '${op.value}'`;
    }
    if (product.zone_id !== zoneId) {
      return `Product '${op.value}' belongs to '${product.zone_id}', not '${zoneId}'`;
    }
    return null;
  }

  const lightingMatch = ZONE_LIGHTING_PATH.exec(op.path);
  if (lightingMatch) {
    const [, zoneId] = lightingMatch;
    if (!zoneById.has(zoneId)) return `Unknown zone '${zoneId}'`;
    if (typeof op.value !== "string" || !lightingIds.has(op.value)) {
      return `Unknown lighting preset '${String(op.value)}'`;
    }
    return null;
  }

  const signageMatch = ZONE_SIGNAGE_PATH.exec(op.path);
  if (signageMatch) {
    const [, zoneId] = signageMatch;
    if (!zoneById.has(zoneId)) return `Unknown zone '${zoneId}'`;
    if (typeof op.value !== "string" || op.value.trim().length === 0) {
      return "Zone signage must be a non-empty string";
    }
    if (op.value.length > 60) {
      return `Zone signage exceeds 60 chars (${op.value.length})`;
    }
    return null;
  }

  const blurbMatch = BLURB_PATH.exec(op.path);
  if (blurbMatch) {
    const [, productId] = blurbMatch;
    if (!productById.has(productId)) {
      return `Unknown product_id '${productId}' for blurb lever`;
    }
    if (op.value !== 0 && op.value !== 1) {
      return `Blurb value must be 0 or 1`;
    }
    return null;
  }

  return `Path '${op.path}' is not an allowed adaptation lever`;
}

export interface IncomingOpItem {
  op: unknown;
  source?: OpSource;
  latency_ms?: number;
}

export function applyOpsToState(
  currentState: SessionState,
  ops: readonly (Op | IncomingOpItem | unknown)[],
  context: OpApplyContext,
  defaultMeta: OpMetadata
): ApplyOpsResult {
  const nextState: SessionState = { ...currentState };
  const applied: AppliedOpRecord[] = [];
  const rejected: RejectedOpRecord[] = [];
  const appliedAtMs = Date.now();
  const nowS = defaultMeta.now_s ?? 0;

  for (const item of ops) {
    const isWrapped =
      typeof item === "object" &&
      item !== null &&
      "op" in item &&
      typeof (item as Record<string, unknown>).op === "object";

    const rawOp = isWrapped ? (item as IncomingOpItem).op : item;
    const itemSource =
      typeof item === "object" &&
      item !== null &&
      "source" in item &&
      ((item as Record<string, unknown>).source === "model" ||
        (item as Record<string, unknown>).source === "rules" ||
        (item as Record<string, unknown>).source === "manual")
        ? ((item as Record<string, unknown>).source as OpSource)
        : defaultMeta.source;

    const itemLatency =
      typeof item === "object" &&
      item !== null &&
      "latency_ms" in item &&
      typeof (item as Record<string, unknown>).latency_ms === "number"
        ? ((item as Record<string, unknown>).latency_ms as number)
        : defaultMeta.latency_ms;

    const parsed = OpSchema.safeParse(rawOp);
    if (!parsed.success) {
      rejected.push({
        op: rawOp,
        error: parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "op"}: ${issue.message}`)
          .join("; "),
      });
      continue;
    }

    const validationError = validateOpForWorld(parsed.data, context);
    if (validationError) {
      rejected.push({
        op: parsed.data,
        error: validationError,
      });
      continue;
    }

    const previousValue = nextState[parsed.data.path];
    nextState[parsed.data.path] = parsed.data.value;

    opCounter += 1;
    applied.push({
      id: `op_${appliedAtMs}_${opCounter}`,
      op: parsed.data,
      previousValue,
      source: itemSource,
      latency_ms: itemLatency,
      now_s: nowS,
      appliedAtMs,
    });
  }

  return { nextState, applied, rejected };
}

// Helpers to read typed state values cleanly from SessionState
export function getHeroProductId(
  state: SessionState,
  worldSpec: WorldSpec
): string {
  const value = state["/hero_plinth/product_id"];
  return typeof value === "string" ? value : worldSpec.hero_plinth.product_id;
}

export function getGuideTargetZone(
  state: SessionState,
  worldSpec: WorldSpec
): string {
  const value = state["/guide_path/target_zone"];
  return typeof value === "string" ? value : worldSpec.guide_path.target_zone;
}

export function getHostNote(
  state: SessionState,
  worldSpec: WorldSpec
): string {
  const value = state["/host_note"];
  return typeof value === "string" ? value : worldSpec.host_note;
}

export function getSlotProductId(
  state: SessionState,
  zoneId: string,
  slotId: string,
  fallback: string
): string {
  const value = state[`/zones/${zoneId}/slots/${slotId}/product_id`];
  return typeof value === "string" ? value : fallback;
}

export function getZoneLightingId(
  state: SessionState,
  zoneId: string,
  fallback: string
): string {
  const value = state[`/zones/${zoneId}/lighting`];
  return typeof value === "string" ? value : fallback;
}

export function getZoneSignage(
  state: SessionState,
  zoneId: string,
  fallback: string
): string {
  const value = state[`/zones/${zoneId}/signage`];
  return typeof value === "string" ? value : fallback;
}

export function getProductBlurbIndex(
  state: SessionState,
  productId: string,
  worldSpec: WorldSpec
): BlurbIndex {
  const value = state[`/blurbs/${productId}`];
  if (value === 0 || value === 1) return value;
  return worldSpec.blurbs[productId] ?? 0;
}

const ManualEnvelopeSchema = z.object({
  ops: z.array(OpSchema),
  visitor_read: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export function parseManualOpInput(rawJson: string): ParsedManualOps {
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawJson);
  } catch (error) {
    throw new Error(
      `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (Array.isArray(decoded)) {
    const parsedArray = z.array(OpSchema).parse(decoded);
    return { ops: parsedArray };
  }

  if (typeof decoded === "object" && decoded !== null && "ops" in decoded) {
    const parsedEnvelope = ManualEnvelopeSchema.parse(decoded);
    return {
      ops: parsedEnvelope.ops,
      visitor_read: parsedEnvelope.visitor_read,
      confidence: parsedEnvelope.confidence,
    };
  }

  const singleOp = OpSchema.parse(decoded);
  return { ops: [singleOp] };
}
