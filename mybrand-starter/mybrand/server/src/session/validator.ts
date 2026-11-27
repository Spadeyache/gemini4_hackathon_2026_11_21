import type {
  LeverValue,
  Op,
  SessionCatalogItem,
  SessionConfig,
  SessionState,
} from "@mybrand/shared";
import type { ComputedSignals } from "./types";

const MAX_SIGNAGE_CHARS = 60;
const MAX_HOST_NOTE_CHARS = 90;

const ZONE_SLOT_PATH_RE = /^\/zones\/([^/]+)\/slots\/([^/]+)\/product_id$/;
const ZONE_LIGHTING_PATH_RE = /^\/zones\/([^/]+)\/lighting$/;
const ZONE_SIGNAGE_PATH_RE = /^\/zones\/([^/]+)\/signage$/;
const BLURB_PATH_RE = /^\/blurbs\/([^/]+)$/;
const ZONE_PREFIX_RE = /^\/zones\/([^/]+)\//;

export interface ValidationContext {
  config: SessionConfig;
  state: SessionState;
  signals: ComputedSignals;
  now_s: number;
  appliedCount: number;
  lastChangeAtS: number | null;
  leverLastChangedAtS: Readonly<Record<string, number>>;
  /** Optional restriction, e.g. host_note-only in rules_plus_host_note mode. */
  allowedPathFilter?: (path: string) => boolean;
  /** Skip session-level cooldown check (used only when pairing a model host_note with a same-tick rule op). */
  skipCooldownCheck?: boolean;
  /** Skip timing gates (first_change_after_s, cooldown_s, lever_min_interval_s) for explicit demo "Adapt Now" triggers. */
  skipTimingGates?: boolean;
}

export interface RejectedOp {
  op: Op;
  reason: string;
}

export interface ValidatedOpsResult {
  accepted: Op[];
  rejected: RejectedOp[];
}

function leverTemplateToRegex(template: string): RegExp {
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.replace(/\\\{[^}]+\\\}/g, "[^/]+");
  return new RegExp(`^${pattern}$`);
}

export function extractKnownZones(config: SessionConfig): Set<string> {
  const zones = new Set<string>();
  for (const key of Object.keys(config.base_state)) {
    const match = ZONE_PREFIX_RE.exec(key);
    if (match?.[1]) zones.add(match[1]);
  }
  for (const zoneId of Object.keys(config.pools.signage)) {
    zones.add(zoneId);
  }
  for (const item of config.catalog) {
    zones.add(item.zone_id);
  }
  return zones;
}

export function isProductSlotPath(path: string): boolean {
  return path === "/hero_plinth/product_id" || ZONE_SLOT_PATH_RE.test(path);
}

function validateLeverAndValue(
  path: string,
  value: LeverValue,
  config: SessionConfig,
  catalogById: ReadonlyMap<string, SessionCatalogItem>,
  lightingIds: ReadonlySet<string>,
  knownZones: ReadonlySet<string>
): string | null {
  if (path === "/hero_plinth/product_id") {
    if (!(path in config.base_state)) {
      return "hero_plinth lever missing from base_state";
    }
    if (typeof value !== "string" || !catalogById.has(value)) {
      return `unknown product id '${String(value)}' for hero_plinth`;
    }
    return null;
  }

  const slotMatch = ZONE_SLOT_PATH_RE.exec(path);
  if (slotMatch) {
    const zoneId = slotMatch[1];
    if (!(path in config.base_state)) {
      return `unknown slot path '${path}'`;
    }
    if (typeof value !== "string") {
      return "slot product_id must be a string";
    }
    const product = catalogById.get(value);
    if (!product) {
      return `unknown product id '${value}'`;
    }
    if (product.zone_id !== zoneId) {
      return `product '${value}' belongs to '${product.zone_id}', not '${zoneId}'`;
    }
    return null;
  }

  const lightingMatch = ZONE_LIGHTING_PATH_RE.exec(path);
  if (lightingMatch) {
    if (!(path in config.base_state)) {
      return `unknown zone lighting path '${path}'`;
    }
    if (typeof value !== "string" || !lightingIds.has(value)) {
      return `lighting preset '${String(value)}' is not in variant_pools.lighting`;
    }
    return null;
  }

  const signageMatch = ZONE_SIGNAGE_PATH_RE.exec(path);
  if (signageMatch) {
    if (!(path in config.base_state)) {
      return `unknown zone signage path '${path}'`;
    }
    if (typeof value !== "string") {
      return "signage value must be a string";
    }
    if (value.trim().length === 0) {
      return "signage cannot be empty";
    }
    if (value.length > MAX_SIGNAGE_CHARS) {
      return `signage exceeds ${MAX_SIGNAGE_CHARS} chars (${value.length})`;
    }
    return null;
  }

  const blurbMatch = BLURB_PATH_RE.exec(path);
  if (blurbMatch) {
    const productId = blurbMatch[1];
    if (!(path in config.base_state) || !catalogById.has(productId)) {
      return `unknown product blurb path '${path}'`;
    }
    if (value !== 0 && value !== 1) {
      return `blurb index must be 0 or 1, got '${String(value)}'`;
    }
    return null;
  }

  if (path === "/host_note") {
    if (typeof value !== "string") {
      return "host_note must be a string";
    }
    if (value.trim().length === 0) {
      return "host_note cannot be empty";
    }
    if (value.length > MAX_HOST_NOTE_CHARS) {
      return `host_note exceeds ${MAX_HOST_NOTE_CHARS} chars (${value.length})`;
    }
    return null;
  }

  if (path === "/guide_path/target_zone") {
    if (typeof value !== "string" || !knownZones.has(value)) {
      return `unknown guide_path target_zone '${String(value)}'`;
    }
    return null;
  }

  return `path '${path}' is not a supported lever`;
}

