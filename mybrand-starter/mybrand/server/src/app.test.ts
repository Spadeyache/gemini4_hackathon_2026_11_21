import fs from "node:fs";
import http from "node:http";
import type { Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { Duplex } from "node:stream";
import type { Express } from "express";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { loadServerEnv, parseServerEnv } from "./env";

interface MockResponse {
  status: number;
  headers: http.OutgoingHttpHeaders;
  text: string;
  json: <T = unknown>() => T;
}

function dispatch(
  app: Express,
  method: string,
  urlPath: string
): Promise<MockResponse> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const rawSocket = new Duplex({
      read() {},
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        callback();
      },
    });
    Object.assign(rawSocket, {
      remoteAddress: "127.0.0.1",
      writable: true,
      cork() {},
      uncork() {},
    });

    const socket = rawSocket as unknown as Socket;
    const req = new http.IncomingMessage(socket);
    req.method = method;
    req.url = urlPath;
    req.headers = { host: "127.0.0.1" };
    req.httpVersion = "1.0";
    req.httpVersionMajor = 1;
    req.httpVersionMinor = 0;

    const res = new http.ServerResponse(req);
    res.assignSocket(socket);

    res.on("error", reject);
    res.on("finish", () => {
      const wire = Buffer.concat(chunks);
      const separator = wire.indexOf("\r\n\r\n");
      const bodyBuffer = separator >= 0 ? wire.subarray(separator + 4) : wire;
      const text = bodyBuffer.toString("utf-8");
      resolve({
        status: res.statusCode,
        headers: res.getHeaders(),
        text,
        json: <T = unknown>() => JSON.parse(text) as T,
      });
    });

    app(req, res);
    req.push(null);
  });
}

describe("server env loading", () => {
  it("boots cleanly with an empty .env file and only warns when GEMINI_API_KEY is missing", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mybrand-env-"));
    const emptyEnvPath = path.join(tempDir, ".env");
    fs.writeFileSync(emptyEnvPath, "", "utf-8");

    const warnSpy = vi.fn();
    const prevKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
      const env = loadServerEnv(emptyEnvPath, warnSpy);
      expect(env.port).toBeGreaterThan(0);
      expect(env.geminiApiKey).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toContain("GEMINI_API_KEY");
    } finally {
      if (prevKey !== undefined) {
        process.env.GEMINI_API_KEY = prevKey;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not warn or leak secrets when GEMINI_API_KEY is set", () => {
    const warnSpy = vi.fn();
    const env = parseServerEnv(
      { PORT: "4000", GEMINI_API_KEY: "test-secret-do-not-log" },
      warnSpy
    );
    expect(env.port).toBe(4000);
    expect(env.geminiApiKey).toBe("test-secret-do-not-log");
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("server HTTP endpoints", () => {
  const app = createApp();

  it("GET /api/health returns ok", async () => {
    const res = await dispatch(app, "GET", "/api/health");
    expect(res.status).toBe(200);
    const body = res.json<{ ok: boolean; status: string }>();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("ok");
  });

  it("GET /api/boots/demo-brand returns schema-valid fixture artifacts", async () => {
    const res = await dispatch(app, "GET", "/api/boots/demo-brand");
    expect(res.status).toBe(200);
    const body = res.json<{
      brand_core: { brand_slug: string };
      products: unknown[];
      world_spec: { zones: unknown[] };
    }>();
    expect(body.brand_core.brand_slug).toBe("kestrel-clay");
    expect(body.products).toHaveLength(9);
    expect(body.world_spec.zones).toHaveLength(3);
  });

  it("serves static fixture palette assets", async () => {
    const res = await dispatch(
      app,
      "GET",
      "/fixtures/demo-brand/assets/floor_terracotta.svg"
    );
    expect(res.status).toBe(200);
    expect(res.text).toContain("#D9C9B8");
  });

  it("returns 404 for unknown bootId and 400 for invalid bootId", async () => {
    const missing = await dispatch(app, "GET", "/api/boots/does-not-exist");
    expect(missing.status).toBe(404);

    const invalid = await dispatch(app, "GET", "/api/boots/BAD_ID!");
    expect(invalid.status).toBe(400);
  });
});
