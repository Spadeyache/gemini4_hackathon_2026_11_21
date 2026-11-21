import type { Request, Response } from "express";
import type { SsePayload } from "./types";

const HEARTBEAT_INTERVAL_MS = 15_000;

export function formatSseMessage(payload: SsePayload): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export function attachSseClient(
  req: Request,
  res: Response,
  sessionId: string,
  clients: Set<Response>
): void {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.status(200);
  res.flushHeaders?.();

  clients.add(res);
  res.write(formatSseMessage({ type: "connected", sessionId }));

  const heartbeat = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      cleanup();
      return;
    }
    try {
      res.write(": heartbeat\n\n");
    } catch {
      cleanup();
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  const cleanup = (): void => {
    clearInterval(heartbeat);
    clients.delete(res);
  };

  req.on("close", cleanup);
  res.on("close", cleanup);
  res.on("finish", cleanup);
  res.on("error", cleanup);
}

export function broadcastSse(
  clients: Set<Response>,
  payload: SsePayload
): void {
  const frame = formatSseMessage(payload);
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

export function closeAllSse(clients: Set<Response>): void {
  for (const res of Array.from(clients)) {
    try {
      if (!res.writableEnded) {
        res.end();
      }
    } catch {
      // Ignore already-closed stream errors during cleanup.
    }
  }
  clients.clear();
}
