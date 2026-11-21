<#
.SYNOPSIS
    Bootstraps color-coded GitHub labels and all 8 parallelizable hackathon sprint issues
    for ATELIER 119 (Spadeyache/gemini4_hackathon_2026_11_21).

.EXAMPLE
    .\scripts\create_github_issues.ps1
    .\scripts\create_github_issues.ps1 -DryRun
    .\scripts\create_github_issues.ps1 -Repo "Spadeyache/gemini4_hackathon_2026_11_21" -Force
#>

[CmdletBinding()]
param(
    [string]$Repo = "Spadeyache/gemini4_hackathon_2026_11_21",
    [switch]$DryRun,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host " ATELIER 119 — GitHub Sprint Collaboration Bootstrapper" -ForegroundColor Cyan
Write-Host " Target Repository : $Repo" -ForegroundColor Cyan
Write-Host " Mode              : $(if ($DryRun) { 'DRY RUN (no GitHub mutations)' } else { 'LIVE PUBLISH' })" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host ""

if (-not $DryRun) {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        Write-Error "GitHub CLI ('gh') is not installed or not on PATH. Install via: winget install --id GitHub.cli"
        exit 1
    }

    Write-Host "[1/3] Checking GitHub CLI authentication status..." -ForegroundColor Yellow
    $ErrorActionPreference = "Continue"
    gh auth status *> $null
    $authExitCode = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

    if ($authExitCode -ne 0) {
        Write-Host "GitHub CLI is not authenticated. Launching interactive 'gh auth login'..." -ForegroundColor Yellow
        gh auth login
        if ($LASTEXITCODE -ne 0) {
            Write-Error "GitHub authentication did not complete. Re-run after logging in with 'gh auth login'."
            exit 1
        }
    }
    Write-Host "  [OK] Authenticated with GitHub CLI." -ForegroundColor Green
} else {
    Write-Host "[1/3] Dry-run enabled — skipping 'gh auth status' check." -ForegroundColor DarkGray
}

# ------------------------------------------------------------------------------
# 1. Color-Coded Hackathon Labels
# ------------------------------------------------------------------------------
$Labels = @(
    @{
        Name        = "teammate-ready"
        Color       = "0E8A16"
        Description = "Parallelizable sprint task with strict zero-merge-conflict file ownership"
    },
    @{
        Name        = "gemini-4"
        Color       = "1D76DB"
        Description = "Gemini 4 multimodal model pipeline (carbon / neon / hydrogen)"
    },
    @{
        Name        = "decisions-api"
        Color       = "5319E7"
        Description = "Gemini Decisions API (gemini-decision-1) routing & closed-loop store mutation"
    },
    @{
        Name        = "shopify"
        Color       = "95BF47"
        Description = "Shopify Storefront & Admin GraphQL sync (shop.dev bonus track)"
    },
    @{
        Name        = "eval-proof"
        Color       = "FBCA04"
        Description = "Proof-It-Works (25% rubric) held-out persona eval & Element 119 stress test"
    },
    @{
        Name        = "3d-roblox"
        Color       = "D93F0B"
        Description = "React Three Fiber 3D boutique, volumetric cloth & Roblox WASD walk UX"
    }
)

Write-Host ""
Write-Host "[2/3] Syncing color-coded labels on $Repo..." -ForegroundColor Yellow
foreach ($lbl in $Labels) {
    if ($DryRun) {
        Write-Host "  [DRY-RUN] Label: $($lbl.Name) (#$($lbl.Color)) — $($lbl.Description)" -ForegroundColor DarkCyan
    } else {
        gh label create $lbl.Name `
            --repo $Repo `
            --color $lbl.Color `
            --description $lbl.Description `
            --force | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Failed creating/updating label '$($lbl.Name)' on $Repo."
            exit 1
        }
        Write-Host "  [OK] Label synced: $($lbl.Name) (#$($lbl.Color))" -ForegroundColor Green
    }
}

