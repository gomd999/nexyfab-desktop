/**
 * phase3SoakLong.test.ts — Wave 2 Phase 3 hands-on long-soak.
 *
 * Companion to `phase3SoakHarness.test.ts` (3 peers × 100 ops × 6 seeds).
 * This variant pushes SketchStore to 3 peers × 1000 ops × 20 seeds =
 * 60,000 op-cycles to replace the manual 3-hour 3-peer wall-clock soak
 * from docs/wave-2-phase-3-exit.md §7 item 2.
 *
 * Why SketchStore only (vs all 3 stores like the mini-harness):
 *   - Yjs convergence is operation-driven, not store-specific. The
 *     mini-harness already covered breadth (3 stores × 6 seeds);
 *     this variant covers depth (1 store × 1000 ops × 20 seeds).
 *   - Sketch is the highest-touch surface in the editor — divergence
 *     here would surface first in real multi-user editing.
 *   - Self-contained: no import from the mini-harness avoids vitest
 *     double-execution of the harness's existing describes.
 *
 * Runtime: ~3-5 minutes on a fast box. Gated by RUN_LONG_SOAK=1 so
 * default CI stays at the W4 mini-soak (~7s).
 *
 * Run manually before flag-graduation:
 *   RUN_LONG_SOAK=1 npx vitest run \
 *     src/app/[lang]/shape-generator/__tests__/phase3SoakLong.test.ts
 *
 * Any seed divergence is reproducible: re-run with the same seed.
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

import { SketchStore } from '../sketch/SketchStore';
import { sketchesEqual, syncDocs as syncSketchDocs } from '../collab/sketchYjs';
import type { SketchSegment } from '../sketch/types';

const ENABLED = process.env.RUN_LONG_SOAK === '1';
const describeMaybe = ENABLED ? describe : describe.skip;

const PEERS = 3;
const OPS_PER_RUN = 1000;
// 20 deterministic seeds: small + edge + random + INT32-ish boundary.
// Divergence reproduces by re-running the failing seed.
const SEEDS = [
  1, 2, 3, 7, 11, 13, 42, 100, 999,
  1234, 5678, 31415, 27182, 16180,
  65535, 1_000_003, 1_777_777, 7_000_001, 9_999_991,
  2_147_483_647,
];

// ─── PRNG + helpers (mirrors phase3SoakHarness.test.ts — intentional
//     duplication to avoid vitest module side effects from importing
//     a *.test.ts file's runners) ───────────────────────────────────

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function syncAll(docs: Y.Doc[], syncFn: (a: Y.Doc, b: Y.Doc) => unknown): void {
  for (let i = 0; i < docs.length; i += 1) {
    for (let j = i + 1; j < docs.length; j += 1) {
      syncFn(docs[i]!, docs[j]!);
    }
  }
}

interface SoakResult {
  applied: number;
  finalSegCount: number;
}

function runSketchSoakDeep(seed: number, peers: number, ops: number): SoakResult {
  const docs = Array.from({ length: peers }, () => new Y.Doc());
  const stores = docs.map((d) => SketchStore.fromYDoc(d, 'soak-sketch-long'));
  const rng = mulberry32(seed);
  const seq: number[] = Array(peers).fill(0);
  const knownIds = new Set<string>();

  let applied = 0;

  for (let op = 0; op < ops; op += 1) {
    const peer = Math.floor(rng() * peers);
    const store = stores[peer]!;
    const live = store.getSegments();
    const liveIds = live.map((s) => s.id ?? '');
    const r = rng();

    if (live.length === 0 || r < 0.40) {
      seq[peer] += 1;
      const id = `p${peer}-${seq[peer]}`;
      const seg: SketchSegment = {
        id,
        type: 'line',
        points: [
          { x: Math.floor(rng() * 100), y: Math.floor(rng() * 100) },
          { x: Math.floor(rng() * 100), y: Math.floor(rng() * 100) },
        ],
      };
      store.addSegment(seg);
      knownIds.add(id);
      applied += 1;
    } else if (r < 0.70) {
      const id = pick(rng, liveIds);
      if (id) {
        store.updateSegment(id, {
          points: [
            { x: Math.floor(rng() * 100), y: Math.floor(rng() * 100) },
            { x: Math.floor(rng() * 100), y: Math.floor(rng() * 100) },
          ],
        });
        applied += 1;
      }
    } else if (r < 0.85) {
      const id = pick(rng, liveIds);
      if (id) {
        store.removeSegment(id);
        applied += 1;
      }
    } else {
      const planes = ['xy', 'xz', 'yz'] as const;
      store.setPlane(pick(rng, planes));
      applied += 1;
    }

    syncAll(docs, syncSketchDocs);
  }

  const sketches = stores.map((s) => s.getSketch());
  for (let i = 1; i < peers; i += 1) {
    if (!sketchesEqual(sketches[0]!, sketches[i]!)) {
      throw new Error(
        `[phase3SoakLong] DIVERGED at peer ${i} (seed=${seed}, ops=${ops}). ` +
        `p0 segs=${sketches[0]!.segments.length}, p${i} segs=${sketches[i]!.segments.length}. ` +
        `Reproduce: RUN_LONG_SOAK=1 + seed=${seed}`,
      );
    }
  }

  for (const s of stores) s.destroy();
  return { applied, finalSegCount: sketches[0]!.segments.length };
}

describeMaybe(
  `Phase 3 long-soak — SketchStore (${PEERS} peers × ${OPS_PER_RUN} ops × ${SEEDS.length} seeds)`,
  () => {
    for (const seed of SEEDS) {
      it(`seed=${seed} — ${PEERS} peers converge after ${OPS_PER_RUN} ops`, () => {
        const r = runSketchSoakDeep(seed, PEERS, OPS_PER_RUN);
        expect(r.applied).toBeGreaterThan(OPS_PER_RUN * 0.5); // at least half ops applied
      });
    }
  },
);

// Default-CI sentinel so the file is still visible in test summaries
// when the gate is off (otherwise grep'ing for "phase3SoakLong" misses it).
describe('Phase 3 long-soak — gate status', () => {
  it(`RUN_LONG_SOAK=${process.env.RUN_LONG_SOAK ?? '(unset)'} — ${ENABLED ? 'runs full suite' : 'skipped'}`, () => {
    expect(true).toBe(true);
  });
});
