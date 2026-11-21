import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BoutiqueEvent,
  EventType,
  Op,
  OpSource,
  Product,
  SessionState,
} from "@mybrand/shared";
import {
  createSession,
  fetchBootBundle,
  postSessionEvents,
  subscribeSessionStream,
  triggerSessionAdapt,
  type BootBundle,
  type SseOpsPayload,
} from "../api/boutiqueApi";
import { EventBatcher } from "../api/eventBatcher";
import {
  applyOpsToState,
  buildInitialSessionState,
  type AppliedOpRecord,
  type ApplyOpsResult,
  type IncomingOpItem,
} from "./sessionState";

export type SessionMode = "connecting" | "live" | "local-fallback";
export type StreamStatus = "idle" | "connected" | "reconnecting" | "offline";

export interface EmitEventInput {
  type: EventType;
  zone?: string;
  product_id?: string;
  ms?: number;
}

export interface BoutiqueSessionHandle {
  loading: boolean;
  error: string | null;
  boot: BootBundle | null;
  sessionId: string | null;
  sessionMode: SessionMode;
  streamStatus: StreamStatus;
  sessionState: SessionState;
  visitorRead: string;
  confidence: number;
  opLog: AppliedOpRecord[];
  recentEvents: BoutiqueEvent[];
  bagProductIds: Set<string>;
  isAdapting: boolean;
  assetUrlById: Map<string, string>;
  productById: Map<string, Product>;
  emitEvent: (input: EmitEventInput, flushImmediately?: boolean) => void;
  applyOps: (
    ops: readonly (Op | IncomingOpItem | unknown)[],
    meta: {
      source: OpSource;
      latency_ms: number;
      visitor_read?: string;
      confidence?: number;
      now_s?: number;
    }
  ) => ApplyOpsResult | null;
  toggleBagItem: (product: Product, zoneId?: string) => boolean;
  adaptNow: () => Promise<void>;
  getElapsedSeconds: () => number;
}

