import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Canvas } from "@react-three/fiber";
import type { Product } from "@mybrand/shared";
import {
  getHostNote,
  getProductBlurbIndex,
  getZoneSignage,
} from "../state/sessionState";
import { useBoutiqueSession } from "../state/useBoutiqueSession";
import { extractBrandPalette, resolveAssetUrl } from "../world/geometryUtils";
import { AdaptationToast } from "./hud/AdaptationToast";
import { CrosshairHud } from "./hud/CrosshairHud";
import { DevOverlay } from "./hud/DevOverlay";
import { HostNoteBubble } from "./hud/HostNoteBubble";
import { InspectPanel } from "./hud/InspectPanel";
import {
  BoutiqueScene,
  type CameraMode,
  type ScenePerfStats,
  type TargetGazeInfo,
} from "./scene/BoutiqueScene";

interface BoutiquePageProps {
  bootId: string;
  onNavigate: (path: string) => void;
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export function BoutiquePage({ bootId, onNavigate }: BoutiquePageProps) {
  const session = useBoutiqueSession(bootId);

  const [cameraMode, setCameraMode] = useState<CameraMode>("diorama");
  const [focusedZoneId, setFocusedZoneId] = useState<string | null>(null);
  const [pointerLocked, setPointerLocked] = useState(false);
  const [devOverlayOpen, setDevOverlayOpen] = useState(false);
  const [currentZoneId, setCurrentZoneId] = useState<string | null>(null);
  const [targetGaze, setTargetGaze] = useState<TargetGazeInfo | null>(null);
  const [inspected, setInspected] = useState<{
    productId: string;
    zoneId: string;
  } | null>(null);
  const [perfStats, setPerfStats] = useState<ScenePerfStats>({
    fps: 60,
    objects: 0,
    textures: 0,
  });

  const canvasElementRef = useRef<HTMLCanvasElement | null>(null);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const dioramaZoneRef = useRef<string | null>(null);
  const dioramaZoneEnteredAtRef = useRef<number>(performance.now());

  const handleChangeCameraMode = useCallback((nextMode: CameraMode) => {
    if (nextMode === "diorama" && document.pointerLockElement) {
      document.exitPointerLock();
    }
    setCameraMode(nextMode);
  }, []);

  // Keyboard shortcuts: Ctrl+U adapts immediately via Gemini 4 Hydrogen; 'O' toggles Dev Overlay; 'V' toggles 2.5D View <-> Walk
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "u") {
        event.preventDefault();
        void session.adaptNow();
        return;
      }

