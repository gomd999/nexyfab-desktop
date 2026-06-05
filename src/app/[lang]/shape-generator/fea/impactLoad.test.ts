/**
 * impactLoad — dynamic amplification under sudden/falling loads, verified: the h=0
 * suddenly-applied factor of exactly 2; the high-drop √(2h/δ_st) asymptote; the stress
 * amplification σ_impact = n·σ_st; and the closing energy balance W(h+δ) = ½kδ².
 */
import { describe, it, expect } from 'vitest';
import { impactFactor, impactDeflection, impactStress, barStaticDeflection } from './impactLoad';

describe('impactLoad — dynamic amplification (verified)', () => {
  it('a suddenly-applied load (h=0) doubles the static response', () => {
    expect(impactFactor(0, 1e-3)).toBeCloseTo(2, 12);
    expect(impactDeflection(1e-3, 0)).toBeCloseTo(2e-3, 12);
  });

  it('approaches the √(2h/δ_st) asymptote for a high drop', () => {
    const n = impactFactor(1, 1e-4);
    expect(n).toBeGreaterThan(140);
    expect(n).toBeCloseTo(1 + Math.sqrt(1 + 2 * 1 / 1e-4), 9); // exact factor
    expect(n / Math.sqrt(2 * 1 / 1e-4)).toBeCloseTo(1, 1);   // dominated by the free-fall term
  });

  it('amplifies stress by the same factor as deflection', () => {
    const dst = barStaticDeflection(1000, 2, 1e-3, 200e9);   // WL/AE
    expect(dst).toBeCloseTo(1e-5, 12);
    const n = impactFactor(0.01, dst);
    expect(impactStress(1e6, 0.01, dst)).toBeCloseTo(n * 1e6, 3);
  });

  it('satisfies the energy balance W(h+δ) = ½kδ²', () => {
    const W = 1000, dst = barStaticDeflection(W, 2, 1e-3, 200e9), h = 0.01;
    const k = W / dst, d = impactDeflection(dst, h);
    expect(W * (h + d)).toBeCloseTo(0.5 * k * d * d, 6);
  });
});
