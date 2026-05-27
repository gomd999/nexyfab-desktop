import { describe, it, expect } from 'vitest';
import {
  meanStd,
  processCapability,
  xbarRChart,
  ruleOnePointOutside,
  ruleEightConsecutive,
  type Measurement,
} from './spc';

describe('meanStd', () => {
  it('returns 0 / 0 for empty array', () => {
    expect(meanStd([])).toEqual({ mean: 0, sigma: 0 });
  });

  it('returns mean only for single value', () => {
    expect(meanStd([5])).toEqual({ mean: 5, sigma: 0 });
  });

  it('uses sample (n-1) variance', () => {
    const r = meanStd([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(r.mean).toBeCloseTo(5, 6);
    // Sample sigma = sqrt(32/7) ≈ 2.138 — that is, n-1 normalisation.
    // (Population sigma would be sqrt(32/8) = 2 exactly.)
    expect(r.sigma).toBeCloseTo(Math.sqrt(32 / 7), 6);
  });
});

describe('processCapability', () => {
  it('returns infinite Cpk for zero sigma', () => {
    const r = processCapability([5, 5, 5, 5], { lsl: 4, usl: 6 });
    expect(r.cp).toBe(Infinity);
    expect(r.cpk).toBe(Infinity);
    expect(r.isCapable).toBe(true);
  });

  it('Cp = Cpk when centered', () => {
    // mean exactly at midpoint between LSL=4 and USL=6.
    const r = processCapability([4.9, 5.0, 5.1, 5.0, 4.95, 5.05, 5.0, 5.0], { lsl: 4, usl: 6 });
    expect(r.cp).toBeCloseTo(r.cpk, 1);
  });

  it('marks process incapable when sigma is too large', () => {
    // Spec ±0.5, sigma ~0.4 → Cpk far below 1.33.
    const r = processCapability([4.6, 4.9, 5.3, 5.5, 4.7, 5.1, 5.4, 4.4], { lsl: 4.5, usl: 5.5 });
    expect(r.isCapable).toBe(false);
  });

  it('off-center process has Cpk < Cp', () => {
    // mean far from midpoint.
    const vals = Array.from({ length: 30 }, (_, i) => 5.5 + 0.05 * Math.sin(i));
    const r = processCapability(vals, { lsl: 4, usl: 6 });
    expect(r.cpk).toBeLessThan(r.cp);
  });
});

describe('xbarRChart', () => {
  function makeSubgroups(numGroups: number, n: number, mean: number, spread: number): Measurement[] {
    const out: Measurement[] = [];
    for (let g = 0; g < numGroups; g++) {
      for (let i = 0; i < n; i++) {
        out.push({
          subgroupId: `g${g}`,
          value: mean + (Math.random() - 0.5) * spread,
        });
      }
    }
    return out;
  }

  it('returns empty result for no data', () => {
    const r = xbarRChart([]);
    expect(r.subgroups).toHaveLength(0);
    expect(r.inControl).toBe(true);
  });

  it('groups by subgroupId', () => {
    const r = xbarRChart(makeSubgroups(5, 4, 10, 0.5));
    expect(r.subgroups).toHaveLength(5);
  });

  it('UCL > centerLine > LCL', () => {
    const r = xbarRChart(makeSubgroups(20, 5, 10, 0.2));
    expect(r.xbarLimits.upperControlLimit).toBeGreaterThan(r.xbarLimits.centerLine);
    expect(r.xbarLimits.centerLine).toBeGreaterThan(r.xbarLimits.lowerControlLimit);
  });

  it('flags out-of-control subgroup', () => {
    // 19 stable groups + 1 wildly out-of-spec group.
    const data: Measurement[] = makeSubgroups(19, 4, 10, 0.1);
    for (let i = 0; i < 4; i++) data.push({ subgroupId: 'rogue', value: 50 });
    const r = xbarRChart(data);
    expect(r.outOfControlPoints).toContain('rogue');
    expect(r.inControl).toBe(false);
  });
});

describe('Western Electric rules', () => {
  it('rule 1 flags points beyond ±3σ', () => {
    const vals = [10, 10, 10, 10, 20, 10, 10];
    expect(ruleOnePointOutside(vals, 10, 1)).toEqual([4]);
  });

  it('rule 1 ignores points within ±3σ', () => {
    const vals = [10, 11, 9, 10.5, 9.5];
    expect(ruleOnePointOutside(vals, 10, 1)).toEqual([]);
  });

  it('rule 4 flags 8 consecutive above center', () => {
    const vals = [11, 12, 13, 11, 12, 11, 12, 13];
    const r = ruleEightConsecutive(vals, 10);
    expect(r).toContain(7);
  });

  it('rule 4 resets streak on side flip', () => {
    const vals = [11, 12, 11, 12, 9, 11, 12, 11];
    const r = ruleEightConsecutive(vals, 10);
    expect(r).toEqual([]);
  });
});
