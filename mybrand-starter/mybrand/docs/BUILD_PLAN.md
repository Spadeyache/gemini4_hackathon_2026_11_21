# MyBrand — build plan

One milestone per conversation, in Planning mode. Start the next one only when the current checks pass.
After M0, M1 (client) and M2 (server) can run in parallel.

## M0 — Scaffold and fixtures
- npm workspaces: `client/`, `server/`, `shared/`. Root scripts: `dev` (client + server), `typecheck`, `test`.
- `shared/schemas.ts`: zod schemas for brand_core, products, world_spec, adaptation_policy, demo_personas, session_config, event and op, exactly as in `prompts/orchestrator.md` §5.
- `fixtures/demo-brand/`: a fictional brand (not a real person or company) with 3 zones, 8 products across the 3 tiers, 3 lighting presets, 2 signage lines per zone, 6 rules and 2 demo personas. Textures can be flat palette colors.
- The server reads env from `.env` (template: `.env.example`).

Checks: every fixture parses with its schema · `npm run dev` serves the client · `GET /api/health` returns ok.

## M1 — Walkable boutique (`client/` only)
- `/b/:bootId` loads world_spec, products and session_config from `GET /api/boots/:bootId` (fixtures first).
- First-person walk: WASD + mouse with pointer lock. The visitor can't walk through walls or fixtures.
- Draw the room, zones, fixtures (primitives styled from the palette), products on their slots, the hero plinth, signage, a glowing floor path to `guide_path.target_zone`, and the host-note bubble labeled "AI · in {host}'s voice".
- Look = the product under the screen-center ray for ≥600 ms. Inspect = click → panel with title, current blurb, price and "Add to cart" (opens `checkout_url` in a new tab; "Coming soon" when it's null).
- Event logger: send the §5 events in 1-s batches to `POST /api/sessions/:id/events`.
- `applyOps(ops)`: product swap = 400 ms fade/scale, lighting = 800 ms tween, text types itself out.
- Dev overlay (key `O`): visitor_read, each op's reason, source (model or rules) and latency, plus a box to inject ops by hand.

Checks: ≥50 fps · injected ops change the scene visibly · events reach the server log.

## M2 — Session loop (`server/` only)
- `POST /api/sessions {bootId}` → session id + base_state. State lives in memory; drop it after 10 min idle.
- Compute the §5 signals from events, in code.
- Tick every 8 s while the visitor is active, and right away on inspect or add_to_cart if the cooldown allows. No tick before `first_change_after_s`.
- Call `gemini-4-hydrogen` with `prompts/session_adapter.md` as the system instruction, thinking_level `low`, JSON output matching the op schema. Input: brand_card, catalog, policy, pools, state, signals (+ last 20 events), applied, now_s. Abort at `deadline_ms`.
- Validator: drop any op whose path isn't a lever, whose value isn't allowed, whose copy is too long, or that breaks a limit.
- Rules fallback: on timeout, bad JSON, or no valid ops while a rule fires, evaluate the policy rules in code (parse `when`, resolve `do.value` with the §5 resolvers) and apply the top firing rule.
- Push ops to the client over SSE (`GET /api/sessions/:id/stream`), each tagged with `source` and `latency_ms`.

Checks: unit tests for the validator (≥10 cases), every fixture rule (fires on a crafted event list) and the limits · 20 live Hydrogen calls with p50/p95 latency printed. If p95 > 2500 ms, rules drive the changes and the model writes only `/host_note`.

## M3 — Boot agent (server + host UI)
- `/host`: upload ≤20 images, add URLs, paste voice samples, then chat with the Boot agent.
- Run the Boot agent as a background job: `gemini-4-carbon`, `prompts/orchestrator.md` as the system instruction, thinking_level `medium`. Run the function-call loop yourself. Tools: `read_inputs`, `fetch_url`, `generate_image`, `save_artifact`, `ask_host`, `request_shopify_connection`.
- `ask_host` and `request_shopify_connection` wait until the host answers in the UI.
- Stream progress, the brand read and image thumbnails to the UI over SSE. Carbon can take minutes per turn, so always show something.
- `generate_image`: `gemini-nano-banana-2.1` (or `gemini-3-pro-image` when the prompt asks), save the PNG to `server/data/{boot_id}/assets/`, return its URL.
- `save_artifact`: validate with zod; on failure, return the zod error to the model so it fixes the JSON.
- "Open boutique" button → `/b/:bootId`.

Checks: a boot from 5 photos + 1 URL saves every artifact, all pass zod, and the boutique renders in the M1 client.

## M4 — Shopify
- Connect form in `/host`: shop domain + Client ID + Client Secret of a Dev Dashboard app installed on that store (a legacy Admin API token also works). Keep them in server memory only.
- On connect, spawn `npx shopify-mcp --clientId … --clientSecret … --domain …` over stdio and give its tools to the Boot agent (`mcpToTool`).
- Shopify must be able to fetch product images: serve assets at a public URL (tunnel or bucket), or upload them through Shopify staged uploads.
- Follow Phase 5 of `prompts/orchestrator.md` exactly.

Checks: on a dev store, products appear as DRAFT · syncing twice updates instead of duplicating · a checkout link puts the item in the cart.

## M5 — Demo mode
- `/demo/:bootId`: two boutiques side by side, each driven by one demo persona (scripted camera path + events) through the real session loop.
- Each side shows its overlay: visitor_read, reasons, source, latency. A reset button starts fresh sessions.
- Must still work, rules only, if the network drops.

Checks: within 60 s, the two sides differ in ≥3 visible ways.
