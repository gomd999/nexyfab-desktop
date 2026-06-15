/**
 * columnBuckling — Euler/Johnson column buckling with effective length, verified: the
 * end-condition K factors and the resulting 4× capacity of fixed-fixed over pinned;
 * σ_cr=π²E/λ² equalling P_cr/A; the transition slenderness where Euler and Johnson
 * meet (at Sy/2); and the Johnson parabola starting at Sy.
 */
import { describe, it, expect } from 'vitest';
import {
  effectiveLengthFactor, effectiveLength, eulerLoad, radiusOfGyration, slendernessRatio,
  criticalStress, transitionSlenderness, johnsonStress,
} from './columnBuckling';

const E = 200e9, b = 0.02, I = b ** 4 / 12, A = b * b, L = 2, Sy = 250e6;

describe('columnBuckling — Euler/Johnson columns (verified)', () => {
  it('the effective-length factors match the end conditions', () => {
    expect(effectiveLengthFactor('pinned-pinned')).toBe(1);
    expect(effectiveLengthFactor('fixed-fixed')).toBe(0.5);
    expect(effectiveLengthFactor('fixed-pinned')).toBe(0.7);
    expect(effectiveLengthFactor('fixed-free')).toBe(2);
  });

  it('fixed-fixed carries 4× the Euler load of pinned-pinned', () => {
    const pp = eulerLoad(E, I, effectiveLength(L, 'pinned-pinned'));
    const ff = eulerLoad(E, I, effectiveLength(L, 'fixed-fixed'));
    expect(ff / pp).toBeCloseTo(4, 6);                 // K=0.5 ⇒ Le²=0.25 ⇒ 4×
    expect(eulerLoad(E, I, effectiveLength(L, 'fixed-free')) / pp).toBeCloseTo(0.25, 6); // K=2 ⇒ 1/4×
  });

  it('the critical stress σ_cr=π²E/λ² equals P_cr/A', () => {
    const Le = effectiveLength(L, 'pinned-pinned');
    const r = radiusOfGyration(I, A);
    expect(r).toBeCloseTo(Math.sqrt(I / A), 12);
    const lambda = slendernessRatio(Le, r);
    expect(criticalStress(E, lambda)).toBeCloseTo(eulerLoad(E, I, Le) / A, 0);
  });

  it('Euler and Johnson meet at the transition slenderness (σ = Sy/2)', () => {
    const lambda1 = transitionSlenderness(E, Sy);
    expect(lambda1).toBeCloseTo(Math.sqrt((2 * Math.PI ** 2 * E) / Sy), 6);
    expect(criticalStress(E, lambda1)).toBeCloseTo(Sy / 2, -3);    // both = Sy/2 there
    expect(johnsonStress(Sy, lambda1, E)).toBeCloseTo(Sy / 2, -3);
  });

  it('the Johnson parabola starts at Sy and falls with slenderness', () => {
    expect(johnsonStress(Sy, 0, E)).toBeCloseTo(Sy, 6);             // zero slenderness ⇒ yield
    expect(johnsonStress(Sy, 80, E)).toBeLessThan(Sy);             // falls with λ
    // a stockier (shorter, lower λ) column carries more stress.
    expect(criticalStress(E, 100)).toBeGreaterThan(criticalStress(E, 200));
  });
});
