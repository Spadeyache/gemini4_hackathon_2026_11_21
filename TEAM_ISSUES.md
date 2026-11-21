# ATELIER 119 — Hackathon Sprint Backlog (`TEAM_ISSUES.md`)

> **Target Repo:** [`Spadeyache/gemini4_hackathon_2026_11_21`](https://github.com/Spadeyache/gemini4_hackathon_2026_11_21)  
> **Hard Submission Cutoff:** **5:00 PM ET** *(Feature freeze at **4:15 PM ET** for 1-min video capture & pitch rehearsal)*  
> **Publish all 8 issues + labels to GitHub in one command:**  
> ```powershell
> .\scripts\create_github_issues.ps1
> ```

---

## Sprint Assignment & Zero-Conflict Matrix

| # | Issue Title | Suggested Owner | Feature Branch | Labels | Rubric Target |
| :-: | :--- | :--- | :--- | :--- | :--- |
| **#1** | `[Agents / Gemini 4]` Wire Gemini 4 Multimodal Brand Architect (`POST /api/ingest-url` + IG Grid Screenshot Drop) -> `StoreConfig` JSON | **Teammate 2** | `feat/issue-1-brand-architect` | `teammate-ready`, `gemini-4` | Gemini 4 (20%) + Live Demo (35%) |
| **#2** | `[Agents / Decisions API]` Connect Synthetic Shopper Swarm (`ShopperSwarmLayer`) to Fast Gemini 4 Model + Gemini Decisions API (`buy` / `skip` / `bounce`) | **Teammate 2** | `feat/issue-2-shopper-decisions` | `teammate-ready`, `gemini-4`, `decisions-api` | Gemini 4 & Decisions API (20%) |
| **#3** | `[Core Loop / 3D Mutation]` Closed-Loop Store Optimizer — Mutate `StoreConfig` Live (`swap_hero_sku`, `adjust_lighting`, `declutter_aisle`, `reprice`) from Shopper Rejections | **Teammate 2** | `feat/issue-3-closed-loop-mutator` | `teammate-ready`, `gemini-4`, `decisions-api`, `3d-roblox` | Creativity (20%) + Live Demo (35%) |
| **#4** | `[Gemini Image / Garments]` Messy Lifestyle / Human-Model Photo Normalization via Gemini 4 Image Edit API before 3D Cutout | **Teammate 1** | `feat/issue-4-lifestyle-garment-norm` | `teammate-ready`, `gemini-4`, `3d-roblox` | Gemini 4 (20%) + Live Demo (35%) |
| **#5** | `[Shopify Bonus Track]` `shop.dev` Storefront & Admin GraphQL Sync — Import Real Catalog + Push Winning Optimized Collection Order Back to Shopify | **Teammate 3** | `feat/issue-5-shopify-sync` | `teammate-ready`, `shopify` | Shopify Bonus Track + Live Demo |
| **#6** | `[Proof It Works — 25% Score]` Held-Out Shopper Persona Evaluation Harness (Round 0 Baseline vs. Round 3 Optimized Conversion Lift) | **Teammate 3** | `feat/issue-6-heldout-eval-proof` | `teammate-ready`, `eval-proof`, `gemini-4`, `decisions-api` | **Proof It Works (25%)** |
| **#7** | `[Element 119 Stress Test]` Document & Demo the Breaking Point (40-Item Chaotic Store / 50-Agent Oscillation) + Consensus Damping Guardrail | **Teammate 3** | `feat/issue-7-element119-stress-test` | `teammate-ready`, `eval-proof`, `decisions-api` | **Proof It Works (25%)** + Element 119 |
| **#8** | `[Roblox UX & Live Polish]` Interactive Player Checkout Cart, Voice/Chat with NPC Shoppers in Roblox Walk Mode & 1-Minute Demo Video Recording Mode | **Teammate 1** | `feat/issue-8-roblox-checkout-hud` | `teammate-ready`, `3d-roblox`, `gemini-4` | **Live Demo (35%)** + Creativity (20%) |

---

## Issue #1 — `[Agents / Gemini 4]` Wire Gemini 4 Multimodal Brand Architect (`POST /api/ingest-url` + IG Grid Screenshot Drop) -> `StoreConfig` JSON

- **Owner Track:** Teammate 2 (Gemini 4 Multi-Model Agents & Decisions API)
- **Branch:** `feat/issue-1-brand-architect`
- **Labels:** `teammate-ready`, `gemini-4`
- **Owned Files:** `server/routes/ingestUrl.ts`, `server/agents/brandArchitect.ts`, `src/services/boutiquePipeline.ts`

### Context & Goal
Turn any public storefront URL (`POST /api/ingest-url`) **or** dragged-and-dropped Instagram grid / lookbook screenshot into a strictly typed `StoreConfig` (`src/types/storeConfig.ts`) using `GEMINI_ARCHITECT_MODEL=gemini-4-carbon` with Structured Outputs.

> **Anti-Fragility Rule (`CONTEXT.md` §4.2):** Never depend on login-walled Instagram scrapers that Captcha-block on stage! Support clean OpenGraph/product JSON extraction on public URLs **plus** instant multimodal screenshot drop (e.g., an IG profile grid PNG) and sub-250ms client palette fallback (`extractLivePaletteFromImage`).

### Acceptance Criteria
- [ ] Implement `POST /api/ingest-url` accepting `{ url?: string, screenshotBase64?: string, garmentImages?: string[] }`.
- [ ] Prompt `process.env.GEMINI_ARCHITECT_MODEL` (`gemini-4-carbon`) with JSON Schema enforcement matching `StoreConfig` (`brandName`, `tagline`, `vibe`, `palette` 10-hex tokens, `lightingPreset`, `metalRoughness`, `metalness`, `racks`, and 3 curatorial `architectNotes`).
- [ ] Extract SKU titles, price anchors, and image URLs from OpenGraph / JSON-LD (`application/ld+json` Product tags) when given a live e-commerce URL; seamlessly fall back to multimodal vision extraction when given an IG grid screenshot.
- [ ] Guarantee graceful offline fallback to curated presets (`good-shot-club`, `kinetic-concrete`, `kyoto-atelier`) + `extractLivePaletteFromImage` if `GEMINI_API_KEY` is absent or network times out (`> 6s`).

---

## Issue #2 — `[Agents / Decisions API]` Connect Synthetic Shopper Swarm (`ShopperSwarmLayer`) to Fast Gemini 4 Model + Gemini Decisions API (`buy` / `skip` / `bounce`)

- **Owner Track:** Teammate 2 (Gemini 4 Multi-Model Agents & Decisions API)
- **Branch:** `feat/issue-2-shopper-decisions`
- **Labels:** `teammate-ready`, `gemini-4`, `decisions-api`
- **Owned Files:** `server/agents/shopperSwarm.ts`, `server/routes/swarm.ts`, `src/components/ShopperSwarmLayer.tsx`, `src/services/boutiquePipeline.ts`

### Context & Goal
Replace deterministic mock shopper thoughts with real concurrent evaluations from `GEMINI_SWARM_MODEL=gemini-4-neon` paired with **`GEMINI_DECISIONS_MODEL=gemini-decision-1` (Gemini Decisions API)** to emit calibrated `buy` / `skip` / `bounce` verdicts, confidence scores, and spatial friction tags across our 5 core shopper archetypes.

### Acceptance Criteria
- [ ] Fan out parallel requests (`Promise.all`) across `gemini-4-neon` for the active shopper cohort (*Minimalist Aesthetics*, *Vintage Collector*, *Budget Hunter*, *Impulse Gift Buyer*, *Skeptical First-Timer*), passing current `StoreConfig` summary + optional canvas viewport snapshot.
- [ ] Route each persona's structured assessment + store context through **`gemini-decision-1` (Gemini Decisions API)** Yes/No/Action gate to produce calibrated `decision: 'buy' | 'skip' | 'bounce'`, `score` (`0..1`), concise 1-line `thought` bubble, and `suggestedMutation`.
- [ ] Stream or render live thought bubbles + color-coded status rings (`#22c55e` buy, `#eab308` skip, `#ef4444` bounce) directly above walking 3D NPC avatars inside `ShopperSwarmLayer` without dropping below 60 FPS.
- [ ] Cache/replay last valid cohort response if rate-limited during live rehearsal.

---

## Issue #3 — `[Core Loop / 3D Mutation]` Closed-Loop Store Optimizer — Mutate `StoreConfig` Live (`swap_hero_sku`, `adjust_lighting`, `declutter_aisle`, `reprice`) from Shopper Rejections

- **Owner Track:** Teammate 2 (Gemini 4 Multi-Model Agents & Decisions API)
- **Branch:** `feat/issue-3-closed-loop-mutator`
- **Labels:** `teammate-ready`, `gemini-4`, `decisions-api`, `3d-roblox`
- **Owned Files:** `src/services/storeOptimizer.ts`, `server/agents/mutationGate.ts`

### Context & Goal
Close the autonomous optimization loop! Aggregate `skip` and `bounce` friction signals from the Synthetic Shopper Swarm, use `gemini-4-carbon` + **`gemini-decision-1`** to pick the highest-expected-reward merchandising mutation, enforce the **Brand DNA Coherence Floor (`≥ 0.80`)**, and morph `StoreConfig` live in front of the judges.

### Acceptance Criteria
- [ ] Implement all 4 spatial/merchandising mutation operators against `StoreConfig`:
  - `swap_hero_sku`: Promote highest-affinity SKU to the center `hero_faceout` alcove rack and move secondary items to `capsule_rail`.
  - `adjust_lighting`: Transition `lightingPreset` (`cool_gallery_spot` -> `warm_court_sunlight` / `kyoto_golden_hour`) and spot/ambient warmth hexes.
  - `declutter_aisle`: Cap overcrowded rails to clean boutique spacing and widen central walk sightlines.
  - `reprice`: Calibrate hero vs. companion anchor pricing within Brand DNA guardrails (block reward-hacking `-45%` slash-sales when `brandCoherenceScore < 0.80`).
- [ ] Emit structured round history (`Round 0 -> Round 1 -> Round 2 -> Round 3`) showing exact mutation chosen by `gemini-decision-1`, conversion delta, and Brand DNA score in a compact floating HUD pill (`≤15%` viewport footprint).

---

## Issue #4 — `[Gemini Image / Garments]` Messy Lifestyle / Human-Model Photo Normalization via Gemini 4 Image Edit API before 3D Cutout

- **Owner Track:** Teammate 1 (3D World, Roblox Walkthrough & Live Ingestion)
- **Branch:** `feat/issue-4-lifestyle-garment-norm`
- **Labels:** `teammate-ready`, `gemini-4`, `3d-roblox`
- **Owned Files:** `src/lib/garmentProcessor.ts`, `scripts/process_garment.py`, `scripts/normalize_drape_and_companions.py`

### Context & Goal
Real sellers rarely have clean studio flat-lays—they drop wrinkled mirror selfies, human-model street shots, or busy Instagram lifestyle photos. Use `GEMINI_IMAGE_MODEL=gemini-4-hydrogen` to isolate the garment, remove human limbs/occlusions, and normalize it into a clean front-facing gravity-draped hanger silhouette **before** feeding Stage A RGBA matting + Sobel normal map generation + Stage B `HangingGarment` 3D volumetric cloth extrusion!

### Acceptance Criteria
- [ ] Add `normalizeLifestyleGarmentWithGemini(imageBlob)` pipeline step calling `GEMINI_IMAGE_MODEL` (`gemini-4-hydrogen`) to convert messy human-worn or wrinkled lifestyle photos into a clean neutral-background front-hanging garment while **preserving chest typography, logos, and ringer trim**.
- [ ] Feed the normalized output directly into `garmentProcessor.ts` (edge-decontaminated RGBA alpha cutout + synthesized 360° back cutout + tangent-space Sobel normal map) -> populates `normalizedFrontCutoutUrl`, `normalizedBackCutoutUrl`, and `normalizedNormalMapUrl` on `GarmentAssetSet`.
- [ ] Keep the existing `<250ms` instant client-side cutout fallback active immediately on drop, then hot-swap to the `gemini-4-hydrogen` normalized volumetric cloth texture as soon as the API resolves!
- [ ] Expose an instant `Raw Lifestyle Cutout` vs. `Gemini 4 Normalized 3D Hang` A/B toggle for the live judge walkthrough.

---

## Issue #5 — `[Shopify Bonus Track]` `shop.dev` Storefront & Admin GraphQL Sync — Import Real Catalog + Push Winning Optimized Collection Order Back to Shopify

- **Owner Track:** Teammate 3 (Eval Harness, Stress Test & Shopify `shop.dev` Sync)
- **Branch:** `feat/issue-5-shopify-sync`
- **Labels:** `teammate-ready`, `shopify`
- **Owned Files:** `server/shopify/shopifyClient.ts`, `src/services/shopifySync.ts`, `src/components/ShopifySyncModal.tsx`

### Context & Goal
Win the **Build with Commerce (`Shopify` / `shop.dev`) Bonus Track** with a genuine bidirectional GraphQL loop—hydrating 3D racks from a live Shopify store and pushing the Synthetic Shopper Swarm's winning merchandising layout back to Shopify.

### Acceptance Criteria
- [ ] **Inbound (`Storefront GraphQL API`)**: Query `products(first: 12)` + collection metadata from `SHOPIFY_STORE_DOMAIN` using `SHOPIFY_STOREFRONT_ACCESS_TOKEN` and hydrate `GarmentAssetSet[]` (`id`, `sku`, `title`, `price`, `rawUrl`) onto `BoutiqueWorld` racks.
- [ ] **Outbound (`Admin GraphQL API`)**: Push the Round 3 winning `StoreConfig` back to Shopify using `SHOPIFY_ADMIN_ACCESS_TOKEN`:
  - Reorder collection hero products (`collectionReorderProducts`) so the winning `hero_faceout` SKU leads the 2D storefront too.
  - Write spatial merchandising insights (`lightingPreset`, `palette`, conversion lift %, curatorial `architectNotes`) to Shopify `metafieldsSet` (`namespace: "atelier_119"`).
- [ ] Include an inspectable **"View Live `shop.dev` GraphQL Mutation Payload & Response"** drawer with dry-run preview mode when demoing without write tokens.

---

## Issue #6 — `[Proof It Works — 25% Score]` Held-Out Shopper Persona Evaluation Harness (Round 0 Baseline vs. Round 3 Optimized Conversion Lift)

- **Owner Track:** Teammate 3 (Eval Harness, Stress Test & Shopify `shop.dev` Sync)
- **Branch:** `feat/issue-6-heldout-eval-proof`
- **Labels:** `teammate-ready`, `eval-proof`, `gemini-4`, `decisions-api`
- **Owned Files:** `scripts/eval_heldout_personas.ts`, `src/components/EvalProofBadge.tsx`, `docs/PROOF_IT_WORKS.md`

### Context & Goal
**`Proof It Works` is worth 25% of the entire hackathon score.** Judges explicitly test whether closed-loop agent optimizers actually generalize or merely overfit to their own critique prompt. Prove empirical lift on a **strictly disjoint Held-Out Evaluation Cohort B** that never participated in proposing the Round 1–3 store mutations!

### Acceptance Criteria
- [ ] Split synthetic shoppers into **Critique Cohort A** (5 train personas used by `storeOptimizer` to propose mutations) and **Held-Out Cohort B** (10 unseen test personas with varied budgets, aesthetic skepticism, and gift/collector intent).
- [ ] Run automated `Round 0 (Uncurated Flat Baseline)` -> `Round 1` -> `Round 2` -> `Round 3 (Optimized Volumetric Boutique)` benchmark via `npx tsx scripts/eval_heldout_personas.ts` (and export JSON artifact to `public/assets/eval-benchmark.json`).
- [ ] Report clean quantitative metrics in `docs/PROOF_IT_WORKS.md` and a compact collapsible HUD badge (`EvalProofBadge.tsx`):
  - Held-Out `buy` Conversion Rate (`Round 0` vs `Round 3`, e.g. `+34%` absolute lift)
  - Visual Skepticism `bounce` Rate drop
  - Brand DNA Coherence Score (`≥ 0.80` across all accepted rounds)
  - Ablation row comparing **Gemini Decisions API (`gemini-decision-1`)** vs. unconstrained greedy conversion prompt (which reward-hacks discounts and fails Brand DNA floor).

---

## Issue #7 — `[Element 119 Stress Test]` Document & Demo the Breaking Point (40-Item Chaotic Store / 50-Agent Oscillation) + Consensus Damping Guardrail

- **Owner Track:** Teammate 3 (Eval Harness, Stress Test & Shopify `shop.dev` Sync)
- **Branch:** `feat/issue-7-element119-stress-test`
- **Labels:** `teammate-ready`, `eval-proof`, `decisions-api`
- **Owned Files:** `scripts/stress_test_element119.ts`, `docs/PROOF_IT_WORKS.md` *(Section 2: Breaking Point & Mitigation)*

### Context & Goal
Top **Element 119** entries don't pretend their system has infinite limits—they push the medium until it breaks, measure the exact failure threshold, and engineer a principled guardrail. Document and make reproducible **both** the spatial crowding breaking point (**40-SKU chaotic rack overload**) and the multi-agent decision breaking point (**50-agent conflicting preference oscillation**).

### Acceptance Criteria
- [ ] Build `scripts/stress_test_element119.ts` + a `"Chaos Stress Test (40 SKUs / 50 Agents)"` preset/toggle that reproduces:
  1. **Spatial / Visual Overload (`40 SKUs`)**: Overcrowded rails cause silhouette occlusion, grazing-angle visual clutter, and `Minimalist Aesthetics` bounce rate spiking above `80%`.
  2. **Policy Thrashing (`50 Polarized Agents`)**: Equal split of *Budget Hunters* vs. *Luxury Collectors* causes naive round-by-round optimizers to oscillate endlessly between `reprice (-35%)` and `reprice (+25%)` + warm/cool lighting flip-flops.
- [ ] Implement & benchmark the **Consensus Damping + Hysteresis Guardrail** (`quorum >= 0.60` net expected utility gain, cooldown window on repeated axis flips, automatic `declutter_aisle` cap at 6 visible capsule SKUs, and `Brand DNA Coherence >= 0.80` hard floor).
- [ ] Capture before/after oscillation plots/tables in `docs/PROOF_IT_WORKS.md` so judges can inspect exact numbers during the 2-minute Q&A.

---

## Issue #8 — `[Roblox UX & Live Polish]` Interactive Player Checkout Cart, Voice/Chat with NPC Shoppers in Roblox Walk Mode & 1-Minute Demo Video Recording Mode

- **Owner Track:** Teammate 1 (3D World, Roblox Walkthrough & Live Ingestion)
- **Branch:** `feat/issue-8-roblox-checkout-hud`
- **Labels:** `teammate-ready`, `3d-roblox`, `gemini-4`
- **Owned Files:** `src/components/CheckoutCartDrawer.tsx`, `src/components/RobloxNpcChatOverlay.tsx`, `src/components/CameraRig.tsx`

### Context & Goal
Maximize **Live Demo (`35%`)** visceral delight and nail the **1-Minute Submission Video** (`CONTEXT.md` §1: must open at `t = 0s` inside the 3D flagship world with zero static slides). Let a human player walk up to any 3D rack in Roblox `WASD` mode to inspect & bag garments, ask nearby NPC shoppers *why* they're buying or bouncing, and trigger a 1-key **Cinema Demo Mode** for recording.

### Acceptance Criteria
- [ ] **Interactive Proximity Inspection & Checkout Cart**: Walking near a `BoutiqueRack` in Roblox `WASD` mode (or clicking any `HangingGarment`) highlights the garment with a crisp proximity prompt (`[E] Inspect & Add to Bag`), slides out a minimal glassmorphic bag pill, and links directly to Shopify Storefront `checkoutUrl` (or instant simulated Apple Pay / Shop Pay confirmation).
- [ ] **Live Chat / Voice Bubble with NPC Shoppers**: Press `[T]` (or click any walking NPC shopper avatar) to ask a quick question (e.g., *"Why did you skip the cardigan?"*); stream an in-character `gemini-4-neon` answer grounded in that NPC's persona archetype and the current room state.
- [ ] **1-Minute Video Recording Mode (`[V]` Hotkey)**: Temporarily hides debug sliders, locks crisp 60 FPS framing (**≥90% 3D viewport**), and runs smooth choreographed camera keyframes (`Hero Rack` -> `88° Volumetric Cloth Grazing Profile` -> `Shopper Swarm Live Mutation` -> `Roblox Walk Checkout`) for effortless one-take video capture before **4:15 PM ET**.
