/**
 * principalStress — principal stresses, Mohr's circle and invariants, verified: the
 * 2-D principal stresses and max shear, the shear vanishing on the principal planes,
 * the Mohr-circle radius invariant under rotation, and the 3-D eigenvalues/invariants/
 * von Mises for uniaxial, pure-shear and general states.
 */
import { describe, it, expect } from 'vitest';
import { principalStress2D, transformStress2D, principalStress3D } from './principalStress';

describe('principalStress — principal stresses & invariants (verified)', () => {
  it('2-D principal stresses, max shear and the principal angle', () => {
    const p = principalStress2D(100, 40, 30);
    expect(p.s1).toBeCloseTo(70 + Math.hypot(30, 30), 6);   // (σx+σy)/2 ± R
    expect(p.s2).toBeCloseTo(70 - Math.hypot(30, 30), 6);
    expect(p.tauMax).toBeCloseTo((p.s1 - p.s2) / 2, 9);
    // the shear vanishes on the principal plane and the normals are the principals.
    const t = transformStress2D(100, 40, 30, p.thetaP);
    expect(t.txy).toBeCloseTo(0, 9);
    expect(t.sx).toBeCloseTo(p.s1, 6);
    expect(t.sy).toBeCloseTo(p.s2, 6);
  });

  it('the Mohr-circle radius is invariant under rotation', () => {
    const center = 70, R = principalStress2D(100, 40, 30).tauMax;
    for (const deg of [0, 17, 45, 90, 130]) {
      const t = transformStress2D(100, 40, 30, (deg * Math.PI) / 180);
      expect(Math.hypot(t.sx - center, t.txy)).toBeCloseTo(R, 6); // lies on the circle
    }
  });

  it('3-D special states: uniaxial, pure shear, hydrostatic', () => {
    const uni = principalStress3D([200, 0, 0, 0, 0, 0]);
    expect([uni.s1, uni.s2, uni.s3]).toEqual([200, 0, 0]);
    expect(uni.vonMises).toBeCloseTo(200, 6);
    expect(uni.tauMax).toBeCloseTo(100, 6);

    const shear = principalStress3D([0, 0, 0, 50, 0, 0]);
    expect(shear.s1).toBeCloseTo(50, 6); expect(shear.s3).toBeCloseTo(-50, 6);
    expect(shear.vonMises).toBeCloseTo(Math.sqrt(3) * 50, 6); // √3·τ

    const hydro = principalStress3D([80, 80, 80, 0, 0, 0]);
    expect(hydro.vonMises).toBeCloseTo(0, 9);              // no deviatoric stress
    expect(hydro.tauMax).toBeCloseTo(0, 9);
  });

  it('the invariants match the eigenvalues (I1=Σσ, I3=Πσ) and ordering holds', () => {
    const g = principalStress3D([100, 40, 20, 30, 10, 15]);
    expect(g.s1).toBeGreaterThanOrEqual(g.s2);
    expect(g.s2).toBeGreaterThanOrEqual(g.s3);
    expect(g.I1).toBeCloseTo(g.s1 + g.s2 + g.s3, 6);
    expect(g.I3).toBeCloseTo(g.s1 * g.s2 * g.s3, 4);
    // von Mises from the principals.
    expect(g.vonMises).toBeCloseTo(
      Math.sqrt(0.5 * ((g.s1 - g.s2) ** 2 + (g.s2 - g.s3) ** 2 + (g.s3 - g.s1) ** 2)), 6,
    );
  });
});
