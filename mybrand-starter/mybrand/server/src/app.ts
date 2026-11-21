import fs from "node:fs/promises";
import path from "node:path";
import cors from "cors";
import express, { type Express } from "express";
import { z } from "zod";
import { EventSchema } from "@mybrand/shared";
import { loadBootArtifacts, SAFE_BOOT_ID } from "./boot";
import { detectImageMimeType } from "./boot/fallbackPng";
import { CreateBootRequestSchema, getBootAssetsDir } from "./boot/inputs";
import { BootJobManager } from "./boot/manager";
import type { CarbonClient, ImageGenClient, UrlFetcher } from "./boot/types";
import {
  DEFAULT_SESSION_ADAPTER_MODE,
  WORKSPACE_ROOT,
  type ServerEnv,
  type SessionAdapterMode,
} from "./env";
import { SessionManager } from "./session/manager";
import type { SessionAdapterClient } from "./session/types";

export interface AppOptions {
  workspaceRoot?: string;
  env?: Partial<ServerEnv>;
  sessionManager?: SessionManager;
  bootJobManager?: BootJobManager;
  adapterClient?: SessionAdapterClient;
  carbonClient?: CarbonClient;
  imageGenClient?: ImageGenClient;
  urlFetcher?: UrlFetcher;
  adapterMode?: SessionAdapterMode;
  clock?: () => number;
  tickIntervalMs?: number;
  idleTtlMs?: number;
  idleSweepIntervalMs?: number;
  bootHeartbeatIntervalMs?: number;
  bootImageRetryDelayMs?: number;
  bootApiRetryDelayMs?: number;
  bootMaxTurns?: number;
  logger?: (message: string) => void;
}

const SAFE_ASSET_FILENAME = /^[a-zA-Z0-9._-]+$/;

const CreateSessionBodySchema = z.object({
  bootId: z.string().regex(SAFE_BOOT_ID, "Invalid bootId"),
});

const IngestEventsBodySchema = z.object({
  events: z.array(EventSchema),
});

const ReplyBodySchema = z.object({
  text: z.string().trim().min(1, "Reply text is required").max(8000),
});

const ShopifyResponseBodySchema = z.object({
  connected: z.boolean(),
  shop_domain: z.string().trim().min(1).max(255).optional(),
  granted_scopes: z.array(z.string().trim().min(1)).optional(),
  skip: z.boolean().optional(),
});

