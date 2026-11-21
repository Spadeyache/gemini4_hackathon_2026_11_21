import type {
  AdaptationRule,
  LeverValue,
  Op,
  ProductTier,
  SessionCatalogItem,
  SessionConfig,
  SessionState,
} from "@mybrand/shared";
import type { AppliedOp, ComputedSignals } from "./types";
import {
  extractKnownZones,
  isProductSlotPath,
  validateOps,
} from "./validator";

const CURRENT_ZONE_CLAUSE_RE = /^current_zone\s*(==|!=)\s*([a-zA-Z0-9_:-]+)$/;
const SIGNAL_CLAUSE_RE =
  /^([a-z_]+)\(\s*([^)]+?)\s*\)\s*(>=|<=|>|<|==|!=)\s*(-?\d+(?:\.\d+)?)$/;
const RESOLVER_CALL_RE = /^([a-z_]+)\(\s*([^)]*?)\s*\)$/;
const ZONE_SLOT_RE = /^\/zones\/([^/]+)\/slots\/([^/]+)\/product_id$/;
const ZONE_SIGNAGE_RE = /^\/zones\/([^/]+)\/signage$/;

const TIER_RANK: Record<ProductTier, number> = {
  entry: 0,
  core: 1,
  signature: 2,
};

export interface RuleEvalContext {
  config: SessionConfig;
  state: SessionState;
  signals: ComputedSignals;
  applied: readonly AppliedOp[];
  now_s: number;
  lastChangeAtS: number | null;
  leverLastChangedAtS: Readonly<Record<string, number>>;
}

export interface RuleMatchResult {
  rule: AdaptationRule;
  op: Op;
  visitor_read: string;
  confidence: number;
}

function isSystemTag(tag: string): boolean {
  return (
    tag === "mybrand" || tag.startsWith("mybrand:") || tag.startsWith("boot:")
  );
}

function compareNumbers(left: number, op: string, right: number): boolean {
  switch (op) {
    case ">=":
      return left >= right;
    case "<=":
      return left <= right;
    case ">":
      return left > right;
    case "<":
      return left < right;
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    default:
      return false;
  }
}

function readSignalValue(
  signalName: string,
  arg: string,
  signals: ComputedSignals
): number | null {
  switch (signalName) {
    case "dwell_s":
      return signals.dwell_s[arg] ?? 0;
    case "look_s":
      return signals.look_s[arg] ?? 0;
    case "quick_exits":
      return signals.quick_exits[arg] ?? 0;
    case "inspects":
      return arg.startsWith("tag:")
        ? (signals.inspects_by_tag[arg.slice(4)] ?? 0)
        : (signals.inspects[arg] ?? 0);
    case "add_to_cart":
      return arg.startsWith("tag:")
        ? (signals.add_to_cart_by_tag[arg.slice(4)] ?? 0)
        : (signals.add_to_cart[arg] ?? 0);
    case "remove_from_cart":
      return arg.startsWith("tag:")
        ? (signals.remove_from_cart_by_tag[arg.slice(4)] ?? 0)
        : (signals.remove_from_cart[arg] ?? 0);
    default:
      return null;
  }
}

/**
 * Evaluates a §5 rule `when` expression (clauses joined by AND).
 * Returns false on any unknown signal or malformed clause.
 */
export function evaluateWhen(
  whenExpr: string,
  signals: ComputedSignals
): boolean {
  const trimmed = whenExpr.trim();
  if (!trimmed) return false;

  const clauses = trimmed.split(/\s+AND\s+/);
  for (const rawClause of clauses) {
    const clause = rawClause.trim();
    if (!clause) return false;

    const zoneMatch = CURRENT_ZONE_CLAUSE_RE.exec(clause);
    if (zoneMatch) {
      const operator = zoneMatch[1];
      const expectedZone = zoneMatch[2];
      const matches =
        operator === "=="
          ? signals.current_zone === expectedZone
          : signals.current_zone !== expectedZone;
      if (!matches) return false;
      continue;
    }

    const signalMatch = SIGNAL_CLAUSE_RE.exec(clause);
    if (signalMatch) {
      const signalName = signalMatch[1];
      const arg = signalMatch[2].trim();
      const operator = signalMatch[3];
      const threshold = Number(signalMatch[4]);
      const actual = readSignalValue(signalName, arg, signals);
      if (actual === null || !compareNumbers(actual, operator, threshold)) {
        return false;
      }
      continue;
    }

    return false;
  }

  return true;
}