# ------------------------------------------------------------------------------
# 2. Eight Parallelizable Hackathon Sprint Issues (Due before 5:00 PM ET)
# ------------------------------------------------------------------------------
$Issues = @(
    @{
        Title  = "[Agents / Gemini 4] Wire Gemini 4 Multimodal Brand Architect (POST /api/ingest-url + IG Grid Screenshot Drop) -> StoreConfig JSON"
        Labels = @("teammate-ready", "gemini-4")
        Body   = @'
## Sprint Metadata
- **Suggested Owner:** Teammate 2 *(Gemini 4 Multi-Model Agents & Decisions API Store Mutation)*
- **Branch Name:** `feat/issue-1-brand-architect`
- **Rubric Alignment:** `Gemini 4 & Decisions API (20%)` + `Live Demo (35%)`
- **Hard Cutoff:** Feature-freeze by **4:15 PM ET** (final submission **5:00 PM ET**)

## Owned Files (Zero-Merge-Conflict Boundary)
- `server/routes/ingestUrl.ts`
- `server/agents/brandArchitect.ts`
- `src/services/boutiquePipeline.ts`
- *(Read-only contract)*: `src/types/storeConfig.ts`

## Goal & Context
Turn any public storefront URL (`POST /api/ingest-url`) **or** dragged-and-dropped Instagram grid / lookbook screenshot into a strictly typed `StoreConfig` JSON using `GEMINI_ARCHITECT_MODEL=gemini-4-carbon` with Structured Outputs.

> **Anti-Fragility Rule (`CONTEXT.md` §4.2):** Never rely on brittle login-walled Instagram scrapers that Captcha-block on stage. Support clean OpenGraph / `application/ld+json` product schema ingestion on public URLs **plus** instant multimodal vision extraction when dropping an IG grid screenshot, backed by `<250ms` client palette fallback (`extractLivePaletteFromImage`).

## Acceptance Criteria
- [ ] Implement `POST /api/ingest-url` accepting `{ url?: string, screenshotBase64?: string, garmentImages?: string[] }`.
- [ ] Call `process.env.GEMINI_ARCHITECT_MODEL` (`gemini-4-carbon`) with JSON Schema enforcement producing valid `StoreConfig` (`brandName`, `tagline`, `vibe`, 10-hex `palette`, `lightingPreset`, `metalRoughness`, `metalness`, `racks`, and 3 curatorial `architectNotes`).
- [ ] Parse OpenGraph & JSON-LD `Product` metadata on public store URLs; fall back seamlessly to multimodal vision on dropped IG lookbook/grid screenshots.
- [ ] Guarantee zero-crash offline fallback (`good-shot-club`, `kinetic-concrete`, `kyoto-atelier` + `extractLivePaletteFromImage`) if API key is missing or latency exceeds `6s`.
- [ ] `npm run build` passes with zero TypeScript errors.
'@
    },
    @{
        Title  = "[Agents / Decisions API] Connect Synthetic Shopper Swarm (ShopperSwarmLayer) to Fast Gemini 4 Model + Gemini Decisions API (buy / skip / bounce)"
        Labels = @("teammate-ready", "gemini-4", "decisions-api")
        Body   = @'
## Sprint Metadata
- **Suggested Owner:** Teammate 2 *(Gemini 4 Multi-Model Agents & Decisions API Store Mutation)*
- **Branch Name:** `feat/issue-2-shopper-decisions`
- **Rubric Alignment:** `Gemini 4 & Decisions API (20%)` + `Proof It Works (25%)`
- **Hard Cutoff:** Feature-freeze by **4:15 PM ET** (final submission **5:00 PM ET**)

## Owned Files (Zero-Merge-Conflict Boundary)
- `server/agents/shopperSwarm.ts`
- `server/routes/swarm.ts`
- `src/components/ShopperSwarmLayer.tsx`
- `src/services/boutiquePipeline.ts`

## Goal & Context
Power the autonomous 3D NPC shoppers inside `ShopperSwarmLayer` with high-throughput parallel calls to `GEMINI_SWARM_MODEL=gemini-4-neon` gated by **`GEMINI_DECISIONS_MODEL=gemini-decision-1` (Gemini Decisions API)** to emit calibrated `buy` / `skip` / `bounce` verdicts, confidence scores, and spatial friction tags.

## Acceptance Criteria
- [ ] Fan out concurrent evaluations (`Promise.all`) on `gemini-4-neon` across the 5 behavioral archetypes (*Minimalist Aesthetics*, *Vintage Collector*, *Budget Hunter*, *Impulse Gift Buyer*, *Skeptical First-Timer*) given live `StoreConfig` + optional viewport snapshot.
- [ ] Pass persona reasoning + merchandising context into **`gemini-decision-1` (Gemini Decisions API)** routing & Yes/No gate to return calibrated `decision: 'buy' | 'skip' | 'bounce'`, `score` (`0..1`), 1-line `thought` monologue, and `suggestedMutation`.
- [ ] Render live floating thought bubbles and status rings (`buy` green, `skip` amber, `bounce` coral) above walking NPC avatars in `ShopperSwarmLayer` at a locked 60 FPS (**≥85% 3D viewport**).
- [ ] Cache last valid cohort output for resilient stage replay if Wi-Fi drops.
'@
    },
    @{
        Title  = "[Core Loop / 3D Mutation] Closed-Loop Store Optimizer — Mutate StoreConfig Live (swap_hero_sku, adjust_lighting, declutter_aisle, reprice) from Shopper Rejections"
        Labels = @("teammate-ready", "gemini-4", "decisions-api", "3d-roblox")
        Body   = @'
## Sprint Metadata
- **Suggested Owner:** Teammate 2 *(Gemini 4 Multi-Model Agents & Decisions API Store Mutation)*
- **Branch Name:** `feat/issue-3-closed-loop-mutator`
- **Rubric Alignment:** `Creativity — Element 119 (20%)` + `Live Demo (35%)` + `Gemini 4 & Decisions API (20%)`
- **Hard Cutoff:** Feature-freeze by **4:15 PM ET** (final submission **5:00 PM ET**)

## Owned Files (Zero-Merge-Conflict Boundary)
- `src/services/storeOptimizer.ts`
- `server/agents/mutationGate.ts`

## Goal & Context
Close the spatial merchandising loop: aggregate `skip` and `bounce` objections from the Synthetic Shopper Swarm, synthesize candidate interventions with `gemini-4-carbon`, select the reward-maximizing action via **`gemini-decision-1` (Gemini Decisions API)** subject to a hard **Brand DNA Coherence Floor (`≥ 0.80`)**, and morph `StoreConfig` live on screen!

## Acceptance Criteria
- [ ] Implement all 4 live `StoreConfig` mutation operators:
  - `swap_hero_sku`: Promote top-performing SKU onto center `hero_faceout` alcove rack and shift companions to `capsule_rail`.
  - `adjust_lighting`: Morph `lightingPreset` (`cool_gallery_spot` -> `warm_court_sunlight` / `kyoto_golden_hour`) and spotlight/ambient hexes.
  - `declutter_aisle`: Prune overcrowded rails to gallery spacing and clear sightlines to the hero arch alcove.
  - `reprice`: Calibrate hero vs. knitwear anchor price tiers while blocking reward-hacking `-45%` slash discounts whenever `brandCoherenceScore < 0.80`.
- [ ] Track `Round 0 -> Round 1 -> Round 2 -> Round 3` mutation log (chosen action, `buy` lift %, `bounce` delta, Brand DNA coherence score) for instant HUD inspection and Shopify sync.
'@
    },
    @{
        Title  = "[Gemini Image / Garments] Messy Lifestyle / Human-Model Photo Normalization via Gemini 4 Image Edit API before 3D Cutout"
        Labels = @("teammate-ready", "gemini-4", "3d-roblox")
        Body   = @'
## Sprint Metadata
- **Suggested Owner:** Teammate 1 *(3D World, Roblox Walkthrough & Live Ingestion)*
- **Branch Name:** `feat/issue-4-lifestyle-garment-norm`
- **Rubric Alignment:** `Gemini 4 & Decisions API (20%)` + `Live Demo (35%)` + `Creativity (20%)`
- **Hard Cutoff:** Feature-freeze by **4:15 PM ET** (final submission **5:00 PM ET**)

## Owned Files (Zero-Merge-Conflict Boundary)
- `src/lib/garmentProcessor.ts`
- `scripts/process_garment.py`
- `scripts/normalize_drape_and_companions.py`

## Goal & Context
Merchants and creators drop messy mirror selfies, human-model street shots, or wrinkled IG lifestyle photos—not sterile studio flat-lays. Wire `GEMINI_IMAGE_MODEL=gemini-4-hydrogen` to strip human limbs/backgrounds and normalize the garment into a clean gravity-draped front hanger silhouette **before** Stage A RGBA de-fringed cutout + Sobel tangent normal generation + Stage B `HangingGarment` volumetric 3D cloth rendering!

## Acceptance Criteria
- [ ] Add `normalizeLifestyleGarmentWithGemini()` calling `GEMINI_IMAGE_MODEL` (`gemini-4-hydrogen`) to transform human-worn or wrinkled lifestyle photos into clean front-facing hanging garment imagery while preserving chest graphic typography and trim colors.
- [ ] Pipe output directly through `garmentProcessor.ts` (edge-decontaminated RGBA alpha cutout + 360° back synthesis + Sobel normal map) to populate `normalizedFrontCutoutUrl`, `normalizedBackCutoutUrl`, and `normalizedNormalMapUrl`.
- [ ] Keep instant `<250ms` client cutout active on drop so the 3D rack responds immediately, then seamlessly upgrade the `HangingGarment` shell when `gemini-4-hydrogen` resolves.
- [ ] Verify diagnostic A/B toggle (`Raw Cutout` vs. `AI Normalized` + `Naive Flat` vs. `Volumetric 3D`) works live at 88° grazing side angles.
'@
    },
    @{
        Title  = "[Shopify Bonus Track] shop.dev Storefront & Admin GraphQL Sync — Import Real Catalog + Push Winning Optimized Collection Order Back to Shopify"
        Labels = @("teammate-ready", "shopify")
        Body   = @'
## Sprint Metadata
- **Suggested Owner:** Teammate 3 *(Proof-It-Works Eval Harness, Breaking-Point Stress Test & Shopify `shop.dev` Sync)*
- **Branch Name:** `feat/issue-5-shopify-sync`
- **Rubric Alignment:** `Bonus Track: Build with Commerce (Shopify / shop.dev)` + `Live Demo (35%)`
- **Hard Cutoff:** Feature-freeze by **4:15 PM ET** (final submission **5:00 PM ET**)

## Owned Files (Zero-Merge-Conflict Boundary)
- `server/shopify/shopifyClient.ts`
- `src/services/shopifySync.ts`
- `src/components/ShopifySyncModal.tsx`

## Goal & Context
Deliver a complete bidirectional commerce loop aligned with **`shop.dev` Storefront + Admin GraphQL APIs**: pull real Shopify SKUs onto 3D volumetric racks, run Synthetic Shopper optimization, and write the winning hero SKU rank, collection narrative, and spatial palette metafields back to Shopify!

## Acceptance Criteria
- [ ] **Catalog Ingest (`Storefront GraphQL API`)**: Fetch products, variant prices, SKU handles, and imagery from `SHOPIFY_STORE_DOMAIN` (`SHOPIFY_STOREFRONT_ACCESS_TOKEN`) and map into `GarmentAssetSet[]`.
- [ ] **Winning State Write-Back (`Admin GraphQL API`)**: Using `SHOPIFY_ADMIN_ACCESS_TOKEN`, execute `collectionReorderProducts` (promoting the Round 3 winning `hero_faceout` SKU) and `metafieldsSet` (`namespace: "atelier_119"`, storing optimized `lightingPreset`, `palette`, conversion lift %, and `architectNotes`).
- [ ] Provide a sleek glassmorphic **"Sync Winning Boutique to Shopify (`shop.dev`)"** modal displaying live GraphQL request/response JSON (plus safe dry-run preview when `SHOPIFY_ADMIN_ACCESS_TOKEN` is unset).
'@
    },
    @{
        Title  = "[Proof It Works — 25% Score] Held-Out Shopper Persona Evaluation Harness (Round 0 Baseline vs. Round 3 Optimized Conversion Lift)"
        Labels = @("teammate-ready", "eval-proof", "gemini-4", "decisions-api")
        Body   = @'
## Sprint Metadata
- **Suggested Owner:** Teammate 3 *(Proof-It-Works Eval Harness, Breaking-Point Stress Test & Shopify `shop.dev` Sync)*
- **Branch Name:** `feat/issue-6-heldout-eval-proof`
- **Rubric Alignment:** **`Proof It Works (25% of Total Score)`** + `Gemini 4 & Decisions API (20%)`
- **Hard Cutoff:** Feature-freeze by **4:15 PM ET** (final submission **5:00 PM ET**)

## Owned Files (Zero-Merge-Conflict Boundary)
- `scripts/eval_heldout_personas.ts`
- `src/components/EvalProofBadge.tsx`
- `docs/PROOF_IT_WORKS.md`

## Goal & Context
`Proof It Works` carries **25%** of the hackathon judging weight. Prove empirically that our Gemini 4 + Decisions API closed-loop store optimizer generalizes to **unseen shoppers** rather than memorizing its critique cohort!

## Acceptance Criteria
- [ ] Partition personas into disjoint **Critique Cohort A** (5 personas proposing store mutations in Rounds 1–3) and **Held-Out Evaluation Cohort B** (10 unseen test personas across budget, minimalist, vintage collector, gift, and first-timer segments).
- [ ] Build reproducible CLI harness (`npx tsx scripts/eval_heldout_personas.ts`) scoring `Round 0 (Uncurated Flat Baseline)` through `Round 3 (Optimized Volumetric Flagship)` and saving JSON metrics to `public/assets/eval-benchmark.json`.
- [ ] Document tables & ablations in `docs/PROOF_IT_WORKS.md` + compact floating HUD badge (`EvalProofBadge.tsx`):
  - Held-out `buy` conversion rate lift (`Round 0` -> `Round 3`)
  - Skeptical/Minimalist `bounce` rate reduction
  - Brand DNA Coherence Floor (`≥ 0.80`) compliance vs. unconstrained greedy prompt ablation (reward-hacking discount failure).
'@
    },
    @{
        Title  = "[Element 119 Stress Test] Document & Demo the Breaking Point (40-Item Chaotic Store / 50-Agent Oscillation) + Consensus Damping Guardrail"
        Labels = @("teammate-ready", "eval-proof", "decisions-api")
        Body   = @'
## Sprint Metadata
- **Suggested Owner:** Teammate 3 *(Proof-It-Works Eval Harness, Breaking-Point Stress Test & Shopify `shop.dev` Sync)*
- **Branch Name:** `feat/issue-7-element119-stress-test`
- **Rubric Alignment:** **`Proof It Works (25%)`** + **`Creativity — Element 119 (20%)`**
- **Hard Cutoff:** Feature-freeze by **4:15 PM ET** (final submission **5:00 PM ET**)

## Owned Files (Zero-Merge-Conflict Boundary)
- `scripts/stress_test_element119.ts`
- `docs/PROOF_IT_WORKS.md` *(Breaking-Point & Consensus Guardrail section)*

## Goal & Context
Judges love teams that know *exactly* where their emergent system breaks and prove how they stabilized it. Stress-test **ATELIER 119** to failure under extreme catalog density (**40-item chaotic store**) and polarized multi-agent feedback (**50-agent preference oscillation**), then demonstrate the **Consensus Damping Guardrail** fixing both.

## Acceptance Criteria
- [ ] Create `scripts/stress_test_element119.ts` (plus reproducible UI stress-test preset) demonstrating two concrete breaking points:
  1. **40-Item Chaotic Rack Overload**: Garment silhouette overlap + visual crowding drives *Minimalist Aesthetics* & *Skeptical First-Timer* bounce rates `> 80%`.
  2. **50-Agent Policy Thrashing**: Polarized *Budget Hunter* vs. *Vintage Collector* cohorts cause undamped optimizers to flip-flop indefinitely (`reprice -35%` <-> `reprice +25%`, warm <-> cool lighting).
- [ ] Implement & verify **Consensus Damping + Hysteresis Guardrail**:
  - Require net utility quorum + Brand DNA Coherence `≥ 0.80` before committing mutations.
  - Enforce axis cooldown hysteresis and automatic `declutter_aisle` cap (max 1 hero faceout + curated capsule rail).
- [ ] Log pre-guardrail oscillation vs. post-guardrail convergence in `docs/PROOF_IT_WORKS.md` for live Q&A defense.
'@
    },
    @{
        Title  = "[Roblox UX & Live Polish] Interactive Player Checkout Cart, Voice/Chat with NPC Shoppers in Roblox Walk Mode & 1-Minute Demo Video Recording Mode"
        Labels = @("teammate-ready", "3d-roblox", "gemini-4")
        Body   = @'
## Sprint Metadata
- **Suggested Owner:** Teammate 1 *(3D World, Roblox Walkthrough & Live Ingestion)*
- **Branch Name:** `feat/issue-8-roblox-checkout-hud`
- **Rubric Alignment:** **`Live Demo (35% of Total Score)`** + `Creativity — Element 119 (20%)`
- **Hard Cutoff:** Feature-freeze by **4:15 PM ET** (final submission **5:00 PM ET**)

## Owned Files (Zero-Merge-Conflict Boundary)
- `src/components/CheckoutCartDrawer.tsx`
- `src/components/RobloxNpcChatOverlay.tsx`
- `src/components/CameraRig.tsx`

## Goal & Context
Make the 3-minute stage demo unforgettable and make capturing the mandatory **1-Minute Submission Video** (`t = 0s` inside the 3D flagship world, zero title slides) effortless! Let players in Roblox `WASD` walk mode walk right up to hanging garments to bag & check out, chat directly with NPC shoppers on the boutique floor, and press one hotkey for choreographed 60 FPS video capture.

## Acceptance Criteria
- [ ] **Proximity Rack Inspection & Bag Checkout**: Walking up to a `BoutiqueRack` in Roblox `WASD` mode (or clicking a `HangingGarment`) shows `[E] Inspect & Add to Bag`, adds the SKU to a sleek floating cart pill, and launches Shopify checkout URL / instant Express Bag confirmation while keeping **≥85% 3D viewport** visible.
- [ ] **Interactive Chat / Voice Bubble with NPC Shoppers**: Press `[T]` or click an NPC shopper avatar to ask why they bought, skipped, or bounced; reply in-character via `gemini-4-neon` grounded in that persona's live evaluation.
- [ ] **1-Minute Demo Video Recording Mode (`[V]` Hotkey)**: Declutters non-essential HUD chrome and sequences smooth camera keyframes (`Hero Alcove` -> `88° Volumetric Cloth Grazing Profile` -> `Swarm Live Store Morph` -> `Roblox Walk & Bag`) ready for screen recording before **4:15 PM ET**.
'@
    }
)

