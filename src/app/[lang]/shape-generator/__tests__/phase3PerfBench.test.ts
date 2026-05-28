/**
 * phase3PerfBench.test.ts — Wave 2 Phase 3 W4 Q-precursor.
 *
 * **Performance benchmark vs ADR-012 §8 budgets, in both legacy
 * (local) and v2 (Yjs) modes.**
 *
 * ADR-012 §8 specifies:
 *   - Sketch entity add p95 ≤ 16ms (per-keystroke target; Phase 2 baseline).
 *   - Feature tree reorder p95 ≤ 50ms (drag-drop in tree; Phase 2 baseline).
 *   - Direct-edit push-pull preview p95 ≤ 30ms (live drag).
 *   - **CRDT-induced perf regression vs single-user baseline ≤ 50%** on
 *     any of the above (~30% encoding + 20% runtime).
 *
 * This bench measures EACH operation in BOTH modes at N=100 and asserts:
 *   1. Absolute budget met (the ADR-012 §8 column).
 *   2. Yjs-mode regression vs local-mode is < 50% (the 1.5× cap).
 *
 * If (1) fails the operation is over-budget regardless of mode — Phase
 * 3.5 buffer triggers (per ADR-012 §8 final paragraph). If (2) fails
 * the CRDT envelope is the regression — Reversal B per ADR-011 may
 * trigger (per ADR-012 line 67-69).
 *
 * ─── Pattern ──────────────────────────────────────────────────────────
 *
 * Modeled on `configurations/__tests__/ConfigurationTable.perf.test.ts`
 * (A3 perf benchmark, the Phase 2 production version). Same
 * `percentile()` helper, same N=100, same warm-up step, same console.log
 * format so the CI reporter surfaces actual numbers for trending.
 *
 * **Generous thresholds**. The local-mode case targets 16ms p95, but on
 * a slow CI runner pure-JS Y.Map writes can drift; we test against the
 * ADR budget exactly so any regression past it is meaningful, and we
 * print p50 / p95 / p99 so trends are visible even when no test fails.
 *
 * ─── E1 push-pull reuse ───────────────────────────────────────────────
 *
 * The brief calls out "`applyPushPull` (E1) — already has test, reuse
 * perf data". We do NOT duplicate that benchmark here; instead we test
 * the same op-frequency-shaped workload (50 push-pull-sized writes to
 * the Yjs `directEdits` array, mirroring E1's session stack pattern)
 * and assert its p95 ≤ 30ms. The actual OCCT call has its own perf
 * tests under `direct-edit/__tests__/`.
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

import { SketchStore } from '../sketch/SketchStore';
import { FeatureTreeStore } from '../featureTree/FeatureTreeStore';
import { RefGeomStore, migrateToYjs as migrateRefGeomToYjs } from '../referenceGeometry/RefGeomStore';
import { migrateToYjs as migrateFeatureTreeToYjs } from '../featureTree/FeatureTreeStore';
import { migrateToYjs as migrateSketchToYjs } from '../sketch/SketchStore';

import type { SketchSegment } from '../sketch/types';
import type { HistoryNode } from '../useFeatureStack';
import type { ReferencePlaneNode } from '../referenceGeometry/types';

// ═══════════════════════════════════════════════════════════════════════
//  Helpers — percentile, fixture builders
// ═══════════════════════════════════════════════════════════════════════

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

/** Run `fn` N times, returning sorted samples + p50/p95/p99 summary. */
function bench(label: string, N: number, warmup: number, fn: () => void): {
  p50: number;
  p95: number;
  p99: number;
  samples: number[];
} {
  // Warm-up — let the JIT settle.
  for (let i = 0; i < warmup; i += 1) fn();
  const samples: number[] = [];
  for (let i = 0; i < N; i += 1) {
    const t0 = performance.now();
    fn();
    const t1 = performance.now();
    samples.push(t1 - t0);
  }
  samples.sort((a, b) => a - b);
  const p50 = percentile(samples, 50);
  const p95 = percentile(samples, 95);
  const p99 = percentile(samples, 99);
  console.log(
    `[phase3PerfBench] ${label} N=${N} p50=${p50.toFixed(3)}ms p95=${p95.toFixed(3)}ms p99=${p99.toFixed(3)}ms`,
  );
  return { p50, p95, p99, samples };
}

function makeLine(id: string): SketchSegment {
  return { id, type: 'line', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] };
}

