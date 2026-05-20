import { describe, it, expect } from 'vitest';
import { computeModes } from './modalAnalysis';

describe('computeModes', () => {
  it('returns empty for empty input', () => {
    const r = computeModes({ stiffness: [], massDiag: [], modeCount: 1 });
    expect(r).toEqual([]);
  });

  it('1-DOF spring-mass: f = 1/(2π) × √(k/m)', () => {
    // K = 100, M = 1 → ω = 10, f ≈ 1.5915 Hz
    const r = computeModes({ stiffness: [100], massDiag: [1], modeCount: 1 });
    expect(r).toHaveLength(1);
    expect(r[0]!.frequencyHz).toBeCloseTo(10 / (2 * Math.PI), 2);
  });

  it('2-DOF system: first mode lower than second', () => {
    // K = [[2, -1], [-1, 2]], M = diag(1, 1)
    // Eigenvalues: λ1=1, λ2=3 → f1 < f2.
    const r = computeModes({
      stiffness: [2, -1, -1, 2],
      massDiag: [1, 1],
      modeCount: 2,
    });
    expect(r[0]!.frequencyHz).toBeLessThan(r[1]!.frequencyHz);
  });

  it('mode-shape vector is unit-mass-normalized', () => {
    const r = computeModes({ stiffness: [100], massDiag: [4], modeCount: 1 });
    const v = r[0]!.vector;
    const massNorm = v.reduce((s, vi, i) => s + vi * vi * [4][i]!, 0);
    expect(massNorm).toBeCloseTo(1, 3);
  });

  it('frequencies are non-negative', () => {
    const r = computeModes({
      stiffness: [100, -50, -50, 100],
      massDiag: [1, 1],
      modeCount: 2,
    });
    for (const m of r) {
      expect(m.frequencyHz).toBeGreaterThanOrEqual(0);
    }
  });

  it('respects mode count', () => {
    const r = computeModes({
      stiffness: [4, -1, 0, -1, 4, -1, 0, -1, 4],
      massDiag: [1, 1, 1],
      modeCount: 3,
    });
    expect(r).toHaveLength(3);
  });
});
