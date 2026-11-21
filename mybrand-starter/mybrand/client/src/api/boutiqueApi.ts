import {
  AdaptationPolicySchema,
  BrandCoreSchema,
  DemoPersonasSchema,
  OpSchema,
  ProductsSchema,
  SessionConfigSchema,
  SessionStateSchema,
  WorldSpecSchema,
  type AdaptationPolicy,
  type BoutiqueEvent,
  type BrandCore,
  type DemoPersonas,
  type Op,
  type Products,
  type SessionConfig,
  type SessionState,
  type WorldSpec,
} from "@mybrand/shared";
import { z } from "zod";

export interface BootBundle {
  brand_core: BrandCore;
  products: Products;
  world_spec: WorldSpec;
  adaptation_policy: AdaptationPolicy;
  demo_personas: DemoPersonas;
  session_config: SessionConfig;
}

export interface CreateSessionResponse {
  sessionId: string;
  base_state: SessionState;
}

export interface EventsAckResponse {
  ok: true;
  accepted: number;
}

const ServerSourceSchema = z.enum(["model", "rules"]);

const SseConnectedFrameSchema = z.object({
  type: z.literal("connected"),
  sessionId: z.string().min(1),
});

const TaggedServerOpSchema = OpSchema.extend({
  source: ServerSourceSchema.optional(),
  latency_ms: z.number().nonnegative().optional(),
});

const SseOpsFrameSchema = z.object({
  type: z.literal("ops"),
  ops: z.array(TaggedServerOpSchema),
  visitor_read: z.string(),
  confidence: z.number().min(0).max(1),
  source: ServerSourceSchema,
  latency_ms: z.number().nonnegative(),
  now_s: z.number().nonnegative(),
});

const SseFrameSchema = z.discriminatedUnion("type", [
  SseConnectedFrameSchema,
  SseOpsFrameSchema,
]);

export type TaggedServerOp = Op & {
  source: "model" | "rules";
  latency_ms: number;
};

export interface SseOpsPayload {
  type: "ops";
  ops: TaggedServerOp[];
  visitor_read: string;
  confidence: number;
  source: "model" | "rules";
  latency_ms: number;
  now_s: number;
}

export type SseStreamFrame =
  | { type: "connected"; sessionId: string }
  | SseOpsPayload;

const CreateSessionResponseSchema = z.object({
  sessionId: z.string().min(1),
  base_state: SessionStateSchema,
});

const EventsAckResponseSchema = z.object({
  ok: z.literal(true),
  accepted: z.number().int().nonnegative(),
});

export async function fetchBootBundle(bootId: string): Promise<BootBundle> {
  const res = await fetch(`/api/boots/${encodeURIComponent(bootId)}`);
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const errBody = (await res.json()) as { error?: string; detail?: string };
      if (errBody.error) {
        detail = errBody.detail
          ? `${errBody.error}: ${errBody.detail}`
          : errBody.error;
      }
    } catch {
      // Ignore JSON parse error on error response
    }
    throw new Error(`Failed to load boot '${bootId}': ${detail}`);
  }

  const raw = (await res.json()) as Record<string, unknown>;
  return {
    brand_core: BrandCoreSchema.parse(raw.brand_core),
    products: ProductsSchema.parse(raw.products),
    world_spec: WorldSpecSchema.parse(raw.world_spec),
    adaptation_policy: AdaptationPolicySchema.parse(raw.adaptation_policy),
    demo_personas: DemoPersonasSchema.parse(raw.demo_personas),
    session_config: SessionConfigSchema.parse(raw.session_config),
  };
}

export async function createSession(
  bootId: string
): Promise<CreateSessionResponse> {
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bootId }),
  });

  if (!res.ok) {
    throw new Error(`Session create failed (HTTP ${res.status})`);
  }

  const raw: unknown = await res.json();
  return CreateSessionResponseSchema.parse(raw);
}

export async function postSessionEvents(
  sessionId: string,
  events: BoutiqueEvent[],
  options?: { keepalive?: boolean }
): Promise<EventsAckResponse> {
  const res = await fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/events`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
      keepalive: options?.keepalive,
    }
  );

  if (!res.ok) {
    throw new Error(`Event batch rejected (HTTP ${res.status})`);
  }

  const raw: unknown = await res.json();
  return EventsAckResponseSchema.parse(raw);
}

export function parseSseFrame(rawData: string): SseStreamFrame | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawData);
  } catch {
    return null;
  }

  const parsed = SseFrameSchema.safeParse(decoded);
  if (!parsed.success) {
    return null;
  }

  const frame = parsed.data;
  if (frame.type === "connected") {
    return frame;
  }

  return {
    type: "ops",
    visitor_read: frame.visitor_read,
    confidence: frame.confidence,
    source: frame.source,
    latency_ms: frame.latency_ms,
    now_s: frame.now_s,
    ops: frame.ops.map((item) => ({
      op: item.op,
      path: item.path,
      value: item.value,
      reason: item.reason,
      source: item.source ?? frame.source,
      latency_ms: item.latency_ms ?? frame.latency_ms,
    })),
  };
}

export interface SessionStreamCallbacks {
  onConnected?: (sessionId: string) => void;
  onOps: (payload: SseOpsPayload) => void;
  onError?: () => void;
}

export function subscribeSessionStream(
  sessionId: string,
  callbacks: SessionStreamCallbacks
): () => void {
  const source = new EventSource(
    `/api/sessions/${encodeURIComponent(sessionId)}/stream`
  );

  source.onmessage = (event) => {
    const frame = parseSseFrame(event.data);
    if (!frame) return;
    if (frame.type === "connected") {
      callbacks.onConnected?.(frame.sessionId);
    } else {
      callbacks.onOps(frame);
    }
  };

  source.onerror = () => {
    callbacks.onError?.();
  };

  return () => {
    source.close();
  };
}
