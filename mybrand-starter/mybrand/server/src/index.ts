import { createApp } from "./app";
import { loadServerEnv } from "./env";

const env = loadServerEnv();
const app = createApp();

app.listen(env.port, () => {
  console.log(`[mybrand] Server listening on http://localhost:${env.port}`);
});
