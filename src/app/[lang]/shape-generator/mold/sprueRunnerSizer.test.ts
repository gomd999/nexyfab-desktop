import { describe, it, expect } from 'vitest';
import {
  sizeSprue,
  sizeRunner,
  pressureDrop,
  summarizeSprue,
  summarizeRunner,
} from './sprueRunnerSizer';

describe('sizeSprue', () => {
  it('bottom diameter = nozzle + 1 mm', () => {
    const r = sizeSprue({ nozzleOrificeDiameterMm: 4, lengthMm: 50 });
    expect(r.bottomDiameterMm).toBe(5);
  });

  it('top diameter > bottom diameter due to draft', () => {
    const r = sizeSprue({ nozzleOrificeDiameterMm: 4, lengthMm: 50 });
    expect(r.topDiameterMm).toBeGreaterThan(r.bottomDiameterMm);
  });

  it('volume positive', () => {
    const r = sizeSprue({ nozzleOrificeDiameterMm: 4, lengthMm: 50 });
    expect(r.volumeMm3).toBeGreaterThan(0);
  });

  it('custom draft angle changes top diameter', () => {
    const r1 = sizeSprue({ nozzleOrificeDiameterMm: 4, lengthMm: 50, draftAngleDeg: 3 });
    const r2 = sizeSprue({ nozzleOrificeDiameterMm: 4, lengthMm: 50, draftAngleDeg: 6 });
    expect(r2.topDiameterMm).toBeGreaterThan(r1.topDiameterMm);
  });

  it('zero nozzle → warning', () => {
    const r = sizeSprue({ nozzleOrificeDiameterMm: 0, lengthMm: 50 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('sizeRunner', () => {
  it('full-round produces circular area', () => {
    const r = sizeRunner({ partWeightG: 20, runnerLengthMm: 80, partWallThicknessMm: 2, crossSection: 'full-round' });
    const expected = Math.PI * r.primaryDiameterMm * r.primaryDiameterMm / 4;
    expect(r.crossSectionAreaMm2).toBeCloseTo(expected, 3);
  });

  it('primary diameter ≥ wall + 1 mm', () => {
    const r = sizeRunner({ partWeightG: 5, runnerLengthMm: 30, partWallThicknessMm: 4, crossSection: 'full-round' });
    expect(r.primaryDiameterMm).toBeGreaterThanOrEqual(5 - 1e-6);
  });

  it('primary diameter ≤ 10 mm (clamp)', () => {
    const r = sizeRunner({ partWeightG: 1000, runnerLengthMm: 500, partWallThicknessMm: 2, crossSection: 'full-round' });
    expect(r.primaryDiameterMm).toBeLessThanOrEqual(10);
  });

  it('hexagonal hydraulic diameter < D', () => {
    const r = sizeRunner({ partWeightG: 20, runnerLengthMm: 80, partWallThicknessMm: 2, crossSection: 'hexagonal' });
    expect(r.hydraulicDiameterMm).toBeLessThan(r.primaryDiameterMm);
  });

  it('trapezoidal valid area', () => {
    const r = sizeRunner({ partWeightG: 20, runnerLengthMm: 80, partWallThicknessMm: 2, crossSection: 'trapezoidal' });
    expect(r.crossSectionAreaMm2).toBeGreaterThan(0);
  });

  it('half-round produces smaller area than full-round same D', () => {
    const round = sizeRunner({ partWeightG: 20, runnerLengthMm: 80, partWallThicknessMm: 2, crossSection: 'full-round' });
    const half = sizeRunner({ partWeightG: 20, runnerLengthMm: 80, partWallThicknessMm: 2, crossSection: 'half-round' });
    expect(half.crossSectionAreaMm2).toBeLessThan(round.crossSectionAreaMm2);
  });

  it('meetsWallRule true when D ≥ wall+1', () => {
    const r = sizeRunner({ partWeightG: 20, runnerLengthMm: 80, partWallThicknessMm: 2, crossSection: 'full-round' });
    expect(r.meetsWallRule).toBe(true);
  });
});

describe('pressureDrop', () => {
  it('positive flow → positive Δp', () => {
    const r = sizeRunner({ partWeightG: 20, runnerLengthMm: 80, partWallThicknessMm: 2, crossSection: 'full-round' });
    expect(pressureDrop(r, 100, 1000)).toBeGreaterThan(0);
  });

  it('zero radius → zero Δp', () => {
    const r = sizeRunner({ partWeightG: 0, runnerLengthMm: 80, partWallThicknessMm: 0, crossSection: 'full-round' });
    expect(pressureDrop({ ...r, hydraulicDiameterMm: 0 }, 100, 1000)).toBe(0);
  });
});

describe('summary helpers', () => {
  it('summarizeSprue', () => {
    const r = sizeSprue({ nozzleOrificeDiameterMm: 4, lengthMm: 50 });
    expect(summarizeSprue(r).volumeMm3).toBe(r.volumeMm3);
  });

  it('summarizeRunner', () => {
    const r = sizeRunner({ partWeightG: 20, runnerLengthMm: 80, partWallThicknessMm: 2, crossSection: 'full-round' });
    expect(summarizeRunner(r).primaryDiameterMm).toBe(r.primaryDiameterMm);
  });
});
