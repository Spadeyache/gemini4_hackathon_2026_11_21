import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Request, Response } from "express";
import type {
  BoutiqueEvent,
  Op,
  SessionState,
} from "@mybrand/shared";
import { loadSessionConfig } from "../boot";
import type { SessionAdapterMode } from "../env";
import { createHydrogenClient } from "./hydrogen";
import { evaluateRules, evaluateThematicFallback } from "./rules";
import { computeSignals, toModelSignalsPayload } from "./signals";
import { attachSseClient, broadcastSse, closeAllSse } from "./sse";
import type {
  ComputedSignals,
  RuntimeOpSource,
  SessionAdapterClient,
  SessionAdapterInput,
  SessionRecord,
  SseOpsPayload,
  TaggedOp,
} from "./types";
import { validateOps } from "./validator";

const DEFAULT_TICK_INTERVAL_MS = 8_000;
const DEFAULT_IDLE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_IDLE_SWEEP_INTERVAL_MS = 60_000;
const DEFAULT_ACTIVE_WINDOW_MS = 60_000;

export interface SessionManagerOptions {
  workspaceRoot: string;
  geminiApiKey?: string;
  adapterClient?: SessionAdapterClient;
  adapterMode?: SessionAdapterMode;
  clock?: () => number;
  tickIntervalMs?: number;
  idleTtlMs?: number;
  idleSweepIntervalMs?: number;
  activeWindowMs?: number;
  logger?: (message: string) => void;
}

export interface CreateSessionResult {
  sessionId: string;
  base_state: SessionState;
}

export interface IngestEventsResult {
  accepted: number;
  triggeredImmediateTick: boolean;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function summarizeEventsForLog(events: readonly BoutiqueEvent[]): string {
  return events
    .map((event) => {
      const details: string[] = [];
      if (event.zone) details.push(event.zone);
      if (event.product_id) details.push(event.product_id);
      if (event.ms !== undefined) details.push(`${event.ms}ms`);
      const suffix = details.length > 0 ? `(${details.join(",")})` : "";
      return `${event.type}${suffix}@${event.t}s`;
    })
    .join(", ");
}

export class SessionManager {
  private readonly workspaceRoot: string;
  private readonly adapterClient: SessionAdapterClient;
  private readonly adapterMode: SessionAdapterMode;
  private readonly clock: () => number;
  private readonly tickIntervalMs: number;
  private readonly idleTtlMs: number;
  private readonly activeWindowMs: number;
  private readonly logger: (message: string) => void;
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly sweepTimer: NodeJS.Timeout | null;

  constructor(options: SessionManagerOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.adapterClient =
      options.adapterClient ??
      createHydrogenClient({
        apiKey: options.geminiApiKey,
        workspaceRoot: options.workspaceRoot,
      });
    this.adapterMode = options.adapterMode ?? "full";
    this.clock = options.clock ?? (() => Date.now());
    this.tickIntervalMs = options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
    this.idleTtlMs = options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
    this.activeWindowMs = options.activeWindowMs ?? DEFAULT_ACTIVE_WINDOW_MS;
    this.logger = options.logger ?? ((msg) => console.log(msg));

    const sweepInterval =
      options.idleSweepIntervalMs ?? DEFAULT_IDLE_SWEEP_INTERVAL_MS;
    if (sweepInterval > 0) {
      this.sweepTimer = setInterval(() => {
        this.sweepIdleSessions();
      }, sweepInterval);
      this.sweepTimer.unref?.();
    } else {
      this.sweepTimer = null;
    }
  }

