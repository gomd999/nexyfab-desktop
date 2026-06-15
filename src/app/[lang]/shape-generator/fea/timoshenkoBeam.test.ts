/**
 * timoshenkoBeam — shear-deformable beam element, verified: the FEM cantilever tip
 * deflection matches the analytic δ = PL³/(3EI) + PL/(κGA); the shear contribution
 * grows for stubby beams; and the slender limit converges to Euler-Bernoulli with no
 * shear locking (reduced shear integration).
 */
import { describe, it, expect } from 'vitest';
import { analyticTipDeflection, cantileverTip, shearFraction, BeamProps } from './timoshenkoBeam';

const E = 210000, nu = 0.3, G = E / (2 * (1 + nu)), kappa = 5 / 6, P = 1000;
const rect = (h: number): BeamProps => { const bw = 10; return { E, I: (bw * h ** 3) / 12, G, A: bw * h, kappa }; };

describe('timoshenkoBeam — shear-deformable cantilever (verified)', () => {
  it('the FEM tip deflection matches the analytic bending + shear formula', () => {
    for (const [h, L] of [[20, 80], [50, 100]] as const) {
      const b = rect(h);
      expect(cantileverTip(P, L, b, 40) / analyticTipDeflection(P, L, b)).toBeCloseTo(1, 3);
    }
  });

  it('the shear contribution grows for stubby beams', () => {
    const slender = shearFraction(P, 100, rect(2));   // L/h = 50
    const stubby = shearFraction(P, 100, rect(50));   // L/h = 2
    expect(slender).toBeLessThan(0.01);               // negligible
    expect(stubby).toBeGreaterThan(0.1);              // significant
    expect(stubby).toBeGreaterThan(slender);
  });

  it('converges to Euler-Bernoulli in the slender limit (no shear locking)', () => {
    const b = rect(2), L = 100;                        // L/h = 50
    const euler = (P * L ** 3) / (3 * E * b.I);
    const fem = cantileverTip(P, L, b, 40);
    expect(fem / euler).toBeGreaterThan(0.999);        // matches Euler...
    expect(fem / euler).toBeLessThan(1.002);           // ...not collapsed by locking
    expect(fem / analyticTipDeflection(P, L, b)).toBeCloseTo(1, 3);
  });

  it('Timoshenko is always softer than Euler (extra shear compliance)', () => {
    const b = rect(40), L = 100;
    const euler = (P * L ** 3) / (3 * E * b.I);
    expect(analyticTipDeflection(P, L, b)).toBeGreaterThan(euler);
  });

  it('refines toward the analytic tip deflection', () => {
    const b = rect(30), L = 90;
    const an = analyticTipDeflection(P, L, b);
    const e1 = Math.abs(cantileverTip(P, L, b, 4) - an);
    const e2 = Math.abs(cantileverTip(P, L, b, 40) - an);
    expect(e2).toBeLessThanOrEqual(e1 + 1e-12);
    expect(e2 / an).toBeLessThan(1e-3);
  });
});
