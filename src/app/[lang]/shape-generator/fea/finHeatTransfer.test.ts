/**
 * finHeatTransfer — extended-surface (fin) heat dissipation, verified: the efficiency
 * η = tanh(mL)/(mL); the cosh temperature profile (base = θb, cooler tip); the heat
 * rate equalling the base conduction −kA_c·dθ/dx; the effectiveness exceeding 1; and
 * the short-fin (η→1) and long-fin (η→1/mL) limits.
 */
import { describe, it, expect } from 'vitest';
import { finParameter, finEfficiency, finTemperature, finHeatRate, finEffectiveness } from './finHeatTransfer';

const k = 200, h = 50, t = 0.005, w = 0.1, L = 0.05, thetaB = 80;
const P = 2 * (w + t), Ac = w * t;
const m = finParameter(h, P, k, Ac), mL = m * L;

describe('finHeatTransfer — fin dissipation (verified)', () => {
  it('the efficiency is η = tanh(mL)/(mL)', () => {
    expect(finEfficiency(mL)).toBeCloseTo(Math.tanh(mL) / mL, 12);
  });

  it('the temperature profile starts at θb and cools toward the tip', () => {
    expect(finTemperature(0, L, m, thetaB)).toBeCloseTo(thetaB, 9);
    expect(finTemperature(L, L, m, thetaB)).toBeLessThan(thetaB);
    // monotone decreasing.
    let prev = thetaB + 1;
    for (let x = 0; x <= L; x += L / 10) { const T = finTemperature(x, L, m, thetaB); expect(T).toBeLessThan(prev); prev = T; }
  });

  it('the heat rate equals the conduction into the base −kA_c·dθ/dx|₀', () => {
    const d = 1e-7;
    const dTdx = (finTemperature(d, L, m, thetaB) - finTemperature(0, L, m, thetaB)) / d;
    expect(finHeatRate(h, P, k, Ac, L, thetaB) / (-k * Ac * dTdx)).toBeCloseTo(1, 4);
  });

  it('the effectiveness exceeds 1 (the fin is worthwhile)', () => {
    expect(finEffectiveness(h, P, k, Ac, L, thetaB)).toBeGreaterThan(1);
  });

  it('short and long fin limits: η→1 and η→1/mL', () => {
    expect(finEfficiency(0.01)).toBeCloseTo(1, 4);     // mL → 0
    expect(finEfficiency(10)).toBeCloseTo(1 / 10, 4);  // mL → ∞ ⇒ tanh→1 ⇒ η≈1/mL
    expect(finEfficiency(1)).toBeLessThan(finEfficiency(0.5)); // monotone decreasing in mL
  });
});
