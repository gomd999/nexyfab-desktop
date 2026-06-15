/**
 * flatPattern bend formulas — closed-form validation of the K-factor bend
 * allowance and bend deduction. These drive the sheet-metal flat-pattern length
 * (and the DXF export), but were previously untested.
 *
 *   BA = θ·(r + K·t)               (θ in radians)
 *   BD = 2·(r + t)·tan(θ/2) − BA
 */
import { describe, it, expect } from 'vitest';
import { calcBendAllowance, calcBendDeduction } from './flatPattern';

const deg = (d: number) => (d * Math.PI) / 180;

describe('calcBendAllowance', () => {
  it('equals θ·(r + K·t) for a 90° bend', () => {
    // r=2, t=1, K=0.33, 90° → (π/2)·(2 + 0.33) = 3.6603.
    expect(calcBendAllowance(2, 1, deg(90), 0.33)).toBeCloseTo((Math.PI / 2) * (2 + 0.33), 6);
  });

  it('scales linearly with bend angle', () => {
    const ba90 = calcBendAllowance(1, 1, deg(90), 0.4);
    const ba180 = calcBendAllowance(1, 1, deg(180), 0.4);
    expect(ba180).toBeCloseTo(2 * ba90, 6); // double angle → double allowance
  });

  it('a zero-radius 180° bend allowance is π·K·t', () => {
    expect(calcBendAllowance(0, 1, deg(180), 0.5)).toBeCloseTo(Math.PI * 0.5, 6);
  });

  it('is sign-independent in the bend angle', () => {
    expect(calcBendAllowance(2, 1, deg(-90), 0.33)).toBeCloseTo(calcBendAllowance(2, 1, deg(90), 0.33), 9);
  });
});

describe('calcBendDeduction', () => {
  it('equals 2·(r+t)·tan(θ/2) − BA for a 90° bend', () => {
    // r=1, t=1, K=0.33, 90°: 2·2·tan45° − (π/2)(1.33) = 4 − 2.0892 = 1.9108.
    const ba = (Math.PI / 2) * (1 + 0.33 * 1);
    const expected = 2 * (1 + 1) * Math.tan(deg(45)) - ba;
    expect(calcBendDeduction(1, 1, deg(90), 0.33)).toBeCloseTo(expected, 6);
    expect(calcBendDeduction(1, 1, deg(90), 0.33)).toBeCloseTo(1.9108, 3);
  });

  it('matches the BA-based identity at an arbitrary angle', () => {
    const r = 3, t = 1.5, k = 0.42, a = deg(120);
    const ba = calcBendAllowance(r, t, a, k);
    const expected = 2 * (r + t) * Math.tan(a / 2) - ba;
    expect(calcBendDeduction(r, t, a, k)).toBeCloseTo(expected, 9);
  });
});
