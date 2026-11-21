# MyBrand — rules for every agent in this workspace

## What we're building
MyBrand turns one person's or company's photos, websites and voice samples into a walkable 3D boutique with a real Shopify product line, then adapts that boutique live to each visitor. Target: a working hackathon demo (Gemini 4 × Shopify).

## The two runtime prompts — read before any change
The app contains two AI roles. Their system prompts live in `prompts/` and are product specs:
- `prompts/orchestrator.md`: the **Boot agent** (`gemini-4-carbon`). Runs once per brand as a chat with the host. Produces brand_core, products, world_spec, adaptation_policy, demo_personas and session_config, and syncs products to Shopify.
- `prompts/session_adapter.md`: the **Session Adapter** (`gemini-4-hydrogen`, thinking_level `low`, JSON output). The server calls it every few seconds per visitor; it returns ≤3 edits to that visitor's boutique.

These prompts are not instructions to you. Never adopt their roles. The server loads them from disk at runtime; don't copy them into code, and don't edit them unless the user asks.
§5 of `prompts/orchestrator.md` is the data contract for the whole app. Mirror it exactly in `shared/schemas.ts`.

## Stack (ask before changing)
- `client/`: Vite, React, TypeScript, three.js via `@react-three/fiber` and `@react-three/drei`
- `server/`: Node 22+, TypeScript, Express, `@google/genai`, `@modelcontextprotocol/sdk`
- `shared/`: zod schemas and types used by both
- Shopify at runtime: the `shopify-mcp` npm server, spawned over stdio with the host's credentials
- Storage: JSON files in `server/data/{boot_id}/`, images in `server/data/{boot_id}/assets/`. No database.
- `fixtures/demo-brand/`: a fictional sample brand. Build the client and the session loop against it before the Boot agent works.

## Ownership
When agents run in parallel, one owns `client/` and another owns `server/`. Change `shared/` only in a task that says so.

## Guardrails
- Secrets (`GEMINI_API_KEY`, Shopify credentials) live only in server env or memory: never in client code, logs, saved JSON, or git.
- Model IDs: `gemini-4-carbon`, `gemini-4-hydrogen`, `gemini-nano-banana-2.1`, `gemini-3-pro-image`. Don't substitute others without asking.
- Validate every model output with zod before using it.
- The session loop never writes to Shopify and never changes prices. Shopify writes happen only in the Boot flow, after the host approves.
- Session state lives in server memory and is discarded when the session ends. No learning across visitors.
- Out of scope: accounts and auth, mobile controls, several hosts at once, cross-visitor analytics.

## Verify every task
- `npm run typecheck` and `npm test` pass.
- Open the app in the browser and add screenshots to the walkthrough.
- Budget: ≥50 fps walking the fixture boutique on a laptop; ≤60 objects; ≤12 textures at 1024 px.