function productInterestScore(
  productId: string,
  signals: ComputedSignals
): number {
  const cartAdds = signals.add_to_cart[productId] ?? 0;
  const inspects = signals.inspects[productId] ?? 0;
  const lookS = signals.look_s[productId] ?? 0;
  const cartRemoves = signals.remove_from_cart[productId] ?? 0;
  return cartAdds * 10 + inspects * 4 + lookS - cartRemoves * 3;
}

function thematicTagAffinity(
  product: SessionCatalogItem,
  signals: ComputedSignals
): number {
  let score = 0;
  for (const tag of product.tags) {
    if (isSystemTag(tag)) continue;
    score += (signals.add_to_cart_by_tag[tag] ?? 0) * 5;
    score += (signals.inspects_by_tag[tag] ?? 0) * 2;
  }
  return score;
}

function getFeaturedProductIds(state: SessionState): Set<string> {
  const featured = new Set<string>();
  for (const [path, value] of Object.entries(state)) {
    if (isProductSlotPath(path) && typeof value === "string") {
      featured.add(value);
    }
  }
  return featured;
}

function resolveTopProduct(
  filterExpr: string,
  targetPath: string,
  ctx: RuleEvalContext
): string | null {
  const predicates = filterExpr
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const excluded = getFeaturedProductIds(ctx.state);
  const baseVal = ctx.config.base_state[targetPath];
  if (typeof baseVal === "string") {
    excluded.add(baseVal);
  }
  for (const entry of ctx.applied) {
    if (entry.op.path === targetPath && typeof entry.op.value === "string") {
      excluded.add(entry.op.value);
    }
  }

  const candidates: Array<{ item: SessionCatalogItem; index: number }> = [];

  for (let index = 0; index < ctx.config.catalog.length; index++) {
    const item = ctx.config.catalog[index];
    if (excluded.has(item.id)) continue;

    let matches = true;
    for (const pred of predicates) {
      if (pred.startsWith("tag:")) {
        const tag = pred.slice(4).trim();
        if (!item.tags.includes(tag)) {
          matches = false;
          break;
        }
      } else if (pred.startsWith("zone:")) {
        const zone = pred.slice(5).trim();
        if (item.zone_id !== zone) {
          matches = false;
          break;
        }
      } else if (pred.startsWith("tier:")) {
        const tier = pred.slice(5).trim();
        if (item.tier !== tier) {
          matches = false;
          break;
        }
      } else {
        return null;
      }
    }

    if (matches) {
      candidates.push({ item, index });
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const interestDiff =
      productInterestScore(b.item.id, ctx.signals) -
      productInterestScore(a.item.id, ctx.signals);
    if (interestDiff !== 0) return interestDiff;

    const tagDiff =
      thematicTagAffinity(b.item, ctx.signals) -
      thematicTagAffinity(a.item, ctx.signals);
    if (tagDiff !== 0) return tagDiff;

    return a.index - b.index;
  });

  return candidates[0].item.id;
}

function resolveComplement(
  productId: string,
  targetPath: string,
  ctx: RuleEvalContext
): string | null {
  const source = ctx.config.catalog.find((item) => item.id === productId);
  if (!source) return null;

  const slotMatch = ZONE_SLOT_RE.exec(targetPath);
  const requiredZone = slotMatch?.[1] ?? null;

  const sourceTags = new Set(source.tags.filter((tag) => !isSystemTag(tag)));

  const scored: Array<{
    item: SessionCatalogItem;
    score: number;
    index: number;
  }> = [];

  for (let index = 0; index < ctx.config.catalog.length; index++) {
    const candidate = ctx.config.catalog[index];
    if (candidate.id === source.id) continue;
    if (candidate.tier === source.tier) continue;
    if (requiredZone && candidate.zone_id !== requiredZone) continue;

    const sameZone = candidate.zone_id === source.zone_id;
    let sharedThematicTags = 0;
    for (const tag of candidate.tags) {
      if (!isSystemTag(tag) && sourceTags.has(tag)) {
        sharedThematicTags++;
      }
    }

    if (!sameZone && sharedThematicTags === 0) continue;

    const tierDelta = Math.abs(
      TIER_RANK[candidate.tier] - TIER_RANK[source.tier]
    );
    const score =
      (sameZone ? 100 : 0) +
      sharedThematicTags * 20 +
      productInterestScore(candidate.id, ctx.signals) +
      (tierDelta === 1 ? 5 : 0);

    scored.push({
      item: candidate,
      score,
      index,
    });
  }

  if (scored.length === 0) return null;

  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  return scored[0].item.id;
}