/**
 * Validates candidate ops against policy levers, allowed values, copy limits,
 * currently-looked-at protection, no-ops, and all policy.limits gates.
 */
export function validateOps(
  candidates: readonly Op[],
  ctx: ValidationContext
): ValidatedOpsResult {
  const accepted: Op[] = [];
  const rejected: RejectedOp[] = [];
  const { limits } = ctx.config.policy;

  if (!ctx.skipTimingGates && ctx.now_s < limits.first_change_after_s) {
    for (const op of candidates) {
      rejected.push({
        op,
        reason: `blocked before first_change_after_s (${limits.first_change_after_s}s)`,
      });
    }
    return { accepted, rejected };
  }

  if (
    !ctx.skipTimingGates &&
    !ctx.skipCooldownCheck &&
    ctx.lastChangeAtS !== null &&
    ctx.now_s - ctx.lastChangeAtS < limits.cooldown_s
  ) {
    for (const op of candidates) {
      rejected.push({
        op,
        reason: `blocked by cooldown_s (${limits.cooldown_s}s)`,
      });
    }
    return { accepted, rejected };
  }

  const remainingSessionBudget = Math.max(
    0,
    limits.max_ops_per_session - ctx.appliedCount
  );
  if (remainingSessionBudget === 0) {
    for (const op of candidates) {
      rejected.push({
        op,
        reason: `max_ops_per_session (${limits.max_ops_per_session}) reached`,
      });
    }
    return { accepted, rejected };
  }

  const batchCap = Math.min(limits.max_ops_per_change, remainingSessionBudget);
  const leverPatterns = ctx.config.policy.levers.map((lever) =>
    leverTemplateToRegex(lever.path)
  );
  const catalogById = new Map<string, SessionCatalogItem>(
    ctx.config.catalog.map((item) => [item.id, item])
  );
  const lightingIds = new Set(ctx.config.pools.lighting.map((p) => p.id));
  const knownZones = extractKnownZones(ctx.config);
  const seenPaths = new Set<string>();

  for (const op of candidates) {
    if (op.op !== "replace") {
      rejected.push({ op, reason: `unsupported op '${String(op.op)}'` });
      continue;
    }

    if (typeof op.reason !== "string" || op.reason.trim().length === 0) {
      rejected.push({ op, reason: "op reason must be non-empty" });
      continue;
    }

    if (!leverPatterns.some((pattern) => pattern.test(op.path))) {
      rejected.push({
        op,
        reason: `path '${op.path}' is not declared in policy.levers`,
      });
      continue;
    }

    if (ctx.allowedPathFilter && !ctx.allowedPathFilter(op.path)) {
      rejected.push({
        op,
        reason: `path '${op.path}' is disallowed in current adapter mode`,
      });
      continue;
    }

    const leverError = validateLeverAndValue(
      op.path,
      op.value,
      ctx.config,
      catalogById,
      lightingIds,
      knownZones
    );
    if (leverError) {
      rejected.push({ op, reason: leverError });
      continue;
    }

    if (ctx.state[op.path] === op.value) {
      rejected.push({ op, reason: "no-op: value equals current state" });
      continue;
    }

    if (seenPaths.has(op.path)) {
      rejected.push({ op, reason: `duplicate path '${op.path}' in batch` });
      continue;
    }

    if (
      isProductSlotPath(op.path) &&
      ctx.signals.current_look_product_id !== null &&
      ctx.state[op.path] === ctx.signals.current_look_product_id
    ) {
      rejected.push({
        op,
        reason: `cannot swap out currently-looked-at product '${ctx.signals.current_look_product_id}'`,
      });
      continue;
    }

    const lastLeverAt = ctx.leverLastChangedAtS[op.path];
    if (
      !ctx.skipTimingGates &&
      lastLeverAt !== undefined &&
      ctx.now_s - lastLeverAt < limits.lever_min_interval_s
    ) {
      rejected.push({
        op,
        reason: `lever '${op.path}' is within lever_min_interval_s (${limits.lever_min_interval_s}s)`,
      });
      continue;
    }

    if (accepted.length >= batchCap) {
      rejected.push({
        op,
        reason:
          accepted.length >= limits.max_ops_per_change
            ? `exceeds max_ops_per_change (${limits.max_ops_per_change})`
            : `exceeds max_ops_per_session (${limits.max_ops_per_session})`,
      });
      continue;
    }

    seenPaths.add(op.path);
    accepted.push(op);
  }

  return { accepted, rejected };
}
