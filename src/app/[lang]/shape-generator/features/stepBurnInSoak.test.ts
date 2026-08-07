// @vitest-environment node
/**
 * stepBurnInSoak — long-run kernel stability gate (handoff 260808 §8-6).
 *
 * The single-pass burn-in proves the corpus round-trips once; it says nothing
 * about the two long-run failure modes users actually hit in an editing
 * session:
 *   1. degradation — pass-rate drops after the kernel has churned for a while
 *      (stale handles, tolerance drift inside the wasm heap),
 *   2. leaks — RSS climbs monotonically because shapes/documents are not
 *      released inside opencascade.js.
 *
 * This suite repeats the FULL default corpus N times on one kernel instance
 * and gates both: every iteration must keep passRate === 1, and RSS growth
 * after the warmup iteration must stay under a budget. Thresholds are
 * deliberately generous — the gate exists to catch unbounded growth, not to
 * benchmark.
 *
 * Opt-in (slow): NEXYFAB_OCCT_SOAK=1, via `npm run test:occt:soak`. Knobs:
 *   NEXYFAB_OCCT_SOAK_ITERATIONS  (default 5)
 *   NEXYFAB_OCCT_SOAK_MAX_RSS_MB  (default 256 — growth AFTER iteration 1)
 * Run with --expose-gc (the npm script does) for stable RSS reads.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcctNode } from '@/lib/occt/nodeOcctLoader';
import { createNodeOcctBridge } from '@/lib/occt/nodeOcctBridge';
import { createKSeriesKernel, type SolidKernel } from './solidKernel';
import { runStepBurnIn, defaultBurnInCases } from './stepBurnIn';

const SOAK = process.env.NEXYFAB_OCCT_SOAK === '1';
const ITERATIONS = Math.max(2, Number(process.env.NEXYFAB_OCCT_SOAK_ITERATIONS ?? 5));
const MAX_RSS_GROWTH_MB = Number(process.env.NEXYFAB_OCCT_SOAK_MAX_RSS_MB ?? 256);

let okLoad = false;
let kernel: SolidKernel;

beforeAll(async () => {
  if (!SOAK) return;
  const r = await loadOcctNode();
  if (r.ok && r.oc) { kernel = createKSeriesKernel(createNodeOcctBridge(r.oc)); okLoad = true; }
  else console.warn(`[stepBurnInSoak] skipped — ${r.reason}`);
}, 120_000);

describe.skipIf(!SOAK)('stepBurnIn soak (NEXYFAB_OCCT_SOAK=1)', () => {
  it(`corpus × ${ITERATIONS} iterations: pass-rate stays 1 and RSS growth stays bounded`, async () => {
    if (!okLoad) return;
    const cases = defaultBurnInCases();
    const rssMb: number[] = [];

    for (let i = 0; i < ITERATIONS; i++) {
      const report = await runStepBurnIn(kernel, cases);
      // Degradation gate: the same corpus on the same kernel instance must not
      // start failing just because the kernel has been running for a while.
      if (report.passRate !== 1) {
        console.log(`[stepBurnInSoak] iteration ${i} failures:`, JSON.stringify(report.failures, null, 2));
      }
      expect(report.passRate, `iteration ${i} pass-rate`).toBe(1);

      globalThis.gc?.();
      const rss = process.memoryUsage().rss / (1024 * 1024);
      rssMb.push(rss);
      console.log(`[stepBurnInSoak] iteration ${i}: ${report.passed}/${report.total} ok, rss=${rss.toFixed(1)}MB`);
    }

    // Leak gate: measure growth AFTER iteration 0 — the first pass pays wasm
    // heap warmup + lazily-built caches, which is not a leak.
    const growth = rssMb[rssMb.length - 1]! - rssMb[0]!;
    console.log(`[stepBurnInSoak] rss after warmup ${rssMb[0]!.toFixed(1)}MB → ${rssMb[rssMb.length - 1]!.toFixed(1)}MB (growth ${growth.toFixed(1)}MB, budget ${MAX_RSS_GROWTH_MB}MB)`);
    expect(growth, 'post-warmup RSS growth (MB)').toBeLessThan(MAX_RSS_GROWTH_MB);
  }, 1_800_000);
});
