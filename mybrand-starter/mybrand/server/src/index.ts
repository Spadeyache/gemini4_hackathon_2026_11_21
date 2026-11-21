import { createApp } from "./app";
import type { BootJobManager } from "./boot/manager";
import { loadServerEnv } from "./env";
import type { SessionManager } from "./session/manager";

const env = loadServerEnv();
const app = createApp({ env });

const server = app.listen(env.port, () => {
  console.log(
    `[mybrand] Server listening on http://localhost:${env.port} (adapterMode=${env.sessionAdapterMode})`
  );
});

function shutdown(): void {
  const manager = app.locals.sessionManager as SessionManager | undefined;
  const bootManager = app.locals.bootJobManager as BootJobManager | undefined;
  manager?.destroy();
  bootManager?.destroy();
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
