import { EventSchema, type BoutiqueEvent } from "@mybrand/shared";

export type EventSender = (events: BoutiqueEvent[]) => Promise<void>;

export interface EventBatcherOptions {
  intervalMs?: number;
  maxRecentEvents?: number;
  sender?: EventSender | null;
  onEventQueued?: (event: BoutiqueEvent) => void;
  onFlushError?: (error: unknown) => void;
}

export class EventBatcher {
  private readonly intervalMs: number;
  private readonly maxRecentEvents: number;
  private sender: EventSender | null;
  private readonly onEventQueued?: (event: BoutiqueEvent) => void;
  private readonly onFlushError?: (error: unknown) => void;

  private queue: BoutiqueEvent[] = [];
  private recent: BoutiqueEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  constructor(options: EventBatcherOptions = {}) {
    this.intervalMs = options.intervalMs ?? 1000;
    this.maxRecentEvents = options.maxRecentEvents ?? 40;
    this.sender = options.sender ?? null;
    this.onEventQueued = options.onEventQueued;
    this.onFlushError = options.onFlushError;
  }

  setSender(sender: EventSender | null): void {
    this.sender = sender;
  }

  enqueue(event: BoutiqueEvent, flushImmediately = false): boolean {
    const parsed = EventSchema.safeParse(event);
    if (!parsed.success) {
      return false;
    }

    this.queue.push(parsed.data);
    this.recent.push(parsed.data);
    if (this.recent.length > this.maxRecentEvents) {
      this.recent.splice(0, this.recent.length - this.maxRecentEvents);
    }

    this.onEventQueued?.(parsed.data);

    if (flushImmediately) {
      void this.flush();
    }

    return true;
  }

  getPendingCount(): number {
    return this.queue.length;
  }

  getRecentEvents(): BoutiqueEvent[] {
    return [...this.recent];
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async flush(): Promise<number> {
    if (this.flushing || this.queue.length === 0) {
      return 0;
    }

    if (!this.sender) {
      // Offline/local fallback mode: drain queue cleanly while preserving recent log
      const drained = this.queue.length;
      this.queue = [];
      return drained;
    }

    this.flushing = true;
    const batch = this.queue;
    this.queue = [];

    try {
      await this.sender(batch);
      return batch.length;
    } catch (error) {
      this.onFlushError?.(error);
      return 0;
    } finally {
      this.flushing = false;
    }
  }
}
