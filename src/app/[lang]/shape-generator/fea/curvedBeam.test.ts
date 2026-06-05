/**
 * curvedBeam — Winkler curved-beam bending, verified: the neutral axis lying inside the
 * centroid (r_n < r_c); the inner-fibre stress exceeding the outer in magnitude; the zero
 * net axial force ∫σ dA = 0; and the straight-beam limit e→0 as the radius grows.
 */
import { describe, it, expect } from 'vitest';
import { neutralAxisRectangular, centroidalRadiusRectangular, eccentricity, curvedBeamStress, innerFiberStress, outerFiberStress } from './curvedBeam';

describe('curvedBeam — Winkler theory (verified)', () => {
  const ri = 50, ro = 100, b = 20, M = 1e6;
  const rn = neutralAxisRectangular(ri, ro);
  const rc = centroidalRadiusRectangular(ri, ro);
  const e = eccentricity(rc, rn);
  const A = b * (ro - ri);

  it('shifts the neutral axis inside the centroid', () => {
    expect(rn).toBeCloseTo((ro - ri) / Math.log(ro / ri), 9); // 72.13
    expect(rn).toBeLessThan(rc);                              // toward the centre of curvature
    expect(e).toBeGreaterThan(0);
  });

  it('stresses the inner fibre more than the outer', () => {
    const si = innerFiberStress(M, A, e, ri, rn);
    const so = outerFiberStress(M, A, e, ro, rn);
    expect(Math.abs(si)).toBeGreaterThan(Math.abs(so));      // inner fibre is critical
    expect(si).toBeGreaterThan(0);                           // tension inside
    expect(so).toBeLessThan(0);                              // compression outside
  });

  it('carries zero net axial force ∫σ dA = 0', () => {
    let integral = 0; const N = 20000;
    for (let i = 0; i < N; i++) {
      const r = ri + ((ro - ri) * (i + 0.5)) / N;
      integral += curvedBeamStress(M, A, e, r, rn) * (b * (ro - ri)) / N;
    }
    // normalise against a representative fibre force to judge "zero"
    expect(Math.abs(integral)).toBeLessThan(1e-3 * Math.abs(innerFiberStress(M, A, e, ri, rn) * A));
  });

  it('approaches the straight-beam limit (e→0) as the radius grows', () => {
    const eThin = eccentricity(centroidalRadiusRectangular(1000, 1010), neutralAxisRectangular(1000, 1010));
    expect(eThin).toBeLessThan(e);                           // far less curved ⇒ tiny eccentricity
    expect(eThin).toBeLessThan(0.01);
  });
});
