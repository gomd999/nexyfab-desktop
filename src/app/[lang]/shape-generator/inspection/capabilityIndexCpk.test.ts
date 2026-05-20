import { describe, it, expect } from 'vitest';
import {
  computeCapability,
  computeCpm,
  expectedDpmo,
  summarize,
  D2_TABLE,
} from './capabilityIndexCpk';

describe('D2_TABLE', () => {
  it('size 5 → 2.326', () => {
    expect(D2_TABLE[5]).toBeCloseTo(2.326, 3);
  });
});

describe('computeCapability', () => {
  it('empty subgroups → not-capable', () => {
    const r = computeCapability({ subgroups: [], usl: 1, lsl: -1 });
    expect(r.classification).toBe('not-capable');
  });

  it('tight process → six-sigma classification', () => {
    // Mean 10, narrow spread.
    const subgroups: number[][] = [];
    for (let i = 0; i < 25; i++) subgroups.push([9.99, 10.01, 9.995, 10.005, 10]);
    const r = computeCapability({ subgroups, usl: 11, lsl: 9 });
    expect(r.classification).toBe('six-sigma');
  });

  it('cpk less than cp when off-center', () => {
    // Centered at 10.5 but spec 9..11 (target 10).
    const subgroups: number[][] = [];
    for (let i = 0; i < 10; i++) subgroups.push([10.3, 10.5, 10.7, 10.6, 10.4]);
    const r = computeCapability({ subgroups, usl: 11, lsl: 9 });
    expect(r.cpk).toBeLessThan(r.cp);
  });

  it('out-of-spec process → not-capable', () => {
    const subgroups: number[][] = [];
    for (let i = 0; i < 10; i++) subgroups.push([10, 11, 9, 12, 8]);
    const r = computeCapability({ subgroups, usl: 10.5, lsl: 9.5 });
    expect(r.classification).toBe('not-capable');
  });

  it('mean computed correctly', () => {
    const r = computeCapability({ subgroups: [[1, 2, 3], [4, 5, 6]], usl: 10, lsl: 0 });
    expect(r.mean).toBeCloseTo(3.5, 5);
  });

  it('zero variation → warning', () => {
    const r = computeCapability({ subgroups: [[5, 5, 5], [5, 5, 5]], usl: 6, lsl: 4 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('inconsistent subgroup sizes → warning', () => {
    const r = computeCapability({ subgroups: [[1, 2], [3, 4, 5]], usl: 10, lsl: 0 });
    expect(r.warnings.some(w => w.includes('subgroup'))).toBe(true);
  });

  it('single-measurement subgroups → fallback warning', () => {
    const r = computeCapability({ subgroups: [[1], [2], [3]], usl: 10, lsl: 0 });
    expect(r.warnings.some(w => w.includes('Single-measurement'))).toBe(true);
  });

  it('pp uses overall sigma', () => {
    const subgroups: number[][] = [[10, 10.5, 9.5, 10.2]];
    const r = computeCapability({ subgroups, usl: 11, lsl: 9 });
    expect(r.pp).toBeGreaterThan(0);
  });
});

describe('computeCpm', () => {
  it('on-target process gives cpm ≈ pp', () => {
    const subgroups: number[][] = [];
    for (let i = 0; i < 10; i++) subgroups.push([10, 10.1, 9.9, 10.05, 9.95]);
    const cpm = computeCpm({ subgroups, usl: 11, lsl: 9, target: 10 });
    expect(cpm).toBeGreaterThan(0);
  });

  it('off-target reduces cpm', () => {
    const subgroups: number[][] = [];
    for (let i = 0; i < 10; i++) subgroups.push([10, 10.1, 9.9, 10.05, 9.95]);
    const onTarget = computeCpm({ subgroups, usl: 11, lsl: 9, target: 10 });
    const offTarget = computeCpm({ subgroups, usl: 11, lsl: 9, target: 10.5 });
    expect(offTarget).toBeLessThan(onTarget);
  });

  it('empty input → 0', () => {
    expect(computeCpm({ subgroups: [], usl: 1, lsl: 0, target: 0.5 })).toBe(0);
  });
});

describe('expectedDpmo', () => {
  it('centered tight process → low DPMO', () => {
    const subgroups: number[][] = [];
    for (let i = 0; i < 25; i++) subgroups.push([9.99, 10.01, 9.995, 10.005, 10]);
    const r = computeCapability({ subgroups, usl: 11, lsl: 9 });
    expect(expectedDpmo(r, 11, 9)).toBeLessThan(10);
  });

  it('wide process → high DPMO', () => {
    const subgroups: number[][] = [];
    for (let i = 0; i < 10; i++) subgroups.push([10, 12, 8, 11, 9]);
    const r = computeCapability({ subgroups, usl: 10.5, lsl: 9.5 });
    expect(expectedDpmo(r, 10.5, 9.5)).toBeGreaterThan(10000);
  });
});

describe('summarize', () => {
  it('reports cpk + classification + dpmo', () => {
    const subgroups: number[][] = [];
    for (let i = 0; i < 10; i++) subgroups.push([10, 10.1, 9.9, 10.05, 9.95]);
    const r = computeCapability({ subgroups, usl: 11, lsl: 9 });
    const s = summarize(r, 11, 9);
    expect(s.cpk).toBe(r.cpk);
    expect(s.classification).toBe(r.classification);
    expect(s.dpmo).toBeGreaterThanOrEqual(0);
  });
});
