/**
 * transmissionLine — RF mismatch, verified: the matched case (Γ=0, S=1); the open/short
 * extremes (|Γ|=1, S→∞); the quarter-wave geometric-mean impedance; and the VSWR from
 * |Γ|.
 */
import { describe, it, expect } from 'vitest';
import { reflectionCoefficient, vswr, returnLoss, powerReflected, quarterWaveImpedance } from './transmissionLine';

describe('transmissionLine — mismatch (verified)', () => {
  const Z0 = 50;

  it('is matched when Z_L = Z₀ (Γ=0, S=1)', () => {
    expect(reflectionCoefficient(50, Z0)).toBeCloseTo(0, 15);
    expect(vswr(reflectionCoefficient(50, Z0))).toBeCloseTo(1, 12);
  });

  it('gives the VSWR and reflected power from |Γ|', () => {
    const g = reflectionCoefficient(75, Z0);
    expect(g).toBeCloseTo(0.2, 12);
    expect(vswr(g)).toBeCloseTo(1.5, 9);                 // (1+0.2)/(1−0.2)
    expect(powerReflected(g)).toBeCloseTo(0.04, 12);     // |Γ|²
    expect(returnLoss(g)).toBeCloseTo(-20 * Math.log10(0.2), 9); // ~14 dB
  });

  it('reflects fully at the open/short extremes', () => {
    expect(reflectionCoefficient(1e12, Z0)).toBeCloseTo(1, 9);   // open ⇒ Γ→+1
    expect(reflectionCoefficient(0, Z0)).toBeCloseTo(-1, 12);    // short ⇒ Γ=−1
    expect(vswr(reflectionCoefficient(0, Z0))).toBe(Infinity);
  });

  it('matches with a quarter-wave geometric-mean transformer', () => {
    expect(quarterWaveImpedance(50, 100)).toBeCloseTo(Math.sqrt(50 * 100), 9); // 70.71 Ω
    // a λ/4 line of Z_T = √(Z₀Z_L) presents Z_T²/Z_L = Z₀ at the input ⇒ matched
    const Zt = quarterWaveImpedance(50, 100);
    expect((Zt * Zt) / 100).toBeCloseTo(50, 9);
  });
});
