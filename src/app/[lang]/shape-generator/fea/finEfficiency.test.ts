/**
 * finEfficiency — straight-fin extended-surface heat transfer, verified: the
 * η = tanh(mL)/(mL) efficiency; the short/thick-fin limit η→1 (mL→0); the long-fin
 * η→1/(mL) asymptote; the adiabatic-tip temperature θ(L)/θ_b = 1/cosh(mL); and a fin
 * effectiveness ≫ 1 (worth adding).
 */
import { describe, it, expect } from 'vitest';
import { finParameter, finEfficiency, finHeatRate, finEffectiveness, tipTemperatureRatio } from './finEfficiency';

describe('finEfficiency — extended surface (verified)', () => {
  const h = 50, k = 200, L = 0.05, t = 0.002, w = 0.1;
  const Ac = w * t, P = 2 * (w + t), m = finParameter(h, P, k, Ac);

  it('gives η = tanh(mL)/(mL)', () => {
    expect(finEfficiency(m, L)).toBeCloseTo(Math.tanh(m * L) / (m * L), 12);
    expect(finEfficiency(m, L) * m * L).toBeCloseTo(Math.tanh(m * L), 12); // η·mL = tanh(mL)
  });

  it('reduces to η→1 for a short/thick fin and η→1/(mL) for a long fin', () => {
    expect(finEfficiency(0.001, 1)).toBeCloseTo(1, 6);     // mL→0
    expect(finEfficiency(5, 1)).toBeCloseTo(1 / 5, 4);     // mL=5 ⇒ tanh≈1
    expect(finEfficiency(5, 1)).toBeLessThan(finEfficiency(1, 1)); // longer ⇒ less efficient
  });

  it('has tip temperature θ(L)/θ_b = 1/cosh(mL)', () => {
    expect(tipTemperatureRatio(m, L)).toBeCloseTo(1 / Math.cosh(m * L), 12);
    expect(tipTemperatureRatio(m, L)).toBeLessThan(1);     // tip cooler than base
  });

  it('dissipates positive heat with effectiveness ≫ 1', () => {
    expect(finHeatRate(h, P, k, Ac, 60, L)).toBeGreaterThan(0);
    expect(finEffectiveness(h, P, k, Ac, 60, L)).toBeGreaterThan(2); // adding the fin pays off
  });
});
