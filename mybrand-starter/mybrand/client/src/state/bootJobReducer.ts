import type {
  BootActivity,
  BootAsset,
  BootJobSnapshot,
  BootJobStatus,
  BootMessage,
  BootSseFrame,
  BrandRead,
  PendingQuestion,
} from "../api/hostApi";

export const REQUIRED_ARTIFACTS = [
  {
    name: "brand_core",
    label: "Brand Core",
    description: "Positioning, voice, palette & story beats",
  },
  {
    name: "products",
    label: "Product Line",
    description: "Tiered catalog, variants & host-voice copy",
  },
  {
    name: "world_spec",
    label: "3D Boutique World",
    description: "Zones, fixtures, signage & lighting pools",
  },
  {
    name: "adaptation_policy",
    label: "Adaptation Policy",
    description: "Live session levers, rules & safety limits",
  },
  {
    name: "demo_personas",
    label: "Demo Personas",
    description: "Scripted contrasting visitor journeys",
  },
  {
    name: "session_config",
    label: "Session Config",
    description: "Runtime handoff for the Session Adapter",
  },
] as const;

export type BootStreamState = "connecting" | "live" | "reconnecting" | "closed";

export interface BootWorkspaceState {
  bootId: string;
  hydrated: boolean;
  status: BootJobStatus;
  phase: string;
  elapsedSeconds: number;
  lastHeartbeatAtMs: number | null;
  messages: BootMessage[];
  pendingQuestion: PendingQuestion | null;
  activities: BootActivity[];
  assets: BootAsset[];
  artifacts: string[];
  brandRead: BrandRead | null;
  readyToOpen: boolean;
  error: string | null;
  streamState: BootStreamState;
}

export type BootWorkspaceAction =
  | { type: "sse_frame"; frame: BootSseFrame; nowMs?: number }
  | { type: "stream_state"; streamState: BootStreamState }
  | { type: "local_tick"; nowMs?: number }
  | { type: "optimistic_host_reply"; text: string; nowMs?: number }
  | { type: "optimistic_shopify_skip"; nowMs?: number };

export function createInitialBootWorkspaceState(
  bootId: string
): BootWorkspaceState {
  return {
    bootId,
    hydrated: false,
    status: "running",
    phase: "Starting Boot agent…",
    elapsedSeconds: 0,
    lastHeartbeatAtMs: null,
    messages: [],
    pendingQuestion: null,
    activities: [],
    assets: [],
    artifacts: [],
    brandRead: null,
    readyToOpen: false,
    error: null,
    streamState: "connecting",
  };
}

function upsertById<T extends { id: string }>(
  list: readonly T[],
  item: T
): T[] {
  const index = list.findIndex((existing) => existing.id === item.id);
  if (index === -1) {
    return [...list, item];
  }
  const next = list.slice();
  next[index] = item;
  return next;
}

function upsertAsset(list: readonly BootAsset[], asset: BootAsset): BootAsset[] {
  const index = list.findIndex(
    (existing) =>
      existing.asset_id === asset.asset_id || existing.url === asset.url
  );
  if (index === -1) {
    return [...list, asset];
  }
  const next = list.slice();
  next[index] = asset;
  return next;
}

function mergeArtifactList(
  existing: readonly string[],
  incoming: readonly string[],
  addedName?: string
): string[] {
  const set = new Set<string>(existing);
  for (const name of incoming) {
    if (name.trim()) set.add(name);
  }
  if (addedName && addedName.trim()) {
    set.add(addedName);
  }
  return Array.from(set);
}

function applySnapshot(
  state: BootWorkspaceState,
  job: BootJobSnapshot,
  nowMs: number
): BootWorkspaceState {
  // Replace optimistic host message entries once server snapshot includes canonical messages
  const elapsedSeconds =
    typeof job.elapsed_s === "number"
      ? Math.max(state.elapsedSeconds, Math.floor(job.elapsed_s))
      : state.elapsedSeconds;

  return {
    ...state,
    bootId: job.bootId,
    hydrated: true,
    status: job.status,
    phase: job.phase,
    elapsedSeconds,
    lastHeartbeatAtMs: nowMs,
    messages: job.messages,
    pendingQuestion: job.pendingQuestion,
    activities: job.activities,
    assets: job.assets,
    artifacts: job.artifacts,
    brandRead: job.brandRead ?? state.brandRead,
    readyToOpen: job.readyToOpen,
    error: job.error ?? null,
  };
}