function makeNode(id: string, parentId: string | null = null): HistoryNode {
  return {
    id,
    type: 'feature',
    label: id,
    icon: '🔧',
    params: { radius: 5 },
    enabled: true,
    expanded: true,
    parentId,
    children: [],
    editingActive: false,
    timestamp: 1,
  };
}

function makePlane(id: string): ReferencePlaneNode {
  return {
    id,
    kind: 'plane',
    method: 'standard',
    label: id,
    hidden: false,
    dependsOn: [],
    evaluatedAt: 0,
    params: { method: 'standard', id: 'front' },
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  ADR-012 §8 budgets — single source of truth for the assertions below
// ═══════════════════════════════════════════════════════════════════════

const BUDGET = {
  sketchEntityAdd_p95_ms: 16,
  featureTreeReorder_p95_ms: 50,
  refGeomAdd_p95_ms: 16,
  directEdit_p95_ms: 30,
  migrateToYjs_50nodes_overall_ms: 100,
  crdtRegressionMultiplier: 1.5, // 50% over local-mode = ADR cap
} as const;

const N = 100;
const WARMUP = 10;

// ═══════════════════════════════════════════════════════════════════════
//  1. Sketch entity add — local vs Yjs, p95 ≤ 16ms, regression ≤ 1.5×
// ═══════════════════════════════════════════════════════════════════════

describe('Phase 3 W4 perf — Sketch entity add', () => {
  it('local-mode p95 ≤ 16ms (ADR-012 §8)', () => {
    const store = SketchStore.local();
    let i = 0;
    const result = bench('SketchStore.local.addSegment', N, WARMUP, () => {
      i += 1;
      store.addSegment(makeLine(`s-local-${i}`));
    });
    store.destroy();
    expect(result.p95).toBeLessThan(BUDGET.sketchEntityAdd_p95_ms);
  });

  it('yjs-mode p95 ≤ 16ms (ADR-012 §8)', () => {
    const doc = new Y.Doc();
    const store = SketchStore.fromYDoc(doc, 'perf-sketch');
    let i = 0;
    const result = bench('SketchStore.yjs.addSegment', N, WARMUP, () => {
      i += 1;
      store.addSegment(makeLine(`s-yjs-${i}`));
    });
    store.destroy();
    expect(result.p95).toBeLessThan(BUDGET.sketchEntityAdd_p95_ms);
  });

  it('yjs regression vs local ≤ 50% (ADR-012 §8 final ¶)', () => {
    // Run both back-to-back so the ratio reflects the same JIT state.
    const localStore = SketchStore.local();
    let li = 0;
    const localRes = bench('SketchStore.local.addSegment[compare]', N, WARMUP, () => {
      li += 1;
      localStore.addSegment(makeLine(`s-cmp-local-${li}`));
    });
    localStore.destroy();

    const doc = new Y.Doc();
    const yjsStore = SketchStore.fromYDoc(doc, 'perf-sketch-cmp');
    let yi = 0;
    const yjsRes = bench('SketchStore.yjs.addSegment[compare]', N, WARMUP, () => {
      yi += 1;
      yjsStore.addSegment(makeLine(`s-cmp-yjs-${yi}`));
    });
    yjsStore.destroy();

    // Avoid division by zero on absurdly fast local runs (< 0.001ms): in
    // that case any Yjs overhead trivially passes the absolute budget.
    const safeLocalP95 = Math.max(localRes.p95, 0.001);
    const regressionRatio = yjsRes.p95 / safeLocalP95;
    console.log(
      `[phase3PerfBench] Sketch yjs/local regression p95 ratio = ${regressionRatio.toFixed(3)}× (cap ${BUDGET.crdtRegressionMultiplier}×)`,
    );
    // Soft cap: if local is so fast the ratio is meaningless, only check
    // the absolute budget (Yjs <= 16ms means we're fine regardless).
    if (localRes.p95 >= 0.05) {
      expect(regressionRatio).toBeLessThan(BUDGET.crdtRegressionMultiplier);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  2. Feature tree reorder — local vs Yjs, p95 ≤ 50ms, regression ≤ 1.5×
// ═══════════════════════════════════════════════════════════════════════

describe('Phase 3 W4 perf — Feature tree reorder', () => {
  /** Builds a tree with `count` siblings under root. */
  function seedTree(store: ReturnType<typeof FeatureTreeStore.local>, count: number): string[] {
    const root = store.getRootId();
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const id = `node-${i}`;
      store.addNode(makeNode(id, root));
      ids.push(id);
    }
    return ids;
  }

  it('local-mode reorder p95 ≤ 50ms (ADR-012 §8)', () => {
    const store = FeatureTreeStore.local();
    const ids = seedTree(store, 50);
    let pickIdx = 0;
    const result = bench('FeatureTreeStore.local.reorder', N, WARMUP, () => {
      const id = ids[pickIdx % ids.length]!;
      pickIdx += 1;
      store.reorder(id, pickIdx % 49);
    });
    store.destroy();
    expect(result.p95).toBeLessThan(BUDGET.featureTreeReorder_p95_ms);
  });

  it('yjs-mode reorder p95 ≤ 50ms (ADR-012 §8)', () => {
    const seed = FeatureTreeStore.local();
    const ids = seedTree(seed, 50);
    const doc = new Y.Doc();
    const store = migrateFeatureTreeToYjs(seed, doc);
    let pickIdx = 0;
    const result = bench('FeatureTreeStore.yjs.reorder', N, WARMUP, () => {
      const id = ids[pickIdx % ids.length]!;
      pickIdx += 1;
      store.reorder(id, pickIdx % 49);
    });
    store.destroy();
    expect(result.p95).toBeLessThan(BUDGET.featureTreeReorder_p95_ms);
  });

  it('yjs reorder regression vs local ≤ 50%', () => {
    const localSeed = FeatureTreeStore.local();
    const lIds = seedTree(localSeed, 50);
    let li = 0;
    const localRes = bench('FeatureTreeStore.local.reorder[compare]', N, WARMUP, () => {
      const id = lIds[li % lIds.length]!;
      li += 1;
      localSeed.reorder(id, li % 49);
    });
    localSeed.destroy();

    const yjsSeed = FeatureTreeStore.local();
    const yIds = seedTree(yjsSeed, 50);
    const doc = new Y.Doc();
    const yjsStore = migrateFeatureTreeToYjs(yjsSeed, doc);
    let yi = 0;
    const yjsRes = bench('FeatureTreeStore.yjs.reorder[compare]', N, WARMUP, () => {
      const id = yIds[yi % yIds.length]!;
      yi += 1;
      yjsStore.reorder(id, yi % 49);
    });
    yjsStore.destroy();

    const safeLocalP95 = Math.max(localRes.p95, 0.001);
    const ratio = yjsRes.p95 / safeLocalP95;
    console.log(
      `[phase3PerfBench] FeatureTree reorder yjs/local p95 ratio = ${ratio.toFixed(3)}× (cap ${BUDGET.crdtRegressionMultiplier}×)`,
    );
    if (localRes.p95 >= 0.05) {
      expect(ratio).toBeLessThan(BUDGET.crdtRegressionMultiplier);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  3. Ref-geom add — local vs Yjs, p95 ≤ 16ms, regression ≤ 1.5×
// ═══════════════════════════════════════════════════════════════════════

describe('Phase 3 W4 perf — Ref-geom add', () => {
  it('local-mode addNode p95 ≤ 16ms (ADR-012 §8)', () => {
    const store = RefGeomStore.local();
    let i = 0;
    const result = bench('RefGeomStore.local.addNode', N, WARMUP, () => {
      i += 1;
      store.addNode(makePlane(`rg-local-${i}`));
    });
    store.destroy();
    expect(result.p95).toBeLessThan(BUDGET.refGeomAdd_p95_ms);
  });

  it('yjs-mode addNode p95 ≤ 16ms (ADR-012 §8)', () => {
    const doc = new Y.Doc();
    const store = RefGeomStore.fromYDoc(doc);
    let i = 0;
    const result = bench('RefGeomStore.yjs.addNode', N, WARMUP, () => {
      i += 1;
      store.addNode(makePlane(`rg-yjs-${i}`));
    });
    store.destroy();
    expect(result.p95).toBeLessThan(BUDGET.refGeomAdd_p95_ms);
  });

  it('yjs add regression vs local ≤ 50%', () => {
    const local = RefGeomStore.local();
    let li = 0;
    const localRes = bench('RefGeomStore.local.addNode[compare]', N, WARMUP, () => {
      li += 1;
      local.addNode(makePlane(`rg-cmp-local-${li}`));
    });
    local.destroy();

    const doc = new Y.Doc();
    const yjs = RefGeomStore.fromYDoc(doc);
    let yi = 0;
    const yjsRes = bench('RefGeomStore.yjs.addNode[compare]', N, WARMUP, () => {
      yi += 1;
      yjs.addNode(makePlane(`rg-cmp-yjs-${yi}`));
    });
    yjs.destroy();

    const safeLocalP95 = Math.max(localRes.p95, 0.001);
    const ratio = yjsRes.p95 / safeLocalP95;
    console.log(
      `[phase3PerfBench] RefGeom add yjs/local p95 ratio = ${ratio.toFixed(3)}× (cap ${BUDGET.crdtRegressionMultiplier}×)`,
    );
    if (localRes.p95 >= 0.05) {
      expect(ratio).toBeLessThan(BUDGET.crdtRegressionMultiplier);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  4. migrateToYjs round-trip — 50-node tree, overall ≤ 100ms
// ═══════════════════════════════════════════════════════════════════════

describe('Phase 3 W4 perf — migrateToYjs round-trip', () => {
  it('Sketch migrate (50 segments) overall ≤ 100ms', () => {
    const samples: number[] = [];
    for (let trial = 0; trial < 20; trial += 1) {
      const local = SketchStore.local();
      for (let i = 0; i < 50; i += 1) local.addSegment(makeLine(`seg-${trial}-${i}`));
      const doc = new Y.Doc();
      const t0 = performance.now();
      const yjs = migrateSketchToYjs(local, doc, 'sketch-1');
      const t1 = performance.now();
      samples.push(t1 - t0);
      yjs.destroy();
    }
    samples.sort((a, b) => a - b);
    const p95 = percentile(samples, 95);
    console.log(`[phase3PerfBench] Sketch migrateToYjs(50) p95=${p95.toFixed(3)}ms`);
    expect(p95).toBeLessThan(BUDGET.migrateToYjs_50nodes_overall_ms);
  });

  it('FeatureTree migrate (50 nodes) overall ≤ 100ms', () => {
    const samples: number[] = [];
    for (let trial = 0; trial < 20; trial += 1) {
      const local = FeatureTreeStore.local();
      const root = local.getRootId();
      for (let i = 0; i < 50; i += 1) local.addNode(makeNode(`n-${trial}-${i}`, root));
      const doc = new Y.Doc();
      const t0 = performance.now();
      const yjs = migrateFeatureTreeToYjs(local, doc);
      const t1 = performance.now();
      samples.push(t1 - t0);
      yjs.destroy();
    }
    samples.sort((a, b) => a - b);
    const p95 = percentile(samples, 95);
    console.log(`[phase3PerfBench] FeatureTree migrateToYjs(50) p95=${p95.toFixed(3)}ms`);
    expect(p95).toBeLessThan(BUDGET.migrateToYjs_50nodes_overall_ms);
  });

  it('RefGeom migrate (50 nodes) overall ≤ 100ms', () => {
    const samples: number[] = [];
    for (let trial = 0; trial < 20; trial += 1) {
      const local = RefGeomStore.local();
      for (let i = 0; i < 50; i += 1) local.addNode(makePlane(`p-${trial}-${i}`));
      const doc = new Y.Doc();
      const t0 = performance.now();
      const yjs = migrateRefGeomToYjs(local, doc);
      const t1 = performance.now();
      samples.push(t1 - t0);
      yjs.destroy();
    }
    samples.sort((a, b) => a - b);
    const p95 = percentile(samples, 95);
    console.log(`[phase3PerfBench] RefGeom migrateToYjs(50) p95=${p95.toFixed(3)}ms`);
    expect(p95).toBeLessThan(BUDGET.migrateToYjs_50nodes_overall_ms);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  5. Direct-edit push-pull session — applyPushPull frequency-shaped
//     workload, p95 ≤ 30ms (ADR-012 §8)
// ═══════════════════════════════════════════════════════════════════════

describe('Phase 3 W4 perf — Direct-edit push-pull session', () => {
  it('directEdits Y.Array push p95 ≤ 30ms (E1 session-stack proxy)', () => {
    // The actual `applyPushPull` benchmark is in direct-edit/__tests__/
    // — here we test the CRDT-write half (which is what the W4 gate
    // questions: "is the CRDT envelope around push-pull responsive?").
    const doc = new Y.Doc();
    const directEdits = doc.getArray<unknown>('directEdits');
    let i = 0;
    const result = bench('directEdits.push (E1 stack proxy)', N, WARMUP, () => {
      i += 1;
      doc.transact(() => {
        directEdits.push([{
          op: 'pushPull',
          faceIds: [`face-${i}`],
          params: { distanceMm: 5 + (i % 10) },
          timestamp: Date.now(),
          userId: 'test',
        }]);
      });
    });
    expect(result.p95).toBeLessThan(BUDGET.directEdit_p95_ms);
    doc.destroy();
  });
});
