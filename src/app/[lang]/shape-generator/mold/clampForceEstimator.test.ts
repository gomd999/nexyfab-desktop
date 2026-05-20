import { describe, it, expect } from 'vitest';
import {
  estimate,
  rectangleProjectedArea,
  circleProjectedArea,
  summarize,
} from './clampForceEstimator';

describe('estimate', () => {
  it('clamp force scales with projected area', () => {
    const small = estimate({ projectedAreaMm2: 5000, polymer: 'ABS' });
    const big = estimate({ projectedAreaMm2: 10000, polymer: 'ABS' });
    expect(big.clampForceTonnes).toBeCloseTo(2 * small.clampForceTonnes, 3);
  });

  it('PC needs more clamp than PP (same area)', () => {
    const pp = estimate({ projectedAreaMm2: 10000, polymer: 'PP' });
    const pc = estimate({ projectedAreaMm2: 10000, polymer: 'PC' });
    expect(pc.clampForceTonnes).toBeGreaterThan(pp.clampForceTonnes);
  });

  it('multiple cavities multiply area', () => {
    const one = estimate({ projectedAreaMm2: 5000, polymer: 'ABS', cavityCount: 1 });
    const four = estimate({ projectedAreaMm2: 5000, polymer: 'ABS', cavityCount: 4 });
    expect(four.totalProjectedAreaMm2).toBe(20000);
    expect(four.clampForceTonnes).toBeCloseTo(4 * one.clampForceTonnes, 3);
  });

  it('high flow-length ratio raises pressure', () => {
    const low = estimate({ projectedAreaMm2: 10000, polymer: 'ABS', flowLengthToWallRatio: 100 });
    const high = estimate({ projectedAreaMm2: 10000, polymer: 'ABS', flowLengthToWallRatio: 300 });
    expect(high.cavityPressureMpa).toBeGreaterThan(low.cavityPressureMpa);
  });

  it('recommends a standard machine ≥ required tonnage', () => {
    const r = estimate({ projectedAreaMm2: 20000, polymer: 'PC' });
    expect(r.recommendedMachineTonnes).toBeGreaterThanOrEqual(r.clampForceTonnes);
  });

  it('override pressure used directly', () => {
    const r = estimate({ projectedAreaMm2: 10000, polymer: 'ABS', overridePressureMpa: 60, flowLengthToWallRatio: 100 });
    expect(r.cavityPressureMpa).toBeCloseTo(60, 6);
  });

  it('unknown polymer → warning + default', () => {
    const r = estimate({ projectedAreaMm2: 10000, polymer: 'XYZ' as never });
    expect(r.warnings.some(w => w.includes('Unknown'))).toBe(true);
  });

  it('zero area → warning', () => {
    const r = estimate({ projectedAreaMm2: 0, polymer: 'ABS' });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('safety factor increases force', () => {
    const low = estimate({ projectedAreaMm2: 10000, polymer: 'ABS', safetyFactor: 1.0 });
    const high = estimate({ projectedAreaMm2: 10000, polymer: 'ABS', safetyFactor: 1.5 });
    expect(high.clampForceTonnes).toBeGreaterThan(low.clampForceTonnes);
  });
});

describe('area helpers', () => {
  it('rectangle area', () => {
    expect(rectangleProjectedArea(100, 50)).toBe(5000);
  });

  it('circle area', () => {
    expect(circleProjectedArea(100)).toBeCloseTo(Math.PI * 2500, 4);
  });
});

describe('summarize', () => {
  it('reports tonnage + machine + pressure', () => {
    const r = estimate({ projectedAreaMm2: 10000, polymer: 'ABS' });
    const s = summarize(r);
    expect(s.clampForceTonnes).toBe(r.clampForceTonnes);
    expect(s.recommendedMachineTonnes).toBe(r.recommendedMachineTonnes);
  });
});
