/**
 * occtCommitPerf.feasibility.test.ts — Phase 0 (kernel-of-record flip) perf
 * evidence + regression guard.
 *
 * Defaulting the OCCT B-rep kernel ON is a PRODUCT decision gated on perf, not
 * correctness (the kernel is already verified — see test:occt:feasibility). The
 * two costs that decide it are:
 *   1. one-time WASM cold load (ensureOcctReady) — paid once per session;
 *   2. per-COMMIT eval of a real feature through the OCCT path vs the mesh
 *      (three-bvh-csg) path — paid on each edit *settle* (the worker debounce
 *      already keeps live drags on the mesh preview, so only commits hit OCCT).
 *
 * This measures both against representative ops (boolean / fillet / chamfer on a
 * 60×40×30 box) by toggling each feature's `engine` param (1 = OCCT, 0 = mesh),
 * prints a table, and asserts loose budgets so it doubles as a regression guard.
 * Run via `npm run test:occt:feasibility` (RUN_OCCT_FEASIBILITY=1).
 *
 * Budgets are deliberately generous (catch a ~10× regression, not micro-noise);
 * the printed numbers are the actual flip-readiness evidence.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { booleanFeature } from '../features/boolean';
import { filletFeature } from '../features/fillet';
import { chamferFeature } from '../features/chamfer';
import { ensureOcctReady, isOcctReady } from '../features/occtEngine';

const ENABLED = process.env.RUN_OCCT_FEASIBILITY === '1';
const d = ENABLED ? describe : describe.skip;

const WASM_LOAD_BUDGET_MS = 8000;   // one-time cold load (10MB WASM); generous.
const COMMIT_EVAL_BUDGET_MS = 1500; // warm per-commit OCCT eval; generous.

function makeBox(w = 60, h = 40, dp = 30): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, dp);
  g.deleteAttribute('uv');
  return g;
}
function defaultParams(def: { params: Array<{ key: string; default: number }> }): Record<string, number> {
  const p: Record<string, number> = {};
  for (const sp of def.params) p[sp.key] = sp.default;
  return p;
}
/** Median wall-clock of `runs` evaluations (a warm-up call is excluded).
 *  Returns NaN if the op throws — the mesh baseline needs provenance-stamped
 *  inputs the production pipeline supplies but this micro-harness does not, so
 *  it is reported best-effort; the OCCT number is the decision metric. */
function medianMs(fn: () => void, runs = 5): number {
  try { fn(); } catch { return NaN; } // warm up (JIT / kernel cache)
  const ts: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    ts.push(performance.now() - t);
  }
  ts.sort((a, b) => a - b);
  return ts[Math.floor(ts.length / 2)]!;
}

d('OCCT commit-eval performance (kernel-of-record flip evidence)', () => {
  let loadMs = 0;
  beforeAll(async () => {
    const t = performance.now();
    await ensureOcctReady();
    loadMs = performance.now() - t;
  }, 60_000);

  it('WASM cold load is within the one-time session budget', () => {
    expect(isOcctReady()).toBe(true);
    // First run in the process pays the real load; a warm re-run is ~0.
    expect(loadMs).toBeLessThan(WASM_LOAD_BUDGET_MS);
  });

  it('each representative commit op evaluates within budget on the OCCT path', () => {
    const cases: { name: string; mesh: () => void; occt: () => void }[] = [];

    // Boolean subtract (cylinder tool).
    {
      const base = () => {
        const p = defaultParams(booleanFeature);
        p.operation = 1; p.toolShape = 1; p.toolWidth = 20; p.toolHeight = 80;
        return p;
      };
      cases.push({
        name: 'boolean−',
        mesh: () => { booleanFeature.apply(makeBox(), { ...base(), engine: 0 }); },
        occt: () => { booleanFeature.apply(makeBox(), { ...base(), engine: 1 }); },
      });
    }
    // Fillet all edges.
    cases.push({
      name: 'fillet',
      mesh: () => { filletFeature.apply(makeBox(), { ...defaultParams(filletFeature), engine: 0 }); },
      occt: () => { filletFeature.apply(makeBox(), { ...defaultParams(filletFeature), engine: 1 }); },
    });
    // Chamfer all edges.
    cases.push({
      name: 'chamfer',
      mesh: () => { chamferFeature.apply(makeBox(), { ...defaultParams(chamferFeature), engine: 0 }); },
      occt: () => { chamferFeature.apply(makeBox(), { ...defaultParams(chamferFeature), engine: 1 }); },
    });

    const table: Record<string, { 'mesh (ms)': string; 'OCCT (ms)': string; 'ratio': string }> = {};
    for (const c of cases) {
      const meshMs = medianMs(c.mesh);
      const occtMs = medianMs(c.occt);
      table[c.name] = {
        'mesh (ms)': Number.isNaN(meshMs) ? 'n/a' : meshMs.toFixed(1),
        'OCCT (ms)': Number.isNaN(occtMs) ? 'n/a' : occtMs.toFixed(1),
        'ratio': Number.isNaN(meshMs) || Number.isNaN(occtMs)
          ? '—'
          : (occtMs / Math.max(meshMs, 0.01)).toFixed(1) + '×',
      };
      // Regression guard: the OCCT commit eval (the flip-decision metric) stays
      // interactive. The OCCT path must actually run — NaN here = it threw.
      expect(occtMs, `${c.name} OCCT commit eval ran`).not.toBeNaN();
      expect(occtMs, `${c.name} OCCT commit eval`).toBeLessThan(COMMIT_EVAL_BUDGET_MS);
    }
    console.log(`\n[Phase 0] WASM cold load: ${loadMs.toFixed(0)} ms (one-time/session)`);
    console.log('[Phase 0] per-commit eval — OCCT vs mesh (median of 5, warm):');
    console.table(table);
  }, 120_000);
});
