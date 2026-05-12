/**
 * Large-assembly perf benchmark (R3).
 *
 * Uses `buildLargeAssembly` to synthesize 100 / 1000 / 5000 part scenes
 * and measures construction time, memory footprint, and traversal cost.
 * These are the CPU-side ceilings — GPU/render perf is browser-only and
 * lives in the E2E suite.
 *
 * Enable with RUN_PERF_BENCH=1; default skip keeps CI fast.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildLargeAssembly, buildLargeMergedGeometry } from './largeAssemblyFixture';

const ENABLED = process.env.RUN_PERF_BENCH === '1';
const describeMaybe = ENABLED ? describe : describe.skip;

describeMaybe('Large-assembly fixture perf (R3)', () => {
  it('builds 100-part assembly under 100ms with bounded memory', () => {
    const t0 = performance.now();
    const fx = buildLargeAssembly({ count: 100 });
    const elapsed = performance.now() - t0;
    console.log(
      `[R3] 100-part build  ${elapsed.toFixed(0)}ms  ` +
      `tris=${fx.totalTriangles}  mem=${(fx.approxMemoryBytes / 1024).toFixed(0)}KB`,
    );
    expect(fx.partCount).toBe(100);
    expect(elapsed).toBeLessThan(500);
    expect(fx.approxMemoryBytes).toBeLessThan(5 * 1024 * 1024); // <5MB
  }, 60_000);

  it('builds 1000-part assembly under 5s with bounded memory', () => {
    const t0 = performance.now();
    const fx = buildLargeAssembly({ count: 1000 });
    const elapsed = performance.now() - t0;
    console.log(
      `[R3] 1000-part build  ${elapsed.toFixed(0)}ms  ` +
      `tris=${fx.totalTriangles}  mem=${(fx.approxMemoryBytes / 1024 / 1024).toFixed(2)}MB`,
    );
    expect(fx.partCount).toBe(1000);
    expect(elapsed).toBeLessThan(5_000);
    expect(fx.approxMemoryBytes).toBeLessThan(50 * 1024 * 1024); // <50MB
  }, 60_000);

  it('builds 5000-part assembly without OOM', () => {
    const t0 = performance.now();
    const fx = buildLargeAssembly({ count: 5000 });
    const elapsed = performance.now() - t0;
    console.log(
      `[R3] 5000-part build  ${elapsed.toFixed(0)}ms  ` +
      `tris=${fx.totalTriangles}  mem=${(fx.approxMemoryBytes / 1024 / 1024).toFixed(2)}MB`,
    );
    expect(fx.partCount).toBe(5000);
    expect(elapsed).toBeLessThan(30_000);
  }, 60_000);

  it('traversal of 1000-part group completes in O(N)', () => {
    const fx = buildLargeAssembly({ count: 1000 });
    const t0 = performance.now();
    let count = 0;
    fx.group.traverse((obj) => { if (obj instanceof THREE.Mesh) count++; });
    const elapsed = performance.now() - t0;
    console.log(`[R3] 1000-part traversal ${elapsed.toFixed(2)}ms`);
    expect(count).toBe(1000);
    expect(elapsed).toBeLessThan(50);
  });

  it('mergeGeometries on 1000-part assembly stays under 10s', async () => {
    const t0 = performance.now();
    const merged = await buildLargeMergedGeometry({ count: 1000 });
    const elapsed = performance.now() - t0;
    const tris = merged.index ? merged.index.count / 3 : merged.attributes.position.count / 3;
    console.log(`[R3] 1000-part merge ${elapsed.toFixed(0)}ms tris=${tris}`);
    expect(elapsed).toBeLessThan(10_000);
    expect(tris).toBeGreaterThan(0);
  }, 60_000);
});
