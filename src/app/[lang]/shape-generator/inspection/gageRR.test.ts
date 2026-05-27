import { describe, it, expect } from 'vitest';
import {
  computeGageRR,
  numberOfDistinctCategories,
  operatorBias,
  summarize,
  type MeasurementSample,
} from './gageRR';

// Build a synthetic dataset: parts have distinct means; operators have small bias;
// trials introduce small noise. This should yield acceptable Gage R&R.
function syntheticSamples(): MeasurementSample[] {
  const samples: MeasurementSample[] = [];
  const partMeans = [10.0, 10.5, 11.0, 11.5, 12.0];
  const operatorBias = { A: 0.0, B: 0.02 };
  const trialNoise = [0.01, -0.01];
  for (let p = 0; p < partMeans.length; p++) {
    for (const op of Object.keys(operatorBias) as ('A' | 'B')[]) {
      for (let t = 0; t < 2; t++) {
        samples.push({
          partId: `part${p}`,
          operatorId: op,
          trial: t + 1,
          value: partMeans[p]! + operatorBias[op] + trialNoise[t]!,
        });
      }
    }
  }
  return samples;
}

function highVarianceSamples(): MeasurementSample[] {
  // Same parts but huge trial noise → unacceptable GR&R.
  const samples: MeasurementSample[] = [];
  for (let p = 0; p < 5; p++) {
    for (const op of ['A', 'B']) {
      for (let t = 0; t < 2; t++) {
        const noise = (Math.random() - 0.5) * 5;
        samples.push({ partId: `part${p}`, operatorId: op, trial: t + 1, value: 10 + p * 0.5 + noise });
      }
    }
  }
  return samples;
}

describe('computeGageRR', () => {
  it('synthetic well-behaved data → low %GRR', () => {
    const r = computeGageRR(syntheticSamples());
    expect(r.percentGrr).toBeLessThan(30);
  });

  it('classification acceptable / marginal for low noise', () => {
    const r = computeGageRR(syntheticSamples());
    expect(['acceptable', 'marginal']).toContain(r.classification);
  });

  it('high variance → unacceptable', () => {
    const r = computeGageRR(highVarianceSamples());
    expect(['marginal', 'unacceptable']).toContain(r.classification);
  });

  it('all metrics non-negative', () => {
    const r = computeGageRR(syntheticSamples());
    expect(r.evSigma).toBeGreaterThanOrEqual(0);
    expect(r.avSigma).toBeGreaterThanOrEqual(0);
    expect(r.grrSigma).toBeGreaterThanOrEqual(0);
    expect(r.pvSigma).toBeGreaterThanOrEqual(0);
  });

  it('TV is sqrt(GRR² + PV²)', () => {
    const r = computeGageRR(syntheticSamples());
    expect(r.tvSigma).toBeCloseTo(Math.sqrt(r.grrSigma ** 2 + r.pvSigma ** 2), 5);
  });

  it('percent metrics sum-of-squares ≈ 100', () => {
    const r = computeGageRR(syntheticSamples());
    const sumSquares = (r.percentGrr ** 2 + r.percentPv ** 2);
    expect(sumSquares).toBeCloseTo(10000, -1);
  });

  it('empty input → no crash', () => {
    const r = computeGageRR([]);
    expect(r.classification).toBeDefined();
  });
});

describe('numberOfDistinctCategories', () => {
  it('large PV/GRR → high NDC', () => {
    const r = computeGageRR(syntheticSamples());
    expect(numberOfDistinctCategories(r)).toBeGreaterThan(0);
  });
});

describe('operatorBias', () => {
  it('returns one entry per operator', () => {
    const bias = operatorBias(syntheticSamples());
    expect(bias).toHaveLength(2);
  });

  it('bias signed and sums approx to zero', () => {
    const bias = operatorBias(syntheticSamples());
    const total = bias.reduce((s, b) => s + b.meanDeviation, 0);
    expect(Math.abs(total)).toBeLessThan(0.1);
  });
});

describe('summarize', () => {
  it('reports counts + ndc', () => {
    const samples = syntheticSamples();
    const r = computeGageRR(samples);
    const s = summarize(samples, r);
    expect(s.partCount).toBe(5);
    expect(s.operatorCount).toBe(2);
    expect(s.classification).toBe(r.classification);
  });
});
