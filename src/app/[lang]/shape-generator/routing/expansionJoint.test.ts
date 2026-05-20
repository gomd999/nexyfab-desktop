import { describe, it, expect } from 'vitest';
import { compute, thermalMovementMm, summarize, type ExpansionJointInput } from './expansionJoint';

const base: ExpansionJointInput = {
  runLengthMm: 20000, ctePerK: 12e-6, deltaTempC: 150,
  movementPerConvolutionMm: 3, axialStiffnessNmmPerConv: 600,
  effectiveAreaMm2: 8000, pressureBar: 10,
};

describe('compute', () => {
  it('thermal movement = α·L·ΔT', () => {
    expect(compute(base).thermalMovementMm).toBeCloseTo(12e-6 * 20000 * 150, 5);
  });

  it('design movement adds safety factor', () => {
    const r = compute({ ...base, safetyFactor: 1.5 });
    expect(r.designMovementMm).toBeCloseTo(r.thermalMovementMm * 1.5, 5);
  });

  it('required convolutions = ceil(design / per-conv)', () => {
    const r = compute(base);
    expect(r.requiredConvolutions).toBeGreaterThan(0);
    expect(Number.isInteger(r.requiredConvolutions)).toBe(true);
  });

  it('more movement → more convolutions', () => {
    const cool = compute({ ...base, deltaTempC: 50 });
    const hot = compute({ ...base, deltaTempC: 300 });
    expect(hot.requiredConvolutions).toBeGreaterThan(cool.requiredConvolutions);
  });

  it('pressure thrust = P·A', () => {
    const r = compute(base);
    expect(r.pressureThrustN).toBeCloseTo(10 * 8000 * 0.1, 4);
  });

  it('anchor load = spring + thrust', () => {
    const r = compute(base);
    expect(r.anchorLoadN).toBeCloseTo(r.springForceN + r.pressureThrustN, 4);
  });

  it('adequacy check vs rated convolutions', () => {
    const ok = compute({ ...base, ratedConvolutions: 100 });
    const no = compute({ ...base, ratedConvolutions: 1 });
    expect(ok.adequate).toBe(true);
    expect(no.adequate).toBe(false);
    expect(no.warnings.length).toBeGreaterThan(0);
  });

  it('zero per-convolution → warning', () => {
    expect(compute({ ...base, movementPerConvolutionMm: 0 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('thermalMovementMm', () => {
  it('matches α·L·ΔT', () => {
    expect(thermalMovementMm(10000, 12e-6, 100)).toBeCloseTo(12, 5);
  });
});

describe('summarize', () => {
  it('reports movement + convolutions + anchor', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.designMovementMm).toBe(r.designMovementMm);
    expect(s.anchorLoadN).toBe(r.anchorLoadN);
  });
});
