/**
 * stressConcentration — elastic stress-concentration factors, verified: the circular-
 * hole K_t=3 (ellipse a=b limit); the elliptical K_t=1+2a/b matching the tip-radius
 * form 1+2√(a/ρ); the crack-like divergence as ρ→0; the peak stress K_t·σ_nom; and the
 * fatigue notch factor K_f between 1 (q=0) and K_t (q=1).
 */
import { describe, it, expect } from 'vitest';
import {
  circularHoleKt, ellipticalHoleKt, ellipticalHoleKtFromRadius, ellipseTipRadius,
  maxStress, fatigueNotchFactor,
} from './stressConcentration';

describe('stressConcentration — K_t and notch fatigue (verified)', () => {
  it('a circular hole gives K_t = 3 (the a=b ellipse)', () => {
    expect(circularHoleKt()).toBe(3);
    expect(ellipticalHoleKt(1, 1)).toBeCloseTo(3, 9);
  });

  it('the elliptical K_t = 1+2a/b matches the tip-radius form 1+2√(a/ρ)', () => {
    const a = 2, b = 1;
    expect(ellipticalHoleKt(a, b)).toBeCloseTo(5, 9);
    const rho = ellipseTipRadius(a, b);
    expect(rho).toBeCloseTo((b * b) / a, 12);
    expect(ellipticalHoleKtFromRadius(a, rho)).toBeCloseTo(ellipticalHoleKt(a, b), 9);
  });

  it('a sharper (crack-like) notch concentrates more stress', () => {
    expect(ellipticalHoleKt(2, 0.01)).toBeGreaterThan(ellipticalHoleKt(2, 1)); // smaller b ⇒ higher K_t
    expect(ellipticalHoleKtFromRadius(2, 1e-4)).toBeGreaterThan(100);          // ρ → 0 ⇒ K_t → ∞
  });

  it('the peak stress is K_t·σ_nom', () => {
    expect(maxStress(100, 3)).toBe(300);
    expect(maxStress(50, ellipticalHoleKt(2, 1))).toBeCloseTo(250, 9);
  });

  it('the fatigue notch factor lies between 1 (q=0) and K_t (q=1)', () => {
    const Kt = 3;
    expect(fatigueNotchFactor(Kt, 0)).toBeCloseTo(1, 9);     // insensitive material
    expect(fatigueNotchFactor(Kt, 1)).toBeCloseTo(Kt, 9);    // fully sensitive
    expect(fatigueNotchFactor(Kt, 0.8)).toBeCloseTo(2.6, 9);
    expect(fatigueNotchFactor(Kt, 0.8)).toBeLessThan(Kt);    // K_f < K_t in general
  });
});
