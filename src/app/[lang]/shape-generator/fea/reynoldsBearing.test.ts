/**
 * reynoldsBearing — 1-D hydrodynamic slider bearing (Reynolds equation), verified:
 * the numerical pressure solve reproduces the closed-form load capacity
 * W = 6μUL²/h2²·C_w(K); a parallel film carries no load (convergence is essential);
 * the pressure is positive and peaks inside; the load is linear in μU; and the
 * convergence ratio that maximises the load is ≈ 2.2.
 */
import { describe, it, expect } from 'vitest';
import { reynoldsPressure, loadCapacity, loadCoefficient, analyticLoad, linearFilm } from './reynoldsBearing';

const mu = 0.01, U = 1, L = 0.1, h2 = 1e-4, n = 2001;

describe('reynoldsBearing — hydrodynamic slider (verified)', () => {
  it('the numerical load capacity matches the closed-form slider formula', () => {
    const h1 = 2e-4; // K = 2
    const p = reynoldsPressure(linearFilm(h1, h2, n), L, mu, U);
    expect(loadCapacity(p, L) / analyticLoad(mu, U, L, h1, h2)).toBeCloseTo(1, 3);
    expect(loadCoefficient(2)).toBeCloseTo(Math.log(2) - 2 / 3, 6);
  });

  it('a parallel film carries no load (convergence is essential)', () => {
    const p = reynoldsPressure(linearFilm(h2, h2, n), L, mu, U);
    expect(Math.max(...p.map(Math.abs))).toBeLessThan(1e-6);
    expect(loadCapacity(p, L)).toBeCloseTo(0, 6);
    expect(loadCoefficient(1)).toBe(0);
  });

  it('the pressure is positive and peaks inside the bearing', () => {
    const p = reynoldsPressure(linearFilm(2e-4, h2, n), L, mu, U);
    for (const v of p) expect(v).toBeGreaterThanOrEqual(-1e-6);
    const iPeak = p.indexOf(Math.max(...p));
    expect(iPeak).toBeGreaterThan(0);
    expect(iPeak).toBeLessThan(n - 1);                 // not at a boundary
    expect(p[0]).toBeCloseTo(0, 6); expect(p[n - 1]).toBeCloseTo(0, 6); // zero at inlet/outlet
  });

  it('the load is linear in viscosity × speed', () => {
    const film = linearFilm(2e-4, h2, n);
    const W1 = loadCapacity(reynoldsPressure(film, L, mu, U), L);
    const W2 = loadCapacity(reynoldsPressure(film, L, 2 * mu, U), L);
    const W3 = loadCapacity(reynoldsPressure(film, L, mu, 3 * U), L);
    expect(W2 / W1).toBeCloseTo(2, 4);
    expect(W3 / W1).toBeCloseTo(3, 4);
  });

  it('the load-maximising convergence ratio is about 2.2', () => {
    let bestK = 0, best = 0;
    for (let K = 1.1; K < 5; K += 0.01) { const cw = loadCoefficient(K); if (cw > best) { best = cw; bestK = K; } }
    expect(bestK).toBeGreaterThan(2.0);
    expect(bestK).toBeLessThan(2.4);                   // classic optimum ≈ 2.19
  });
});