export function createApp(options: AppOptions = {}): Express {
  const workspaceRoot = options.workspaceRoot ?? WORKSPACE_ROOT;
  const app = express();

  const sessionManager =
    options.sessionManager ??
    new SessionManager({
      workspaceRoot,
      geminiApiKey: options.env?.geminiApiKey,
      adapterClient: options.adapterClient,
      adapterMode:
        options.adapterMode ??
        options.env?.sessionAdapterMode ??
        DEFAULT_SESSION_ADAPTER_MODE,
      clock: options.clock,
      tickIntervalMs: options.tickIntervalMs,
      idleTtlMs: options.idleTtlMs,
      idleSweepIntervalMs: options.idleSweepIntervalMs,
      logger: options.logger,
    });

  const bootJobManager =
    options.bootJobManager ??
    new BootJobManager({
      workspaceRoot,
      geminiApiKey: options.env?.geminiApiKey,
      shopifySecrets: [options.env?.shopifyClientSecret],
      carbonClient: options.carbonClient,
      imageGenClient: options.imageGenClient,
      urlFetcher: options.urlFetcher,
      clock: options.clock,
      maxTurns: options.bootMaxTurns,
      heartbeatIntervalMs: options.bootHeartbeatIntervalMs,
      imageRetryDelayMs: options.bootImageRetryDelayMs,
      apiRetryDelayMs: options.bootApiRetryDelayMs,
      logger: options.logger,
    });

  app.locals.sessionManager = sessionManager;
  app.locals.bootJobManager = bootJobManager;

  app.use(cors());
  app.use(express.json({ limit: "50mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  });

  app.use("/fixtures", express.static(path.join(workspaceRoot, "fixtures")));

  // Serve generated Boot assets from server/data/{bootId}/assets/{filename} with magic-byte MIME detection.
  app.get("/data/:bootId/assets/:filename", async (req, res) => {
    const { bootId, filename } = req.params;
    if (!SAFE_BOOT_ID.test(bootId) || !SAFE_ASSET_FILENAME.test(filename)) {
      res.status(400).json({ error: "Invalid asset path" });
      return;
    }

    const filePath = path.join(getBootAssetsDir(workspaceRoot, bootId), filename);
    try {
      const bytes = await fs.readFile(filePath);
      res.setHeader("Content-Type", detectImageMimeType(bytes, filename));
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.status(200).send(bytes);
    } catch {
      res.status(404).json({ error: "Asset not found" });
    }
  });

  // ---------------------------------------------------------------------------
  // M3 Boot Agent endpoints
  // ---------------------------------------------------------------------------

  app.get("/api/boots", async (_req, res) => {
    try {
      const boots = await bootJobManager.listBoots();
      res.json({ boots });
    } catch (error) {
      res.status(500).json({
        error: "Failed to list boots",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/boots", async (req, res) => {
    const parsed = CreateBootRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid boot input payload",
        detail: parsed.error.issues
          .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
          .join("; "),
      });
      return;
    }

    try {
      const started = await bootJobManager.startBoot(parsed.data);
      res.status(201).json(started);
    } catch (error) {
      res.status(400).json({
        error: "Failed to start boot job",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/boots/:bootId/job", async (req, res) => {
    const { bootId } = req.params;
    if (!SAFE_BOOT_ID.test(bootId)) {
      res.status(400).json({ error: "Invalid bootId" });
      return;
    }

    try {
      const snapshot = await bootJobManager.getJobSnapshot(bootId);
      if (!snapshot) {
        res.status(404).json({ error: `Boot job '${bootId}' not found` });
        return;
      }
      res.json(snapshot);
    } catch (error) {
      res.status(500).json({
        error: "Failed to fetch boot job",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/boots/:bootId/stream", async (req, res) => {
    const { bootId } = req.params;
    if (!SAFE_BOOT_ID.test(bootId)) {
      res.status(400).json({ error: "Invalid bootId" });
      return;
    }

    const attached = await bootJobManager.attachStream(bootId, req, res);
    if (!attached) {
      res.status(404).json({ error: `Boot job '${bootId}' not found` });
      return;
    }
  });

  app.post("/api/boots/:bootId/reply", (req, res) => {
    const { bootId } = req.params;
    if (!SAFE_BOOT_ID.test(bootId)) {
      res.status(400).json({ error: "Invalid bootId" });
      return;
    }

    const parsed = ReplyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid reply payload",
        detail: parsed.error.issues.map((i) => i.message).join("; "),
      });
      return;
    }

    const result = bootJobManager.submitReply(bootId, parsed.data.text);
    if (!result.ok) {
      res.status(result.statusCode).json({ error: result.error });
      return;
    }

    res.status(200).json({ ok: true });
  });

  app.post("/api/boots/:bootId/shopify-response", (req, res) => {
    const { bootId } = req.params;
    if (!SAFE_BOOT_ID.test(bootId)) {
      res.status(400).json({ error: "Invalid bootId" });
      return;
    }

    const parsed = ShopifyResponseBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid shopify response payload",
        detail: parsed.error.issues.map((i) => i.message).join("; "),
      });
      return;
    }

    const result = bootJobManager.submitShopifyResponse(bootId, parsed.data);
    if (!result.ok) {
      res.status(result.statusCode).json({ error: result.error });
      return;
    }

    res.status(200).json({ ok: true });
  });

  app.get("/api/boots/:bootId", async (req, res) => {
    const { bootId } = req.params;
    if (!SAFE_BOOT_ID.test(bootId)) {
      res.status(400).json({ error: "Invalid bootId" });
      return;
    }

    try {
      const artifacts = await loadBootArtifacts(workspaceRoot, bootId);
      if (!artifacts) {
        res.status(404).json({ error: `Boot '${bootId}' not found` });
        return;
      }
      res.json(artifacts);
    } catch (error) {
      res.status(500).json({
        error: "Failed to load or validate boot artifacts",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ---------------------------------------------------------------------------
  // M2 Session endpoints
  // ---------------------------------------------------------------------------

  app.post("/api/sessions", async (req, res) => {
    const parsed = CreateSessionBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request body",
        detail: parsed.error.issues.map((i) => i.message).join("; "),
      });
      return;
    }

    try {
      const created = await sessionManager.createSession(parsed.data.bootId);
      if (!created) {
        res
          .status(404)
          .json({ error: `Boot '${parsed.data.bootId}' not found` });
        return;
      }
      res.status(201).json(created);
    } catch (error) {
      res.status(500).json({
        error: "Failed to create session",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/sessions/:id/events", (req, res) => {
    const { id } = req.params;
    const parsed = IngestEventsBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid events payload",
        detail: parsed.error.issues.map((i) => i.message).join("; "),
      });
      return;
    }

    const result = sessionManager.ingestEvents(id, parsed.data.events);
    if (!result) {
      res.status(404).json({ error: `Session '${id}' not found` });
      return;
    }

    res.status(200).json({ ok: true, accepted: result.accepted });
  });

  app.post("/api/sessions/:id/adapt", async (req, res) => {
    const { id } = req.params;
    if (!sessionManager.getSession(id)) {
      res.status(404).json({ error: `Session '${id}' not found` });
      return;
    }

    try {
      const payload = await sessionManager.forceAdaptNow(id);
      if (!payload) {
        res.status(200).json({ ok: true, applied: 0, ops: [] });
        return;
      }
      res.status(200).json({
        ok: true,
        applied: payload.ops.length,
        ops: payload.ops,
        source: payload.source,
        latency_ms: payload.latency_ms,
        visitor_read: payload.visitor_read,
        confidence: payload.confidence,
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to run immediate adaptation",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/sessions/:id/stream", (req, res) => {
    const { id } = req.params;
    const attached = sessionManager.attachStream(id, req, res);
    if (!attached) {
      res.status(404).json({ error: `Session '${id}' not found` });
      return;
    }
  });

  return app;
}
