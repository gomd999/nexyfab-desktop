/**
 * Pure civil gate-material checks — one PASS (adequate) + one FAIL
 * (over-stressed / over-deflected / under-safe) per check, asserting the
 * MEASURED metric crosses the limit. At least one value is cross-checked
 * against an independent hand calculation.
 */
import { describe, it, expect } from 'vitest';
import {
  checkBeamBendingStress,
  checkBeamDeflection,
  checkSafetyFactor,
  checkInfiniteSlopeStability,
  checkColumnBucklingEuler,
  checkRetainingWallOverturning,
  maxSimpleSpanMomentKNm,
  simpleSpanDeflection_mm,
  rankineKa,
  STEEL_E_MPA,
  CIVIL_CHECKS,
} from '../checks';

// every result must carry a non-empty basis (honesty contract)
function assertBasis(r: { basis: string; pass: boolean; reason?: string }) {
  expect(r.basis.length).toBeGreaterThan(10);
  if (!r.pass) expect(r.reason && r.reason.length).toBeGreaterThan(0);
}

describe('1. beam bending stress σ = M/Z', () => {
  // Hand calc: UDL w=10 kN/m, L=6 m → M = wL²/8 = 45 kN·m.
  // Z = 500,000 mm³ → σ = 45e6 N·mm / 5e5 mm³ = 90 MPa.
  it('PASS: adequate section (σ ≤ allowable)', () => {
    const r = checkBeamBendingStress({
      load: { type: 'udl', w_kNpm: 10, span_m: 6 },
      sectionModulus_mm3: 500_000,
      allowableStress_MPa: 165, // steel ASD ~0.66·Fy250
    });
    expect(maxSimpleSpanMomentKNm({ type: 'udl', w_kNpm: 10, span_m: 6 })).toBeCloseTo(45, 9);
    expect(r.metrics.moment_kNm).toBeCloseTo(45, 6);
    expect(r.metrics.bendingStress_MPa).toBeCloseTo(90, 6); // hand-calc cross-check
    expect(r.metrics.bendingStress_MPa).toBeLessThanOrEqual(r.metrics.allowableStress_MPa);
    expect(r.pass).toBe(true);
    assertBasis(r);
  });

  it('FAIL: undersized section (σ > allowable)', () => {
    const r = checkBeamBendingStress({
      load: { type: 'udl', w_kNpm: 10, span_m: 6 },
      sectionModulus_mm3: 200_000, // σ = 45e6/2e5 = 225 MPa
      allowableStress_MPa: 165,
    });
    expect(r.metrics.bendingStress_MPa).toBeCloseTo(225, 6);
    expect(r.metrics.bendingStress_MPa).toBeGreaterThan(r.metrics.allowableStress_MPa);
    expect(r.pass).toBe(false);
    assertBasis(r);
  });
});

describe('2. beam deflection δ = 5wL⁴/(384EI)', () => {
  // Hand calc: w=10 kN/m (=10 N/mm), L=6000 mm, E=200 GPa, I=1e8 mm⁴
  // δ = 5·10·6000⁴/(384·200000·1e8) = 6.48e16/7.68e15 = 8.4375 mm.
  it('PASS: stiff enough (δ ≤ L/360)', () => {
    const r = checkBeamDeflection({
      load: { type: 'udl', w_kNpm: 10 },
      span_mm: 6000,
      E_MPa: STEEL_E_MPA,
      I_mm4: 1e8,
    });
    expect(simpleSpanDeflection_mm({ type: 'udl', w_kNpm: 10 }, 6000, STEEL_E_MPA, 1e8)).toBeCloseTo(8.4375, 6);
    expect(r.metrics.deflection_mm).toBeCloseTo(8.4375, 4); // hand-calc cross-check
    expect(r.metrics.deflectionLimit_mm).toBeCloseTo(6000 / 360, 6);
    expect(r.metrics.deflection_mm).toBeLessThanOrEqual(r.metrics.deflectionLimit_mm);
    expect(r.pass).toBe(true);
    assertBasis(r);
  });

  it('FAIL: too flexible (δ > L/360)', () => {
    const r = checkBeamDeflection({
      load: { type: 'udl', w_kNpm: 10 },
      span_mm: 6000,
      E_MPa: STEEL_E_MPA,
      I_mm4: 2e7, // 5× more flexible → δ ≈ 42.19 mm
    });
    expect(r.metrics.deflection_mm).toBeCloseTo(42.1875, 3);
    expect(r.metrics.deflection_mm).toBeGreaterThan(r.metrics.deflectionLimit_mm);
    expect(r.pass).toBe(false);
    assertBasis(r);
  });
});

