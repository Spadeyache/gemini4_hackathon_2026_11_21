import fs from "node:fs/promises";
import path from "node:path";
import cors from "cors";
import express, { type Express } from "express";
import {
  AdaptationPolicySchema,
  BrandCoreSchema,
  DemoPersonasSchema,
  ProductsSchema,
  SessionConfigSchema,
  WorldSpecSchema,
} from "@mybrand/shared";
import { WORKSPACE_ROOT } from "./env";

export interface AppOptions {
  workspaceRoot?: string;
}

const SAFE_BOOT_ID = /^[a-z0-9-]+$/;

async function dirExists(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function readJsonFile(filePath: string): Promise<unknown> {
  const content = await fs.readFile(filePath, "utf-8");
  return JSON.parse(content) as unknown;
}

async function resolveBootDir(
  workspaceRoot: string,
  bootId: string
): Promise<string | null> {
  const fixtureDir = path.join(workspaceRoot, "fixtures", bootId);
  if (await dirExists(fixtureDir)) return fixtureDir;

  const dataDir = path.join(workspaceRoot, "server", "data", bootId);
  if (await dirExists(dataDir)) return dataDir;

  return null;
}

export function createApp(options: AppOptions = {}): Express {
  const workspaceRoot = options.workspaceRoot ?? WORKSPACE_ROOT;
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  });

  app.use("/fixtures", express.static(path.join(workspaceRoot, "fixtures")));

  app.get("/api/boots/:bootId", async (req, res) => {
    const { bootId } = req.params;
    if (!SAFE_BOOT_ID.test(bootId)) {
      res.status(400).json({ error: "Invalid bootId" });
      return;
    }

    const bootDir = await resolveBootDir(workspaceRoot, bootId);
    if (!bootDir) {
      res.status(404).json({ error: `Boot '${bootId}' not found` });
      return;
    }

    try {
      const [
        brandCoreRaw,
        productsRaw,
        worldSpecRaw,
        policyRaw,
        personasRaw,
        sessionConfigRaw,
      ] = await Promise.all([
        readJsonFile(path.join(bootDir, "brand_core.json")),
        readJsonFile(path.join(bootDir, "products.json")),
        readJsonFile(path.join(bootDir, "world_spec.json")),
        readJsonFile(path.join(bootDir, "adaptation_policy.json")),
        readJsonFile(path.join(bootDir, "demo_personas.json")),
        readJsonFile(path.join(bootDir, "session_config.json")),
      ]);

      res.json({
        brand_core: BrandCoreSchema.parse(brandCoreRaw),
        products: ProductsSchema.parse(productsRaw),
        world_spec: WorldSpecSchema.parse(worldSpecRaw),
        adaptation_policy: AdaptationPolicySchema.parse(policyRaw),
        demo_personas: DemoPersonasSchema.parse(personasRaw),
        session_config: SessionConfigSchema.parse(sessionConfigRaw),
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to load or validate boot artifacts",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return app;
}
