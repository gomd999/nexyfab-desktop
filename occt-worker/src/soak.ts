/**
 * OCCT worker soak harness — W12 D3-5 (ADR-007).
 *
 * Drives the pool with continuous boolean ops for a configurable
 * duration, samples /health-style memory snapshots periodically, and
 * verifies the recycling policy keeps heap bounded.
 *
 * Two modes:
 *   1. Fast smoke (default): 60 s × 2 ops/sec ≈ 120 ops. Suitable for
 *      CI pre-merge gating; catches gross regressions.
 *   2. Real soak: `npm run soak -- --duration=14400` (4 h, the ADR-007
 *      gate). Run locally or in a long-running CI job — Railway free
 *      tier won't tolerate 4 h compute on every PR.
 *
 * Pass criterion (heap stability):
 *   - Collect (opCount, aggregateHeapUsedMb) samples across the run.
 *   - Split into 4 chronological buckets.
 *   - mean(bucket 4) ≤ 2 × mean(bucket 1) → PASS.
 *   - Otherwise FAIL with the actual ratio in the log.
 *
 * Usage:
 *   npm run soak                                          # default 60 s, 2 ops/sec
 *   npm run soak -- --duration=300 --ops-per-sec=5        # 5 min, 5 ops/sec
 *   npm run soak -- --duration=14400 --ops-per-sec=1      # 4 h gate run
 */

import { OcctWorkerPool } from './pool/workerPool.js';
import type { BooleanParams } from './occt/boolean.js';

interface CliArgs {
  durationSec: number;
  opsPerSec: number;
  size: number;
  maxOpsPerSlot: number;
  sampleEverySec: number;
  failOnRegression: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const get = (k: string, fallback: number): number => {
    const a = args.find(s => s.startsWith(`--${k}=`));
    if (!a) return fallback;
    const n = parseFloat(a.split('=')[1]!);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    durationSec: get('duration', 60),
    opsPerSec: get('ops-per-sec', 2),
    size: get('pool-size', 2),
    maxOpsPerSlot: get('max-ops-per-slot', 50),
    sampleEverySec: get('sample-every', 5),
    failOnRegression: !args.includes('--no-fail'),
  };
}

interface Sample {
  t: number;          // seconds since start
  opsCompleted: number;
  aggregateHeapUsedMb: number;
  maxSlotHeapUsedMb: number;
  recycles: number;
}

/** Average aggregateHeapUsedMb over a sub-range of samples. */
function meanHeap(samples: Sample[], from: number, to: number): number {
  const slice = samples.slice(from, to);
  if (slice.length === 0) return 0;
  return slice.reduce((n, s) => n + s.aggregateHeapUsedMb, 0) / slice.length;
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log('[soak] config:', args);

  const pool = new OcctWorkerPool({
    size: args.size,
    maxOpsPerSlot: args.maxOpsPerSlot,
    opTimeoutMs: 30_000,
  });
  pool.start();

  // Wait for at least one slot ready before driving.
  const tWait = Date.now();
  while (pool.status().readyCount === 0 && Date.now() - tWait < 30_000) {
    await new Promise(r => setTimeout(r, 200));
  }
  if (pool.status().readyCount === 0) {
    console.error('[soak] no slot ready after 30 s — aborting');
    await pool.drain();
    process.exit(1);
  }
  console.log(`[soak] pool ready (${pool.status().readyCount}/${args.size} slots) — driving ops`);

  const samples: Sample[] = [];
  const tStart = Date.now();
  const opIntervalMs = 1000 / args.opsPerSec;
  let opCount = 0;
  let failedOps = 0;

  // Sampler — pulls a status snapshot every sampleEverySec.
  const sampler = setInterval(() => {
    const s = pool.status();
    samples.push({
      t: (Date.now() - tStart) / 1000,
      opsCompleted: s.totalOpsCompleted,
      aggregateHeapUsedMb: s.aggregateHeapUsedMb,
      maxSlotHeapUsedMb: s.maxSlotHeapUsedMb,
      recycles: s.totalRecycles,
    });
    const latest = samples[samples.length - 1]!;
    console.log(
      `[soak] t=${latest.t.toFixed(0)}s ops=${latest.opsCompleted} heap=${latest.aggregateHeapUsedMb}MB max=${latest.maxSlotHeapUsedMb}MB recycles=${latest.recycles}`,
    );
  }, args.sampleEverySec * 1000);

  // Op driver — sustained boolean ops at the configured rate. Params
  // varied slightly so the kernel can't cache aggressively.
  const driveOps = async (): Promise<void> => {
    while ((Date.now() - tStart) / 1000 < args.durationSec) {
      const params: BooleanParams = {
        host: { w: 50 + (opCount % 10), h: 50, d: 50 },
        toolShape: opCount % 2,
        r: 5 + (opCount % 5),
        type: 'cut',
      };
      pool.execute('boolean', params, 'soak-user')
        .then(() => { opCount++; })
        .catch((err: Error) => {
          failedOps++;
          if (failedOps < 5) console.warn(`[soak] op failed: ${err.message}`);
        });
      await new Promise(r => setTimeout(r, opIntervalMs));
    }
  };

  await driveOps();
  // Let in-flight settle.
  await new Promise(r => setTimeout(r, 5000));
  clearInterval(sampler);

  // Final sample for the analysis.
  const final = pool.status();
  samples.push({
    t: (Date.now() - tStart) / 1000,
    opsCompleted: final.totalOpsCompleted,
    aggregateHeapUsedMb: final.aggregateHeapUsedMb,
    maxSlotHeapUsedMb: final.maxSlotHeapUsedMb,
    recycles: final.totalRecycles,
  });

  console.log('\n[soak] === SUMMARY ===');
  console.log(`[soak] duration: ${args.durationSec}s`);
  console.log(`[soak] ops driven: ${opCount} (failed: ${failedOps})`);
  console.log(`[soak] ops/sec actual: ${(opCount / args.durationSec).toFixed(2)}`);
  console.log(`[soak] recycles: ${final.totalRecycles}`);
  console.log(`[soak] final aggregate heap: ${final.aggregateHeapUsedMb}MB`);
  console.log(`[soak] final max slot heap: ${final.maxSlotHeapUsedMb}MB`);

  // Heap stability: bucket 4 mean vs bucket 1 mean.
  const q = Math.floor(samples.length / 4);
  let regression = false;
  let ratio = 0;
  if (q >= 2) {
    const firstQ = meanHeap(samples, 0, q);
    const lastQ = meanHeap(samples, samples.length - q, samples.length);
    ratio = firstQ > 0 ? lastQ / firstQ : Number.POSITIVE_INFINITY;
    regression = ratio > 2.0;
    console.log(`[soak] heap Q1 mean: ${firstQ.toFixed(2)}MB`);
    console.log(`[soak] heap Q4 mean: ${lastQ.toFixed(2)}MB`);
    console.log(`[soak] heap growth ratio (Q4/Q1): ${ratio.toFixed(2)}x`);
  } else {
    console.log('[soak] not enough samples for trend analysis — extend --duration');
  }

  await pool.drain();

  if (regression && args.failOnRegression) {
    console.error(`[soak] FAIL — heap grew ${ratio.toFixed(2)}x (limit: 2x). Recycling policy not bounding heap.`);
    process.exit(1);
  }
  console.log('[soak] PASS');
  process.exit(0);
}

main().catch(err => {
  console.error('[soak] uncaught:', err);
  process.exit(2);
});
