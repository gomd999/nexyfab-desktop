/**
 * cohesiveZone — bilinear cohesive-zone fracture law, verified: the traction peaks at
 * T_max (δ0) and reaches zero at full separation δf; the area under the law equals the
 * fracture energy Gc; unloading follows a secant to the origin; and the damage is
 * irreversible (monotone, never heals).
 */
import { describe, it, expect } from 'vitest';
import { cohesiveTraction, onsetSeparation, failureSeparation, dissipatedEnergy, damage, CohesiveMaterial } from './cohesiveZone';

const mat: CohesiveMaterial = { K: 1e5, Tmax: 50, Gc: 0.5 };
const d0 = onsetSeparation(mat), df = failureSeparation(mat);

describe('cohesiveZone — bilinear traction-separation (verified)', () => {
  it('peaks at T_max (δ0) and falls to zero at full separation δf', () => {
    expect(d0).toBeCloseTo(mat.Tmax / mat.K, 12);
    expect(df).toBeCloseTo((2 * mat.Gc) / mat.Tmax, 12);
    expect(cohesiveTraction(d0, 0, mat).traction).toBeCloseTo(mat.Tmax, 8);
    expect(cohesiveTraction(df, 0, mat).traction).toBeCloseTo(0, 6);
    expect(cohesiveTraction(2 * df, 0, mat).traction).toBeCloseTo(0, 6); // fully separated
  });

  it('dissipates exactly the fracture energy Gc over a full opening', () => {
    expect(dissipatedEnergy(df, mat) / mat.Gc).toBeGreaterThan(0.999);
    expect(dissipatedEnergy(df, mat) / mat.Gc).toBeLessThan(1.001);
  });

  it('unloads along a secant to the origin (reduced stiffness)', () => {
    const dm = 0.005;                                 // a point on the softening branch
    const Tm = cohesiveTraction(dm, 0, mat).traction;
    const Thalf = cohesiveTraction(dm / 2, dm, mat).traction;
    expect(Thalf).toBeCloseTo(Tm / 2, 6);             // linear secant: T ∝ δ on unloading
    // reloading returns to the envelope at dm with the same damage.
    const reload = cohesiveTraction(dm, dm, mat);
    expect(reload.traction).toBeCloseTo(Tm, 8);
    expect(reload.damage).toBeCloseTo(damage(dm, mat), 12);
  });

  it('has irreversible, monotone damage (never heals)', () => {
    let dmax = 0, maxDamage = 0;
    for (const s of [0.001, 0.003, 0.005, 0.002, 0.004, 0.006, 0.001]) {
      const st = cohesiveTraction(s, dmax, mat);
      dmax = st.deltaMax;
      expect(st.damage).toBeGreaterThanOrEqual(maxDamage - 1e-12); // never decreases
      maxDamage = Math.max(maxDamage, st.damage);
    }
    expect(maxDamage).toBeGreaterThan(damage(0.005, mat)); // grew past the mid value
  });

  it('does not damage in compression (δ < 0 ⇒ T = Kδ, penalty contact)', () => {
    const c = cohesiveTraction(-1e-4, 0, mat);
    expect(c.traction).toBeCloseTo(mat.K * -1e-4, 6);
    expect(c.damage).toBe(0);
  });
});