export function bootJobReducer(
  state: BootWorkspaceState,
  action: BootWorkspaceAction
): BootWorkspaceState {
  switch (action.type) {
    case "stream_state":
      return {
        ...state,
        streamState: action.streamState,
      };

    case "local_tick": {
      if (state.status !== "running") return state;
      return {
        ...state,
        elapsedSeconds: state.elapsedSeconds + 1,
      };
    }

    case "optimistic_host_reply": {
      const trimmed = action.text.trim();
      if (!trimmed) return state;
      const shouldClearQuestion = state.pendingQuestion?.kind === "ask_host";
      return {
        ...state,
        status:
          state.status === "waiting_host" || state.status === "completed"
            ? "running"
            : state.status,
        pendingQuestion: shouldClearQuestion ? null : state.pendingQuestion,
      };
    }

    case "optimistic_shopify_skip": {
      const shouldClear =
        state.pendingQuestion?.kind === "request_shopify_connection";
      return {
        ...state,
        status: state.status === "waiting_shopify" ? "running" : state.status,
        pendingQuestion: shouldClear ? null : state.pendingQuestion,
      };
    }

    case "sse_frame": {
      const nowMs = action.nowMs ?? Date.now();
      const { frame } = action;
      switch (frame.type) {
        case "snapshot":
          return applySnapshot(state, frame.job, nowMs);

        case "heartbeat":
          return {
            ...state,
            elapsedSeconds: Math.max(
              state.elapsedSeconds,
              Math.floor(frame.elapsed_s)
            ),
            phase: frame.phase || state.phase,
            lastHeartbeatAtMs: nowMs,
          };

        case "activity":
          return {
            ...state,
            activities: upsertById(state.activities, frame.activity),
            lastHeartbeatAtMs: nowMs,
          };

        case "message":
          return {
            ...state,
            messages: upsertById(state.messages, frame.message),
            lastHeartbeatAtMs: nowMs,
          };

        case "question": {
          const nextQuestion = frame.pendingQuestion;
          let nextStatus = state.status;
          if (nextQuestion?.kind === "ask_host") {
            nextStatus = "waiting_host";
          } else if (nextQuestion?.kind === "request_shopify_connection") {
            nextStatus = "waiting_shopify";
          }
          return {
            ...state,
            pendingQuestion: nextQuestion,
            status: nextStatus,
            lastHeartbeatAtMs: nowMs,
          };
        }

        case "asset":
          return {
            ...state,
            assets: upsertAsset(state.assets, frame.asset),
            lastHeartbeatAtMs: nowMs,
          };

        case "artifact":
          return {
            ...state,
            artifacts: mergeArtifactList(
              state.artifacts,
              frame.artifacts,
              frame.name
            ),
            readyToOpen: frame.readyToOpen || state.readyToOpen,
            brandRead:
              frame.brandRead !== undefined ? frame.brandRead : state.brandRead,
            lastHeartbeatAtMs: nowMs,
          };

        case "status":
          return {
            ...state,
            status: frame.status,
            phase: frame.phase || state.phase,
            readyToOpen: frame.readyToOpen,
            error:
              frame.error !== undefined
                ? frame.error
                : frame.status === "failed"
                  ? state.error
                  : null,
            brandRead:
              frame.brandRead !== undefined ? frame.brandRead : state.brandRead,
            pendingQuestion:
              frame.status === "running" ||
              frame.status === "completed" ||
              frame.status === "failed"
                ? null
                : state.pendingQuestion,
            lastHeartbeatAtMs: nowMs,
          };
      }
    }
  }
}

export function formatElapsedClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function formatPhaseLabel(phase: string): string {
  const trimmed = phase.trim();
  if (!trimmed) return "Booting boutique";
  const lookup: Record<string, string> = {
    intake: "Phase 0 · Intake",
    phase_0: "Phase 0 · Intake",
    brand_core: "Phase 1 · Brand Core",
    phase_1: "Phase 1 · Brand Core",
    products: "Phase 2 · Product Line",
    phase_2: "Phase 2 · Product Line",
    world: "Phase 3 · 3D World & Images",
    world_spec: "Phase 3 · 3D World & Images",
    phase_3: "Phase 3 · 3D World & Images",
    adaptation: "Phase 4 · Adaptation Policy",
    adaptation_policy: "Phase 4 · Adaptation Policy",
    phase_4: "Phase 4 · Adaptation Policy",
    shopify: "Phase 5 · Shopify Sync",
    phase_5: "Phase 5 · Shopify Sync",
    handoff: "Phase 6 · Handoff",
    session_config: "Phase 6 · Handoff",
    phase_6: "Phase 6 · Handoff",
    completed: "Boutique Ready",
    done: "Boutique Ready",
  };
  const key = trimmed.toLowerCase().replace(/[\s-]+/g, "_");
  return lookup[key] ?? trimmed;
}
