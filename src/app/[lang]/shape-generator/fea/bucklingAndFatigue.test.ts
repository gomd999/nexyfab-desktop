import { describe, it, expect } from 'vitest';
import {
  analyzeBuckling,
  bucklingSafetyFactor,
  rectangleMinI,
  circleI,
  annulusI,
  plateBucklingStress,
} from './bucklingAnalysis';
import {
  analyzeFatigue,
  minerCumulativeDamage,
} from './fatigueAnalysis';

describe('buckling helpers', () => {
  it('rectangleMinI returns minimum-axis I', () => {
    // 10×20 rect: min I about long axis = (20 × 10³)/12 ≈ 1667
    expect(rectangleMinI(10, 20)).toBeCloseTo((20 * 10 ** 3) / 12, 1);
  });

  it('circleI = π·d⁴/64', () => {
    expect(circleI(10)).toBeCloseTo(Math.PI * 10000 / 64, 4);
  });

  it('annulusI = π(D⁴ - d⁴)/64', () => {
    expect(annulusI(20, 10)).toBeCloseTo(Math.PI * (160000 - 10000) / 64, 4);
  });
});

describe('analyzeBuckling', () => {
  // Steel column: E = 200 GPa, Sy = 250 MPa.
  const steel = { elasticModulusMpa: 200000, yieldStrengthMpa: 250 };

  it('long slender column → Euler regime', () => {
    // 10mm dia × 1000mm long rod, pinned-pinned.
    const I = circleI(10);
    const A = Math.PI * 5 * 5;
    const r = analyzeBuckling(
      { areaMm2: A, minMomentOfInertiaMm4: I, lengthMm: 1000, endCondition: 'pinned-pinned' },
      steel,
    );
    expect(r.regime).toBe('euler');
    expect(r.criticalLoadN).toBeGreaterThan(0);
  });

  it('short stocky column → Johnson regime', () => {
    // 50mm dia × 100mm long → very low slenderness.
    const I = circleI(50);
    const A = Math.PI * 25 * 25;
    const r = analyzeBuckling(
      { areaMm2: A, minMomentOfInertiaMm4: I, lengthMm: 100, endCondition: 'pinned-pinned' },
      steel,
    );
    expect(r.regime).toBe('johnson');
  });

  it('fixed-fixed has shorter effective length than pinned-pinned', () => {
    const A = 100, I = 800;
    const a = analyzeBuckling({ areaMm2: A, minMomentOfInertiaMm4: I, lengthMm: 500, endCondition: 'pinned-pinned' }, steel);
    const b = analyzeBuckling({ areaMm2: A, minMomentOfInertiaMm4: I, lengthMm: 500, endCondition: 'fixed-fixed' }, steel);
    expect(b.effectiveLengthMm).toBeLessThan(a.effectiveLengthMm);
    expect(b.criticalLoadN).toBeGreaterThan(a.criticalLoadN);
  });
});

describe('bucklingSafetyFactor', () => {
  it('SF = criticalLoad / applied', () => {
    const fake = {
      effectiveLengthMm: 1000, radiusOfGyrationMm: 5, slendernessRatio: 200,
      transitionSlenderness: 125, criticalLoadN: 10000, regime: 'euler' as const,
      criticalStressMpa: 100,
    };
    expect(bucklingSafetyFactor(fake, 2500)).toBeCloseTo(4, 6);
  });

  it('infinite SF when no applied load', () => {
    const fake = {
      effectiveLengthMm: 0, radiusOfGyrationMm: 0, slendernessRatio: 0,
      transitionSlenderness: 0, criticalLoadN: 5000, regime: 'euler' as const, criticalStressMpa: 0,
    };
    expect(bucklingSafetyFactor(fake, 0)).toBe(Infinity);
  });
});

describe('plateBucklingStress', () => {
  it('thicker plate buckles at higher stress', () => {
    const thin = plateBucklingStress(1, 100, 200000, 0.3);
    const thick = plateBucklingStress(3, 100, 200000, 0.3);
    expect(thick).toBeGreaterThan(thin * 8); // ratio ~ (t1/t2)² = 9
  });
});

describe('analyzeFatigue', () => {
  // Mild steel: Sut = 440, Sy = 370, Se ≈ 220.
  const steel = {
    ultimateStrengthMpa: 440,
    yieldStrengthMpa: 370,
    enduranceLimitMpa: 220,
  };

  it('fully reversed loading (R = -1)', () => {
    const r = analyzeFatigue({ maxStressMpa: 100, minStressMpa: -100 }, steel);
    expect(r.meanStressMpa).toBe(0);
    expect(r.alternatingStressMpa).toBe(100);
    expect(r.stressRatio).toBe(-1);
  });

  it('infinite life below endurance limit', () => {
    const r = analyzeFatigue({ maxStressMpa: 150, minStressMpa: -150 }, steel);
    expect(r.cyclesToFailure).toBe(Infinity);
  });

  it('Soderberg more conservative than Goodman', () => {
    const r = analyzeFatigue({ maxStressMpa: 200, minStressMpa: 0 }, steel);
    expect(r.soderbergSf).toBeLessThanOrEqual(r.goodmanSf);
  });

  it('Gerber less conservative than Goodman', () => {
    const r = analyzeFatigue({ maxStressMpa: 200, minStressMpa: 0 }, steel);
    expect(r.gerberSf).toBeGreaterThan(r.goodmanSf);
  });

  it('flags failure when goodman SF < 1', () => {
    const r = analyzeFatigue({ maxStressMpa: 500, minStressMpa: -500 }, steel);
    expect(r.passGoodman).toBe(false);
  });
});

describe('minerCumulativeDamage', () => {
  const steel = {
    ultimateStrengthMpa: 440, yieldStrengthMpa: 370, enduranceLimitMpa: 220,
  };

  it('zero damage when all blocks below endurance', () => {
    const r = minerCumulativeDamage([
      { cycles: 1e6, load: { maxStressMpa: 100, minStressMpa: -100 } },
    ], steel);
    expect(r.damage).toBe(0);
    expect(r.failed).toBe(false);
  });

  it('accumulates damage across blocks above endurance', () => {
    const r = minerCumulativeDamage([
      { cycles: 1000, load: { maxStressMpa: 400, minStressMpa: -400 } },
      { cycles: 5000, load: { maxStressMpa: 300, minStressMpa: -300 } },
    ], steel);
    expect(r.damage).toBeGreaterThan(0);
    expect(r.perBlockDamage).toHaveLength(2);
  });

  it('failure flag set when damage ≥ 1', () => {
    const r = minerCumulativeDamage([
      { cycles: 1e10, load: { maxStressMpa: 430, minStressMpa: -430 } },
    ], steel);
    expect(r.failed).toBe(true);
  });
});