  async createSession(bootId: string): Promise<CreateSessionResult | null> {
    const config = await loadSessionConfig(this.workspaceRoot, bootId);
    if (!config) return null;

    const nowMs = this.clock();
    const sessionId = crypto.randomUUID();
    const baseStateCopy: SessionState = { ...config.base_state };

    const record: SessionRecord = {
      id: sessionId,
      bootId,
      config,
      state: { ...baseStateCopy },
      events: [],
      maxEventT: 0,
      applied: [],
      createdAtMs: nowMs,
      lastActivityMs: nowMs,
      lastEventAtMs: null,
      lastChangeAtS: null,
      leverLastChangedAtS: {},
      tickInFlight: false,
      pendingImmediateTick: false,
      tickTimer: null,
      sseClients: new Set<Response>(),
    };

    if (this.tickIntervalMs > 0) {
      record.tickTimer = setInterval(() => {
        this.onPeriodicTick(sessionId);
      }, this.tickIntervalMs);
      record.tickTimer.unref?.();
    }

    this.sessions.set(sessionId, record);
    this.logger(
      `[session:${sessionId.slice(0, 8)}] created for boot '${bootId}' (mode=${this.adapterMode})`
    );

    return {
      sessionId,
      base_state: baseStateCopy,
    };
  }

