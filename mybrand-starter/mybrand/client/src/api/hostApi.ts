import { HostTypeSchema, type HostType } from "@mybrand/shared";
import { z } from "zod";

export const BootJobStatusSchema = z.enum([
  "running",
  "waiting_host",
  "waiting_shopify",
  "completed",
  "failed",
]);
export type BootJobStatus = z.infer<typeof BootJobStatusSchema>;

export const BootListItemSchema = z.object({
  bootId: z.string().min(1),
  name: z.string().min(1),
  brandSlug: z.string().optional(),
  source: z.enum(["fixture", "data"]),
  ready: z.boolean(),
  status: BootJobStatusSchema.optional(),
});
export type BootListItem = z.infer<typeof BootListItemSchema>;

export const BootListResponseSchema = z.object({
  boots: z.array(BootListItemSchema),
});

export const BootMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["assistant", "host", "system"]),
  text: z.string(),
  options: z.array(z.string()).optional(),
  timestamp: z.string(),
});
export type BootMessage = z.infer<typeof BootMessageSchema>;

export const PendingQuestionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["ask_host", "request_shopify_connection"]),
  message: z.string(),
  options: z.array(z.string()).optional(),
  scopes: z.array(z.string()).optional(),
  createdAt: z.string().optional(),
});
export type PendingQuestion = z.infer<typeof PendingQuestionSchema>;

export const BootActivitySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["status", "tool_call", "tool_result", "artifact", "error"]),
  label: z.string(),
  detail: z.string().optional(),
  timestamp: z.string(),
});
export type BootActivity = z.infer<typeof BootActivitySchema>;

export const BootAssetSchema = z.object({
  asset_id: z.string().min(1),
  url: z.string().min(1),
  prompt: z.string(),
  model: z.string(),
  kind: z.string().optional(),
  fallback: z.boolean().optional(),
});
export type BootAsset = z.infer<typeof BootAssetSchema>;

export const BrandReadSchema = z.object({
  positioning: z.string(),
  audience: z.string(),
  dynamic: z.string(),
  strategy: z.string(),
  voice: z.string(),
  look: z.string(),
  palette_hex: z.array(z.string()).optional(),
});
export type BrandRead = z.infer<typeof BrandReadSchema>;

export const BootJobSnapshotSchema = z.object({
  bootId: z.string().min(1),
  status: BootJobStatusSchema,
  phase: z.string(),
  messages: z.array(BootMessageSchema),
  pendingQuestion: PendingQuestionSchema.nullable(),
  activities: z.array(BootActivitySchema),
  assets: z.array(BootAssetSchema),
  artifacts: z.array(z.string()),
  brandRead: BrandReadSchema.nullable(),
  readyToOpen: z.boolean(),
  error: z.string().nullable().optional(),
  elapsed_s: z.number().nonnegative().optional(),
});
export type BootJobSnapshot = z.infer<typeof BootJobSnapshotSchema>;

const BootSseSnapshotFrameSchema = z.object({
  type: z.literal("snapshot"),
  job: BootJobSnapshotSchema,
});

const BootSseHeartbeatFrameSchema = z.object({
  type: z.literal("heartbeat"),
  elapsed_s: z.number().nonnegative(),
  phase: z.string(),
});

const BootSseActivityFrameSchema = z.object({
  type: z.literal("activity"),
  activity: BootActivitySchema,
});

const BootSseMessageFrameSchema = z.object({
  type: z.literal("message"),
  message: BootMessageSchema,
});

const BootSseQuestionFrameSchema = z.object({
  type: z.literal("question"),
  pendingQuestion: PendingQuestionSchema.nullable(),
});

const BootSseAssetFrameSchema = z.object({
  type: z.literal("asset"),
  asset: BootAssetSchema,
});

const BootSseArtifactFrameSchema = z.object({
  type: z.literal("artifact"),
  name: z.string().min(1),
  artifacts: z.array(z.string()),
  readyToOpen: z.boolean(),
  brandRead: BrandReadSchema.nullable().optional(),
});

const BootSseStatusFrameSchema = z.object({
  type: z.literal("status"),
  status: BootJobStatusSchema,
  phase: z.string(),
  readyToOpen: z.boolean(),
  error: z.string().nullable().optional(),
  brandRead: BrandReadSchema.nullable().optional(),
});

