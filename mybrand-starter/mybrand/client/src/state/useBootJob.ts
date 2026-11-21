import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  fetchBootJob,
  sendBootReply,
  sendShopifyResponse,
  subscribeBootStream,
  type ShopifyResponsePayload,
} from "../api/hostApi";
import {
  bootJobReducer,
  createInitialBootWorkspaceState,
  type BootWorkspaceState,
} from "./bootJobReducer";

export interface UseBootJobHandle {
  state: BootWorkspaceState;
  loading: boolean;
  notFound: boolean;
  loadError: string | null;
  submittingReply: boolean;
  submittingShopify: boolean;
  actionError: string | null;
  submitReply: (text: string) => Promise<boolean>;
  submitShopify: (payload: ShopifyResponsePayload) => Promise<boolean>;
  refreshSnapshot: () => Promise<void>;
}

export function useBootJob(bootId: string): UseBootJobHandle {
  const [state, dispatch] = useReducer(
    bootJobReducer,
    bootId,
    createInitialBootWorkspaceState
  );
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submittingReply, setSubmittingReply] = useState(false);
  const [submittingShopify, setSubmittingShopify] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const reconnectTimerRef = useRef<number | null>(null);
  const brandReadPresentRef = useRef(false);

  useEffect(() => {
    brandReadPresentRef.current = state.brandRead !== null;
  }, [state.brandRead]);

  const refreshSnapshot = useCallback(async () => {
    try {
      const job = await fetchBootJob(bootId);
      dispatch({
        type: "sse_frame",
        frame: { type: "snapshot", job },
      });
      setNotFound(false);
      setLoadError(null);
      setLoading(false);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 404) {
        setNotFound(true);
      } else {
        setLoadError(err instanceof Error ? err.message : String(err));
      }
      setLoading(false);
    }
  }, [bootId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setNotFound(false);
    setLoadError(null);
    setActionError(null);

    const hydrate = async () => {
      try {
        const job = await fetchBootJob(bootId);
        if (!active) return;
        dispatch({
          type: "sse_frame",
          frame: { type: "snapshot", job },
        });
        setLoading(false);
      } catch (err) {
        if (!active) return;
        const status = (err as { status?: number }).status;
        if (status === 404) {
          setNotFound(true);
        } else {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
        setLoading(false);
      }
    };

    void hydrate();

    const unsubscribe = subscribeBootStream(bootId, {
      onOpen: () => {
        if (!active) return;
        if (reconnectTimerRef.current !== null) {
          window.clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        dispatch({ type: "stream_state", streamState: "live" });
      },
      onFrame: (frame) => {
        if (!active) return;
        dispatch({ type: "stream_state", streamState: "live" });
        dispatch({ type: "sse_frame", frame });
        setLoading(false);

        // If brand_core just saved and brandRead wasn't attached on the frame, pull snapshot so the Brand Read card populates immediately.
        if (
          frame.type === "artifact" &&
          frame.name === "brand_core" &&
          !frame.brandRead &&
          !brandReadPresentRef.current
        ) {
          void fetchBootJob(bootId)
            .then((job) => {
              if (active) {
                dispatch({
                  type: "sse_frame",
                  frame: { type: "snapshot", job },
                });
              }
            })
            .catch(() => {
              // Ignore opportunistic refresh error
            });
        }
      },
      onError: () => {
        if (!active) return;
        dispatch({ type: "stream_state", streamState: "reconnecting" });
        if (reconnectTimerRef.current === null) {
          reconnectTimerRef.current = window.setTimeout(() => {
            reconnectTimerRef.current = null;
            if (!active) return;
            void fetchBootJob(bootId)
              .then((job) => {
                if (active) {
                  dispatch({
                    type: "sse_frame",
                    frame: { type: "snapshot", job },
                  });
                }
              })
              .catch(() => {
                // Keep waiting for EventSource reconnect
              });
          }, 4000);
        }
      },
    });

    return () => {
      active = false;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      unsubscribe();
      dispatch({ type: "stream_state", streamState: "closed" });
    };
  }, [bootId]);

  // 1-second local elapsed clock so UI always feels alive between server heartbeats
  useEffect(() => {
    if (state.status !== "running") return;
    const timer = window.setInterval(() => {
      dispatch({ type: "local_tick" });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [state.status]);

  const submitReply = useCallback(
    async (text: string): Promise<boolean> => {
      const trimmed = text.trim();
      if (!trimmed || submittingReply) return false;
      setSubmittingReply(true);
      setActionError(null);
      try {
        await sendBootReply(bootId, trimmed);
        dispatch({ type: "optimistic_host_reply", text: trimmed });
        return true;
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setSubmittingReply(false);
      }
    },
    [bootId, submittingReply]
  );

  const submitShopify = useCallback(
    async (payload: ShopifyResponsePayload): Promise<boolean> => {
      if (submittingShopify) return false;
      setSubmittingShopify(true);
      setActionError(null);
      try {
        await sendShopifyResponse(bootId, payload);
        if (payload.skip) {
          dispatch({ type: "optimistic_shopify_skip" });
        }
        return true;
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setSubmittingShopify(false);
      }
    },
    [bootId, submittingShopify]
  );

  return {
    state,
    loading,
    notFound,
    loadError,
    submittingReply,
    submittingShopify,
    actionError,
    submitReply,
    submitShopify,
    refreshSnapshot,
  };
}
