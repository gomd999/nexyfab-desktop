import { describe, it, expect } from 'vitest';
import { compute, rivetsForLoad, summarize, type RivetJointInput } from './rivetJoint';

const base: RivetJointInput = {
  rivetDiameterMm: 10, plateThicknessMm: 8, pitchMm: 30, rivetCount: 1,
  shearType: 'single', allowableShearMPa: 80, allowableBearingMPa: 160, allowableTensionMPa: 100,
};

describe('compute', () => {
  it('shear load = n·m·(π/4)d²·τ', () => {
    expect(compute(base).shearLoadN).toBeCloseTo(1 * 1 * (Math.PI / 4) * 100 * 80, 4);
  });

  it('bearing load = n·d·t·σ_b', () => {
    expect(compute(base).bearingLoadN).toBeCloseTo(1 * 10 * 8 * 160, 4);
  });

  it('tearing load = (p−d)·t·σ_t', () => {
    expect(compute(base).tearingLoadN).toBeCloseTo((30 - 10) * 8 * 100, 4);
  });

  it('double shear doubles shear load', () => {
    const single = compute(base);
    const double = compute({ ...base, shearType: 'double' });
    expect(double.shearLoadN).toBeCloseTo(single.shearLoadN * 2, 4);
  });

  it('capacity = min of three modes', () => {
    const r = compute(base);
    expect(r.capacityN).toBe(Math.min(r.shearLoadN, r.bearingLoadN, r.tearingLoadN));
  });

  it('governing mode matches the minimum', () => {
    // base: shear≈6283, bearing=12800, tearing=16000 → shear governs
    expect(compute(base).governingMode).toBe('shear');
  });

  it('efficiency = capacity / (p·t·σ_t)', () => {
    const r = compute(base);
    expect(r.efficiency).toBeCloseTo(r.capacityN / (30 * 8 * 100), 6);
  });

  it('more rivets → higher shear capacity', () => {
    const one = compute(base);
    const four = compute({ ...base, rivetCount: 4 });
    expect(four.shearLoadN).toBeCloseTo(one.shearLoadN * 4, 4);
  });

  it('pitch ≤ diameter → warning', () => {
    expect(compute({ ...base, pitchMm: 8 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('rivetsForLoad', () => {
  it('rounds up to carry the target in shear', () => {
    const { rivetCount, ...rest } = base;
    void rivetCount;
    const perRivet = (Math.PI / 4) * 100 * 80;
    expect(rivetsForLoad(rest, perRivet * 3.2)).toBe(4);
  });
});

describe('summarize', () => {
  it('reports capacity + mode + efficiency', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.capacityN).toBe(r.capacityN);
    expect(s.governingMode).toBe(r.governingMode);
  });
});