      if (isEditableElement(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "o" || event.key === "O") {
        event.preventDefault();
        setDevOverlayOpen((prev) => {
          const next = !prev;
          if (next && document.pointerLockElement) {
            document.exitPointerLock();
          }
          return next;
        });
      } else if (event.key === "v" || event.key === "V") {
        event.preventDefault();
        setCameraMode((prev) => {
          const next: CameraMode = prev === "diorama" ? "walk" : "diorama";
          if (next === "diorama" && document.pointerLockElement) {
            document.exitPointerLock();
          }
          return next;
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [session.adaptNow]);

  const handleZoneChange = useCallback(
    (nextZoneId: string | null, prevZoneId: string | null, dwellMs: number) => {
      setCurrentZoneId(nextZoneId);
      if (prevZoneId) {
        session.emitEvent({
          type: "exit_zone",
          zone: prevZoneId,
          ms: dwellMs,
        });
      }
      if (nextZoneId) {
        session.emitEvent({
          type: "enter_zone",
          zone: nextZoneId,
        });
      }
    },
    [session.emitEvent]
  );

  // Focusing a zone in 2.5D Diorama mode glides camera + emits live enter_zone/exit_zone events
  const handleFocusZone = useCallback(
    (nextZoneId: string | null) => {
      setFocusedZoneId(nextZoneId);
      const prevZoneId = dioramaZoneRef.current;
      if (nextZoneId === prevZoneId) return;

      const now = performance.now();
      const dwellMs = Math.max(0, Math.round(now - dioramaZoneEnteredAtRef.current));
      dioramaZoneRef.current = nextZoneId;
      dioramaZoneEnteredAtRef.current = now;
      handleZoneChange(nextZoneId, prevZoneId, dwellMs);
    },
    [handleZoneChange]
  );

  const handleLookEvent = useCallback(
    (productId: string, zoneId: string, ms: number) => {
      session.emitEvent({
        type: "look",
        zone: zoneId,
        product_id: productId,
        ms,
      });
    },
    [session.emitEvent]
  );

  const handleInspectProduct = useCallback(
    (product: Product, zoneId: string) => {
      setInspected({ productId: product.id, zoneId });
      session.emitEvent(
        {
          type: "inspect",
          zone: zoneId,
          product_id: product.id,
        },
        true
      );
    },
    [session.emitEvent]
  );

  const handleCheckoutClick = useCallback(
    (product: Product, zoneId: string) => {
      session.emitEvent(
        {
          type: "add_to_cart",
          zone: zoneId,
          product_id: product.id,
        },
        true
      );
      session.emitEvent(
        {
          type: "checkout_click",
          zone: zoneId,
          product_id: product.id,
        },
        true
      );
      if (product.shopify.checkout_url) {
        window.open(
          product.shopify.checkout_url,
          "_blank",
          "noopener,noreferrer"
        );
      }
    },
    [session.emitEvent]
  );

  const handleToggleTestBag = useCallback(
    (product: Product, zoneId: string) => {
      session.toggleBagItem(product, zoneId);
    },
    [session.toggleBagItem]
  );

  const handlePointerMissed = useCallback(
    (event: MouseEvent) => {
      if (cameraMode !== "walk") return;
      if (inspected !== null) return;
      if (document.pointerLockElement) return;

      const down = pointerDownPosRef.current;
      if (down) {
        const dist = Math.hypot(event.clientX - down.x, event.clientY - down.y);
        if (dist > 6) return; // User dragged to look rather than clicking to lock
      }

      const canvas = canvasElementRef.current;
      if (canvas && typeof canvas.requestPointerLock === "function") {
        void Promise.resolve(canvas.requestPointerLock()).catch(() => {
          // Ignore browser pointer lock rejections
        });
      }
    },
    [cameraMode, inspected]
  );

  const palette = useMemo(
    () => (session.boot ? extractBrandPalette(session.boot.brand_core) : null),
    [session.boot]
  );

  const cssVars = useMemo<CSSProperties>(
    () =>
      ({
        "--brand-floor": palette?.floor ?? "#D9C9B8",
        "--brand-accent": palette?.accent ?? "#C46D4E",
        "--brand-dark": palette?.dark ?? "#2E2B28",
        "--brand-wood": palette?.wood ?? "#8A7968",
        "--brand-secondary": palette?.secondary ?? "#5B6B5C",
        "--brand-wall": palette?.wall ?? "#F2EAE0",
      }) as CSSProperties,
    [palette]
  );

  if (session.loading) {
    return (
      <div className="boutique-status-screen" style={cssVars}>
        <div className="status-card">
          <div className="status-eyebrow">MyBrand Boutique</div>
          <h1>Opening {bootId}…</h1>
          <p>Loading world spec, catalog, and lighting presets.</p>
        </div>
      </div>
    );
  }

  if (session.error || !session.boot) {
    return (
      <div className="boutique-status-screen" style={cssVars}>
        <div className="status-card">
          <div className="status-eyebrow">Boutique Unavailable</div>
          <h1>Could not open &ldquo;{bootId}&rdquo;</h1>
          <p className="status-error">{session.error ?? "Unknown error"}</p>
          <button
            type="button"
            className="primary-cta"
            onClick={() => onNavigate("/")}
          >
            ← Back to lobby
          </button>
        </div>
      </div>
    );
  }

  const { brand_core, world_spec, products } = session.boot;
  const activeZoneId = cameraMode === "diorama" ? focusedZoneId : currentZoneId;
  const currentZone =
    world_spec.zones.find((z) => z.id === activeZoneId) ?? null;
  const currentZoneSignage = currentZone
    ? getZoneSignage(session.sessionState, currentZone.id, currentZone.signage)
    : null;
  const hostNote = getHostNote(session.sessionState, world_spec);

  const inspectedProduct = inspected
    ? (session.productById.get(inspected.productId) ?? null)
    : null;
  const inspectedBlurbIndex = inspectedProduct
    ? getProductBlurbIndex(session.sessionState, inspectedProduct.id, world_spec)
    : 0;
  const inspectedImageUrl = resolveAssetUrl(
    inspectedProduct?.image_asset_ids[0],
    session.assetUrlById
  );

  return (
    <div
      className="boutique-shell"
      style={cssVars}
      onMouseDown={(e) => {
        if (e.target === canvasElementRef.current) {
          pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
        }
      }}
    >
      <Canvas
        dpr={[1, 1.5]}
        camera={{ fov: 56, near: 0.1, far: 260 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          canvasElementRef.current = gl.domElement;
        }}
        onPointerMissed={handlePointerMissed}
      >
        <BoutiqueScene
          brandCore={brand_core}
          worldSpec={world_spec}
          sessionState={session.sessionState}
          productById={session.productById}
          assetUrlById={session.assetUrlById}
          cameraMode={cameraMode}
          focusedZoneId={focusedZoneId}
          controlsDisabled={inspected !== null}
          pointerLocked={pointerLocked}
          onPointerLockChange={setPointerLocked}
          onZoneChange={handleZoneChange}
          onFocusZone={handleFocusZone}
          onLookEvent={handleLookEvent}
          onInspectProduct={handleInspectProduct}
          onTargetChange={setTargetGaze}
          onPerfStats={setPerfStats}
        />
      </Canvas>

      <CrosshairHud
        brandCore={brand_core}
        worldSpec={world_spec}
        currentZone={currentZone}
        currentZoneSignage={currentZoneSignage}
        cameraMode={cameraMode}
        focusedZoneId={focusedZoneId}
        targetGaze={targetGaze}
        pointerLocked={pointerLocked}
        devOverlayOpen={devOverlayOpen}
        inspectOpen={inspectedProduct !== null}
        bagCount={session.bagProductIds.size}
        sessionMode={session.sessionMode}
        streamStatus={session.streamStatus}
        isAdapting={session.isAdapting}
        onAdaptNow={() => {
          void session.adaptNow();
        }}
        onChangeCameraMode={handleChangeCameraMode}
        onFocusZone={handleFocusZone}
        onToggleDevOverlay={() => {
          setDevOverlayOpen((prev) => {
            const next = !prev;
            if (next && document.pointerLockElement) {
              document.exitPointerLock();
            }
            return next;
          });
        }}
        onBackHome={() => {
          if (document.pointerLockElement) {
            document.exitPointerLock();
          }
          onNavigate("/");
        }}
      />

      <AdaptationToast
        opLog={session.opLog}
        visitorRead={session.visitorRead}
        productById={session.productById}
        worldSpec={world_spec}
      />

      <HostNoteBubble hostName={brand_core.host.name} note={hostNote} />

      <InspectPanel
        product={inspectedProduct}
        zoneId={inspected?.zoneId ?? null}
        activeBlurbIndex={inspectedBlurbIndex}
        imageUrl={inspectedImageUrl}
        inBag={
          inspectedProduct
            ? session.bagProductIds.has(inspectedProduct.id)
            : false
        }
        onClose={() => setInspected(null)}
        onCheckoutClick={handleCheckoutClick}
        onToggleTestBag={handleToggleTestBag}
      />

      <DevOverlay
        open={devOverlayOpen}
        bootId={bootId}
        sessionId={session.sessionId}
        sessionMode={session.sessionMode}
        streamStatus={session.streamStatus}
        currentZoneId={activeZoneId}
        worldSpec={world_spec}
        products={products}
        visitorRead={session.visitorRead}
        confidence={session.confidence}
        opLog={session.opLog}
        recentEvents={session.recentEvents}
        perfStats={perfStats}
        onClose={() => setDevOverlayOpen(false)}
        onInjectOps={session.applyOps}
      />
    </div>
  );
}
