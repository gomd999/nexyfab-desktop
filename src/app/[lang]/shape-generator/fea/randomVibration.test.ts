/**
 * randomVibration — linear random response to a PSD input, verified: the SDOF peak
 * transmissibility is Q, the resonance kernel integrates to the exact (π/2)Q·f_n,
 * Miles' equation matches the numerically integrated RMS of |H|²·W, and the response
 * variance scales linearly with the input PSD.
 */
import { describe, it, expect } from 'vitest';
import { transmissibilitySquared, resonanceKernel, rmsFromPSD, milesRMS, responsePSD } from './randomVibration';

const fn = 100, zeta = 0.025, Q = 1 / (2 * zeta), W = 0.1;

describe('randomVibration — PSD response (verified)', () => {
  it('peak transmissibility at resonance is ≈ Q', () => {
    expect(Math.sqrt(transmissibilitySquared(fn, fn, zeta))).toBeCloseTo(Q, 1); // 20.02 ≈ 20
    // away from resonance it is well below the peak.
    expect(Math.sqrt(transmissibilitySquared(fn * 3, fn, zeta))).toBeLessThan(1);
  });

  it('the SDOF resonance kernel integrates to (π/2)·Q·f_n exactly', () => {
    const integral = rmsFromPSD((f) => resonanceKernel(f, fn, zeta), 0, 2000, 40000) ** 2;
    expect(integral / ((Math.PI / 2) * Q * fn)).toBeCloseTo(1, 3);
  });

  it("Miles' equation matches the numerically integrated RMS response", () => {
    const numerical = rmsFromPSD(responsePSD(() => W, fn, zeta), 0, 2000, 40000);
    const miles = milesRMS(fn, Q, W);
    expect(numerical / miles).toBeGreaterThan(0.99);
    expect(numerical / miles).toBeLessThan(1.01);
  });

  it('response variance is linear in the input PSD', () => {
    const r1 = rmsFromPSD(responsePSD(() => W, fn, zeta), 0, 2000, 40000);
    const r2 = rmsFromPSD(responsePSD(() => 2 * W, fn, zeta), 0, 2000, 40000);
    expect((r2 / r1) ** 2).toBeCloseTo(2, 4);
  });

  it('more damping lowers the RMS response (∝ √Q)', () => {
    const light = rmsFromPSD(responsePSD(() => W, fn, 0.025), 0, 2000, 40000);
    const heavy = rmsFromPSD(responsePSD(() => W, fn, 0.05), 0, 2000, 40000);
    expect(heavy).toBeLessThan(light);
    // Miles ∝ √Q ⇒ halving Q (doubling ζ) scales RMS by √(1/2).
    expect(heavy / light).toBeCloseTo(Math.sqrt(0.5), 2);
  });
});