describe('3. safety factor SF = capacity/demand', () => {
  it('PASS: SF ≥ required', () => {
    const r = checkSafetyFactor({ capacity: 300, demand: 100, requiredSF: 2.0, quantity: 'kN' });
    expect(r.metrics.safetyFactor).toBeCloseTo(3.0, 6);
    expect(r.metrics.safetyFactor).toBeGreaterThanOrEqual(r.metrics.requiredSF);
    expect(r.pass).toBe(true);
    assertBasis(r);
  });

  it('FAIL: SF < required', () => {
    const r = checkSafetyFactor({ capacity: 150, demand: 100, requiredSF: 2.0 });
    expect(r.metrics.safetyFactor).toBeCloseTo(1.5, 6);
    expect(r.metrics.safetyFactor).toBeLessThan(r.metrics.requiredSF);
    expect(r.pass).toBe(false);
    assertBasis(r);
  });
});

describe('4. infinite-slope stability FoS', () => {
  // Dry cohesionless slope reduces to FS = tanφ / tanβ (independent hand form).
  it('PASS: flat-enough slope (FoS ≥ required)', () => {
    const r = checkInfiniteSlopeStability({
      slopeDeg: 20,
      phiDeg: 30,
      cohesion_kPa: 0,
      depth_m: 3,
      gamma_kNm3: 18,
      waterDepth_m: 0,
      requiredFS: 1.5,
    });
    const handFS = Math.tan((30 * Math.PI) / 180) / Math.tan((20 * Math.PI) / 180);
    expect(r.metrics.factorOfSafety).toBeCloseTo(handFS, 5); // ≈ 1.586, cross-check
    expect(r.metrics.factorOfSafety).toBeGreaterThanOrEqual(r.metrics.requiredFS);
    expect(r.pass).toBe(true);
    assertBasis(r);
  });

  it('FAIL: steep slope (FoS < required)', () => {
    const r = checkInfiniteSlopeStability({
      slopeDeg: 35,
      phiDeg: 30,
      cohesion_kPa: 0,
      depth_m: 3,
      gamma_kNm3: 18,
      requiredFS: 1.5,
    });
    const handFS = Math.tan((30 * Math.PI) / 180) / Math.tan((35 * Math.PI) / 180);
    expect(r.metrics.factorOfSafety).toBeCloseTo(handFS, 5); // ≈ 0.825
    expect(r.metrics.factorOfSafety).toBeLessThan(r.metrics.requiredFS);
    expect(r.pass).toBe(false);
    assertBasis(r);
  });

  it('pore pressure lowers FoS (seepage sanity)', () => {
    const dry = checkInfiniteSlopeStability({ slopeDeg: 20, phiDeg: 30, depth_m: 3, gamma_kNm3: 18, waterDepth_m: 0, requiredFS: 1.5 });
    const wet = checkInfiniteSlopeStability({ slopeDeg: 20, phiDeg: 30, depth_m: 3, gamma_kNm3: 18, waterDepth_m: 3, requiredFS: 1.5 });
    expect(wet.metrics.factorOfSafety).toBeLessThan(dry.metrics.factorOfSafety);
    expect(wet.metrics.porePressure_kPa).toBeGreaterThan(0);
  });
});

describe('5. column buckling — Euler Pcr = π²EI/(KL)²', () => {
  // Hand calc: E=200000, I=1e7, K=1, L=3000 → Pcr = π²·2e5·1e7/9e6 = 2193.25 kN.
  const base = { E_MPa: STEEL_E_MPA, I_mm4: 1e7, K: 1, L_mm: 3000, r_mm: 50, requiredSF: 2.0 };
  it('PASS: demand ≤ Pcr/SF and slenderness OK', () => {
    const r = checkColumnBucklingEuler({ ...base, demand_kN: 800 });
    const handPcr = (Math.PI ** 2 * 2e5 * 1e7) / 3000 ** 2 / 1000;
    expect(r.metrics.criticalLoad_kN).toBeCloseTo(handPcr, 2); // ≈ 2193.25 kN
    expect(r.metrics.criticalLoad_kN).toBeCloseTo(2193.25, 1);
    expect(r.metrics.slenderness).toBeCloseTo(60, 6);
    expect(r.metrics.demand_kN).toBeLessThanOrEqual(r.metrics.allowableLoad_kN);
    expect(r.pass).toBe(true);
    assertBasis(r);
  });

  it('FAIL: demand exceeds Pcr/SF (over-loaded)', () => {
    const r = checkColumnBucklingEuler({ ...base, demand_kN: 1500 });
    expect(r.metrics.demand_kN).toBeGreaterThan(r.metrics.allowableLoad_kN);
    expect(r.pass).toBe(false);
    assertBasis(r);
  });

  it('FAIL: slenderness gate KL/r > 200', () => {
    const r = checkColumnBucklingEuler({ ...base, r_mm: 10, demand_kN: 10 });
    expect(r.metrics.slenderness).toBeGreaterThan(r.metrics.slendernessLimit);
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/slenderness/);
  });
});

