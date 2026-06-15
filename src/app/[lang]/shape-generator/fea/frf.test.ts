/**
 * frf — structural-damping frequency response, verified: the SDOF receptance peaks
 * at ω_n with |H_peak| = 1/(kη) and −90° phase; the half-power (−3 dB) bandwidth
 * recovers the loss factor η = Δω/ω_n; the peak scales as 1/η; and the complex
 * modulus satisfies η = E''/E'.
 */
import { describe, it, expect } from 'vitest';
import { sdofFRF, magnitude, phase, halfPowerLossFactor, complexModulus } from './frf';

const m = 1, k = 10000, eta = 0.05;
const wn = Math.sqrt(k / m);

describe('frf — structural-damping FRF (verified)', () => {
  it('peaks at ω_n with magnitude 1/(kη) and −90° phase', () => {
    const H = sdofFRF(wn, m, k, eta);
    expect(magnitude(H)).toBeCloseTo(1 / (k * eta), 12);
    expect(phase(H) * 180 / Math.PI).toBeCloseTo(-90, 6);
    // it is a genuine peak: neighbours are smaller.
    expect(magnitude(sdofFRF(wn * 0.9, m, k, eta))).toBeLessThan(magnitude(H));
    expect(magnitude(sdofFRF(wn * 1.1, m, k, eta))).toBeLessThan(magnitude(H));
  });

  it('the half-power bandwidth recovers the loss factor η = Δω/ω_n', () => {
    const fr: number[] = [], mg: number[] = [];
    for (let w = 80; w <= 120; w += 0.02) { fr.push(w); mg.push(magnitude(sdofFRF(w, m, k, eta))); }
    expect(halfPowerLossFactor(fr, mg) / eta).toBeGreaterThan(0.99);
    expect(halfPowerLossFactor(fr, mg) / eta).toBeLessThan(1.01);
  });

  it('the resonant peak scales as 1/η (more damping ⇒ lower peak)', () => {
    const peak05 = magnitude(sdofFRF(wn, m, k, 0.05));
    const peak10 = magnitude(sdofFRF(wn, m, k, 0.10));
    expect(peak05 / peak10).toBeCloseTo(2, 6);             // halving η doubles the peak
  });

  it('the complex modulus has loss factor eta = E-loss / E-storage', () => {
    const cm = complexModulus(70000, 0.1);
    expect(cm.loss).toBeCloseTo(7000, 6);
    expect(cm.loss / cm.storage).toBeCloseTo(0.1, 10);
    expect(cm.lossFactor).toBe(0.1);
  });

  it('away from resonance the response is below the peak and the phase rotates', () => {
    const below = sdofFRF(wn * 0.5, m, k, eta);  // stiffness-dominated ⇒ phase near 0
    const above = sdofFRF(wn * 2, m, k, eta);    // mass-dominated ⇒ phase near −180°
    expect(Math.abs(phase(below) * 180 / Math.PI)).toBeLessThan(20);
    expect(Math.abs(phase(above) * 180 / Math.PI)).toBeGreaterThan(160);
  });
});