  getSession(sessionId: string): SessionRecord | undefined {
    const record = this.sessions.get(sessionId);
    if (!record) return undefined;

    if (this.clock() - record.lastActivityMs >= this.idleTtlMs) {
      this.evictSession(record, "idle TTL elapsed");
      return undefined;
    }

    return record;
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  ingestEvents(
    sessionId: string,
    events: readonly BoutiqueEvent[]
  ): IngestEventsResult | null {
    const session = this.getSession(sessionId);
    if (!session) return null;

    const nowMs = this.clock();
    session.lastActivityMs = nowMs;

    if (events.length > 0) {
      session.lastEventAtMs = nowMs;
      for (const event of events) {
        session.events.push(event);
        if (event.t > session.maxEventT) {
          session.maxEventT = event.t;
        }
      }
      this.logger(
        `[session:${session.id.slice(0, 8)}] +${events.length} events: ${summarizeEventsForLog(events)}`
      );
    }

    const hasImmediateEvent = events.some(
      (event) => event.type === "inspect" || event.type === "add_to_cart"
    );

    let triggeredImmediateTick = false;
    if (hasImmediateEvent) {
      const nowS = this.computeNowS(session);
      if (this.canTickNow(session, nowS)) {
        triggeredImmediateTick = true;
        if (session.tickInFlight) {
          session.pendingImmediateTick = true;
        } else {
          void this.tickSession(session.id).catch((err) => {
            this.logger(
              `[session:${session.id.slice(0, 8)}] immediate tick error: ${err instanceof Error ? err.message : String(err)}`
            );
          });
        }
      }
    }

    return {
      accepted: events.length,
      triggeredImmediateTick,
    };
  }

  attachStream(sessionId: string, req: Request, res: Response): boolean {
    const session = this.getSession(sessionId);
    if (!session) return false;

    session.lastActivityMs = this.clock();
    attachSseClient(req, res, session.id, session.sseClients);
    return true;
  }

  /**
   * Explicit demo trigger ("Adapt Now" / Ctrl+U): bypasses first_change_after_s
   * and cooldown_s so the presenter can immediately ask gemini-4-hydrogen to adapt
   * products, lighting, signage, guide path, and host_note to recent selections.
   * All §5 levers, allowed values, copy caps, and session caps remain strictly enforced.
   */
  async forceAdaptNow(sessionId: string): Promise<SseOpsPayload | null> {
    const session = this.getSession(sessionId);
    if (!session) return null;

    session.lastActivityMs = this.clock();
    if (session.tickInFlight) return null;

    const rawNowS = round2(this.computeNowS(session));
    const effectiveNowS = Math.max(
      rawNowS,
      session.config.policy.limits.first_change_after_s + 1
    );
    if (session.applied.length >= session.config.policy.limits.max_ops_per_session) {
      return null;
    }

    session.tickInFlight = true;
    try {
      const signals = computeSignals(
        session.events,
        session.config.catalog,
        effectiveNowS
      );

      // 1. Prefer live gemini-4-hydrogen when available (except rules_only mode)
      if (this.adapterMode !== "rules_only" && this.adapterClient.isAvailable()) {
        const modelInput = this.buildAdapterInput(
          session,
          signals,
          effectiveNowS
        );
        const deadlineMs = Math.max(
          session.config.policy.limits.deadline_ms,
          9_000
        );
        const modelRes = await this.adapterClient.propose(modelInput, deadlineMs);

        if (modelRes.ok && this.sessions.get(sessionId) === session) {
          const latestSignals = computeSignals(
            session.events,
            session.config.catalog,
            effectiveNowS
          );
          const validated = validateOps(modelRes.output.ops, {
            config: session.config,
            state: session.state,
            signals: latestSignals,
            now_s: effectiveNowS,
            appliedCount: session.applied.length,
            lastChangeAtS: session.lastChangeAtS,
            leverLastChangedAtS: session.leverLastChangedAtS,
            skipTimingGates: true,
          });
          if (validated.accepted.length > 0) {
            return this.applyAndBroadcast(session, validated.accepted, {
              source: "model",
              latency_ms: modelRes.latency_ms,
              visitor_read:
                modelRes.output.visitor_read || "tailored to your recent picks",
              confidence: modelRes.output.confidence,
              now_s: rawNowS,
            });
          }
        } else if (!modelRes.ok) {
          this.logger(
            `[session:${session.id.slice(0, 8)}] forceAdaptNow fallback (${modelRes.timedOut ? "timeout" : "error"}, ${modelRes.latency_ms}ms): ${modelRes.error}`
          );
        }
      }

      // 2. Fallback: deterministic thematic match or top firing rule (skipping timing gates)
      const thematic = evaluateThematicFallback(
        {
          config: session.config,
          state: session.state,
          signals,
          applied: session.applied,
          now_s: effectiveNowS,
          lastChangeAtS: session.lastChangeAtS,
          leverLastChangedAtS: session.leverLastChangedAtS,
        },
        { skipTimingGates: true }
      );
      if (thematic) {
        return this.applyAndBroadcast(session, thematic.ops, {
          source: "rules",
          latency_ms: 1,
          visitor_read: thematic.visitor_read,
          confidence: thematic.confidence,
          now_s: rawNowS,
        });
      }

      const ruleMatch = evaluateRules({
        config: session.config,
        state: session.state,
        signals,
        applied: session.applied,
        now_s: effectiveNowS,
        lastChangeAtS: null,
        leverLastChangedAtS: {},
      });
      if (ruleMatch) {
        return this.applyAndBroadcast(session, [ruleMatch.op], {
          source: "rules",
          latency_ms: 1,
          visitor_read: ruleMatch.visitor_read,
          confidence: ruleMatch.confidence,
          now_s: rawNowS,
        });
      }

      return null;
    } finally {
      session.tickInFlight = false;
    }
  }

  async tickSession(
    sessionId: string,
    options?: { nowSOverride?: number }
  ): Promise<SseOpsPayload[]> {
    const session = this.getSession(sessionId);
    if (!session || session.tickInFlight) return [];

    const nowS = round2(options?.nowSOverride ?? this.computeNowS(session));
    if (!this.canTickNow(session, nowS)) return [];

    session.tickInFlight = true;
    const emitted: SseOpsPayload[] = [];

    try {
      const signals = computeSignals(
        session.events,
        session.config.catalog,
        nowS
      );
      const effectiveMode: SessionAdapterMode = !this.adapterClient.isAvailable()
        ? "rules_only"
        : this.adapterMode;

      if (effectiveMode === "rules_only") {
        const rulePayload = this.runRulesAndApply(session, signals, nowS);
        if (rulePayload) emitted.push(rulePayload);
      } else if (effectiveMode === "hybrid") {
        // 1. Instant deterministic policy rule (~1ms) if one matches right now.
        const rulePayload = this.runRulesAndApply(session, signals, nowS);
        if (rulePayload) {
          emitted.push(rulePayload);
        }

        // 2. Live gemini-4-hydrogen multi-op thematic adaptation across all allowed levers
        //    (swapping matching-theme products, signage, lighting, guide path, and host_note).
        const remainingBudget =
          session.config.policy.limits.max_ops_per_session -
          session.applied.length;
        const hasSignal =
          signals.recent_events.length > 0 &&
          (rulePayload !== null ||
            signals.recent_events.some(
              (ev) =>
                ev.type === "inspect" ||
                ev.type === "add_to_cart" ||
                ev.type === "look"
            ));

        let modelApplied = false;
        if (
          hasSignal &&
          remainingBudget > 0 &&
          this.sessions.get(sessionId) === session
        ) {
          const modelInput = this.buildAdapterInput(session, signals, nowS);
          const modelDeadlineMs = Math.max(
            session.config.policy.limits.deadline_ms,
            session.config.policy.limits.cooldown_s * 1000
          );
          const modelRes = await this.adapterClient.propose(
            modelInput,
            modelDeadlineMs
          );
          if (modelRes.ok && this.sessions.get(sessionId) === session) {
            const latestSignals = computeSignals(
              session.events,
              session.config.catalog,
              nowS
            );
            const validated = validateOps(modelRes.output.ops, {
              config: session.config,
              state: session.state,
              signals: latestSignals,
              now_s: nowS,
              appliedCount: session.applied.length,
              lastChangeAtS: session.lastChangeAtS,
              leverLastChangedAtS: session.leverLastChangedAtS,
              skipCooldownCheck: rulePayload !== null,
            });
            if (validated.accepted.length > 0) {
              const modelPayload = this.applyAndBroadcast(
                session,
                validated.accepted,
                {
                  source: "model",
                  latency_ms: modelRes.latency_ms,
                  visitor_read:
                    modelRes.output.visitor_read ||
                    rulePayload?.visitor_read ||
                    "tailoring boutique theme",
                  confidence: modelRes.output.confidence,
                  now_s: nowS,
                }
              );
              emitted.push(modelPayload);
              modelApplied = true;
            }
          } else if (!modelRes.ok) {
            this.logger(
              `[session:${session.id.slice(0, 8)}] hybrid model fallback (${modelRes.timedOut ? "timeout" : "error"}, ${modelRes.latency_ms}ms): ${modelRes.error}`
            );
          }
        }

        // 3. If neither hardcoded rules nor model applied an edit yet, try deterministic theme matching.
        if (
          !rulePayload &&
          !modelApplied &&
          this.sessions.get(sessionId) === session
        ) {
          const thematic = evaluateThematicFallback({
            config: session.config,
            state: session.state,
            signals,
            applied: session.applied,
            now_s: nowS,
            lastChangeAtS: session.lastChangeAtS,
            leverLastChangedAtS: session.leverLastChangedAtS,
          });
          if (thematic) {
            const fallbackPayload = this.applyAndBroadcast(
              session,
              thematic.ops,
              {
                source: "rules",
                latency_ms: 1,
                visitor_read: thematic.visitor_read,
                confidence: thematic.confidence,
                now_s: nowS,
              }
            );
            emitted.push(fallbackPayload);
          }
        }
      } else if (effectiveMode === "rules_plus_host_note") {
        const rulePayload = this.runRulesAndApply(session, signals, nowS);
        if (rulePayload) {
          emitted.push(rulePayload);

          const remainingBudget =
            session.config.policy.limits.max_ops_per_session -
            session.applied.length;
          if (remainingBudget > 0 && this.sessions.get(sessionId) === session) {
            const hostNoteInput = this.buildAdapterInput(session, signals, nowS);
            const hostNoteDeadlineMs = Math.max(
              session.config.policy.limits.deadline_ms,
              session.config.policy.limits.cooldown_s * 1000
            );
            const modelRes = await this.adapterClient.propose(
              hostNoteInput,
              hostNoteDeadlineMs,
              { hostNoteOnly: true }
            );
            if (modelRes.ok && this.sessions.get(sessionId) === session) {
              const latestSignals = computeSignals(
                session.events,
                session.config.catalog,
                nowS
              );
              const validated = validateOps(modelRes.output.ops, {
                config: session.config,
                state: session.state,
                signals: latestSignals,
                now_s: nowS,
                appliedCount: session.applied.length,
                lastChangeAtS: session.lastChangeAtS,
                leverLastChangedAtS: session.leverLastChangedAtS,
                allowedPathFilter: (p) => p === "/host_note",
                skipCooldownCheck: true,
              });
              if (validated.accepted.length > 0) {
                const notePayload = this.applyAndBroadcast(
                  session,
                  validated.accepted,
                  {
                    source: "model",
                    latency_ms: modelRes.latency_ms,
                    visitor_read:
                      modelRes.output.visitor_read || rulePayload.visitor_read,
                    confidence: modelRes.output.confidence,
                    now_s: nowS,
                  }
                );
                emitted.push(notePayload);
              }
            }
          }
        }
      } else {
        // Full mode: call Hydrogen first, validate, fall back to rules on failure/timeout or empty ops while a rule fires.
        const input = this.buildAdapterInput(session, signals, nowS);
        const modelRes = await this.adapterClient.propose(
          input,
          session.config.policy.limits.deadline_ms
        );

        if (this.sessions.get(sessionId) !== session) {
          return emitted;
        }

        const latestSignals = computeSignals(
          session.events,
          session.config.catalog,
          nowS
        );

        if (modelRes.ok) {
          const validated = validateOps(modelRes.output.ops, {
            config: session.config,
            state: session.state,
            signals: latestSignals,
            now_s: nowS,
            appliedCount: session.applied.length,
            lastChangeAtS: session.lastChangeAtS,
            leverLastChangedAtS: session.leverLastChangedAtS,
          });

          if (validated.accepted.length > 0) {
            const payload = this.applyAndBroadcast(
              session,
              validated.accepted,
              {
                source: "model",
                latency_ms: modelRes.latency_ms,
                visitor_read: modelRes.output.visitor_read,
                confidence: modelRes.output.confidence,
                now_s: nowS,
              }
            );
            emitted.push(payload);
          } else {
            // No valid model ops -> fall back to rules if a rule fires.
            const rulePayload = this.runRulesAndApply(
              session,
              latestSignals,
              nowS,
              modelRes.latency_ms
            );
            if (rulePayload) emitted.push(rulePayload);
          }
        } else {
          this.logger(
            `[session:${session.id.slice(0, 8)}] model fallback (${modelRes.timedOut ? "timeout" : "error"}, ${modelRes.latency_ms}ms): ${modelRes.error}`
          );
          const rulePayload = this.runRulesAndApply(
            session,
            latestSignals,
            nowS,
            modelRes.latency_ms
          );
          if (rulePayload) emitted.push(rulePayload);
        }
      }
    } finally {
      session.tickInFlight = false;
      if (
        session.pendingImmediateTick &&
        this.sessions.get(sessionId) === session
      ) {
        session.pendingImmediateTick = false;
        const followUpNowS = this.computeNowS(session);
        if (this.canTickNow(session, followUpNowS)) {
          void this.tickSession(sessionId).catch(() => {});
        }
      }
    }

    return emitted;
  }

  sweepIdleSessions(): number {
    const nowMs = this.clock();
    let evicted = 0;
    for (const session of Array.from(this.sessions.values())) {
      if (nowMs - session.lastActivityMs >= this.idleTtlMs) {
        this.evictSession(session, "idle TTL elapsed");
        evicted++;
      }
    }
    return evicted;
  }

  destroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
    }
    for (const session of Array.from(this.sessions.values())) {
      this.evictSession(session, "shutdown");
    }
  }

