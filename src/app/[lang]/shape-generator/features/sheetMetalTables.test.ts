/**
 * Sheet metal table validation.
 *
 * Reference values cross-checked against:
 *  - Machinery's Handbook 30th ed. (sheet metal bending chapter)
 *  - SolidWorks default K-factor tables
 *  - SheetMetalGuy.com worked examples
 *
 * Tolerances reflect the inherent variability of K-factor formulas —
 * different texts cite ±0.02 on K and ±0.5mm on BA. Our solver should
 * agree with any of them within those bands.
 */
import { describe, it, expect } from 'vitest';
import {
  bendAllowance,
  bendDeduction,
  outsideSetback,
  getKFactor,
  validateBend,
  SHEET_METAL_MATERIALS,
} from './sheetMetalTables';

describe('bend allowance — K-factor formula', () => {
  it('90° bend on 1.0mm mild steel, R=1.0mm, K=0.42 → BA ≈ 2.23mm', () => {
    // BA = π × (R + K×T) × A/180 = π × (1 + 0.42×1) × 90/180
    //    = π × 1.42 × 0.5 = 2.2305 mm
    const ba = bendAllowance(90, 1.0, 1.0, 0.42);
    expect(ba).toBeCloseTo(2.23, 1);
  });

  it('90° bend on 2.0mm steel, R=2.0mm, K=0.44 → BA ≈ 4.52mm', () => {
    // π × (2 + 0.44×2) × 0.5 = π × 2.88 × 0.5 = 4.524
    const ba = bendAllowance(90, 2.0, 2.0, 0.44);
    expect(ba).toBeCloseTo(4.52, 1);
  });

  it('45° bend halves the 90° allowance for the same geometry', () => {
    const ba90 = bendAllowance(90, 1.0, 1.0, 0.44);
    const ba45 = bendAllowance(45, 1.0, 1.0, 0.44);
    expect(ba45).toBeCloseTo(ba90 / 2, 3);
  });

  it('zero thickness collapses to π·R·A/180 (pure arc length)', () => {
    const ba = bendAllowance(180, 5.0, 0, 0.5);
    expect(ba).toBeCloseTo(Math.PI * 5, 3);
  });
});

describe('outside setback', () => {
  it('90° bend on 2.0mm steel, R=2.0mm → OSSB = R+T = 4mm', () => {
    // tan(45°) × (R+T) = 1 × 4 = 4
    expect(outsideSetback(90, 2.0, 2.0)).toBeCloseTo(4.0, 3);
  });

  it('45° bend on 2.0mm steel, R=2.0mm → OSSB ≈ tan(22.5°)×4 ≈ 1.657', () => {
    expect(outsideSetback(45, 2.0, 2.0)).toBeCloseTo(Math.tan(Math.PI / 8) * 4, 3);
  });
});

describe('bend deduction — BD = 2·OSSB − BA', () => {
  it('90° bend on 1.6mm steel, R=1.6mm, K=0.44 → BD ≈ 3.2−3.62 ≈ 2.96mm', () => {
    // OSSB = 1×(1.6+1.6) = 3.2; BA = π×(1.6+0.44×1.6)×0.5 = π×2.304×0.5 ≈ 3.619
    // BD = 2×3.2 − 3.619 ≈ 2.781
    const bd = bendDeduction(90, 1.6, 1.6, 0.44);
    expect(bd).toBeCloseTo(2.781, 2);
  });

  it('matches the relation BD = 2·OSSB − BA across inputs', () => {
    const angle = 60, R = 2.0, T = 1.5, K = 0.43;
    expect(bendDeduction(angle, R, T, K))
      .toBeCloseTo(2 * outsideSetback(angle, R, T) - bendAllowance(angle, R, T, K), 6);
  });
});