Write-Host ""
Write-Host "[3/3] Creating $($Issues.Count) hackathon sprint issues on $Repo..." -ForegroundColor Yellow

$ExistingTitles = @{}
if (-not $DryRun -and -not $Force) {
    $ErrorActionPreference = "Continue"
    $existingJson = gh issue list --repo $Repo --state all --limit 100 --json title,url 2>$null
    if ($LASTEXITCODE -eq 0 -and $existingJson) {
        $parsed = $existingJson | ConvertFrom-Json
        foreach ($item in $parsed) {
            $ExistingTitles[$item.title] = $item.url
        }
    }
    $ErrorActionPreference = "Stop"
[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
}

$idx = 0
foreach ($issue in $Issues) {
    $idx++
    $labelCsv = ($issue.Labels -join ",")

    if ($DryRun) {
        Write-Host "  [DRY-RUN] Issue #$idx : $($issue.Title)" -ForegroundColor Cyan
        Write-Host "            Labels   : $labelCsv" -ForegroundColor DarkGray
        continue
    }

    if (-not $Force -and $ExistingTitles.ContainsKey($issue.Title)) {
        Write-Host "  [SKIP] Issue #$idx already exists: $($ExistingTitles[$issue.Title])" -ForegroundColor DarkYellow
        continue
    }

    $tempBodyFile = [System.IO.Path]::GetTempFileName()
    try {
        [System.IO.File]::WriteAllText(
            $tempBodyFile,
            $issue.Body,
            [System.Text.UTF8Encoding]::new($false)
        )

        $ghArgs = @(
            "issue", "create",
            "--repo", $Repo,
            "--title", $issue.Title,
            "--body-file", $tempBodyFile
        )
        foreach ($labelName in $issue.Labels) {
            $ghArgs += @("--label", $labelName)
        }

        $createdUrl = & gh @ghArgs
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Failed to create Issue #$idx : $($issue.Title)"
            exit 1
        }
        Write-Host "  [OK] Created Issue #$idx -> $createdUrl" -ForegroundColor Green
    }
    finally {
        if (Test-Path $tempBodyFile) {
            Remove-Item $tempBodyFile -Force -ErrorAction SilentlyContinue
        }
    }
}

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Green
Write-Host " Done! Sprint backlog ready for 3-person parallel execution." -ForegroundColor Green
Write-Host " Branch convention: feat/issue-<num>-<slug>" -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Green
