# `src/features/eval/` — Proof It Works (25% Score) & Element 119 Stress Test

**Teammate Ownership:** Issues #6 & #7

## Responsibilities
1. **Held-Out Shopper Persona Benchmark:**
   - Splits synthetic shoppers into **Training Personas** (used by the Store Optimizer in Rounds 1–3) and **Held-Out Eval Personas** (never seen by the Architect).
   - Measures and displays conversion lift: `Round 0 Single-Pass Baseline` vs. `Round 3 Mutated Store`.
2. **Element 119 Breaking Point & Guardrail:**
   - Stress-tests chaotic 40-SKU inputs / 50 concurrent shopper agents to trigger layout oscillation, and applies consensus-threshold damping to stabilize conversion.