  private onPeriodicTick(sessionId: string): void {
    const session = this.getSession(sessionId);
    if (!session || session.tickInFlight) return;
    if (!this.isVisitorActive(session)) return;

    void this.tickSession(sessionId).catch((err) => {
      this.logger(
        `[session:${session.id.slice(0, 8)}] periodic tick error: ${err instanceof Error ? err.message : String(err)}`
      );
    });
  }

  private isVisitorActive(session: SessionRecord): boolean {
    if (session.events.length === 0) return false;
    if (session.sseClients.size > 0) return true;
    if (session.lastEventAtMs === null) return false;
    return this.clock() - session.lastEventAtMs <= this.activeWindowMs;
  }

  private computeNowS(session: SessionRecord): number {
    const elapsedWallS = Math.max(0, (this.clock() - session.createdAtMs) / 1000);
    return Math.max(elapsedWallS, session.maxEventT);
  }

  private canTickNow(session: SessionRecord, nowS: number): boolean {
    const { limits } = session.config.policy;
    if (nowS < limits.first_change_after_s) return false;
    if (
      session.lastChangeAtS !== null &&
      nowS - session.lastChangeAtS < limits.cooldown_s
    ) {
      return false;
    }
    if (session.applied.length >= limits.max_ops_per_session) return false;
    return true;
  }