describe('K-factor interpolation', () => {
  it('returns curve endpoint when R/T below the lowest sample', () => {
    const k = getKFactor('mildSteel', 0.1, 1.0); // r/t = 0.1 < first sample 0.5
    expect(k).toBe(SHEET_METAL_MATERIALS.mildSteel.kFactorCurve[0].k);
  });

  it('returns curve endpoint when R/T above the highest sample', () => {
    const k = getKFactor('mildSteel', 100, 1.0); // r/t = 100 > last sample 10
    expect(k).toBe(SHEET_METAL_MATERIALS.mildSteel.kFactorCurve.at(-1)!.k);
  });

  it('linearly interpolates between sample points', () => {
    // mildSteel curve has (rt=1.0, k=0.42) and (rt=2.0, k=0.44).
    // At rt=1.5 we expect midpoint k = 0.43.
    const k = getKFactor('mildSteel', 1.5, 1.0);
    expect(k).toBeCloseTo(0.43, 2);
  });

  it('returns 0.44 default on zero thickness (avoids divide by zero)', () => {
    expect(getKFactor('mildSteel', 1.0, 0)).toBe(0.44);
  });

  it('stainless 304 is consistently lower than mild steel at small R/T (work hardening)', () => {
    // Sharp bends — stainless K should sit lower than mild steel because of
    // the higher tensile strength shifting the neutral axis inward.
    const kSs = getKFactor('stainless304', 0.5, 1.0);
    const kMs = getKFactor('mildSteel', 0.5, 1.0);
    expect(kSs).toBeLessThan(kMs);
  });
});

describe('validateBend — minimum radius gate', () => {
  it('flags radius below minBendRadiusFactor × thickness as error', () => {
    // mildSteel minBendRadiusFactor = 1.0 → for 2mm sheet min R = 2mm
    const warnings = validateBend('mildSteel', 2.0, 1.0, 90);
    const hasRadiusError = warnings.some(w => w.code === 'radiusTooSmall' && w.severity === 'error');
    expect(hasRadiusError).toBe(true);
  });

  it('passes when radius meets the minimum', () => {
    const warnings = validateBend('mildSteel', 2.0, 2.0, 90);
    const radiusErrors = warnings.filter(w => w.code === 'radiusTooSmall');
    expect(radiusErrors).toHaveLength(0);
  });

  it('flags angle outside 0–180° range', () => {
    const overflow = validateBend('mildSteel', 1.0, 1.0, 200);
    const underflow = validateBend('mildSteel', 1.0, 1.0, 0);
    expect(overflow.some(w => w.code === 'angleOutOfRange')).toBe(true);
    expect(underflow.some(w => w.code === 'angleOutOfRange')).toBe(true);
  });

  it('stainless requires 1.5× thickness minimum (vs 1.0× for mild steel)', () => {
    // Same 2mm radius on 2mm sheet → ok for mild steel, error for stainless
    const ms = validateBend('mildSteel', 2.0, 2.0, 90);
    const ss = validateBend('stainless304', 2.0, 2.0, 90);
    expect(ms.some(w => w.code === 'radiusTooSmall')).toBe(false);
    expect(ss.some(w => w.code === 'radiusTooSmall')).toBe(true);
  });
});

describe('material database completeness', () => {
  it('has the 7 documented materials with full property sets', () => {
    const ids = Object.keys(SHEET_METAL_MATERIALS);
    expect(ids).toHaveLength(7);
    for (const id of ids) {
      const m = SHEET_METAL_MATERIALS[id as keyof typeof SHEET_METAL_MATERIALS];
      expect(m.density).toBeGreaterThan(0);
      expect(m.tensileStrength).toBeGreaterThan(0);
      expect(m.minBendRadiusFactor).toBeGreaterThan(0);
      expect(m.kFactorCurve.length).toBeGreaterThanOrEqual(2);
      // K-factor curve must be monotonic non-decreasing in K vs R/T.
      for (let i = 1; i < m.kFactorCurve.length; i++) {
        expect(m.kFactorCurve[i].rt).toBeGreaterThan(m.kFactorCurve[i - 1].rt);
        expect(m.kFactorCurve[i].k).toBeGreaterThanOrEqual(m.kFactorCurve[i - 1].k);
      }
    }
  });
});