function resolveTopZone(
  signalName: string,
  ctx: RuleEvalContext
): string | null {
  const zones = Array.from(extractKnownZones(ctx.config));
  let bestZone: string | null = null;
  let bestValue = 0;

  for (const zoneId of zones) {
    let value = 0;
    switch (signalName) {
      case "dwell_s":
        value = ctx.signals.dwell_s[zoneId] ?? 0;
        break;
      case "quick_exits":
        value = ctx.signals.quick_exits[zoneId] ?? 0;
        break;
      case "look_s":
        for (const item of ctx.config.catalog) {
          if (item.zone_id === zoneId) {
            value += ctx.signals.look_s[item.id] ?? 0;
          }
        }
        break;
      case "inspects":
        for (const item of ctx.config.catalog) {
          if (item.zone_id === zoneId) {
            value += ctx.signals.inspects[item.id] ?? 0;
          }
        }
        break;
      case "add_to_cart":
        for (const item of ctx.config.catalog) {
          if (item.zone_id === zoneId) {
            value += ctx.signals.add_to_cart[item.id] ?? 0;
          }
        }
        break;
      default:
        return null;
    }

    if (value > bestValue) {
      bestValue = value;
      bestZone = zoneId;
    }
  }

  return bestZone;
}

function resolvePool(
  poolArg: string,
  targetPath: string,
  ctx: RuleEvalContext
): string | null {
  let candidates: string[] | undefined;

  if (poolArg === "lighting") {
    candidates = ctx.config.pools.lighting.map((preset) => preset.id);
  } else if (poolArg === "signage") {
    const zoneMatch = ZONE_SIGNAGE_RE.exec(targetPath);
    const zoneId = zoneMatch?.[1];
    if (zoneId) {
      candidates = ctx.config.pools.signage[zoneId];
    }
  } else if (poolArg.startsWith("signage:")) {
    const zoneId = poolArg.slice("signage:".length).trim();
    candidates = ctx.config.pools.signage[zoneId];
  } else if (poolArg in ctx.config.pools.signage) {
    candidates = ctx.config.pools.signage[poolArg];
  }

  if (!candidates || candidates.length === 0) return null;

  const currentValue = ctx.state[targetPath];
  const previouslyApplied = new Set<LeverValue>(
    ctx.applied
      .filter((entry) => entry.op.path === targetPath)
      .map((entry) => entry.op.value)
  );
  if (ctx.config.base_state[targetPath] !== undefined) {
    previouslyApplied.add(ctx.config.base_state[targetPath]);
  }

  const unused = candidates.find(
    (val) => val !== currentValue && !previouslyApplied.has(val)
  );
  if (unused !== undefined) return unused;

  const alternate = candidates.find((val) => val !== currentValue);
  return alternate ?? null;
}

/**
 * Resolves a rule `do.value` (either a literal or one of the §5 resolvers).
 */
export function resolveRuleValue(
  rawValue: LeverValue,
  targetPath: string,
  ctx: RuleEvalContext
): LeverValue | null {
  if (typeof rawValue !== "string") {
    return rawValue;
  }

  const callMatch = RESOLVER_CALL_RE.exec(rawValue.trim());
  if (!callMatch) {
    return rawValue;
  }

  const resolverName = callMatch[1];
  const arg = callMatch[2].trim();

  switch (resolverName) {
    case "top_product":
      return resolveTopProduct(arg, targetPath, ctx);
    case "complement":
      return resolveComplement(arg, targetPath, ctx);
    case "top_zone":
      return resolveTopZone(arg, ctx);
    case "pool":
      return resolvePool(arg, targetPath, ctx);
    default:
      return rawValue;
  }
}

function toVisitorRead(why: string): string {
  const words = why.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 12) return words.join(" ");
  return words.slice(0, 12).join(" ");
}

/**
 * Evaluates policy rules in priority order (1 = highest) and returns the top
 * firing rule that resolves to a valid, applicable op.
 */
