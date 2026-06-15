/**
 * wheatstone — Wheatstone-bridge strain-gauge measurement, verified: ΔR/R = GF·ε; the
 * balanced-bridge null (R₁R₃=R₂R₄); the quarter-bridge linearised output matching the
 * exact bridge formula for small strain; and the full > half > quarter sensitivity.
 */
import { describe, it, expect } from 'vitest';
import { gaugeResistanceChange, bridgeRatio, isBalanced, quarterBridge, halfBridge, fullBridge } from './wheatstone';

describe('wheatstone — strain-gauge bridge (verified)', () => {
  const GF = 2.0, eps = 1e-3, R = 350, Vin = 5;

  it('relates resistance change to strain: ΔR/R = GF·ε', () => {
    expect(gaugeResistanceChange(GF, eps, R) / R).toBeCloseTo(GF * eps, 12);
  });

  it('nulls a balanced bridge (R₁R₃ = R₂R₄)', () => {
    expect(bridgeRatio(R, R, R, R)).toBeCloseTo(0, 12);
    expect(isBalanced(R, R, R, R)).toBe(true);
    expect(isBalanced(100, 200, 300, 150)).toBe(true);  // 100·300 = 200·150
    expect(isBalanced(100, 200, 300, 151)).toBe(false);
  });

  it('quarter-bridge linear output matches the exact bridge for small strain', () => {
    const Rg = R * (1 + GF * eps);                       // one active gauge
    const exact = Math.abs(bridgeRatio(Rg, R, R, R));
    expect(exact).toBeCloseTo(quarterBridge(1, GF, eps), 6); // GF·ε/4, tiny nonlinearity
  });

  it('orders sensitivity full > half > quarter', () => {
    expect(fullBridge(Vin, GF, eps)).toBeCloseTo(2 * halfBridge(Vin, GF, eps), 12);
    expect(halfBridge(Vin, GF, eps)).toBeCloseTo(2 * quarterBridge(Vin, GF, eps), 12);
    expect(quarterBridge(Vin, GF, eps)).toBeCloseTo((Vin * GF * eps) / 4, 12);
  });
});
