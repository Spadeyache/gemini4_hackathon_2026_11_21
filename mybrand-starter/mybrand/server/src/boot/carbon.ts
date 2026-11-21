import fs from "node:fs/promises";
import path from "node:path";
import {
  GoogleGenAI,
  ThinkingLevel,
  type FunctionDeclaration,
} from "@google/genai";
import type { CarbonClient, CarbonTurnParams, CarbonTurnResult, UploadedFileRef } from "./types";

export const CARBON_MODEL = "gemini-4-carbon";

const promptCache = new Map<string, string>();

export function getOrchestratorPromptPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, "prompts", "orchestrator.md");
}

/**
 * Loads prompts/orchestrator.md from disk at runtime (never hardcoded in source).
 */
export async function loadOrchestratorPrompt(
  workspaceRoot: string,
  options?: { bypassCache?: boolean }
): Promise<string> {
  const promptPath = path.resolve(getOrchestratorPromptPath(workspaceRoot));
  if (!options?.bypassCache) {
    const cached = promptCache.get(promptPath);
    if (cached !== undefined) return cached;
  }
  const content = await fs.readFile(promptPath, "utf-8");
  promptCache.set(promptPath, content);
  return content;
}

export function clearOrchestratorPromptCache(): void {
  promptCache.clear();
}

export function sanitizeSecrets(
  error: unknown,
  secrets: ReadonlyArray<string | undefined>
): string {
  let raw = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) {
    if (secret && secret.length > 0 && raw.includes(secret)) {
      raw = raw.split(secret).join("[REDACTED]");
    }
  }
  return raw;
}

/**
 * Tool declarations for the Boot agent (orchestrator.md §3).
 */
export const BOOT_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "read_inputs",
    description:
      "Read the host's structured input manifest: boot_id, host name/type, uploaded image ids (img_01..img_N), URLs (url_1..), and voice samples (voice_1..). Uploaded images are also attached inline in the initial message with [img_XX] labels.",
    parametersJsonSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "fetch_url",
    description:
      "Fetch a public http/https URL and extract its title, description, cleaned page text, and discovered image URLs.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The http:// or https:// URL to fetch.",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "generate_image",
    description: [
      "Generate a bespoke image asset (1024px budget) and save it to server/data/{boot_id}/assets/{asset_id}.png. Call in parallel for multiple assets.",
      "Model choice: use 'gemini-nano-banana-2.1' for textures, backdrops, and product imagery; use 'gemini-3-pro-image' when text/lettering in the image must be legible (logos, signage posters, labels).",
      "World framing guidance (stay strictly within <= 12 total assets in world_spec):",
      "- For room.wall_asset: generate a wide '16:9' clean open panoramic environment horizon vista capturing the host's authentic real-world setting (e.g., expansive Pacific ocean swells meeting misty dawn cliffs and a distant lighthouse for an ocean brand, wide airport runway & parked jets under twilight sky for an aviation/flights brand, sunlit garden canopy or warm craft workshop panorama — open unobstructed horizon with NO foreground pillars, window frames, or duplicated interior rooms, because the 3D pavilion itself provides foreground architecture).",
      "- For room.floor_asset: generate a matching realistic ground/floor surface texture (e.g., coastal boardwalk/sand, terrazzo terminal floor, warm terracotta tile, workshop timber).",
      "- For poster and product_image assets: generate photorealistic, high-craft studio visuals grounded in the host's actual materials and palette.",
    ].join(" "),
    parametersJsonSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "Detailed visual generation prompt describing subject, materials, lighting, palette, composition, and realism.",
        },
        model: {
          type: "string",
          enum: ["gemini-nano-banana-2.1", "gemini-3-pro-image"],
          description:
            "Exact image model ID: 'gemini-nano-banana-2.1' (default) or 'gemini-3-pro-image' (when text must be legible).",
        },
        aspect: {
          type: "string",
          description:
            "Aspect ratio: '1:1', '16:9' (recommended for panoramic room.wall_asset), '4:3', '3:4', '3:2', '2:3', '9:16', or '21:9'.",
        },
        ref_asset_ids: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional list of reference image IDs (uploaded img_01..img_N or previously generated asset_XX) to guide style/subject consistency.",
        },
        kind: {
          type: "string",
          enum: ["texture", "poster", "product_image", "logo"],
          description: "Optional hint for how this asset is used in world_spec.",
        },
      },
      required: ["prompt", "model", "aspect"],
      additionalProperties: false,
    },
  },
  {
    name: "save_artifact",
    description:
      "Validate with zod and persist a Boot artifact to server/data/{boot_id}/{name}.json. On validation failure, returns the exact error string so you can fix and re-save.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          enum: [
            "brand_core",
            "brand_card",
            "products",
            "world_spec",
            "adaptation_policy",
            "demo_personas",
            "session_config",
          ],
          description: "Exact §5 artifact name.",
        },
        json: {
          type: "string",
          description:
            "Valid JSON-encoded string of the artifact payload matching §5 schema (JSON array string for products/demo_personas, JSON object string for brand_core/world_spec/adaptation_policy/session_config, or plain/JSON string <=150 words for brand_card).",
        },
      },
      required: ["name", "json"],
      additionalProperties: false,
    },
  },
  {
    name: "ask_host",
    description:
      "Send a message/question to the host in the UI and pause until the host replies. Batch questions concisely (at most 3 in Phase 0).",
    parametersJsonSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Short, clear message or batched questions for the host.",
        },
        options: {
          type: "array",
          items: { type: "string" },
          description: "Optional quick-reply choices to display as buttons.",
        },
      },
      required: ["message"],
      additionalProperties: false,
    },
  },
  {
    name: "request_shopify_connection",
    description:
      "Open the app's secure Shopify connect form in the UI and pause until the host connects or skips. Never ask for secrets in chat.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        scopes: {
          type: "array",
          items: { type: "string" },
          description:
            "Requested Shopify Admin scopes, e.g. ['read_products', 'write_products', 'read_publications', 'write_publications'].",
        },
      },
      required: ["scopes"],
      additionalProperties: false,
    },
  },
];

