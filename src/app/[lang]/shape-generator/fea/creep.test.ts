/**
 * creep — secondary (Norton) creep / viscoplasticity, verified against the exact
 * solutions: the multiaxial flow is isochoric and reduces to ε̇ = Aσⁿ under uniaxial
 * stress; constant-stress creep accumulates strain linearly in time; a bar at
 * constant strain relaxes as σ₀e^{−EAt} (n=1) and the power-law relaxation (n=5),
 * with backward Euler converging to the exact curve as Δt → 0.
 */
import { describe, it, expect } from 'vitest';
import { creepStrainRate, equivalentCreepRate, creepUniaxial, relaxUniaxial } from './creep';

describe('creep — Norton power-law (verified)', () => {
  it('uniaxial creep rate is Aσⁿ, lateral −Aσⁿ/2, and isochoric', () => {
    const A = 1e-20, n = 5, sig = 200;
    const r = creepStrainRate([sig, 0, 0, 0, 0, 0], { A, n });
    expect(r[0]).toBeCloseTo(A * sig ** n, 15);
    expect(r[1]).toBeCloseTo(-A * sig ** n / 2, 15);
    expect(r[0] + r[1] + r[2]).toBeCloseTo(0, 12);       // no volume change
    expect(equivalentCreepRate(sig, { A, n })).toBeCloseTo(A * sig ** n, 15);
  });

  it('constant stress gives strain linear in time (secondary creep)', () => {
    const A = 1e-20, n = 5, sig = 200;
    const e = creepUniaxial(sig, { A, n }, 1, 10);
    expect(e[10]).toBeCloseTo(10 * A * sig ** n, 15);
    expect(e[5]).toBeCloseTo(5 * A * sig ** n, 15);       // constant rate ⇒ linear
  });

  it('relaxation with n=1 → σ₀e^{−EAt}, converging as Δt → 0', () => {
    const E = 200000, A = 5e-7; // EA = 0.1, τ = 10
    const exact = 200 * Math.exp(-E * A * 20);
    const coarse = relaxUniaxial(200, E, { A, n: 1 }, 0.1, 200);
    const fine = relaxUniaxial(200, E, { A, n: 1 }, 0.005, 4000);
    expect(fine.sigma[4000] / exact).toBeGreaterThan(0.998);
    expect(fine.sigma[4000] / exact).toBeLessThan(1.002);
    // first-order convergence: the finer step is closer to the exact value.
    expect(Math.abs(fine.sigma[4000] - exact)).toBeLessThan(Math.abs(coarse.sigma[200] - exact));
  });

  it('relaxation with n=5 → power-law, monotone decreasing', () => {
    const E = 200000, A = 1e-14;
    const exact = (Math.pow(200, -4) + 4 * E * A * 100) ** (-1 / 4);
    const r = relaxUniaxial(200, E, { A, n: 5 }, 0.05, 2000);
    expect(r.sigma[2000] / exact).toBeGreaterThan(0.997);
    expect(r.sigma[2000] / exact).toBeLessThan(1.003);
    for (let i = 1; i < r.sigma.length; i++) expect(r.sigma[i]).toBeLessThanOrEqual(r.sigma[i - 1] + 1e-12);
  });
});
