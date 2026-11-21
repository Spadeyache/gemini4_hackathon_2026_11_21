# `src/features/agents/` — Gemini 4 Multi-Model & Decisions API Module

**Teammate Ownership:** Issues #1, #2, #3 (Zero overlap with `src/components/*` or `src/features/shopify/*`)

## Responsibilities
1. **Brand & Store Architect (`Gemini 4 Carbon / Heavy Multimodal`):**
   - Consumes scraped site metadata + screenshot / IG grid image -> returns validated `StoreConfig` JSON (`src/types/storeConfig.ts`).
2. **Synthetic Shopper Swarm (`Gemini 4 Neon / Fast Low-Latency`):**
   - Runs 5–8 persona prompts in parallel with rendered 3D rack views + garment price/title.
3. **Routing & Yes/No Gate (`Gemini Decisions API`):**
   - Scores fast `buy` / `skip` / `bounce` decisions per display and selects store mutation actions (`swap_hero_sku`, `declutter_aisle`, `adjust_lighting`, `reprice`) to mutate `StoreConfig` in real time.
