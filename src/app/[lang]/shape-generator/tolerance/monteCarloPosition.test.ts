import { describe, it, expect } from 'vitest';
import {
  runMonteCarlo,
  histogram,
  type NominalFeature,
  type MeasurementSpec,
} from './monteCarloPosition';

const featureA: NominalFeature = {
  id: 'A',
  nominalMm: [0, 0, 0],
  toleranceMm: [0.1, 0.1, 0.1],
};

const featureB: NominalFeature = {
  id: 'B',
  nominalMm: [10, 0, 0],
  toleranceMm: [0.1, 0.1, 0.1],
};

const distanceAB: MeasurementSpec = {
  id: 'dist-AB',
  evaluate: (samples) => {
    const a = samples.get('A')!.positionMm;
    const b = samples.get('B')!.positionMm;
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  },
  lsl: 9.7,
  usl: 10.3,
};

describe('runMonteCarlo', () => {
  it('returns one result per measurement', () => {
    const r = runMonteCarlo([featureA, featureB], [distanceAB], 1000, /*seed*/ 42);
    expect(r.measurements).toHaveLength(1);
  });

  it('mean near nominal distance', () => {
    const r = runMonteCarlo([featureA, featureB], [distanceAB], 5000, 42);
    expect(r.measurements[0]!.mean).toBeGreaterThan(9.5);
    expect(r.measurements[0]!.mean).toBeLessThan(10.5);
  });

  it('stdDev > 0', () => {
    const r = runMonteCarlo([featureA, featureB], [distanceAB], 2000, 42);
    expect(r.measurements[0]!.stdDev).toBeGreaterThan(0);
  });

  it('yieldFraction near 1 for wide spec', () => {
    const wide: MeasurementSpec = {
      ...distanceAB,
      lsl: 0,
      usl: 100,
    };
    const r = runMonteCarlo([featureA, featureB], [wide], 1000, 42);
    expect(r.measurements[0]!.yieldFraction).toBeCloseTo(1, 2);
  });

  it('yieldFraction = 0 for impossible spec', () => {
    const tight: MeasurementSpec = {
      ...distanceAB,
      lsl: 1000,
      usl: 2000,
    };
    const r = runMonteCarlo([featureA, featureB], [tight], 500, 42);
    expect(r.measurements[0]!.yieldFraction).toBe(0);
    expect(r.measurements[0]!.dpmo).toBe(1_000_000);
  });

  it('Cpk reported', () => {
    const r = runMonteCarlo([featureA, featureB], [distanceAB], 5000, 42);
    expect(isFinite(r.measurements[0]!.cpk)).toBe(true);
  });

  it('deterministic with same seed', () => {
    const r1 = runMonteCarlo([featureA, featureB], [distanceAB], 100, 99);
    const r2 = runMonteCarlo([featureA, featureB], [distanceAB], 100, 99);
    expect(r1.measurements[0]!.mean).toBe(r2.measurements[0]!.mean);
  });

  it('common-cause correlation tightens variance', () => {
    const independent = [featureA, featureB];
    const correlated: NominalFeature[] = [
      { ...featureA, commonCauseGroup: 'gA' },
      { ...featureB, commonCauseGroup: 'gA' },
    ];
    const r1 = runMonteCarlo(independent, [distanceAB], 5000, 42);
    const r2 = runMonteCarlo(correlated, [distanceAB], 5000, 42);
    expect(r2.measurements[0]!.stdDev).toBeLessThan(r1.measurements[0]!.stdDev);
  });

  it('multi-measurement overall yield ≤ each individual yield', () => {
    const m1: MeasurementSpec = { ...distanceAB, lsl: 9.99, usl: 10.01 };
    const m2: MeasurementSpec = { id: 'm2', evaluate: () => 5, lsl: 0, usl: 10 };
    const r = runMonteCarlo([featureA, featureB], [m1, m2], 1000, 42);
    const minIndividual = Math.min(
      r.measurements[0]!.yieldFraction,
      r.measurements[1]!.yieldFraction,
    );
    expect(r.overallYield).toBeLessThanOrEqual(minIndividual + 1e-9);
  });

  it('uniform distribution wider spread than normal', () => {
    const a: NominalFeature = { ...featureA, distribution: 'uniform' };
    const b: NominalFeature = { ...featureB, distribution: 'uniform' };
    const n_a: NominalFeature = { ...featureA, distribution: 'normal' };
    const n_b: NominalFeature = { ...featureB, distribution: 'normal' };
    const uniform = runMonteCarlo([a, b], [distanceAB], 5000, 42);
    const normal = runMonteCarlo([n_a, n_b], [distanceAB], 5000, 42);
    expect(uniform.measurements[0]!.stdDev).toBeGreaterThan(normal.measurements[0]!.stdDev);
  });
});

describe('histogram', () => {
  it('produces requested bin count', () => {
    const h = histogram([1, 2, 3, 4, 5, 6, 7, 8], 4);
    expect(h.bins).toHaveLength(4);
  });

  it('total count matches input length', () => {
    const h = histogram([1, 2, 3, 4, 5], 5);
    expect(h.totalCount).toBe(5);
  });

  it('all values in one bin → that bin holds them all', () => {
    const h = histogram([5, 5, 5], 5);
    expect(h.bins[0]!.count).toBe(3);
  });

  it('empty input → empty bins', () => {
    expect(histogram([], 5).bins).toHaveLength(0);
  });
});
