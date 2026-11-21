# GEMINI BOUTIQUE — Spatial Brand World & Self-Optimizing Commerce Flagship

> **Gemini 4 NYC Hackathon Architectural & Execution Specification**  
> Single source of truth for track alignment, multi-model orchestration, 3D cloth/showroom engineering, empirical evaluation, and demo guardrails.

---

## 1. Event & Submission Constraints

| Constraint | Requirement | Operational Rule |
| :--- | :--- | :--- |
| **Hard Submission Cutoff** | **5:00 PM ET** | Feature-freeze by 4:15 PM ET; reserve final 45 minutes strictly for video upload, repo audit, and rehearsal. |
| **Code Repository** | **Public GitHub Repository** | Zero hardcoded secrets (`.env.example` only), reproducible `npm install && npm run dev`, clean TypeScript (`tsc -b`) build. |
| **Submission Video** | **1-Minute Demo Video** | High-impact screen capture leading immediately (`t = 0s`) inside the 3D flagship world—no static title slides. |
| **Live Judging Format** | **3-Min Live Demo + 2-Min Q&A** | Live garment drag-and-drop -> Brand DNA room morph -> 360° cloth inspection -> closed-loop shopper optimization -> Shopify sync. |

---

## 2. Hackathon Track Alignment

### Primary Track: Problem Statement Two — **Element 119**
Synthesize a **new, emergent interactive medium** beyond flat 2D e-commerce grids. Given a single raw garment photo (e.g., an uploaded Uniqlo UT × Peanuts *"Good Shot Club"* ringer tee), **Gemini Boutique** extracts the item's latent **Brand DNA** and materializes an architectural magazine-grade **3D flagship showroom**—complete with custom material palettes, fluted timber/stone alcoves, gallery lighting, volumetric hanging garments, and synthetic shopper agents that iteratively mutate the store for conversion and brand coherence.

### Bonus Track: **Build with Commerce (`Shopify` / `shop.dev`)**
Bidirectional commerce loop bridged to **Shopify (`Storefront GraphQL API`, `Admin GraphQL API`, and `shop.dev` tooling)**:
1. **Catalog Ingestion**: Hydrates `GarmentAssetSet` SKU metadata, variant pricing, inventory, and raw product imagery directly from Shopify product schemas.
2. **Spatial Merchandising Sync**: Pushes winning `StoreConfig` mutations discovered by the synthetic shopper optimization loop—hero faceout SKU selection, capsule rail cross-sell pairing, collection narrative copy, and validated price tiers—back to Shopify collections and storefront metafields.

---

## 3. Multi-Model Gemini 4 + Decisions API + Shopify Architecture

The pipeline orchestrates **2+ specialized Gemini 4 models** across the **Argon, Carbon, Neon, and Hydrogen** model family alongside the **Gemini Decisions API** and **Shopify**:

```
[Raw Garment Image / Shopify SKU]
        │
        ├──► Gemini 4 Argon (Deep Multimodal Architect & Brand DNA Strategist)
        │      └─ Extracts heritage cues, color harmony, material physics & lighting mood
        │         into strictly typed `StoreConfig` JSON + curatorial `architectNotes`.
        │
        ├──► Gemini 4 Neon (Multimodal Vision, Stage A Garment Normalization & PBR Textures)
        │      ├─ Relaxes stiff flat-lay T-pose sleeves into natural gravity-draped hanger posture
        │      │  while preserving front chest typography & graphic linework.
        │      └─ Synthesizes seamless architectural textures (travertine, Venetian limewash,
        │         fluted sage timber, framed exhibition crest artwork).
        │
        ▼
[Interactive 85%+ Viewport 3D Showroom — React Three Fiber (`BoutiqueWorld` + `HangingGarment`)]
        │
        ├──► Gemini 4 Hydrogen (High-Throughput Parallel Synthetic Shopper Cohort)
        │      └─ Simulates diverse shopper personas inspecting live showroom viewport snapshots
        │         & SKU pricing -> emits structured `buy | skip | bounce` + qualitative thoughts.
        │
        ├──► Gemini 4 Carbon (Structured Critique Synthesis & Schema Guardrails)
        │      └─ Aggregates persona friction signals, enforces Brand DNA luxury floor constraints,
        │         and compiles candidate spatial/merchandising mutations + Shopify GraphQL payloads.
        │
        ▼
[Gemini Decisions API — Closed-Loop Spatial Merchandising Optimizer]
        │
        └─ Selects highest-expected-reward `StoreConfig` action (`swap_hero_sku`,
           `declutter_aisle`, `adjust_lighting`, `reprice`) -> morphs 3D store in real time
           & syncs winning merchandising state to Shopify (`shop.dev`).
```