export function useBoutiqueSession(bootId: string): BoutiqueSessionHandle {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [boot, setBoot] = useState<BootBundle | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionMode, setSessionMode] = useState<SessionMode>("connecting");
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("idle");
  const [sessionState, setSessionState] = useState<SessionState>({});
  const [visitorRead, setVisitorRead] = useState("orienting in boutique");
  const [confidence, setConfidence] = useState(0);
  const [opLog, setOpLog] = useState<AppliedOpRecord[]>([]);
  const [recentEvents, setRecentEvents] = useState<BoutiqueEvent[]>([]);
  const [bagProductIds, setBagProductIds] = useState<Set<string>>(() => new Set());
  const [isAdapting, setIsAdapting] = useState(false);

  const sessionStartRef = useRef<number>(performance.now());
  const sessionStateRef = useRef<SessionState>({});
  const bootRef = useRef<BootBundle | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const isAdaptingRef = useRef(false);
  const batcherRef = useRef<EventBatcher | null>(null);
  const bagProductIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    sessionStateRef.current = sessionState;
  }, [sessionState]);

  useEffect(() => {
    bootRef.current = boot;
  }, [boot]);

  const getElapsedSeconds = useCallback(() => {
    return Number(((performance.now() - sessionStartRef.current) / 1000).toFixed(2));
  }, []);

  const applyOps = useCallback(
    (
      ops: readonly (Op | IncomingOpItem | unknown)[],
      meta: {
        source: OpSource;
        latency_ms: number;
        visitor_read?: string;
        confidence?: number;
        now_s?: number;
      }
    ): ApplyOpsResult | null => {
      const currentBoot = bootRef.current;
      if (!currentBoot) return null;

      const result = applyOpsToState(
        sessionStateRef.current,
        ops,
        {
          worldSpec: currentBoot.world_spec,
          products: currentBoot.products,
        },
        {
          source: meta.source,
          latency_ms: meta.latency_ms,
          now_s: meta.now_s ?? getElapsedSeconds(),
        }
      );

      if (result.applied.length > 0) {
        sessionStateRef.current = result.nextState;
        setSessionState(result.nextState);
        setOpLog((prev) => [...result.applied.slice().reverse(), ...prev].slice(0, 60));
      }

      if (typeof meta.visitor_read === "string" && meta.visitor_read.trim().length > 0) {
        setVisitorRead(meta.visitor_read);
      }
      if (typeof meta.confidence === "number") {
        setConfidence(meta.confidence);
      }

      return result;
    },
    [getElapsedSeconds]
  );

  useEffect(() => {
    let active = true;
    let unsubscribeStream: (() => void) | null = null;

    setLoading(true);
    setError(null);
    setBoot(null);
    setSessionId(null);
    setSessionMode("connecting");
    setStreamStatus("idle");
    setOpLog([]);
    setRecentEvents([]);
    setVisitorRead("orienting in boutique");
    setConfidence(0);
    bagProductIdsRef.current = new Set();
    setBagProductIds(new Set());

    sessionStartRef.current = performance.now();

    const batcher = new EventBatcher({
      intervalMs: 1000,
      onEventQueued: () => {
        if (active) {
          setRecentEvents(batcher.getRecentEvents());
        }
      },
    });
    batcherRef.current = batcher;
    batcher.start();

    async function init() {
      try {
        const bundle = await fetchBootBundle(bootId);
        if (!active) return;

        bootRef.current = bundle;
        setBoot(bundle);

        const initialFromBoot = buildInitialSessionState(
          bundle.world_spec,
          bundle.session_config.base_state
        );
        sessionStateRef.current = initialFromBoot;
        setSessionState(initialFromBoot);
        setLoading(false);

        try {
          const created = await createSession(bootId);
          if (!active) return;

          const serverState = buildInitialSessionState(
            bundle.world_spec,
            created.base_state
          );
          sessionStateRef.current = serverState;
          setSessionState(serverState);
          sessionIdRef.current = created.sessionId;
          setSessionId(created.sessionId);
          setSessionMode("live");

          batcher.setSender(async (events) => {
            await postSessionEvents(created.sessionId, events);
          });

          unsubscribeStream = subscribeSessionStream(created.sessionId, {
            onConnected: () => {
              if (active) setStreamStatus("connected");
            },
            onOps: (payload: SseOpsPayload) => {
              if (!active) return;
              setStreamStatus("connected");
              applyOps(
                payload.ops.map((item) => ({
                  op: {
                    op: item.op,
                    path: item.path,
                    value: item.value,
                    reason: item.reason,
                  },
                  source: item.source,
                  latency_ms: item.latency_ms,
                })),
                {
                  source: payload.source,
                  latency_ms: payload.latency_ms,
                  visitor_read: payload.visitor_read,
                  confidence: payload.confidence,
                  now_s: payload.now_s,
                }
              );
            },
            onError: () => {
              if (active) setStreamStatus("reconnecting");
            },
          });
        } catch {
          if (!active) return;
          // Graceful fallback when M2 session loop endpoint is not running yet
          sessionIdRef.current = null;
          setSessionId(null);
          setSessionMode("local-fallback");
          setStreamStatus("offline");
          batcher.setSender(null);
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    }

    void init();

    const handlePageHide = () => {
      void batcher.flush();
    };
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      active = false;
      window.removeEventListener("pagehide", handlePageHide);
      unsubscribeStream?.();
      batcher.stop();
      void batcher.flush();
      batcherRef.current = null;
    };
  }, [bootId, applyOps]);

  const emitEvent = useCallback(
    (input: EmitEventInput, flushImmediately = false) => {
      const batcher = batcherRef.current;
      if (!batcher) return;

      const event: BoutiqueEvent = {
        t: getElapsedSeconds(),
        type: input.type,
        ...(input.zone ? { zone: input.zone } : {}),
        ...(input.product_id ? { product_id: input.product_id } : {}),
        ...(typeof input.ms === "number" ? { ms: Math.max(0, Math.round(input.ms)) } : {}),
      };

      batcher.enqueue(event, flushImmediately);
    },
    [getElapsedSeconds]
  );

  const toggleBagItem = useCallback(
    (product: Product, zoneId?: string): boolean => {
      const next = new Set(bagProductIdsRef.current);
      const added = !next.has(product.id);
      if (added) {
        next.add(product.id);
      } else {
        next.delete(product.id);
      }
      bagProductIdsRef.current = next;
      setBagProductIds(next);

      emitEvent(
        {
          type: added ? "add_to_cart" : "remove_from_cart",
          zone: zoneId ?? product.zone_id,
          product_id: product.id,
        },
        true
      );

      return added;
    },
    [emitEvent]
  );

  const assetUrlById = useMemo(() => {
    const map = new Map<string, string>();
    if (boot) {
      for (const asset of boot.world_spec.assets) {
        map.set(asset.id, asset.url);
      }
    }
    return map;
  }, [boot]);

  const productById = useMemo(() => {
    const map = new Map<string, Product>();
    if (boot) {
      for (const product of boot.products) {
        map.set(product.id, product);
      }
    }
    return map;
  }, [boot]);

  const adaptNow = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || isAdaptingRef.current) return;

    isAdaptingRef.current = true;
    setIsAdapting(true);
    try {
      // Flush any buffered clicks/looks before calling Gemini 4 Hydrogen
      if (batcherRef.current) {
        await batcherRef.current.flush();
      }
      await triggerSessionAdapt(sid);
    } catch {
      // Ignore transient demo trigger failure cleanly
    } finally {
      isAdaptingRef.current = false;
      setIsAdapting(false);
    }
  }, []);

  return {
    loading,
    error,
    boot,
    sessionId,
    sessionMode,
    streamStatus,
    sessionState,
    visitorRead,
    confidence,
    opLog,
    recentEvents,
    bagProductIds,
    isAdapting,
    assetUrlById,
    productById,
    emitEvent,
    applyOps,
    toggleBagItem,
    adaptNow,
    getElapsedSeconds,
  };
}
