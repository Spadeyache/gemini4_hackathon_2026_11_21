import type { Content, FunctionDeclaration } from "@google/genai";
import type { HostType } from "@mybrand/shared";

export type BootJobStatus =
  | "running"
  | "waiting_host"
  | "waiting_shopify"
  | "completed"
  | "failed";

export interface BootMessage {
  id: string;
  role: "assistant" | "host" | "system";
  text: string;
  options?: string[];
  timestamp: string;
}

export interface BootPendingQuestion {
  id: string;
  kind: "ask_host" | "request_shopify_connection";
  message: string;
  options?: string[];
  scopes?: string[];
  createdAt?: string;
}

export type BootActivityKind =
  | "status"
  | "tool_call"
  | "tool_result"
  | "artifact"
  | "error";

export interface BootActivity {
  id: string;
  kind: BootActivityKind;
  label: string;
  detail?: string;
  timestamp: string;
}

export interface BootGeneratedAsset {
  asset_id: string;
  url: string;
  prompt: string;
  model: string;
  kind?: string;
  fallback?: boolean;
}

export interface BootBrandRead {
  positioning: string;
  audience: string;
  dynamic: string;
  strategy: string;
  voice: string;
  look: string;
  palette_hex?: string[];
}

export interface BootJobSnapshot {
  bootId: string;
  status: BootJobStatus;
  phase: string;
  messages: BootMessage[];
  pendingQuestion: BootPendingQuestion | null;
  activities: BootActivity[];
  assets: BootGeneratedAsset[];
  artifacts: string[];
  brandRead: BootBrandRead | null;
  readyToOpen: boolean;
  error?: string;
}

export interface BootListItem {
  bootId: string;
  name: string;
  brandSlug?: string;
  source: "fixture" | "data";
  ready: boolean;
  status?: BootJobStatus;
}

export type BootSseEvent =
  | { type: "snapshot"; job: BootJobSnapshot }
  | { type: "heartbeat"; elapsed_s: number; phase: string }
  | { type: "activity"; activity: BootActivity }
  | { type: "message"; message: BootMessage }
  | { type: "question"; pendingQuestion: BootPendingQuestion | null }
  | { type: "asset"; asset: BootGeneratedAsset }
  | {
      type: "artifact";
      name: string;
      artifacts: string[];
      readyToOpen: boolean;
      brandRead?: BootBrandRead;
    }
  | {
      type: "status";
      status: BootJobStatus;
      phase: string;
      readyToOpen: boolean;
      error?: string;
    };

export interface BootInputImageUpload {
  filename: string;
  mimeType: string;
  dataBase64: string;
}

export interface CreateBootRequest {
  hostName: string;
  hostType: HostType;
  images: BootInputImageUpload[];
  urls: string[];
  voiceSamples: string[];
}

export interface StoredInputImage {
  id: string;
  filename: string;
  mimeType: string;
  relativePath: string;
  sizeBytes: number;
}

export interface StoredInputUrl {
  id: string;
  url: string;
}

export interface StoredVoiceSample {
  id: string;
  text: string;
}

export interface BootInputManifest {
  boot_id: string;
  host: {
    name: string;
    type: HostType;
  };
  images: StoredInputImage[];
  urls: StoredInputUrl[];
  voice_samples: StoredVoiceSample[];
  created_at: string;
}

export interface ShopifyResponsePayload {
  connected: boolean;
  shop_domain?: string;
  granted_scopes?: string[];
  skip?: boolean;
}

export interface CarbonTurnParams {
  contents: Content[];
  systemInstruction: string;
  functionDeclarations: FunctionDeclaration[];
  abortSignal?: AbortSignal;
}

export interface CarbonTurnResult {
  /** Raw model Content returned by Gemini (preserved verbatim including thoughtSignature). */
  content: Content;
  finishReason?: string;
}

export interface UploadedFileRef {
  fileUri: string;
  mimeType: string;
}

export interface CarbonClient {
  isAvailable(): boolean;
  generateTurn(params: CarbonTurnParams): Promise<CarbonTurnResult>;
  /** Optional Files API upload fallback when inline host images exceed the ~15MB inline threshold. */
  uploadFile?(filePath: string, mimeType: string): Promise<UploadedFileRef>;
}

export interface ReferenceImageData {
  id: string;
  mimeType: string;
  dataBase64: string;
}

export interface ImageGenParams {
  prompt: string;
  model: "gemini-nano-banana-2.1" | "gemini-3-pro-image";
  aspectRatio: string;
  references: ReferenceImageData[];
  abortSignal?: AbortSignal;
}

export interface ImageGenResult {
  bytes: Buffer;
  mimeType: string;
}

export interface ImageGenClient {
  isAvailable(): boolean;
  generateImage(params: ImageGenParams): Promise<ImageGenResult>;
}

export interface FetchUrlResult {
  url: string;
  ok: boolean;
  status?: number;
  title?: string;
  description?: string;
  text?: string;
  image_urls?: string[];
  error?: string;
}

export type UrlFetcher = (
  url: string,
  abortSignal?: AbortSignal
) => Promise<FetchUrlResult>;
