import fs from "node:fs/promises";
import path from "node:path";
import {
  AdaptationPolicySchema,
  BrandCoreSchema,
  DemoPersonasSchema,
  ProductsSchema,
  SessionConfigSchema,
  WorldSpecSchema,
  type AdaptationPolicy,
  type BrandCore,
  type DemoPersonas,
  type Products,
  type SessionConfig,
  type WorldSpec,
} from "@mybrand/shared";

import type { BootListItem } from "./boot/types";

export const SAFE_BOOT_ID = /^[a-z0-9-]+$/;

export const REQUIRED_BOOT_ARTIFACTS = [
  "brand_core",
  "products",
  "world_spec",
  "adaptation_policy",
  "demo_personas",
  "session_config",
] as const;

export interface BootArtifacts {
  brand_core: BrandCore;
  products: Products;
  world_spec: WorldSpec;
  adaptation_policy: AdaptationPolicy;
  demo_personas: DemoPersonas;
  session_config: SessionConfig;
}

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

export async function resolveBootDir(
  workspaceRoot: string,
  bootId: string
): Promise<string | null> {
  const fixtureDir = path.join(workspaceRoot, "fixtures", bootId);
  if (await dirExists(fixtureDir)) return fixtureDir;

  const dataDir = path.join(workspaceRoot, "server", "data", bootId);
  if (await dirExists(dataDir)) return dataDir;

  return null;
}

export async function loadBootArtifacts(
  workspaceRoot: string,
  bootId: string
): Promise<BootArtifacts | null> {
  const bootDir = await resolveBootDir(workspaceRoot, bootId);
  if (!bootDir) return null;

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

  return {
    brand_core: BrandCoreSchema.parse(brandCoreRaw),
    products: ProductsSchema.parse(productsRaw),
    world_spec: WorldSpecSchema.parse(worldSpecRaw),
    adaptation_policy: AdaptationPolicySchema.parse(policyRaw),
    demo_personas: DemoPersonasSchema.parse(personasRaw),
    session_config: SessionConfigSchema.parse(sessionConfigRaw),
  };
}

export async function loadSessionConfig(
  workspaceRoot: string,
  bootId: string
): Promise<SessionConfig | null> {
  const bootDir = await resolveBootDir(workspaceRoot, bootId);
  if (!bootDir) return null;

  const raw = await readJsonFile(path.join(bootDir, "session_config.json"));
  return SessionConfigSchema.parse(raw);
}

async function inspectDiskBootDir(
  dirPath: string,
  bootId: string,
  source: "fixture" | "data"
): Promise<BootListItem> {
  let name = bootId;
  let brandSlug: string | undefined;

  try {
    const brandCoreRaw = await readJsonFile(path.join(dirPath, "brand_core.json"));
    const parsedCore = BrandCoreSchema.safeParse(brandCoreRaw);
    if (parsedCore.success) {
      name = parsedCore.data.host.name;
      brandSlug = parsedCore.data.brand_slug;
    }
  } catch {
    try {
      const manifestRaw = (await readJsonFile(
        path.join(dirPath, "inputs", "manifest.json")
      )) as { host?: { name?: string } };
      if (manifestRaw?.host?.name) {
        name = manifestRaw.host.name;
      }
    } catch {
      // Fall back to bootId as display name.
    }
  }

  let ready = false;
  try {
    const [
      brandCoreRaw,
      productsRaw,
      worldSpecRaw,
      policyRaw,
      personasRaw,
      sessionConfigRaw,
    ] = await Promise.all([
      readJsonFile(path.join(dirPath, "brand_core.json")),
      readJsonFile(path.join(dirPath, "products.json")),
      readJsonFile(path.join(dirPath, "world_spec.json")),
      readJsonFile(path.join(dirPath, "adaptation_policy.json")),
      readJsonFile(path.join(dirPath, "demo_personas.json")),
      readJsonFile(path.join(dirPath, "session_config.json")),
    ]);

    BrandCoreSchema.parse(brandCoreRaw);
    ProductsSchema.parse(productsRaw);
    WorldSpecSchema.parse(worldSpecRaw);
    AdaptationPolicySchema.parse(policyRaw);
    DemoPersonasSchema.parse(personasRaw);
    SessionConfigSchema.parse(sessionConfigRaw);
    ready = true;
  } catch {
    ready = false;
  }

  return {
    bootId,
    name,
    ...(brandSlug ? { brandSlug } : {}),
    source,
    ready,
  };
}

async function scanBootRoot(
  rootDir: string,
  source: "fixture" | "data"
): Promise<BootListItem[]> {
  let entries;
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const items: BootListItem[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!SAFE_BOOT_ID.test(entry.name)) continue;
    items.push(
      await inspectDiskBootDir(path.join(rootDir, entry.name), entry.name, source)
    );
  }
  return items;
}

export async function listDiskBoots(
  workspaceRoot: string
): Promise<BootListItem[]> {
  const [fixtures, dataBoots] = await Promise.all([
    scanBootRoot(path.join(workspaceRoot, "fixtures"), "fixture"),
    scanBootRoot(path.join(workspaceRoot, "server", "data"), "data"),
  ]);

  const byId = new Map<string, BootListItem>();
  for (const item of dataBoots) {
    byId.set(item.bootId, item);
  }
  // Fixtures take precedence if the same bootId exists in both places (matching resolveBootDir).
  for (const item of fixtures) {
    byId.set(item.bootId, item);
  }

  return Array.from(byId.values());
}
