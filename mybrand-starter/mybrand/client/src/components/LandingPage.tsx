import { useEffect, useState, type FormEvent } from "react";
import { fetchBootBundle, type BootBundle } from "../api/boutiqueApi";
import { fetchBootList, type BootListItem } from "../api/hostApi";

interface HealthResponse {
  ok: boolean;
  status: string;
  timestamp: string;
}

interface LandingPageProps {
  onNavigate: (path: string) => void;
}

function formatBootStatus(boot: BootListItem): { label: string; tone: string } {
  if (boot.status === "running") return { label: "Running", tone: "running" };
  if (boot.status === "waiting_host")
    return { label: "Waiting for host", tone: "waiting" };
  if (boot.status === "waiting_shopify")
    return { label: "Waiting for Shopify", tone: "waiting" };
  if (boot.status === "failed") return { label: "Failed", tone: "failed" };
  if (boot.ready) return { label: "Ready", tone: "ready" };
  return { label: "In progress", tone: "running" };
}

export function LandingPage({ onNavigate }: LandingPageProps) {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [demoBoot, setDemoBoot] = useState<BootBundle | null>(null);
  const [boots, setBoots] = useState<BootListItem[] | null>(null);
  const [customBootId, setCustomBootId] = useState("demo-brand");

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

    fetchBootList()
      .then((list) => {
        if (active) setBoots(list);
      })
      .catch(() => {
        // Fallback smoothly when /api/boots is unavailable
        if (active) {
          setBoots([
            {
              bootId: "demo-brand",
              name: "Kestrel & Clay",
              brandSlug: "kestrel-clay",
              source: "fixture",
              ready: true,
            },
          ]);
        }
      });

    fetchBootBundle("demo-brand")
      .then((bundle) => {
        if (active) setDemoBoot(bundle);
      })
      .catch(() => {
        // Optional preview stats on landing page
      });

    return () => {
      active = false;
    };
  }, []);

  const handleCustomOpen = (event: FormEvent) => {
    event.preventDefault();
    const cleaned = customBootId.trim().toLowerCase();
    if (!cleaned) return;
    onNavigate(`/b/${encodeURIComponent(cleaned)}`);
  };

  return (
    <main className="landing-page">
      <div className="landing-container">
        <p className="landing-eyebrow">MyBrand · Adaptive 3D Boutique Studio</p>
        <h1 className="landing-title">
          Turn photos &amp; voice into a live adaptive 3D boutique
        </h1>
        <p className="landing-lead">
          Build a bespoke boutique from your own material with{" "}
          <strong>Gemini 4</strong>, or explore an interactive 2.5D diorama &amp;
          walkable studio that adapts live as every visitor browses.
        </p>

        {/* Primary Host CTA */}
        <section className="landing-hero-card landing-create-card">
          <div className="landing-card-copy">
            <div className="landing-card-kicker">Host Studio · Boot Agent</div>
            <h2>Create a Boutique</h2>
            <p>
              Upload up to 20 photos, add links, and paste a few voice samples.
              Chat with the Boot agent as it designs your brand strategy,
              product catalog, generated artwork, 3D world, and live rules.
            </p>
          </div>
          <div className="landing-card-cta">
            <button
              type="button"
              className="primary-cta"
              onClick={() => onNavigate("/host")}
            >
              Create a Boutique →
            </button>
            <a
              href="/host"
              className="landing-direct-link"
              onClick={(e) => {
                e.preventDefault();
                onNavigate("/host");
              }}
            >
              /host
            </a>
          </div>
        </section>

        {/* Available Boutiques from GET /api/boots */}
        <section className="landing-boots-section" aria-label="Available boutiques">
          <div className="landing-section-head">
            <h2>Available Boutiques</h2>
            <span className="landing-section-sub">
              {boots ? `${boots.length} available` : "Loading…"}
            </span>
          </div>

          <div className="landing-boots-list">
            {(boots ?? []).map((boot) => {
              const status = formatBootStatus(boot);
              const isDemoFixture = boot.bootId === "demo-brand";
              return (
                <article key={boot.bootId} className="boot-list-card">
                  <div className="boot-list-copy">
                    <div className="boot-list-badges">
                      <span className={`boot-source-badge source-${boot.source}`}>
                        {boot.source === "fixture" ? "Fixture" : "Booted"}
                      </span>
                      <span className={`boot-status-pill tone-${status.tone}`}>
                        {status.label}
                      </span>
                    </div>
                    <h3>{boot.name}</h3>
                    <div className="boot-list-meta">
                      <code>{boot.bootId}</code>
                      {boot.brandSlug && boot.brandSlug !== boot.bootId && (
                        <>
                          <span>·</span>
                          <span>{boot.brandSlug}</span>
                        </>
                      )}
                      {isDemoFixture && demoBoot && (
                        <>
                          <span>·</span>
                          <span>
                            {demoBoot.world_spec.zones.length} zones ·{" "}
                            {demoBoot.products.length} products
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="boot-list-actions">
                    {boot.source === "data" && (
                      <button
                        type="button"
                        className="secondary-cta"
                        onClick={() =>
                          onNavigate(`/host/${encodeURIComponent(boot.bootId)}`)
                        }
                      >
                        {boot.ready ? "Host Studio" : "Resume Boot"}
                      </button>
                    )}
                    {boot.ready ? (
                      <button
                        type="button"
                        className="primary-cta"
                        onClick={() =>
                          onNavigate(`/b/${encodeURIComponent(boot.bootId)}`)
                        }
                      >
                        Enter Boutique →
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="primary-cta"
                        disabled
                        title="Finish booting to enter the boutique"
                      >
                        Building…
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <div className="landing-grid">
          <section className="landing-panel">
            <h3>Open another boot ID</h3>
            <form className="landing-form" onSubmit={handleCustomOpen}>
              <input
                type="text"
                value={customBootId}
                onChange={(e) => setCustomBootId(e.target.value)}
                placeholder="demo-brand"
                aria-label="Boot ID"
              />
              <button type="submit" className="secondary-cta">
                Open
              </button>
            </form>
          </section>

          <section className="landing-panel">
            <h3>Server Health</h3>
            {health ? (
              <p className="health-ok">
                OK — {health.status} (
                {new Date(health.timestamp).toLocaleTimeString()})
              </p>
            ) : healthError ? (
              <p className="health-err">Unavailable: {healthError}</p>
            ) : (
              <p className="health-pending">Checking /api/health…</p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
