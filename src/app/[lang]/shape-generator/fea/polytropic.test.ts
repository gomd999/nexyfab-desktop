/**
 * polytropic — the polytropic process PVⁿ=const, verified: the adiabatic (n=γ) T–P
 * ratio 10^((γ−1)/γ); the boundary-work integral (P₁V₁−P₂V₂)/(n−1) ≡ mR(T₁−T₂)/(n−1);
 * the isothermal (n=1) work P₁V₁·ln(V₂/V₁); and the polytropic specific heat limits
 * cₙ=0 at n=γ (adiabatic) and cₙ=cₚ at n=0 (isobaric).
 */
import { describe, it, expect } from 'vitest';
import { polytropicTempRatio, polytropicFinalTemp, polytropicWork, isothermalWork, polytropicSpecificHeat } from './polytropic';

describe('polytropic — PVⁿ process (verified)', () => {
  const gamma = 1.4;

  it('adiabatic (n=γ) gives T₂/T₁ = (P₂/P₁)^((γ−1)/γ)', () => {
    expect(polytropicTempRatio(1e6, 1e5, gamma)).toBeCloseTo(10 ** (0.4 / 1.4), 9); // 1.9307
    // temperature rises on compression
    expect(polytropicTempRatio(1e6, 1e5, gamma)).toBeGreaterThan(1);
  });

  it('the boundary work equals both (P₁V₁−P₂V₂)/(n−1) and mR(T₁−T₂)/(n−1)', () => {
    const n = 1.3, P1 = 1e5, P2 = 1e6, T1 = 300, mR = 1;
    const V1 = (mR * T1) / P1;
    const T2 = polytropicFinalTemp(T1, P1, P2, n), V2 = (mR * T2) / P2;
    expect(polytropicWork(P1, V1, P2, V2, n)).toBeCloseTo((mR * (T1 - T2)) / (n - 1), 6);
    expect(polytropicWork(P1, V1, P2, V2, n)).toBeLessThan(0); // compression ⇒ work done ON the gas
  });

  it('isothermal (n=1) work is P₁V₁·ln(V₂/V₁)', () => {
    const P1 = 1e5, V1 = 1e-3;
    expect(isothermalWork(P1, V1, 2 * V1)).toBeCloseTo(P1 * V1 * Math.log(2), 9);
  });

  it('the polytropic specific heat hits cₙ=0 (adiabatic) and cₙ=cₚ (isobaric)', () => {
    const cv = 718;
    expect(polytropicSpecificHeat(cv, gamma, gamma)).toBeCloseTo(0, 9);     // n=γ
    expect(polytropicSpecificHeat(cv, 0, gamma)).toBeCloseTo(gamma * cv, 6); // n=0 ⇒ cₚ
  });
});
