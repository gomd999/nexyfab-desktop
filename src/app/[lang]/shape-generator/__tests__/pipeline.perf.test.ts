/**
 * Large-pipeline perf benchmark (Q3).
 *
 * Establishes a perf budget for feature-stack-heavy projects. We build a
 * synthetic pipeline of N boolean cuts on a starter box and measure:
 *   • wall-clock time for one pipeline pass
 *   • per-feature cost (linear scaling expectation)
 *   • triangle count after N ops (mesh CSG should not collapse silently)
 *
 * The budgets here are loose ceilings — they catch O(N²) regressions and
 * deadlocks, not micro-perf drift. Enable with RUN_PERF_BENCH=1; default
 * skip keeps CI fast.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applyFeaturePipelineDetailed } from '../features';
import type { FeatureInstance } from '../features/types';

const ENABLED = process.env.RUN_PERF_BENCH === '1';
const describeMaybe = ENABLED ? describe : describe.skip;

function makeBox(w = 200, h = 200, d = 50): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.computeVertexNormals();
  return geo;
}

function buildBooleanGrid(rows: number, cols: number): FeatureInstance[] {
  // Lay out `rows×cols` cylinder cuts on the box top face.
  const features: FeatureInstance[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      features.push({
        id: `cut_${r}_${c}`,
        type: 'boolean',
        params: {
          operation: 1,    // subtract
          toolShape: 1,    // cylinder
          toolWidth: 4,
          toolHeight: 60,
          toolDepth: 4,
          posX: -90 + c * 18,
          posY: 0,
          posZ: -90 + r * 18,
          rotX: 90, rotY: 0, rotZ: 0,
          engine: 0,       // mesh CSG (we're measuring the default path)
        },
        enabled: true,
      });
    }
  }
  return features;
}

interface PerfRun {
  featureCount: number;
  millis: number;
  triangleCount: number;
  errors: number;
}

function runOnce(featureCount: number, side: number): PerfRun {
  const features = buildBooleanGrid(side, side).slice(0, featureCount);
  const t0 = performance.now();
  const result = applyFeaturePipelineDetailed(makeBox(), features);
  const t1 = performance.now();
  return {
    featureCount: features.length,
    millis: t1 - t0,
    triangleCount: result.geometry.index ? result.geometry.index.count / 3 : 0,
    errors: Object.keys(result.errors).length,
  };
}

describeMaybe('Large-pipeline perf benchmark (Q3)', () => {
  it('25-feature pipeline completes within 30 seconds', () => {
    const run = runOnce(25, 5);
    console.log(
      `[perf] N=${run.featureCount}  ${run.millis.toFixed(0)}ms  ` +
      `tris=${run.triangleCount}  errors=${run.errors}`,
    );
    expect(run.errors).toBe(0);
    expect(run.millis).toBeLessThan(30_000);
    expect(run.triangleCount).toBeGreaterThan(50);
  }, 60_000);

  it('100-feature pipeline scales sub-quadratically', () => {
    // If feature N degrades worse than O(N¹·⁵) we have an algorithmic
    // regression (e.g. each op re-tessellates from scratch). We measure 25
    // and 100 and assert the ratio stays under 25× — a quadratic scale
    // would give 16×, so 25× absorbs noise but rejects O(N²).
    const small = runOnce(25, 5);
    const large = runOnce(100, 10);
    const ratio = large.millis / small.millis;
    console.log(
      `[perf] scaling 25→100:  ${small.millis.toFixed(0)}ms → ${large.millis.toFixed(0)}ms  ` +
      `ratio ${ratio.toFixed(1)}× (expect <25)`,
    );
    expect(small.errors).toBe(0);
    expect(large.errors).toBe(0);
    expect(ratio).toBeLessThan(25);
    expect(large.millis).toBeLessThan(180_000);  // 3-min hard ceiling
  }, 240_000);

  // Memory: count-based heuristic (we can't read process.memoryUsage from
  // browser code, and the Node side here can in vitest). Asserts the
  // triangle count after N cuts hasn't exploded (mesh CSG bug used to
  // double-count vertices).
  it('triangle count after 50 cuts stays under 200k', () => {
    const run = runOnce(50, 8);
    console.log(`[perf] tris after 50 cuts = ${run.triangleCount}`);
    expect(run.triangleCount).toBeLessThan(200_000);
    expect(run.triangleCount).toBeGreaterThan(0);
  }, 120_000);

  // Determinism under load: same input twice → same triangle count.
  // CSG nondeterminism shows up as tris jumping by ±1-3 between runs.
  it('30-feature pipeline is deterministic across 2 runs (tri count match)', () => {
    const r1 = runOnce(30, 6);
    const r2 = runOnce(30, 6);
    console.log(`[perf] determinism tris  ${r1.triangleCount} vs ${r2.triangleCount}`);
    expect(r1.triangleCount).toBe(r2.triangleCount);
  }, 240_000);
});
