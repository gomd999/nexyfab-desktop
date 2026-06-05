/**
 * secantColumn — the secant formula for an eccentrically-loaded column, verified: the
 * P→0 limit σ → (P/A)(1 + ec/r²) (combined axial+bending with no amplification); the
 * e→0 pure-axial limit σ → P/A; and the unbounded growth of stress and deflection as
 * P approaches the Euler critical load.
 */
import { describe, it, expect } from 'vitest';
import { secantMaxStress, secantDeflection, eulerCritical } from './secantColumn';

describe('secantColumn — secant formula (verified)', () => {
  const E = 200e9, A = 1e-3, I = 8e-8, Le = 2, c = 0.05;
  const r = Math.sqrt(I / A), e = 0.005;
  const Pcr = eulerCritical(E, I, Le);

  it('reduces to (P/A)(1 + ec/r²) for vanishing load (no amplification)', () => {
    const P = 0.01; // negligible vs Pcr ⇒ sec→1
    expect(secantMaxStress(P, A, e, c, r, Le, E)).toBeCloseTo((P / A) * (1 + (e * c) / (r * r)), 4);
  });

  it('reduces to pure axial stress P/A when the eccentricity vanishes', () => {
    expect(secantMaxStress(1000, A, 1e-15, c, r, Le, E)).toBeCloseTo(1000 / A, 3);
  });

  it('amplifies stress and deflection without bound as P→P_cr', () => {
    const sLow = secantMaxStress(0.3 * Pcr, A, e, c, r, Le, E);
    const sHigh = secantMaxStress(0.99 * Pcr, A, e, c, r, Le, E);
    expect(sHigh).toBeGreaterThan(10 * sLow);              // dramatic amplification near buckling
    const dLow = secantDeflection(e, Le, 0.3 * Pcr, E, I);
    const dHigh = secantDeflection(e, Le, 0.99 * Pcr, E, I);
    expect(dHigh).toBeGreaterThan(10 * dLow);
    expect(dLow).toBeGreaterThan(0);                       // bent from the start (eccentric)
  });

  it('places the Euler load at the secant asymptote', () => {
    expect(Pcr).toBeCloseTo((Math.PI ** 2 * E * I) / (Le * Le), 3);
    // the secant argument at P_cr is π/2 (cos→0): deflection explodes just below it
    expect(secantDeflection(e, Le, 0.999 * Pcr, E, I)).toBeGreaterThan(secantDeflection(e, Le, 0.9 * Pcr, E, I));
  });
});