---

## 4. Strict Anti-Project Guardrails

To guarantee a visceral, resilient 3-minute live demo, the following anti-patterns are **strictly forbidden**:

1. **85%+ 3D Viewport Rule (NO Dashboard-First UI)**:
   - The interactive 3D architectural showroom (`BoutiqueWorld`) must occupy **≥85% of the viewport** at all times.
   - Controls, Brand DNA switchers, Stage A/B cloth toggles, and synthetic shopper rounds live in sleek, collapsible floating HUD overlays—never SaaS admin tables or multi-page analytics dashboards.
2. **NO Fragile Live Instagram / Social Scrapers**:
   - Do not rely on brittle login-walled Instagram scrapers that rate-limit or Captcha-block on stage.
   - Ingest via instant drag-and-drop garment image upload, Shopify `shop.dev` catalog schemas, and curated zero-latency Brand DNA presets (`good-shot-club`, `kinetic-concrete`, `kyoto-atelier`).
3. **NO Slow, Melted 3D Mesh Generation**:
   - Off-the-shelf image-to-3D diffusion/NeRF/marching-cubes pipelines take 60–180 seconds and melt crisp screen-printed typography (turning *"Good Shot Club"* and Snoopy's racket strings into blurry wax).
   - Instead, we combine **Stage A 2D/RGBA Multimodal Hang Normalization** with **Stage B Real-Time Parametric Volumetric 3D Cloth Geometry** at a locked 60 FPS with razor-sharp 2K textures.

---

## 5. Stage A & Stage B Garment Normalization + Volumetric 3D Cloth Architecture

### Stage A — Garment Matting, Back Synthesis & AI Hanging Normalization
Raw e-commerce flat-lays exhibit stiff outward-splayed sleeves and studio backdrop spill. Stage A produces deterministic garment asset layers (`GarmentAssetSet`):
- **Clean RGBA Alpha Matting**: Edge-aware background removal with premultiplied border de-fringing so cream cotton edges have zero grey halo against sage wood or dark concrete.
- **Hanging Silhouette Normalization (`ai_normalized` mode)**: Relaxes outward-splayed flat-lay sleeves downward under gravity and introduces natural collar/underarm drape folds while keeping chest graphics crisp.
- **360° Back Cutout & Tangent Normal Map**: Synthesizes a matching rear garment view (removing inner neck label print while preserving continuous ringer collar/cuff ribbing) plus a tangent-space normal map capturing cotton jersey weave and fold micro-relief.
- **Zero-Latency Client Fallback**: Dropping *any* custom image in the browser immediately runs client-side flood-fill matting, back synthesis, Sobel tangent normal generation, and live palette extraction (`extractLivePaletteFromImage`).

### Stage B — Volumetric 3D Cloth Shell (`HangingGarment.tsx` + `BoutiqueRack.tsx`)
Instead of a paper-thin 2D billboard that vanishes at 90° side grazing angles:
- **Dual-Sided Stitched Volumetric Shell**: High-subdivision front and rear cloth surfaces separated by physical `shellThickness` and bridged along the outer garment contour by a continuous stitched edge band.
- **Parametric Drape Physics**:
  - Contoured wooden hanger shoulder tenting (`hangerWood`) + brushed metallic swivel hook seated physically on the tubular `BoutiqueRack` rail (`rackMetal`).
  - Parabolic chest cylinder curvature (`curveDepth`), harmonic vertical pleat ripples toward the bottom hem, and downward sleeve relaxation (`sleeveRelax`).
  - `MeshPhysicalMaterial` cotton sheen (`fabricSheen`), tangent-space normal relief (`normalStrength`), double-sided shadow casting (`2048×2048` key spot shadow map), and gentle showroom air-current pendulum motion (`swayIntensity`).
- **Live Diagnostic A/B Toggle**: Instant switch between `Volumetric 3D` vs. `Naive Flat` and `AI Normalized` vs. `Raw Cutout` across 5 choreographed camera presets (`Hero Rack`, `Hanger & Fabric`, `3D Drape Profile`, `Back Seam 360°`, `Boutique World`).

---

## 6. Proof It Works — Synthetic Shopper Loop & Stress-Test Protocol

### Held-Out Persona Benchmark (Round 0 Baseline vs. Rounds 1–3 Mutations)
To prove the closed-loop optimizer generalizes rather than memorizing its own critique prompt:
- **Split**: Optimization mutations are proposed from **Critique Cohort A**, then scored blindly on a disjoint **Held-Out Evaluation Cohort B** spanning 5 behavioral archetypes (*Minimalist Aesthetics*, *Vintage Collector*, *Budget Hunter*, *Impulse Gift Buyer*, *Skeptical First-Timer*).
- **Round 0 (Uncurated Baseline)**: Naive flat-lay cutout on harsh cool studio lighting, cluttered rail, unanchored pricing -> baseline conversion rate & high `bounce` rate from *Minimalist Aesthetics* and *Skeptical First-Timer* personas.
- **Round 1 (`adjust_lighting` + Stage A/B Volumetric Hang)**: Gemini Decisions API switches to `warm_court_sunlight` + volumetric hanging garment drape -> measurable drop in visual skepticism bounces.
- **Round 2 (`declutter_aisle` + Hero Alcove Choreography)**: Isolates hero ringer tee on center faceout stand inside the recessed sage-fluted arch alcove while moving `Court Cable-Knit Cardigan` & `Club Pique Tennis Polo` to a flanking capsule rail -> lifts dwell score & multi-item consideration.
- **Round 3 (`reprice` / Capsule Tier Anchoring + Shopify Sync)**: Calibrates hero tee vs. knitwear anchor pricing while maintaining Brand DNA luxury coherence -> achieves peak held-out conversion lift and prepares one-click Shopify `shop.dev` sync.

### Documented Stress-Test Breaking Point & Engineering Fix
1. **Visual / Geometric Breaking Point — Grazing 88° Side View & High-Saturation Dark Rooms**:
   - *Failure Observed*: Raw flat-lay cutouts rendered on single planes collapsed to a 0px sliver at side views (`CameraPreset: side`), exhibited 1–2px light studio background halos inside dark brutalist rooms (`kinetic-concrete`), and looked like stiff cardboard T-poses.
   - *Fix Shipped*: Added sub-pixel alpha border erosion + color decontamination on cutout edges, Stage A gravity sleeve relaxation, and Stage B extruded front/back shell thickness with perimeter seam geometry.
2. **Decision Loop Breaking Point — Conversion Reward Hacking**:
   - *Failure Observed*: Unconstrained conversion optimization pushed steep discount pricing (`-45%`) and loud neon accents that boosted *Budget Hunter* clicks while destroying heritage brand equity (*Vintage Collector* & *Minimalist Aesthetics* scores collapsed).
   - *Fix Shipped*: Added a composite reward objective in the Gemini Decisions API wrapper enforcing a hard **Brand DNA Coherence Floor (`≥ 0.80`)** synthesized by Gemini 4 Carbon before any price or palette mutation is accepted.

---

## 7. Milestone Execution Roadmap

- **Milestone 1 — Magazine-Grade 3D Boutique Engine & Volumetric Garment Core**
  - Deliver `BoutiqueWorld.tsx` (recessed arch alcove, hidden LED cove strip, 3D signage, framed gallery art with picture light, fluted travertine props, overhead track spots, contact & cast shadows), `HangingGarment.tsx`, `BoutiqueRack.tsx`, 5-preset `CameraRig.tsx`, `STORE_PRESETS` (3 full Brand DNA worlds), and zero-build `public/isolated-rack.html`.
- **Milestone 2 — Multimodal Brand DNA Extraction & Stage A Asset Pipeline**
  - Wire Gemini 4 Argon (`StoreConfig` JSON synthesis from uploaded garment photography) + Gemini 4 Neon (Stage A normalized garment cutouts & seamless PBR showroom textures) with instant client-side fallback so custom drag-and-drop works in `<250ms` even offline.
- **Milestone 3 — Parallel Synthetic Shopper Cohort (`Gemini 4 Hydrogen`)**
  - Run 5-archetype synthetic shopper evaluations against showroom state & viewport captures, surfacing structured `buy | skip | bounce` decisions, persona monologues, and friction tags inside a lightweight glassmorphic drawer.
- **Milestone 4 — Closed-Loop Spatial Mutation via Gemini Decisions API**
  - Execute `Round 0 -> Round 3` mutation loop (`swap_hero_sku`, `declutter_aisle`, `adjust_lighting`, `reprice`), logging held-out persona lift metrics and morphing the 3D flagship showroom live on screen.
- **Milestone 5 — Shopify (`shop.dev`) Commerce Sync & Live Demo Polish**
  - Complete Shopify product ingestion + winning mutation GraphQL sync preview, verify stress-test edge cases across all 3 Brand DNA presets, record the 1-minute submission video, and lock public repo before **5:00 PM ET**.
