/**
 * strainRosette — rosette gauge reduction + Mohr's strain circle, verified: a uniaxial
 * field measured by an aligned 45° rosette returns γxy=0 with principal strains ε and
 * −νε; the first strain invariant εx+εy = ε₁+ε₂; γ_max = ε₁−ε₂; and the 60° delta
 * rosette recovering the same field.
 */
import { describe, it, expect } from 'vitest';
import { rosette45, rosette60, principalStrains, maxShearStrain, principalAngle } from './strainRosette';

describe('strainRosette — gauge reduction + Mohr circle (verified)', () => {
  const eps = 1e-3, nu = 0.3, eyUni = -nu * eps;

  it('an aligned 45° rosette over a uniaxial field gives γxy=0 and principal ε, −νε', () => {
    const ea = eps, ec = eyUni, eb = (eps + ec) / 2; // gauge axes are the principal axes
    const s = rosette45(ea, eb, ec);
    expect(s.ex).toBeCloseTo(eps, 12);
    expect(s.ey).toBeCloseTo(eyUni, 12);
    expect(s.gxy).toBeCloseTo(0, 12);                       // no shear on principal axes
    const p = principalStrains(s);
    expect(p.e1).toBeCloseTo(eps, 12);
    expect(p.e2).toBeCloseTo(eyUni, 12);
    expect(principalAngle(s)).toBeCloseTo(0, 9);            // axes already aligned
  });

  it('preserves the first strain invariant and gives γ_max = ε₁−ε₂', () => {
    const s = rosette45(eps, (eps + eyUni) / 2, eyUni);
    const p = principalStrains(s);
    expect(s.ex + s.ey).toBeCloseTo(p.e1 + p.e2, 12);       // invariant
    expect(maxShearStrain(s)).toBeCloseTo(p.e1 - p.e2, 12);
  });

  it('a 60° delta rosette recovers the same uniaxial field', () => {
    // strain along a gauge at angle θ: ε(θ) = εx cos²θ + εy sin²θ (γxy=0 here)
    const eb = eps * 0.25 + eyUni * 0.75; // 60°
    const ec = eps * 0.25 + eyUni * 0.75; // 120° (same magnitude by symmetry)
    const s = rosette60(eps, eb, ec);
    expect(s.ex).toBeCloseTo(eps, 12);
    expect(s.ey).toBeCloseTo(eyUni, 12);
    expect(s.gxy).toBeCloseTo(0, 12);
  });
});
