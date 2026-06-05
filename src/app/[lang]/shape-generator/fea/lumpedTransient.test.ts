/**
 * lumpedTransient — lumped-capacitance transient conduction, verified: the decay to 1/e
 * at one time constant; the identity t/τ = Bi·Fo (so θ=exp(−Bi·Fo)); the Bi<0.1 validity
 * threshold; and the Ti (t=0) / T∞ (t→∞) end conditions.
 */
import { describe, it, expect } from 'vitest';
import { biotNumber, timeConstant, lumpedTemperature, thermalDiffusivity, fourierNumber, isLumpedValid } from './lumpedTransient';

describe('lumpedTransient — lumped capacitance (verified)', () => {
  const h = 20, k = 200, Lc = 0.01, rho = 2700, cp = 900; // aluminium in mild convection
  const Bi = biotNumber(h, Lc, k);
  const tau = timeConstant(rho, Lc, cp, h, 1); // V=Lc, As=1

  it('cools to 1/e of the initial excess at one time constant', () => {
    const Ti = 200, Tinf = 25;
    const theta = (lumpedTemperature(Ti, Tinf, tau, tau) - Tinf) / (Ti - Tinf);
    expect(theta).toBeCloseTo(Math.exp(-1), 9); // 0.3679
  });

  it('satisfies t/τ = Bi·Fo', () => {
    const alpha = thermalDiffusivity(k, rho, cp), t = 50;
    const Fo = fourierNumber(alpha, t, Lc);
    expect(Bi * Fo).toBeCloseTo(t / tau, 9);
  });

  it('flags lumped validity at Bi<0.1', () => {
    expect(Bi).toBeLessThan(0.1);
    expect(isLumpedValid(Bi)).toBe(true);
    expect(isLumpedValid(0.5)).toBe(false); // thick/poorly-conducting body ⇒ gradients matter
  });

  it('starts at Ti and asymptotes to T∞', () => {
    const Ti = 200, Tinf = 25;
    expect(lumpedTemperature(Ti, Tinf, 0, tau)).toBeCloseTo(Ti, 9);
    expect(lumpedTemperature(Ti, Tinf, 1e9, tau)).toBeCloseTo(Tinf, 6);
  });
});