export function evaluateRules(ctx: RuleEvalContext): RuleMatchResult | null {
  const sortedRules = [...ctx.config.policy.rules].sort(
    (a, b) => a.priority - b.priority
  );

  for (const rule of sortedRules) {
    if (!evaluateWhen(rule.when, ctx.signals)) continue;

    const resolved = resolveRuleValue(rule.do.value, rule.do.path, ctx);
    if (resolved === null) continue;

    const candidate: Op = {
      op: "replace",
      path: rule.do.path,
      value: resolved,
      reason: rule.why,
    };

    const validated = validateOps([candidate], {
      config: ctx.config,
      state: ctx.state,
      signals: ctx.signals,
      now_s: ctx.now_s,
      appliedCount: ctx.applied.length,
      lastChangeAtS: ctx.lastChangeAtS,
      leverLastChangedAtS: ctx.leverLastChangedAtS,
    });

    if (validated.accepted.length > 0) {
      return {
        rule,
        op: validated.accepted[0],
        visitor_read: toVisitorRead(rule.why),
        confidence: 0.75,
      };
    }
  }

  return null;
}

export interface ThematicFallbackResult {
  ops: Op[];
  visitor_read: string;
  confidence: number;
}

/**
 * Deterministic theme-matching fallback used when gemini-4-hydrogen is unavailable
 * and no hardcoded policy rule fired yet: promotes another catalog product sharing
 * the visitor's most recently selected product's thematic tags.
 */
export function evaluateThematicFallback(
  ctx: RuleEvalContext,
  options?: { skipTimingGates?: boolean }
): ThematicFallbackResult | null {
  const recent = ctx.signals.recent_events;
  let selectedId: string | null = null;
  for (let i = recent.length - 1; i >= 0; i--) {
    const ev = recent[i];
    if (ev && (ev.type === "add_to_cart" || ev.type === "inspect") && ev.product_id) {
      selectedId = ev.product_id;
      break;
    }
  }
  if (!selectedId) return null;

  const selected = ctx.config.catalog.find((p) => p.id === selectedId);
  if (!selected) return null;

  const isThematic = (t: string) => {
    const lower = t.toLowerCase();
    return lower !== "mybrand" && !lower.startsWith("mybrand:") && !lower.startsWith("boot:");
  };
  const targetTags = new Set(selected.tags.filter(isThematic).map((t) => t.toLowerCase()));
  if (targetTags.size === 0) return null;

  const featuredIds = new Set<string>();
  for (const [k, v] of Object.entries(ctx.state)) {
    if (
      typeof v === "string" &&
      (k === "/hero_plinth/product_id" || /^\/zones\/[^/]+\/slots\/[^/]+\/product_id$/.test(k))
    ) {
      featuredIds.add(v);
    }
  }

  const scored = ctx.config.catalog
    .filter((p) => p.id !== selected.id)
    .map((item) => {
      const shared = item.tags
        .filter(isThematic)
        .filter((t) => targetTags.has(t.toLowerCase()));
      if (shared.length === 0) return null;
      const unfeaturedBoost = featuredIds.has(item.id) ? 0 : 10;
      const sameZoneBoost = item.zone_id === selected.zone_id ? 3 : 0;
      return {
        item,
        primaryTag: shared[0]!,
        score: unfeaturedBoost + shared.length * 4 + sameZoneBoost,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;

  const best = scored[0]!;
  const candidates: Op[] = [];

  // Promote matching-theme piece onto hero plinth if not already featured there
  if (ctx.state["/hero_plinth/product_id"] !== best.item.id) {
    candidates.push({
      op: "replace",
      path: "/hero_plinth/product_id",
      value: best.item.id,
      reason: `selected ${best.primaryTag} piece; spotlighting matching ${best.item.title}`,
    });
  }

  // Guide visitor toward the matching-theme zone if different from current guide target
  if (ctx.state["/guide_path/target_zone"] !== best.item.zone_id) {
    candidates.push({
      op: "replace",
      path: "/guide_path/target_zone",
      value: best.item.zone_id,
      reason: `guiding toward more ${best.primaryTag} pieces`,
    });
  }

  if (candidates.length === 0) return null;

  const validated = validateOps(candidates, {
    config: ctx.config,
    state: ctx.state,
    signals: ctx.signals,
    now_s: ctx.now_s,
    appliedCount: ctx.applied.length,
    lastChangeAtS: ctx.lastChangeAtS,
    leverLastChangedAtS: ctx.leverLastChangedAtS,
    skipTimingGates: options?.skipTimingGates,
  });

  if (validated.accepted.length === 0) return null;

  return {
    ops: validated.accepted,
    visitor_read: `exploring ${best.primaryTag} pieces`,
    confidence: 0.72,
  };
}
