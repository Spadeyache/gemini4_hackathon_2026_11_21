import { useEffect, useState } from "react";
import {
  BrandCoreSchema,
  ProductsSchema,
  WorldSpecSchema,
  type BrandCore,
  type Products,
  type WorldSpec,
} from "@mybrand/shared";

interface HealthResponse {
  ok: boolean;
  status: string;
  timestamp: string;
}

interface FixturePreview {
  brand_core: BrandCore;
  products: Products;
  world_spec: WorldSpec;
}

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [fixture, setFixture] = useState<FixturePreview | null>(null);

  useEffect(() => {
    let active = true;

    fetch("/api/health")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<HealthResponse>;
      })
      .then((data) => {
        if (active) setHealth(data);
      })
      .catch((err: unknown) => {
        if (active) {
          setHealthError(err instanceof Error ? err.message : String(err));
        }
      });

    fetch("/api/boots/demo-brand")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<Record<string, unknown>>;
      })
      .then((data) => {
        if (!active) return;
        setFixture({
          brand_core: BrandCoreSchema.parse(data.brand_core),
          products: ProductsSchema.parse(data.products),
          world_spec: WorldSpecSchema.parse(data.world_spec),
        });
      })
      .catch(() => {
        // Optional preview on M0 landing page
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        margin: 0,
        padding: "3rem 1.5rem",
        fontFamily: "Inter, system-ui, -apple-system, sans-serif",
        backgroundColor: "#F2EAE0",
        color: "#2E2B28",
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <p
          style={{
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            fontSize: "0.75rem",
            color: "#8A7968",
            marginBottom: "0.5rem",
          }}
        >
          MyBrand · Milestone 0
        </p>
        <h1 style={{ fontSize: "2.25rem", margin: "0 0 0.75rem" }}>
          Scaffold &amp; Fixtures Ready
        </h1>
        <p style={{ lineHeight: 1.6, color: "#524B44", marginBottom: "2rem" }}>
          Workspaces (<code>shared</code>, <code>server</code>,{" "}
          <code>client</code>) and the <code>demo-brand</code> fixture are
          wired. Next milestones: M1 walkable 3D boutique and M2 session loop.
        </p>

        <section
          style={{
            background: "#FFFFFF",
            border: "1px solid #D9C9B8",
            borderRadius: 12,
            padding: "1.25rem 1.5rem",
            marginBottom: "1.25rem",
          }}
        >
          <h2 style={{ fontSize: "1rem", margin: "0 0 0.75rem" }}>
            Server Health (<code>GET /api/health</code>)
          </h2>
          {health ? (
            <p style={{ margin: 0, color: "#355E3B", fontWeight: 600 }}>
              OK — status: {health.status} ({health.timestamp})
            </p>
          ) : healthError ? (
            <p style={{ margin: 0, color: "#A12D2D" }}>
              Unavailable: {healthError}
            </p>
          ) : (
            <p style={{ margin: 0, color: "#8A7968" }}>Checking server…</p>
          )}
        </section>

        {fixture && (
          <section
            style={{
              background: "#FFFFFF",
              border: "1px solid #D9C9B8",
              borderRadius: 12,
              padding: "1.25rem 1.5rem",
            }}
          >
            <h2 style={{ fontSize: "1rem", margin: "0 0 0.5rem" }}>
              Demo Fixture: {fixture.brand_core.host.name} (
              <code>{fixture.brand_core.brand_slug}</code>)
            </h2>
            <p style={{ margin: "0 0 0.75rem", color: "#524B44" }}>
              {fixture.world_spec.entrance.greeting}
            </p>
            <ul
              style={{
                margin: 0,
                paddingLeft: "1.25rem",
                lineHeight: 1.7,
                color: "#524B44",
              }}
            >
              <li>
                <strong>Zones:</strong> {fixture.world_spec.zones.length} (
                {fixture.world_spec.zones.map((z) => z.id).join(", ")})
              </li>
              <li>
                <strong>Products:</strong> {fixture.products.length} across
                entry, core, and signature tiers
              </li>
              <li>
                <strong>Lighting presets:</strong>{" "}
                {fixture.world_spec.variant_pools.lighting.length}
              </li>
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