export const BootSseFrameSchema = z.discriminatedUnion("type", [
  BootSseSnapshotFrameSchema,
  BootSseHeartbeatFrameSchema,
  BootSseActivityFrameSchema,
  BootSseMessageFrameSchema,
  BootSseQuestionFrameSchema,
  BootSseAssetFrameSchema,
  BootSseArtifactFrameSchema,
  BootSseStatusFrameSchema,
]);
export type BootSseFrame = z.infer<typeof BootSseFrameSchema>;

export interface StartBootImagePayload {
  filename: string;
  mimeType: string;
  dataBase64: string;
}

export interface StartBootRequest {
  hostName: string;
  hostType: HostType;
  images: StartBootImagePayload[];
  urls: string[];
  voiceSamples: string[];
}

const StartBootResponseSchema = z.object({
  bootId: z.string().min(1),
  status: BootJobStatusSchema,
});
export type StartBootResponse = z.infer<typeof StartBootResponseSchema>;

export interface ShopifyResponsePayload {
  connected: boolean;
  shop_domain?: string;
  granted_scopes?: string[];
  skip?: boolean;
}

const OkResponseSchema = z.object({
  ok: z.literal(true),
});

async function extractErrorDetail(res: Response): Promise<string> {
  let detail = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { error?: string; detail?: string };
    if (body.error) {
      detail = body.detail ? `${body.error}: ${body.detail}` : body.error;
    }
  } catch {
    // Ignore non-JSON error bodies
  }
  return detail;
}

export async function fetchBootList(): Promise<BootListItem[]> {
  const res = await fetch("/api/boots");
  if (!res.ok) {
    throw new Error(await extractErrorDetail(res));
  }
  const raw: unknown = await res.json();
  return BootListResponseSchema.parse(raw).boots;
}

export async function startBootJob(
  payload: StartBootRequest
): Promise<StartBootResponse> {
  HostTypeSchema.parse(payload.hostType);

  const res = await fetch("/api/boots", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(await extractErrorDetail(res));
  }

  const raw: unknown = await res.json();
  return StartBootResponseSchema.parse(raw);
}

export async function fetchBootJob(bootId: string): Promise<BootJobSnapshot> {
  const res = await fetch(`/api/boots/${encodeURIComponent(bootId)}/job`);
  if (!res.ok) {
    const detail = await extractErrorDetail(res);
    const err = new Error(detail) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  const raw: unknown = await res.json();
  return BootJobSnapshotSchema.parse(raw);
}

export async function sendBootReply(
  bootId: string,
  text: string
): Promise<{ ok: true }> {
  const res = await fetch(`/api/boots/${encodeURIComponent(bootId)}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    throw new Error(await extractErrorDetail(res));
  }

  const raw: unknown = await res.json();
  return OkResponseSchema.parse(raw);
}

export async function sendShopifyResponse(
  bootId: string,
  payload: ShopifyResponsePayload
): Promise<{ ok: true }> {
  const res = await fetch(
    `/api/boots/${encodeURIComponent(bootId)}/shopify-response`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    throw new Error(await extractErrorDetail(res));
  }

  const raw: unknown = await res.json();
  return OkResponseSchema.parse(raw);
}

export function parseBootSseFrame(rawData: string): BootSseFrame | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawData);
  } catch {
    return null;
  }

  const parsed = BootSseFrameSchema.safeParse(decoded);
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

export interface BootStreamCallbacks {
  onFrame: (frame: BootSseFrame) => void;
  onOpen?: () => void;
  onError?: () => void;
}

export function subscribeBootStream(
  bootId: string,
  callbacks: BootStreamCallbacks
): () => void {
  const source = new EventSource(
    `/api/boots/${encodeURIComponent(bootId)}/stream`
  );

  source.onopen = () => {
    callbacks.onOpen?.();
  };

  source.onmessage = (event) => {
    const frame = parseBootSseFrame(event.data);
    if (frame) {
      callbacks.onFrame(frame);
    }
  };

  source.onerror = () => {
    callbacks.onError?.();
  };

  return () => {
    source.close();
  };
}
