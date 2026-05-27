import { describe, it, expect } from 'vitest';
import { compute, pressureForTorque, summarize, type PressFitTorqueInput } from './pressFitTorque';

const base: PressFitTorqueInput = {
  interfacePressureMPa: 40, shaftDiameterMm: 30, engagementLengthMm: 40, frictionCoefficient: 0.15,
};

describe('compute', () => {
  it('contact area = π·d·L', () => {
    expect(compute(base).contactAreaMm2).toBeCloseTo(Math.PI * 30 * 40, 4);
  });

  it('axial capacity = μ·p·A', () => {
    const r = compute(base);
    expect(r.axialCapacityN).toBeCloseTo(0.15 * 40 * Math.PI * 30 * 40, 3);
  });

  it('torque = μ·p·π·d²·L/2 (N·m)', () => {
    const r = compute(base);
    expect(r.torqueCapacityNm).toBeCloseTo((0.15 * 40 * Math.PI * 30 * 30 * 40) / 2 / 1000, 5);
  });

  it('torque = axial · d/2 / 1000', () => {
    const r = compute(base);
    expect(r.torqueCapacityNm).toBeCloseTo(r.axialCapacityN * (30 / 2) / 1000, 6);
  });

  it('higher pressure → higher capacity', () => {
    const lo = compute({ ...base, interfacePressureMPa: 20 });
    const hi = compute({ ...base, interfacePressureMPa: 80 });
    expect(hi.torqueCapacityNm).toBeCloseTo(lo.torqueCapacityNm * 4, 4);
  });

  it('applied torque below capacity → SF>1, no slip', () => {
    const r = compute({ ...base, appliedTorqueNm: 50 });
    expect(r.torqueSafetyFactor).toBeGreaterThan(1);
    expect(r.slips).toBe(false);
  });

  it('applied torque above capacity → slip + warning', () => {
    const cap = compute(base).torqueCapacityNm;
    const r = compute({ ...base, appliedTorqueNm: cap * 2 });
    expect(r.slips).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('applied axial above capacity → slip', () => {
    const cap = compute(base).axialCapacityN;
    expect(compute({ ...base, appliedAxialN: cap * 1.5 }).slips).toBe(true);
  });

  it('no duty given → null safety factors', () => {
    const r = compute(base);
    expect(r.torqueSafetyFactor).toBeNull();
    expect(r.axialSafetyFactor).toBeNull();
  });

  it('zero pressure → warning', () => {
    expect(compute({ ...base, interfacePressureMPa: 0 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('pressureForTorque', () => {
  it('round-trips with compute', () => {
    const cap = compute(base).torqueCapacityNm;
    expect(pressureForTorque(30, 40, 0.15, cap)).toBeCloseTo(40, 5);
  });
});

describe('summarize', () => {
  it('reports torque + axial + slip', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.torqueCapacityNm).toBe(r.torqueCapacityNm);
    expect(s.slips).toBe(r.slips);
  });
});
