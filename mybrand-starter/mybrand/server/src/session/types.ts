import type { Response } from "express";
import type {
  AdaptationPolicy,
  BoutiqueEvent,
  LeverValue,
  Op,
  SessionAdapterOutput,
  SessionCatalogItem,
  SessionConfig,
  SessionState,
  VariantPools,
} from "@mybrand/shared";
import type { SessionAdapterMode } from "../env";

export type RuntimeOpSource = "model" | "rules";

export type TaggedOp = Op & {
  source: RuntimeOpSource;
  latency_ms: number;
};

export interface AppliedOp {
  op: Op;
  applied_at_s: number;
  source: RuntimeOpSource;
  latency_ms: number;
}

export interface AppliedOpSummary {
  path: string;
  value: LeverValue;
  reason: string;
  at_s: number;
}

export interface ModelSignalsPayload {
  current_zone: string | null;
  dwell_s: Record<string, number>;
  look_s: Record<string, number>;
  inspects: Record<string, number>;
  inspects_by_tag: Record<string, number>;
  add_to_cart: Record<string, number>;
  add_to_cart_by_tag: Record<string, number>;
  remove_from_cart: Record<string, number>;
  remove_from_cart_by_tag: Record<string, number>;
  quick_exits: Record<string, number>;
  recent_events: BoutiqueEvent[];
}

export interface ComputedSignals extends ModelSignalsPayload {
  /** Product currently under the visitor's active gaze, if any. */
  current_look_product_id: string | null;
}

export interface SessionAdapterInput {
  brand_card: string;
  catalog: SessionCatalogItem[];
  policy: AdaptationPolicy;
  pools: VariantPools;
  state: SessionState;
  signals: ModelSignalsPayload;
  applied: AppliedOpSummary[];
  now_s: number;
}

export type AdapterCallResult =
  | {
      ok: true;
      output: SessionAdapterOutput;
      latency_ms: number;
    }
  | {
      ok: false;
      error: string;
      timedOut: boolean;
      latency_ms: number;
    };

export interface SessionAdapterClient {
  isAvailable(): boolean;
  propose(
    input: SessionAdapterInput,
    deadlineMs: number,
    options?: { hostNoteOnly?: boolean }
  ): Promise<AdapterCallResult>;
}

export interface SseConnectedPayload {
  type: "connected";
  sessionId: string;
}

export interface SseOpsPayload {
  type: "ops";
  ops: TaggedOp[];
  visitor_read: string;
  confidence: number;
  source: RuntimeOpSource;
  latency_ms: number;
  now_s: number;
}

export type SsePayload = SseConnectedPayload | SseOpsPayload;

export interface SessionRecord {
  id: string;
  bootId: string;
  config: SessionConfig;
  state: SessionState;
  events: BoutiqueEvent[];
  maxEventT: number;
  applied: AppliedOp[];
  createdAtMs: number;
  lastActivityMs: number;
  lastEventAtMs: number | null;
  lastChangeAtS: number | null;
  leverLastChangedAtS: Record<string, number>;
  tickInFlight: boolean;
  pendingImmediateTick: boolean;
  tickTimer: NodeJS.Timeout | null;
  sseClients: Set<Response>;
}

export type { SessionAdapterMode };
