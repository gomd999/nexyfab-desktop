/**
 * diffusion — Fick's-law mass diffusion, verified: the error function at known points
 * (erf(1)=0.8427, erf(0.5)=0.5205); the surface/deep boundary concentrations (C=C_s at
 * x=0, C→C₀ deep); the √t growth of the diffusion length; the self-similar fixed ratio
 * erfc(1) at x=2√(Dt); and Fick's first law opposing the gradient.
 */
import { describe, it, expect } from 'vitest';
import { erf, erfc, fickFlux, diffusionLength, concentrationProfile } from './diffusion';

describe('diffusion — Fick laws (verified)', () => {
  it('computes the error function accurately', () => {
    expect(erf(0)).toBeCloseTo(0, 6);
    expect(erf(1)).toBeCloseTo(0.8427008, 6);
    expect(erf(0.5)).toBeCloseTo(0.5204999, 6);
    expect(erf(-1)).toBeCloseTo(-0.8427008, 6);  // odd function
    expect(erfc(0)).toBeCloseTo(1, 6);
  });

  it('matches the surface and deep boundary concentrations', () => {
    const D = 1e-12, t = 3600, C0 = 0.1, Cs = 1.2;
    expect(concentrationProfile(0, D, t, C0, Cs)).toBeCloseTo(Cs, 6);       // surface
    expect(concentrationProfile(1e-3, D, t, C0, Cs)).toBeCloseTo(C0, 6);    // deep interior
  });

  it('grows the diffusion length like √t', () => {
    const D = 1e-12, t = 3600;
    expect(diffusionLength(D, t)).toBeCloseTo(2 * Math.sqrt(D * t), 15);
    expect(diffusionLength(D, 4 * t) / diffusionLength(D, t)).toBeCloseTo(2, 9); // ∝ √t
  });

  it('is self-similar: the ratio at x=2√(Dt) is fixed at erfc(1)', () => {
    const D = 1e-12, t = 3600, C0 = 0.1, Cs = 1.2;
    const xs = 2 * Math.sqrt(D * t);
    const ratio = (concentrationProfile(xs, D, t, C0, Cs) - C0) / (Cs - C0);
    expect(ratio).toBeCloseTo(erfc(1), 9);                                  // ~0.1573
    expect(fickFlux(D, 5, 1)).toBeLessThan(0);                             // flux down the gradient
  });
});
