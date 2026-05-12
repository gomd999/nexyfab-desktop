/**
 * Ω1 — Topology optimizer tests.
 *
 * Pin contract: candidateCount candidates produced, Pareto front
 * filters by maxStressMPa, voxelMask shape correct, mass scales with
 * removalFraction.
 */

import { describe, it, expect } from 'vitest';
import { optimizeTopology, type TopOptInput } from '../topologyOptimizer';

const baseInput = (over: Partial<TopOptInput> = {}): TopOptInput => ({
  domain: { w: 100, h: 100, d: 50 },
  resolution: 8,  // 512 voxels — fast enough for tests
  material: 'aluminum_6061',
  maxStressMPa: 200,
  loads: [{ location: [50, 50, 50], force: [0, 0, -100] }],
  supports: [{ location: [50, 50, 0] }],
  candidateCount: 4,
  seed: 42,
  ...over,
});

describe('optimizeTopology', () => {
  it('produces requested candidate count', () => {
    const r = optimizeTopology(baseInput());
    expect(r.candidates).toHaveLength(4);
  });

  it('voxel mask length = resolution³', () => {
    const r = optimizeTopology(baseInput({ resolution: 8 }));
    for (const c of r.candidates) {
      expect(c.voxelMask.length).toBe(512);
    }
  });

  it('mass decreases as removalFraction increases', () => {
    const r = optimizeTopology(baseInput({ candidateCount: 4 }));
    const sorted = r.candidates.slice().sort((a, b) => a.removalFraction - b.removalFraction);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].massG).toBeLessThanOrEqual(sorted[i - 1].massG);
    }
  });

  it('Pareto front filters out infeasible candidates', () => {
    const r = optimizeTopology(baseInput({ maxStressMPa: 0.001 }));  // impossibly tight
    expect(r.paretoFront).toHaveLength(0);
    expect(r.notes).toMatch(/No candidate met/);
  });

  it('Pareto front sorted by mass ascending', () => {
    const r = optimizeTopology(baseInput({ maxStressMPa: 1e9 }));  // accept all
    const massesInOrder = r.paretoFront.map(id => r.candidates.find(c => c.id === id)!.massG);
    for (let i = 1; i < massesInOrder.length; i++) {
      expect(massesInOrder[i]).toBeGreaterThanOrEqual(massesInOrder[i - 1]);
    }
  });

  it('safetyFactor = yield / maxStressMPa per candidate', () => {
    const r = optimizeTopology(baseInput({ maxStressMPa: 1e9 }));
    for (const c of r.candidates) {
      expect(c.safetyFactor).toBeCloseTo(276 / c.maxStressMPa, 3);
    }
  });

  it('different seeds produce some candidate variation', () => {
    const r1 = optimizeTopology(baseInput({ seed: 1, candidateCount: 6 }));
    const r2 = optimizeTopology(baseInput({ seed: 999, candidateCount: 6 }));
    // At least one candidate's mask should differ across seeds (the random
    // shuffle window biases mid-removal candidates more than extremes).
    const anyDiffer = r1.candidates.some((c, i) => {
      const m1 = Array.from(c.voxelMask).join('');
      const m2 = Array.from(r2.candidates[i].voxelMask).join('');
      return m1 !== m2;
    });
    expect(anyDiffer).toBe(true);
  });

  it('throws on unknown material', () => {
    expect(() => optimizeTopology(baseInput({ material: 'unobtainium' as unknown as TopOptInput['material'] })))
      .toThrow(/unknown material/);
  });

  it('respects candidateCount cap (max 8)', () => {
    const r = optimizeTopology(baseInput({ candidateCount: 50 }));
    expect(r.candidates.length).toBeLessThanOrEqual(8);
  });
});
