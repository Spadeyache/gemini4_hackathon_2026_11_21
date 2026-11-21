import { useCallback, useEffect, useState } from "react";
import { BoutiquePage } from "./components/BoutiquePage";
import { HostIntakePage } from "./components/host/HostIntakePage";
import { HostWorkspacePage } from "./components/host/HostWorkspacePage";
import { LandingPage } from "./components/LandingPage";
import { parseRoute } from "./routing";

export function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  const navigate = useCallback((nextPath: string) => {
    if (window.location.pathname !== nextPath) {
      window.history.pushState(null, "", nextPath);
      setPathname(nextPath);
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setPathname(window.location.pathname);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const route = parseRoute(pathname);

  if (route.kind === "host-intake") {
    return <HostIntakePage onNavigate={navigate} />;
  }

  if (route.kind === "host-workspace") {
    return (
      <HostWorkspacePage
        key={route.bootId}
        bootId={route.bootId}
        onNavigate={navigate}
      />
    );
  }

  if (route.kind === "boutique") {
    return (
      <BoutiquePage
        key={route.bootId}
        bootId={route.bootId}
        onNavigate={navigate}
      />
    );
  }

  if (route.kind === "not-found") {
    return (
      <main className="boutique-status-screen">
        <div className="status-card">
          <div className="status-eyebrow">MyBrand</div>
          <h1>Page not found</h1>
          <p>
            Start a new boutique at <code>/host</code> or open the demo boutique
            at <code>/b/demo-brand</code>.
          </p>
          <div className="status-card-actions">
            <button
              type="button"
              className="primary-cta"
              onClick={() => navigate("/host")}
            >
              Create a Boutique →
            </button>
            <button
              type="button"
              className="secondary-cta"
              onClick={() => navigate("/b/demo-brand")}
            >
              Enter demo-brand
            </button>
          </div>
        </div>
      </main>
    );
  }

  return <LandingPage onNavigate={navigate} />;
}