  private buildAdapterInput(
    session: SessionRecord,
    signals: ComputedSignals,
    nowS: number
  ): SessionAdapterInput {
    return {
      brand_card: session.config.brand_card,
      catalog: session.config.catalog,
      policy: session.config.policy,
      pools: session.config.pools,
      state: { ...session.state },
      signals: toModelSignalsPayload(signals),
      applied: session.applied.map((entry) => ({
        path: entry.op.path,
        value: entry.op.value,
        reason: entry.op.reason,
        at_s: entry.applied_at_s,
      })),
      now_s: nowS,
    };
  }

  private runRulesAndApply(
    session: SessionRecord,
    signals: ComputedSignals,
    nowS: number,
    priorLatencyMs?: number
  ): SseOpsPayload | null {
    const start = performance.now();
    const match = evaluateRules({
      config: session.config,
      state: session.state,
      signals,
      applied: session.applied,
      now_s: nowS,
      lastChangeAtS: session.lastChangeAtS,
      leverLastChangedAtS: session.leverLastChangedAtS,
    });
    const evalMs = Math.round(performance.now() - start);
    if (!match) return null;

    const latencyMs = priorLatencyMs !== undefined ? priorLatencyMs + evalMs : evalMs;
    return this.applyAndBroadcast(session, [match.op], {
      source: "rules",
      latency_ms: latencyMs,
      visitor_read: match.visitor_read,
      confidence: match.confidence,
      now_s: nowS,
    });
  }

