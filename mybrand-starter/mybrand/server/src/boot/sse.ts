import type { Request, Response } from "express";
import type { BootJobSnapshot, BootSseEvent } from "./types";

const IDLE_PING_INTERVAL_MS = 15_000;

export function formatBootSseFrame(payload: BootSseEvent): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export function attachBootSseClient(
  req: Request,
  res: Response,
  snapshot: BootJobSnapshot,
  clients: Set<Response>
): void {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.status(200);
  res.flushHeaders?.();

  clients.add(res);
  res.write(formatBootSseFrame({ type: "snapshot", job: snapshot }));

  const keepalive = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      cleanup();
      return;
    }
    try {
      res.write(": keepalive\n\n");
    } catch {
      cleanup();
    }
  }, IDLE_PING_INTERVAL_MS);
  keepalive.unref?.();

  const cleanup = (): void => {
    clearInterval(keepalive);
    clients.delete(res);
  };

  req.on("close", cleanup);
  res.on("close", cleanup);
  res.on("finish", cleanup);
  res.on("error", cleanup);
}

export function broadcastBootSse(
  clients: Set<Response>,
  payload: BootSseEvent
): void {
  const frame = formatBootSseFrame(payload);
  for (const res of Array.from(clients)) {
    if (res.writableEnded || res.destroyed) {
      clients.delete(res);
      continue;
    }
    try {
      res.write(frame);
    } catch {
      clients.delete(res);
    }
  }
}

export function closeAllBootSse(clients: Set<Response>): void {
  for (const res of Array.from(clients)) {
    try {
      if (!res.writableEnded) {
        res.end();
      }
    } catch {
      // Ignore already-closed stream errors during shutdown.
    }
  }
  clients.clear();
}