export interface CarbonClientOptions {
  apiKey?: string;
}

export function createCarbonClient(options: CarbonClientOptions): CarbonClient {
  const apiKey = options.apiKey?.trim() || undefined;
  let ai: GoogleGenAI | null = null;

  function getAi(): GoogleGenAI {
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured");
    }
    if (!ai) {
      ai = new GoogleGenAI({ apiKey });
    }
    return ai;
  }

  return {
    isAvailable(): boolean {
      return Boolean(apiKey);
    },

    async generateTurn(params: CarbonTurnParams): Promise<CarbonTurnResult> {
      const client = getAi();
      try {
        const response = await client.models.generateContent({
          model: CARBON_MODEL,
          contents: params.contents,
          config: {
            systemInstruction: params.systemInstruction,
            thinkingConfig: {
              thinkingLevel: ThinkingLevel.MEDIUM,
            },
            tools: [{ functionDeclarations: params.functionDeclarations }],
            abortSignal: params.abortSignal,
          },
        });

        const candidate = response.candidates?.[0];
        if (!candidate?.content) {
          const reason =
            candidate?.finishReason ??
            response.promptFeedback?.blockReason ??
            "empty_candidate";
          throw new Error(`Carbon returned no candidate content (${String(reason)})`);
        }

        // Preserve exact candidate.content (including thought / thoughtSignature / functionCall parts).
        return {
          content: {
            role: candidate.content.role ?? "model",
            parts: candidate.content.parts ?? [],
          },
          finishReason: candidate.finishReason,
        };
      } catch (error) {
        throw new Error(sanitizeSecrets(error, [apiKey]));
      }
    },

    async uploadFile(
      filePath: string,
      mimeType: string
    ): Promise<UploadedFileRef> {
      const client = getAi();
      try {
        const uploaded = await client.files.upload({
          file: filePath,
          config: { mimeType },
        });
        if (!uploaded.uri) {
          throw new Error("Files API upload did not return a file URI");
        }
        return {
          fileUri: uploaded.uri,
          mimeType: uploaded.mimeType ?? mimeType,
        };
      } catch (error) {
        throw new Error(sanitizeSecrets(error, [apiKey]));
      }
    },
  };
}