  private applyAndBroadcast(
    session: SessionRecord,
    ops: readonly Op[],
    meta: {
      source: RuntimeOpSource;
      latency_ms: number;
      visitor_read: string;
      confidence: number;
      now_s: number;
    }
  ): SseOpsPayload {
    const taggedOps: TaggedOp[] = [];

    for (const op of ops) {
      session.state[op.path] = op.value;
      session.applied.push({
        op,
        applied_at_s: meta.now_s,
        source: meta.source,
        latency_ms: meta.latency_ms,
      });
      session.leverLastChangedAtS[op.path] = meta.now_s;
      taggedOps.push({
        ...op,
        source: meta.source,
        latency_ms: meta.latency_ms,
      });
    }

    session.lastChangeAtS = meta.now_s;

    const payload: SseOpsPayload = {
      type: "ops",
      ops: taggedOps,
      visitor_read: meta.visitor_read,
      confidence: meta.confidence,
      source: meta.source,
      latency_ms: meta.latency_ms,
      now_s: meta.now_s,
    };

    broadcastSse(session.sseClients, payload);
    this.logger(
      `[session:${session.id.slice(0, 8)}] applied ${taggedOps.length} op(s) via ${meta.source} (${meta.latency_ms}ms): ${taggedOps.map((o) => `${o.path}=${JSON.stringify(o.value)}`).join("; ")}`
    );

    return payload;
  }

  private evictSession(session: SessionRecord, reason: string): void {
    if (session.tickTimer) {
      clearInterval(session.tickTimer);
      session.tickTimer = null;
    }
    closeAllSse(session.sseClients);
    this.sessions.delete(session.id);
    if (reason !== "shutdown") {
      this.logger(
        `[session:${session.id.slice(0, 8)}] dropped (${reason})`
      );
    }
  }
}
