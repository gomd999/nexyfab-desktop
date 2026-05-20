import { describe, it, expect } from 'vitest';
import {
  evaluate,
  autoPair,
  summarize,
  type OpposedPair,
} from './symmetryEvaluator';

// Datum plane = YZ plane (normal +X). Symmetric slot: points at ±a → median on plane.
function symmetricPairs(a: number, n = 4): OpposedPair[] {
  const pairs: OpposedPair[] = [];
  for (let i = 0; i < n; i++) {
    pairs.push({ pointA: { x: a, y: i * 10, z: 0 }, pointB: { x: -a, y: i * 10, z: 0 } });
  }
  return pairs;
}

// Offset: both points shifted by e → median offset by e.
function offsetPairs(a: number, e: number, n = 4): OpposedPair[] {
  const pairs: OpposedPair[] = [];
  for (let i = 0; i < n; i++) {
    pairs.push({ pointA: { x: a + e, y: i * 10, z: 0 }, pointB: { x: -a + e, y: i * 10, z: 0 } });
  }
  return pairs;
}

describe('evaluate', () => {
  it('symmetric feature → near-zero symmetry zone', () => {
    const r = evaluate({ pairs: symmetricPairs(10), toleranceMm: 0.05 });
    expect(r.symmetryMm).toBeCloseTo(0, 6);
    expect(r.passed).toBe(true);
  });

  it('uniformly offset median → zone still small (all shifted equally)', () => {
    // All medians offset by same e → max=min=e → zone = 0 (symmetry zone straddles, but spread is 0)
    const r = evaluate({ pairs: offsetPairs(10, 0.05), toleranceMm: 0.2 });
    expect(r.symmetryMm).toBeCloseTo(0, 6);
    expect(r.maxMedianOffsetMm).toBeCloseTo(0.05, 5);
  });

  it('varying median offsets → nonzero zone', () => {
    const pairs: OpposedPair[] = [
      { pointA: { x: 10, y: 0, z: 0 }, pointB: { x: -10, y: 0, z: 0 } },   // median 0
      { pointA: { x: 10.2, y: 10, z: 0 }, pointB: { x: -9.8, y: 10, z: 0 } }, // median 0.2
    ];
    const r = evaluate({ pairs, toleranceMm: 1 });
    expect(r.symmetryMm).toBeCloseTo(0.2, 5);
  });

  it('exceeds tolerance → fail', () => {
    const pairs: OpposedPair[] = [
      { pointA: { x: 10, y: 0, z: 0 }, pointB: { x: -10, y: 0, z: 0 } },
      { pointA: { x: 11, y: 10, z: 0 }, pointB: { x: -9, y: 10, z: 0 } }, // median 1
    ];
    const r = evaluate({ pairs, toleranceMm: 0.5 });
    expect(r.passed).toBe(false);
  });

  it('worst pair index identified', () => {
    const pairs: OpposedPair[] = [
      { pointA: { x: 10, y: 0, z: 0 }, pointB: { x: -10, y: 0, z: 0 } },
      { pointA: { x: 12, y: 10, z: 0 }, pointB: { x: -8, y: 10, z: 0 } }, // median 2
    ];
    const r = evaluate({ pairs, toleranceMm: 5 });
    expect(r.worstPairIndex).toBe(1);
  });

  it('empty pairs → warning', () => {
    const r = evaluate({ pairs: [], toleranceMm: 0.1 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('zone = max − min', () => {
    const pairs: OpposedPair[] = [
      { pointA: { x: 10.1, y: 0, z: 0 }, pointB: { x: -10, y: 0, z: 0 } }, // 0.05
      { pointA: { x: 9.9, y: 10, z: 0 }, pointB: { x: -10, y: 10, z: 0 } }, // -0.05
    ];
    const r = evaluate({ pairs, toleranceMm: 1 });
    expect(r.symmetryMm).toBeCloseTo(r.maxMedianOffsetMm - r.minMedianOffsetMm, 6);
  });
});

describe('autoPair', () => {
  it('mirrors side-A and matches nearest side-B', () => {
    const sideA = [{ x: 10, y: 0, z: 0 }];
    const sideB = [{ x: -10, y: 0, z: 0 }];
    const pairs = autoPair(sideA, sideB, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.pointB.x).toBe(-10);
  });

  it('does not reuse a side-B point', () => {
    const sideA = [{ x: 10, y: 0, z: 0 }, { x: 10, y: 1, z: 0 }];
    const sideB = [{ x: -10, y: 0, z: 0 }, { x: -10, y: 1, z: 0 }];
    const pairs = autoPair(sideA, sideB, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(pairs).toHaveLength(2);
    expect(pairs[0]!.pointB).not.toEqual(pairs[1]!.pointB);
  });
});

describe('summarize', () => {
  it('reports pass + symmetry', () => {
    const r = evaluate({ pairs: symmetricPairs(10), toleranceMm: 0.05 });
    const s = summarize(r);
    expect(s.passed).toBe(r.passed);
    expect(s.symmetryMm).toBe(r.symmetryMm);
  });
});
