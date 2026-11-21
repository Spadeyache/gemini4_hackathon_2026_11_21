---
name: Hackathon Sprint Task (Zero-Conflict)
about: Parallelizable sprint task with explicit folder ownership, branch naming, and rubric alignment
title: "[Track] Short actionable task title"
labels: ["teammate-ready"]
assignees: []
---

## Sprint Metadata
- **Owner Track:** `Teammate 1 (3D / Roblox / Garment Ingest)` | `Teammate 2 (Gemini 4 Agents / Decisions API)` | `Teammate 3 (Eval Proof / Stress Test / Shopify)`
- **Branch Name:** `feat/issue-<num>-<slug>`
- **Rubric Alignment:** `Live Demo (35%)` | `Proof It Works (25%)` | `Creativity — Element 119 (20%)` | `Gemini 4 & Decisions API (20%)` | `Shopify Bonus Track`
- **Target Freeze:** Before **4:15 PM ET** (5:00 PM ET hard submission cutoff)

---

## Owned Files (Zero-Merge-Conflict Boundary)
> Only edit files listed below so all 3 teammates can push and merge simultaneously without rebasing conflicts. `src/types/storeConfig.ts` is our shared schema contract—ping the team before changing exported interfaces.

- `path/to/owned/file.ts`

---

## Goal & Context
Describe what user-visible capability or empirical benchmark this unlocks in **ATELIER 119**.

---

## Implementation Checklist
- [ ] Step 1
- [ ] Step 2
- [ ] Graceful offline/cached fallback verified (never crash stage demo if network hiccups)
- [ ] `npm run build` (`tsc -b && vite build`) passes cleanly with zero TypeScript errors

---

## 30-Second Stage Verification
1. Run `npm run dev`
2. Exact click / keyboard walkthrough (`WASD` / drop image / run swarm round) to verify it works live at 60 FPS while preserving the **85%+ 3D viewport** rule.
