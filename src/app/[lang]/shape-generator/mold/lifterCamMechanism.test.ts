import { describe, it, expect } from 'vitest';
import {
  designLifter,
  findOptimalAngle,
  buildCamProfile,
  summarize,
} from './lifterCamMechanism';

describe('designLifter', () => {
  it('defaults → feasible', () => {
    const r = designLifter();
    expect(r.feasible).toBe(true);
    expect(r.rodLengthMm).toBeGreaterThan(0);
  });

  it('lift angle 0 → invalid', () => {
    const r = designLifter({ liftAngleDeg: 0 });
    expect(r.feasible).toBe(false);
  });

  it('lift angle 90 → invalid', () => {
    const r = designLifter({ liftAngleDeg: 90 });
    expect(r.feasible).toBe(false);
  });

  it('large undercut needs more vertical', () => {
    const small = designLifter({ undercutMm: 1 });
    const big = designLifter({ undercutMm: 10 });
    expect(big.verticalTravelMm).toBeGreaterThan(small.verticalTravelMm);
  });

  it('insufficient stroke → infeasible', () => {
    const r = designLifter({ undercutMm: 10, liftAngleDeg: 5, availableStrokeMm: 10 });
    expect(r.feasible).toBe(false);
  });

  it('small angle warns', () => {
    const r = designLifter({ liftAngleDeg: 3 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('large angle warns about bending', () => {
    const r = designLifter({ liftAngleDeg: 25 });
    expect(r.warnings.some(w => w.includes('bending'))).toBe(true);
  });

  it('ejection force scales with mass', () => {
    const light = designLifter({ lifterMassKg: 0.1 });
    const heavy = designLifter({ lifterMassKg: 1 });
    expect(heavy.ejectionForceN).toBeGreaterThan(light.ejectionForceN);
  });

  it('rod length = undercut / sin(α)', () => {
    const r = designLifter({ undercutMm: 5, liftAngleDeg: 10 });
    expect(r.rodLengthMm).toBeCloseTo(5 / Math.sin(Math.PI * 10 / 180), 3);
  });
});

describe('findOptimalAngle', () => {
  it('finds an angle in range', () => {
    const r = findOptimalAngle({ undercutMm: 5, availableStrokeMm: 100, lifterMassKg: 0.2, friction: 0.15 }, { min: 5, max: 20, step: 5 });
    expect(r.bestAngleDeg).toBeGreaterThanOrEqual(5);
    expect(r.bestAngleDeg).toBeLessThanOrEqual(20);
  });

  it('returns positive rod length + force', () => {
    const r = findOptimalAngle({ undercutMm: 5, availableStrokeMm: 100, lifterMassKg: 0.2, friction: 0.15 }, { min: 5, max: 20, step: 5 });
    expect(r.rodLengthMm).toBeGreaterThan(0);
    expect(r.ejectionForceN).toBeGreaterThan(0);
  });
});

describe('buildCamProfile', () => {
  it('point count > 0', () => {
    expect(buildCamProfile(20).pointCount).toBeGreaterThan(0);
  });

  it('rise echoes stroke', () => {
    expect(buildCamProfile(20).riseMm).toBe(20);
  });

  it('default dwell angle 20', () => {
    expect(buildCamProfile(20).dwellAngleDeg).toBe(20);
  });
});

describe('summarize', () => {
  it('reports key fields', () => {
    const r = designLifter();
    const s = summarize(r);
    expect(s.rodLengthMm).toBe(r.rodLengthMm);
    expect(s.feasible).toBe(r.feasible);
  });
});
