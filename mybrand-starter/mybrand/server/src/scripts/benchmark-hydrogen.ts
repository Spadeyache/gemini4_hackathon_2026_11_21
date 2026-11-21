import type { BoutiqueEvent, SessionConfig } from "@mybrand/shared";
import { loadSessionConfig } from "../boot";
import { loadServerEnv, WORKSPACE_ROOT } from "../env";
import { createHydrogenClient, HYDROGEN_MODEL } from "../session/hydrogen";
import { computeSignals, toModelSignalsPayload } from "../session/signals";
import type { SessionAdapterInput } from "../session/types";
import { validateOps } from "../session/validator";

const TOTAL_CALLS = 20;
const BENCHMARK_HARD_TIMEOUT_MS = 15_000;

interface BenchmarkScenario {
  label: string;
  now_s: number;
  events: BoutiqueEvent[];
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const clamped = Math.max(0, Math.min(sorted.length - 1, rank));
  return sorted[clamped];
}

function buildScenarios(config: SessionConfig): BenchmarkScenario[] {
  const scenarios: BenchmarkScenario[] = [];
  const p0 = config.demo_personas[0];
  const p1 = config.demo_personas[1] ?? config.demo_personas[0];

  const checkpoints = [13, 18, 24, 31, 38, 45, 50, 55, 60, 65];
  for (const t of checkpoints) {
    scenarios.push({
      label: `${p0.name} @ ${t}s`,
      now_s: t,
      events: p0.events.filter((e) => e.t <= t),
    });
  }
  for (const t of checkpoints) {
    scenarios.push({
      label: `${p1.name} @ ${t}s`,
      now_s: t,
      events: p1.events.filter((e) => e.t <= t),
    });
  }

  return scenarios.slice(0, TOTAL_CALLS);
}

async function main(): Promise<void> {
  const env = loadServerEnv();
  if (!env.geminiApiKey) {
    console.error(
      "[bench:hydrogen] GEMINI_API_KEY is not set in .env or environment. Add a key to run the 20-call live benchmark."
    );
    process.exit(1);
  }

  const config = await loadSessionConfig(WORKSPACE_ROOT, "demo-brand");
  if (!config) {
    console.error("[bench:hydrogen] Could not load fixtures/demo-brand/session_config.json");
    process.exit(1);
  }

  const client = createHydrogenClient({
    apiKey: env.geminiApiKey,
    workspaceRoot: WORKSPACE_ROOT,
  });

  const scenarios = buildScenarios(config);
  const deadlineMs = config.policy.limits.deadline_ms;
  const succeededLatencies: number[] = [];
  let validJsonCount = 0;
  let validOpBatchCount = 0;
  let exceededDeadlineCount = 0;
  let errorCount = 0;

  console.log(
    `[bench:hydrogen] Running ${scenarios.length} live calls against ${HYDROGEN_MODEL} (thinking_level=LOW, target deadline_ms=${deadlineMs}ms)...`
  );

  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i];
    const signals = computeSignals(
      scenario.events,
      config.catalog,
      scenario.now_s
    );

    const input: SessionAdapterInput = {
      brand_card: config.brand_card,
      catalog: config.catalog,
      policy: config.policy,
      pools: config.pools,
      state: { ...config.base_state },
      signals: toModelSignalsPayload(signals),
      applied: [],
      now_s: scenario.now_s,
    };

    const res = await client.propose(input, BENCHMARK_HARD_TIMEOUT_MS);

    if (res.ok) {
      validJsonCount++;
      succeededLatencies.push(res.latency_ms);
      if (res.latency_ms > deadlineMs) {
        exceededDeadlineCount++;
      }
      const validated = validateOps(res.output.ops, {
        config,
        state: { ...config.base_state },
        signals,
        now_s: scenario.now_s,
        appliedCount: 0,
        lastChangeAtS: null,
        leverLastChangedAtS: {},
      });
      if (validated.rejected.length === 0) {
        validOpBatchCount++;
      }
      console.log(
        `  #${String(i + 1).padStart(2, "0")} [${res.latency_ms}ms] ${scenario.label} -> ops=${validated.accepted.length} (dropped=${validated.rejected.length}), read="${res.output.visitor_read}", conf=${res.output.confidence}`
      );
    } else {
      errorCount++;
      console.log(
        `  #${String(i + 1).padStart(2, "0")} [${res.latency_ms}ms] ${scenario.label} -> ERROR: ${res.error}`
      );
    }
  }

  console.log("\n=== Hydrogen Latency Summary (20 calls) ===");
  console.log(`Model:             ${HYDROGEN_MODEL} (thinking_level=LOW)`);
  console.log(`Valid JSON:        ${validJsonCount}/${scenarios.length}`);
  console.log(`Errors:            ${errorCount}/${scenarios.length}`);
  console.log(`Clean validator:   ${validOpBatchCount}/${scenarios.length}`);

  if (succeededLatencies.length === 0) {
    console.error(
      "\n[FAILED] 0/20 live Hydrogen calls succeeded. Check network access and GEMINI_API_KEY."
    );
    process.exit(1);
  }

  const sorted = [...succeededLatencies].sort((a, b) => a - b);
  const min = sorted[0] ?? 0;
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const max = sorted[sorted.length - 1] ?? 0;

  console.log(`Over ${deadlineMs}ms:      ${exceededDeadlineCount}/${succeededLatencies.length}`);
  console.log(`Min / p50 / p95 / Max: ${min}ms / ${p50}ms / ${p95}ms / ${max}ms`);

  if (p95 > deadlineMs) {
    console.log(
      `\n[RECOMMENDATION] p95 (${p95}ms) > ${deadlineMs}ms -> set SESSION_ADAPTER_MODE=rules_plus_host_note so rules drive structural changes immediately and Hydrogen writes only /host_note.`
    );
  } else {
    console.log(
      `\n[OK] p95 (${p95}ms) <= ${deadlineMs}ms -> SESSION_ADAPTER_MODE=full is within budget.`
    );
  }
}

main().catch((error) => {
  console.error(
    "[bench:hydrogen] Fatal error:",
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
});
