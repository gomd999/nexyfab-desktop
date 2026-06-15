/**
 * toleranceStackup — closed-form validation of the worst-case + RSS stack-up.
 * The worst-case formula previously summed |tp|+|tm|, doubling a symmetric ±t
 * into ±2t and mishandling asymmetric tolerances; these tests pin the correct
 * arithmetic (worst-case = Σ bounds, RSS = √Σ half-range²).
 */
import { describe, it, expect } from 'vitest';
import { computeStackup, monteCarloStackup, type ToleranceDimension } from './toleranceStackup';

const dim = (
  id: string, nominal: number, tolerancePlus: number, toleranceMinus: number,
  direction: 1 | -1 = 1, distribution: 'uniform' | 'normal' = 'normal',
): ToleranceDimension => ({ id, name: id, nominal, tolerancePlus, toleranceMinus, direction, distribution });

describe('computeStackup — worst case', () => {
  it('a single symmetric ±0.1 dimension is ±0.1, not ±0.2', () => {
    const r = computeStackup([dim('a', 10, 0.1, -0.1)]);
    expect(r.nominal).toBeCloseTo(10, 9);
    expect(r.worstCaseMax).toBeCloseTo(10.1, 9);
    expect(r.worstCaseMin).toBeCloseTo(9.9, 9);
  });

  it('two ±0.1 dimensions sum to ±0.2 worst case', () => {
    const r = computeStackup([dim('a', 10, 0.1, -0.1), dim('b', 10, 0.1, -0.1)]);
    expect(r.nominal).toBeCloseTo(20, 9);
    expect(r.worstCaseMax).toBeCloseTo(20.2, 9);
    expect(r.worstCaseMin).toBeCloseTo(19.8, 9);
  });

  it('asymmetric +0.2 / −0.05 keeps the bounds distinct', () => {
    const r = computeStackup([dim('a', 10, 0.2, -0.05)]);
    expect(r.worstCaseMax).toBeCloseTo(10.2, 9);
    expect(r.worstCaseMin).toBeCloseTo(9.95, 9);
  });

  it('a subtracted (direction −1) dimension still widens both bounds', () => {
    // 10 − 5±0.1: nominal 5, the subtracted part's ±0.1 adds to worst case.
    const r = computeStackup([dim('a', 10, 0.1, -0.1), dim('b', 5, 0.1, -0.1, -1)]);
    expect(r.nominal).toBeCloseTo(5, 9);
    expect(r.worstCaseMax).toBeCloseTo(5.2, 9);
    expect(r.worstCaseMin).toBeCloseTo(4.8, 9);
  });

  it('empty chain → all zero', () => {
    const r = computeStackup([]);
    expect(r.nominal).toBe(0);
    expect(r.worstCaseMax).toBe(0);
  });
});

describe('computeStackup — RSS', () => {
  it('RSS half-range is √(Σ half-range²): three ±0.1 → 0.1·√3', () => {
    const r = computeStackup([dim('a', 10, 0.1, -0.1), dim('b', 10, 0.1, -0.1), dim('c', 10, 0.1, -0.1)]);
    const expectedHalf = 0.1 * Math.sqrt(3);
    expect(r.rssMax - r.nominal).toBeCloseTo(expectedHalf, 6);
    expect(r.nominal - r.rssMin).toBeCloseTo(expectedHalf, 6);
    // RSS band is tighter than worst case (0.1√3 ≈ 0.173 < 0.3).
    expect(r.rssMax).toBeLessThan(r.worstCaseMax);
  });

  it('flags the largest-tolerance dimension as critical', () => {
    const r = computeStackup([dim('small', 10, 0.05, -0.05), dim('big', 10, 0.3, -0.3)]);
    expect(r.criticalDimension).toBe('big');
  });
});

describe('monteCarloStackup', () => {
  it('mean ≈ nominal and std ≈ RSS/3 for normal dimensions', () => {
    const dims = [dim('a', 10, 0.1, -0.1), dim('b', 10, 0.1, -0.1)];
    const mc = monteCarloStackup(dims, 20000);
    expect(mc.mean).toBeCloseTo(20, 1);
    // each normal dim: σ = 0.1/3; stack σ = √(2)·0.1/3 ≈ 0.0471.
    const expectedSigma = Math.sqrt(2) * 0.1 / 3;
    expect(mc.stdDev).toBeCloseTo(expectedSigma, 2);
    expect(mc.histogram.reduce((s, h) => s + h, 0)).toBe(20000);
  });
});
