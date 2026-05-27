import { describe, it, expect } from 'vitest';
import {
  sensitivityAnalysis,
  computeYield,
  compareDistributions,
  analyzeStackupFull,
} from './toleranceStackupStage2';
import type { StackupChain } from './toleranceStackup';

const chainAB: StackupChain = {
  links: [
    { name: 'A', nominalMm: 10, tolPlusMm: 0.1, tolMinusMm: 0.1, direction: 1 },
    { name: 'B', nominalMm: 20, tolPlusMm: 0.3, tolMinusMm: 0.3, direction: 1 },
  ],
};

describe('sensitivityAnalysis', () => {
  it('returns one row per link', () => {
    const r = sensitivityAnalysis(chainAB);
    expect(r.contributions).toHaveLength(2);
  });

  it('larger tolerance dominates variance', () => {
    const r = sensitivityAnalysis(chainAB);
    expect(r.contributions[0]!.linkName).toBe('B');
    expect(r.contributions[0]!.percentContribution).toBeGreaterThan(80);
  });

  it('percent contributions sum to 100', () => {
    const r = sensitivityAnalysis(chainAB);
    const sum = r.contributions.reduce((s, c) => s + c.percentContribution, 0);
    expect(sum).toBeCloseTo(100, 4);
  });

  it('equal tolerances → equal contribution', () => {
    const chain: StackupChain = {
      links: [
        { name: 'A', nominalMm: 10, tolPlusMm: 0.2, tolMinusMm: 0.2, direction: 1 },
        { name: 'B', nominalMm: 10, tolPlusMm: 0.2, tolMinusMm: 0.2, direction: 1 },
      ],
    };
    const r = sensitivityAnalysis(chain);
    expect(r.contributions[0]!.percentContribution).toBeCloseTo(50, 4);
    expect(r.contributions[1]!.percentContribution).toBeCloseTo(50, 4);
  });
});

describe('computeYield', () => {
  it('mean centered in spec, σ small → high yield', () => {
    const r = computeYield(10, 0.05, { lsl: 9.5, usl: 10.5 });
    expect(r.yieldFraction).toBeGreaterThan(0.999999);
    expect(r.dpmo).toBeLessThan(1);
  });

  it('mean centered, σ = window/3 → ~99.73% yield (3σ)', () => {
    const r = computeYield(10, 1 / 3, { lsl: 9, usl: 11 });
    expect(r.yieldFraction).toBeCloseTo(0.9973, 3);
  });

  it('zero sigma — in-spec mean = 100% yield', () => {
    const r = computeYield(10, 0, { lsl: 9, usl: 11 });
    expect(r.yieldFraction).toBe(1);
    expect(r.dpmo).toBe(0);
  });

  it('zero sigma — out-of-spec mean = 0% yield', () => {
    const r = computeYield(20, 0, { lsl: 9, usl: 11 });
    expect(r.yieldFraction).toBe(0);
    expect(r.dpmo).toBe(1_000_000);
  });

  it('long-term sigma = short-term - 1.5', () => {
    const r = computeYield(10, 0.1, { lsl: 9, usl: 11 });
    expect(r.sigmaLevelLongTerm).toBeCloseTo(r.sigmaLevelShortTerm - 1.5, 5);
  });
});

describe('compareDistributions', () => {
  it('all 3 distributions return a sigma value', () => {
    const r = compareDistributions(chainAB, 2000);
    expect(r.normalResult.sigmaMm).toBeGreaterThan(0);
    expect(r.uniformResult.sigmaMm).toBeGreaterThan(0);
    expect(r.triangularResult.sigmaMm).toBeGreaterThan(0);
  });

  it('uniform gives largest sigma (most variance)', () => {
    const r = compareDistributions(chainAB, 5000);
    // For uniform on ±t: var = t²/3, for triangular: t²/6, normal (3σ=t): t²/9.
    expect(r.uniformResult.sigmaMm).toBeGreaterThan(r.triangularResult.sigmaMm);
    expect(r.triangularResult.sigmaMm).toBeGreaterThan(r.normalResult.sigmaMm);
  });

  it('sigma spread reported', () => {
    const r = compareDistributions(chainAB, 2000);
    expect(r.sigmaSpreadMm).toBeGreaterThan(0);
  });
});

describe('analyzeStackupFull', () => {
  it('returns sensitivity + distribution comparison + topContributors', () => {
    const r = analyzeStackupFull(chainAB, { lsl: 29, usl: 31 }, 2000);
    expect(r.sensitivity.contributions).toHaveLength(2);
    expect(r.distributionComparison.normalResult.sigmaMm).toBeGreaterThan(0);
    expect(r.topContributors[0]!.linkName).toBe('B');
  });

  it('yieldResult null when no spec given', () => {
    const r = analyzeStackupFull(chainAB, null, 2000);
    expect(r.yieldResult).toBeNull();
  });

  it('yieldResult populated when spec given', () => {
    const r = analyzeStackupFull(chainAB, { lsl: 29, usl: 31 }, 5000);
    expect(r.yieldResult).not.toBeNull();
    expect(r.yieldResult!.yieldFraction).toBeGreaterThan(0);
  });
});
