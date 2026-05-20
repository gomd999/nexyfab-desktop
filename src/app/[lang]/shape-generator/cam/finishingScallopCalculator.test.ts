import { describe, it, expect } from 'vitest';
import {
  calcScallop,
  stepOverForScallop,
  recommendStepOvers,
  summarize,
} from './finishingScallopCalculator';

describe('calcScallop', () => {
  it('zero step-over → zero scallop', () => {
    const r = calcScallop({ toolRadiusMm: 5, stepOverMm: 0 });
    expect(r.scallopHeightMm).toBe(0);
  });

  it('step-over equal to tool radius gives non-trivial scallop', () => {
    const r = calcScallop({ toolRadiusMm: 5, stepOverMm: 2 });
    // h = 5 − √(25 − 1) ≈ 0.101
    expect(r.scallopHeightMm).toBeCloseTo(5 - Math.sqrt(24), 3);
  });

  it('tolerance pass marks ok', () => {
    const r = calcScallop({ toolRadiusMm: 5, stepOverMm: 1 }, 0.1);
    expect(r.withinTolerance).toBe(true);
  });

  it('tolerance fail marks not ok', () => {
    const r = calcScallop({ toolRadiusMm: 1, stepOverMm: 1.5 }, 0.001);
    expect(r.withinTolerance).toBe(false);
  });

  it('step-over ≥ diameter → cusp = full radius', () => {
    const r = calcScallop({ toolRadiusMm: 5, stepOverMm: 20 });
    expect(r.scallopHeightMm).toBe(5);
  });

  it('convex curvature reduces effective radius', () => {
    const flat = calcScallop({ toolRadiusMm: 5, stepOverMm: 2 });
    const convex = calcScallop({ toolRadiusMm: 5, stepOverMm: 2, surfaceCurvatureKmm: 0.05 });
    expect(convex.scallopHeightMm).toBeGreaterThan(flat.scallopHeightMm);
  });
});

describe('stepOverForScallop', () => {
  it('zero target → zero step-over', () => {
    expect(stepOverForScallop({ toolRadiusMm: 5, targetScallopMm: 0 })).toBe(0);
  });

  it('round-trip: stepOver → scallop → stepOver', () => {
    const target = 0.01;
    const s = stepOverForScallop({ toolRadiusMm: 5, targetScallopMm: target });
    const back = calcScallop({ toolRadiusMm: 5, stepOverMm: s });
    expect(back.scallopHeightMm).toBeCloseTo(target, 4);
  });

  it('larger tool → larger step-over for same scallop', () => {
    const small = stepOverForScallop({ toolRadiusMm: 3, targetScallopMm: 0.01 });
    const big = stepOverForScallop({ toolRadiusMm: 10, targetScallopMm: 0.01 });
    expect(big).toBeGreaterThan(small);
  });
});

describe('recommendStepOvers', () => {
  it('returns 5 entries', () => {
    const recs = recommendStepOvers(5);
    expect(recs).toHaveLength(5);
  });

  it('larger Ra → larger step-over', () => {
    const recs = recommendStepOvers(5);
    expect(recs[recs.length - 1]!.stepOverMm).toBeGreaterThan(recs[0]!.stepOverMm);
  });
});

describe('summarize', () => {
  it('reports height + radius', () => {
    const r = calcScallop({ toolRadiusMm: 5, stepOverMm: 1 });
    const s = summarize(r);
    expect(s.scallopHeightMm).toBeCloseTo(r.scallopHeightMm, 6);
  });
});
