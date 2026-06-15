/**
 * lameCylinder — Lamé thick-walled cylinder, verified: the boundary tractions
 * σr(a)=−pi, σr(b)=−po; the peak hoop stress at the inner wall = pi(b²+a²)/(b²−a²);
 * the Lamé invariant σr+σθ=2A; the thin-wall limit σθ→pi·r/t; and compressive hoop
 * under external pressure.
 */
import { describe, it, expect } from 'vitest';
import { lameConstants, radialStress, hoopStress, maxHoopStress, thinWallHoop } from './lameCylinder';

const a = 0.1, b = 0.2, pi = 100;

describe('lameCylinder — thick-walled cylinder (verified)', () => {
  it('satisfies the boundary tractions σr(a)=−pi, σr(b)=−po', () => {
    const k = lameConstants(a, b, pi, 0);
    expect(radialStress(a, k)).toBeCloseTo(-pi, 9);
    expect(radialStress(b, k)).toBeCloseTo(0, 9);
    const k2 = lameConstants(a, b, 100, 30);
    expect(radialStress(a, k2)).toBeCloseTo(-100, 9);
    expect(radialStress(b, k2)).toBeCloseTo(-30, 9);
  });

  it('peaks the hoop stress at the inner wall = pi(b²+a²)/(b²−a²)', () => {
    const k = lameConstants(a, b, pi, 0);
    expect(hoopStress(a, k)).toBeCloseTo(maxHoopStress(a, b, pi), 6);
    expect(hoopStress(a, k)).toBeGreaterThan(hoopStress(b, k)); // inner > outer
    expect(hoopStress(a, k)).toBeGreaterThan(pi);               // > internal pressure
  });

  it('the Lamé invariant σr + σθ = 2A is constant through the wall', () => {
    const k = lameConstants(a, b, pi, 0);
    for (const r of [a, 0.13, 0.16, b]) expect(radialStress(r, k) + hoopStress(r, k)).toBeCloseTo(2 * k.A, 9);
  });

  it('approaches the thin-wall hoop stress pi·r/t as the wall thins', () => {
    const ai = 0.1, bi = 0.102, t = 0.002, rm = (ai + bi) / 2; // t/r ≈ 2%
    const k = lameConstants(ai, bi, pi, 0);
    expect(hoopStress(rm, k) / thinWallHoop(pi, rm, t)).toBeCloseTo(1, 1); // within ~1%
  });

  it('external pressure produces compressive hoop stress', () => {
    const k = lameConstants(a, b, 0, 100); // external pressure only
    expect(hoopStress(a, k)).toBeLessThan(0);
    expect(radialStress(b, k)).toBeCloseTo(-100, 9);
  });
});
