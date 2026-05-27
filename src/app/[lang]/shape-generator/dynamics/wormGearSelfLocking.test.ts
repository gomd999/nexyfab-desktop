import { describe, it, expect } from 'vitest';
import { compute, outputTorqueNm, maxSelfLockingLeadAngleDeg, summarize, type WormGearInput } from './wormGearSelfLocking';

// Single-start, small lead → self-locking.
const base: WormGearInput = {
  wormStarts: 1, gearTeeth: 40, moduleMm: 3, wormPitchDiameterMm: 36, frictionCoefficient: 0.1,
};

describe('compute', () => {
  it('ratio = gearTeeth / wormStarts', () => {
    expect(compute(base).ratio).toBeCloseTo(40, 5);
  });

  it('lead angle from z_w·m / d_w', () => {
    const r = compute(base);
    expect(Math.tan(r.leadAngleDeg * Math.PI / 180)).toBeCloseTo((1 * 3) / 36, 5);
  });

  it('single-start small-lead → self-locking', () => {
    expect(compute(base).selfLocking).toBe(true);
  });

  it('multi-start high-lead → not self-locking', () => {
    const r = compute({ ...base, wormStarts: 4, wormPitchDiameterMm: 30 });
    expect(r.selfLocking).toBe(false);
  });

  it('forward efficiency higher for higher lead angle', () => {
    const low = compute({ ...base, wormStarts: 1 });
    const high = compute({ ...base, wormStarts: 4, wormPitchDiameterMm: 30 });
    expect(high.forwardEfficiency).toBeGreaterThan(low.forwardEfficiency);
  });

  it('self-locking → warning', () => {
    expect(compute(base).warnings.length).toBeGreaterThan(0);
  });

  it('friction angle from atan(μ)', () => {
    const r = compute(base);
    expect(r.frictionAngleDeg).toBeCloseTo(Math.atan(0.1) * 180 / Math.PI, 5);
  });

  it('efficiency in 0..1', () => {
    const r = compute({ ...base, wormStarts: 2, wormPitchDiameterMm: 30 });
    expect(r.forwardEfficiency).toBeGreaterThan(0);
    expect(r.forwardEfficiency).toBeLessThan(1);
  });

  it('zero pitch diameter → warning', () => {
    expect(compute({ ...base, wormPitchDiameterMm: 0 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('outputTorqueNm', () => {
  it('= input × ratio × efficiency', () => {
    const r = compute({ ...base, wormStarts: 2, wormPitchDiameterMm: 30 });
    expect(outputTorqueNm(r, 5)).toBeCloseTo(5 * r.ratio * r.forwardEfficiency, 4);
  });
});

describe('maxSelfLockingLeadAngleDeg', () => {
  it('= atan(μ)', () => {
    expect(maxSelfLockingLeadAngleDeg(0.1)).toBeCloseTo(Math.atan(0.1) * 180 / Math.PI, 5);
  });

  it('higher μ → larger self-locking angle', () => {
    expect(maxSelfLockingLeadAngleDeg(0.2)).toBeGreaterThan(maxSelfLockingLeadAngleDeg(0.05));
  });
});

describe('summarize', () => {
  it('reports ratio + efficiency + self-locking', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.ratio).toBe(r.ratio);
    expect(s.selfLocking).toBe(r.selfLocking);
  });
});