describe('6. retaining-wall overturning FS', () => {
  // Hand calc (pass wall): H=4, ts=0.4, B=2.5, tb=0.4, toe=0.6, γB=18, φ=30, γC=24.
  // Ka=tan²30=0.3333, Pa=½·Ka·18·16=48 kN/m, Mo=48·4/3=64.
  // Mr = base 24·1.25 + stem 34.56·0.8 + soil 97.2·1.75 = 30+27.648+170.1 = 227.748.
  // FS = 227.748/64 = 3.559.
  it('PASS: broad-base wall (FS ≥ 2.0)', () => {
    const r = checkRetainingWallOverturning({
      H: 4,
      stemThickness_m: 0.4,
      baseWidth_m: 2.5,
      baseThickness_m: 0.4,
      toeLength_m: 0.6,
      gammaBackfill_kNm3: 18,
      phiBackfillDeg: 30,
      gammaConcrete_kNm3: 24,
      requiredFS: 2.0,
    });
    expect(rankineKa(30)).toBeCloseTo(1 / 3, 6);
    expect(r.metrics.Ka).toBeCloseTo(0.333333, 5);
    expect(r.metrics.activeThrust_kNpm).toBeCloseTo(48, 4); // hand-calc cross-check
    expect(r.metrics.overturningMoment_kNmpm).toBeCloseTo(64, 4);
    expect(r.metrics.resistingMoment_kNmpm).toBeCloseTo(227.748, 2);
    expect(r.metrics.factorOfSafety).toBeCloseTo(3.5586, 3);
    expect(r.metrics.factorOfSafety).toBeGreaterThanOrEqual(r.metrics.requiredFS);
    expect(r.pass).toBe(true);
    assertBasis(r);
  });

  it('FAIL: tall / narrow wall (FS < 2.0)', () => {
    const r = checkRetainingWallOverturning({
      H: 5,
      stemThickness_m: 0.3,
      baseWidth_m: 1.5,
      baseThickness_m: 0.4,
      toeLength_m: 0.3,
      gammaBackfill_kNm3: 18,
      phiBackfillDeg: 30,
      requiredFS: 2.0,
    });
    expect(r.metrics.overturningMoment_kNmpm).toBeCloseTo(125, 3); // Pa=75, Mo=75·5/3
    expect(r.metrics.factorOfSafety).toBeLessThan(r.metrics.requiredFS);
    expect(r.metrics.factorOfSafety).toBeCloseTo(0.8316, 3);
    expect(r.pass).toBe(false);
    assertBasis(r);
  });
});

describe('CIVIL_CHECKS registry', () => {
  it('exposes all six checks with runnable specs', () => {
    const ids = Object.keys(CIVIL_CHECKS).sort();
    expect(ids).toEqual(
      [
        'beam-bending-stress',
        'beam-deflection',
        'column-buckling-euler',
        'retaining-wall-overturning',
        'safety-factor',
        'slope-infinite-stability',
      ].sort(),
    );
    for (const id of ids) {
      expect(CIVIL_CHECKS[id].id).toBe(id);
      expect(typeof CIVIL_CHECKS[id].run).toBe('function');
      expect(CIVIL_CHECKS[id].domain).toMatch(/civil/);
    }
  });

  it('registry runner produces a real verdict', () => {
    const r = CIVIL_CHECKS['safety-factor'].run({ capacity: 300, demand: 100, requiredSF: 2 } as never);
    expect(r.pass).toBe(true);
    expect(r.metrics.safetyFactor).toBeCloseTo(3, 6);
  });
});
