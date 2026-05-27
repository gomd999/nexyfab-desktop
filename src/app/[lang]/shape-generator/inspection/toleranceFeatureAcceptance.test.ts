import { describe, it, expect } from 'vitest';
import {
  evaluateAcceptance,
  rollup,
  worstFeatures,
  summarize,
  type FeatureMeasurement,
} from './toleranceFeatureAcceptance';

function bilateral(id: string, measured: number, nominal: number, tol: number): FeatureMeasurement {
  return {
    id,
    spec: { kind: 'bilateral', nominalMm: nominal, plusMm: tol, minusMm: tol },
    measuredMm: measured,
  };
}

function position(id: string, deviation: number, zone: number): FeatureMeasurement {
  return {
    id,
    spec: { kind: 'position', positionZoneDiameterMm: zone },
    positionDeviationMm: deviation,
  };
}

function flatness(id: string, form: number, max: number): FeatureMeasurement {
  return {
    id,
    spec: { kind: 'form-flatness', formMaxMm: max },
    formMm: form,
  };
}

describe('evaluateAcceptance', () => {
  it('empty → empty', () => {
    expect(evaluateAcceptance([])).toEqual([]);
  });

  it('bilateral on-nominal → pass', () => {
    const r = evaluateAcceptance([bilateral('f1', 10, 10, 0.1)]);
    expect(r[0]!.decision).toBe('pass');
  });

  it('bilateral out of spec → fail', () => {
    const r = evaluateAcceptance([bilateral('f1', 10.5, 10, 0.1)]);
    expect(r[0]!.decision).toBe('fail');
  });

  it('bilateral in warn band → marginal', () => {
    const r = evaluateAcceptance([bilateral('f1', 10.09, 10, 0.1)]);
    expect(r[0]!.decision).toBe('marginal');
  });

  it('position deviation within zone → pass', () => {
    const r = evaluateAcceptance([position('f1', 0.01, 0.2)]);
    expect(r[0]!.decision).toBe('pass');
  });

  it('position deviation outside zone → fail', () => {
    const r = evaluateAcceptance([position('f1', 0.5, 0.2)]);
    expect(r[0]!.decision).toBe('fail');
  });

  it('position deviation in warn band → marginal', () => {
    const r = evaluateAcceptance([position('f1', 0.095, 0.2)]);
    expect(r[0]!.decision).toBe('marginal');
  });

  it('flatness within spec → pass', () => {
    const r = evaluateAcceptance([flatness('f1', 0.01, 0.05)]);
    expect(r[0]!.decision).toBe('pass');
  });

  it('flatness over spec → fail', () => {
    const r = evaluateAcceptance([flatness('f1', 0.1, 0.05)]);
    expect(r[0]!.decision).toBe('fail');
  });

  it('toleranceWidth reported', () => {
    const r = evaluateAcceptance([bilateral('f1', 10, 10, 0.1)]);
    expect(r[0]!.toleranceWidthMm).toBeCloseTo(0.2, 5);
  });

  it('reason text non-empty', () => {
    const r = evaluateAcceptance([bilateral('f1', 10, 10, 0.1)]);
    expect(r[0]!.reason.length).toBeGreaterThan(0);
  });
});

describe('rollup', () => {
  it('acceptance rate counts pass + marginal', () => {
    const r = evaluateAcceptance([
      bilateral('f1', 10, 10, 0.1),
      bilateral('f2', 10.5, 10, 0.1),
    ]);
    expect(rollup(r).acceptanceRate).toBeCloseTo(0.5, 3);
  });

  it('all pass → 100%', () => {
    const r = evaluateAcceptance([bilateral('f1', 10, 10, 0.1)]);
    expect(rollup(r).acceptanceRate).toBe(1);
  });
});

describe('worstFeatures', () => {
  it('returns top-N failing features', () => {
    const r = evaluateAcceptance([
      bilateral('mild', 10.11, 10, 0.1),
      bilateral('severe', 10.5, 10, 0.1),
    ]);
    const worst = worstFeatures(r, 2);
    expect(worst[0]!.featureId).toBe('severe');
  });

  it('empty when all pass', () => {
    const r = evaluateAcceptance([bilateral('f1', 10, 10, 0.1)]);
    expect(worstFeatures(r)).toEqual([]);
  });
});

describe('summarize', () => {
  it('reports acceptance + fail count', () => {
    const r = evaluateAcceptance([
      bilateral('f1', 10, 10, 0.1),
      bilateral('f2', 10.5, 10, 0.1),
    ]);
    const s = summarize(r);
    expect(s.totalFeatures).toBe(2);
    expect(s.failCount).toBe(1);
  });
});
