import { describe, it, expect } from 'vitest';
import {
  calculate,
  nutFactorFor,
  preloadScatter,
  summarize,
  type BoltPreloadInput,
} from './boltPreloadCalculator';

// M10 grade 8.8: A_t ≈ 58 mm², proof ≈ 580 MPa (8.8 proof stress).
const base: BoltPreloadInput = {
  nominalDiameterMm: 10,
  tensileStressAreaMm2: 58,
  proofStrengthMpa: 580,
};

describe('calculate', () => {
  it('target preload = fraction × proof load', () => {
    const r = calculate(base);
    expect(r.targetPreloadN).toBeCloseTo(0.75 * 58 * 580, 3);
  });

  it('required torque = K × F × d', () => {
    const r = calculate(base);
    const expected = 0.2 * r.targetPreloadN * (10 / 1000);
    expect(r.requiredTorqueNm).toBeCloseTo(expected, 4);
  });

  it('applied torque back-computes preload', () => {
    const target = calculate(base);
    const r = calculate({ ...base, appliedTorqueNm: target.requiredTorqueNm });
    expect(r.actualPreloadN).toBeCloseTo(target.targetPreloadN, 1);
  });

  it('lower nut factor → lower torque for same preload', () => {
    const dry = calculate({ ...base, nutFactor: 0.2 });
    const waxed = calculate({ ...base, nutFactor: 0.1 });
    expect(waxed.requiredTorqueNm).toBeLessThan(dry.requiredTorqueNm);
  });

  it('von Mises includes torsional contribution', () => {
    const r = calculate(base);
    expect(r.vonMisesMpa).toBeGreaterThan(r.tensileStressMpa);
  });

  it('over-preload exceeds proof → withinProof false', () => {
    const r = calculate({ ...base, preloadFraction: 1.5 });
    expect(r.withinProof).toBe(false);
  });

  it('75% preload stays within proof', () => {
    const r = calculate(base);
    expect(r.withinProof).toBe(true);
  });

  it('zero area → warning', () => {
    const r = calculate({ ...base, tensileStressAreaMm2: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('proof utilisation = vonMises / proof', () => {
    const r = calculate(base);
    expect(r.proofUtilisation).toBeCloseTo(r.vonMisesMpa / base.proofStrengthMpa, 6);
  });
});

describe('nutFactorFor', () => {
  it('dry > oiled > waxed', () => {
    expect(nutFactorFor('dry')).toBeGreaterThan(nutFactorFor('lightly-oiled'));
    expect(nutFactorFor('lightly-oiled')).toBeGreaterThan(nutFactorFor('waxed'));
  });

  it('PTFE lowest', () => {
    expect(nutFactorFor('PTFE')).toBeLessThan(nutFactorFor('moly'));
  });
});

describe('preloadScatter', () => {
  it('±30% band by default', () => {
    const r = preloadScatter(1000);
    expect(r.minN).toBeCloseTo(700, 6);
    expect(r.maxN).toBeCloseTo(1300, 6);
  });

  it('custom scatter fraction', () => {
    const r = preloadScatter(1000, 0.25);
    expect(r.minN).toBeCloseTo(750, 6);
  });
});

describe('summarize', () => {
  it('reports preload + torque + withinProof', () => {
    const r = calculate(base);
    const s = summarize(r);
    expect(s.targetPreloadN).toBe(r.targetPreloadN);
    expect(s.withinProof).toBe(r.withinProof);
  });
});
