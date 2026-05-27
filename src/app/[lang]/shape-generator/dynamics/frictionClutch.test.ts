import { describe, it, expect } from 'vitest';
import { compute, clampForceForTorque, summarize, type FrictionClutchInput } from './frictionClutch';

const base: FrictionClutchInput = {
  frictionCoefficient: 0.3, clampForceN: 5000, outerRadiusMm: 120, innerRadiusMm: 80,
};

describe('compute', () => {
  it('uniform-wear mean radius = (Ro+Ri)/2', () => {
    const r = compute(base);
    expect(r.meanRadiusMm).toBeCloseTo(100, 5);
  });

  it('torque = μ·F·R·faces', () => {
    const r = compute(base);
    expect(r.torqueCapacityNm).toBeCloseTo(0.3 * 5000 * 0.1, 4);
  });

  it('more faces → more torque', () => {
    const one = compute(base);
    const multi = compute({ ...base, faces: 4 });
    expect(multi.torqueCapacityNm).toBeCloseTo(one.torqueCapacityNm * 4, 4);
  });

  it('uniform-pressure radius differs from uniform-wear', () => {
    const wear = compute({ ...base, theory: 'uniform-wear' });
    const press = compute({ ...base, theory: 'uniform-pressure' });
    expect(press.meanRadiusMm).not.toBeCloseTo(wear.meanRadiusMm, 1);
  });

  it('higher clamp → more torque', () => {
    const lo = compute({ ...base, clampForceN: 2000 });
    const hi = compute({ ...base, clampForceN: 8000 });
    expect(hi.torqueCapacityNm).toBeGreaterThan(lo.torqueCapacityNm);
  });

  it('engagement energy when inertias + speed diff given', () => {
    const r = compute({ ...base, inertia1KgM2: 2, inertia2KgM2: 2, speedDiffRadS: 100 });
    expect(r.engagementEnergyJ).not.toBeNull();
    expect(r.engagementEnergyJ!).toBeGreaterThan(0);
  });

  it('disc temp rise from energy + mass', () => {
    const r = compute({ ...base, inertia1KgM2: 2, inertia2KgM2: 2, speedDiffRadS: 100, discMassKg: 3 });
    expect(r.discTempRiseC).not.toBeNull();
    expect(r.discTempRiseC!).toBeGreaterThan(0);
  });

  it('no engagement inputs → null energy', () => {
    expect(compute(base).engagementEnergyJ).toBeNull();
  });

  it('Ro ≤ Ri → warning', () => {
    expect(compute({ ...base, outerRadiusMm: 50 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('clampForceForTorque', () => {
  it('round-trips with compute', () => {
    const { clampForceN, ...rest } = base;
    void clampForceN;
    const F = clampForceForTorque(rest, compute(base).torqueCapacityNm);
    expect(F).toBeCloseTo(5000, 1);
  });

  it('higher target torque → more clamp', () => {
    const { clampForceN, ...rest } = base;
    void clampForceN;
    expect(clampForceForTorque(rest, 300)).toBeGreaterThan(clampForceForTorque(rest, 100));
  });
});

describe('summarize', () => {
  it('reports torque', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.torqueCapacityNm).toBe(r.torqueCapacityNm);
  });
});
