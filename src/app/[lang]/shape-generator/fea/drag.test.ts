/**
 * drag — drag force, terminal velocity, and the Stokes creeping-flow regime, verified:
 * the drag-balance terminal velocity (F_D(v_t)=mg); the Stokes drag ≡ ½ρv²(24/Re)(πd²/4)
 * identity; and the Stokes settling velocity satisfying its own force balance
 * 3πμd·v_t = buoyant weight.
 */
import { describe, it, expect } from 'vitest';
import { dragForce, reynolds, terminalVelocity, stokesDrag, stokesDragCoefficient, stokesTerminalVelocity } from './drag';

describe('drag — drag & terminal velocity (verified)', () => {
  const g = 9.80665;

  it('the terminal velocity makes the drag balance the weight', () => {
    const m = 1, rho = 1.225, Cd = 0.47, d = 0.1, A = (Math.PI * d * d) / 4;
    const vt = terminalVelocity(m, g, rho, Cd, A);
    expect(dragForce(rho, vt, Cd, A)).toBeCloseTo(m * g, 9);
    // heavier body falls faster (v_t ∝ √m)
    expect(terminalVelocity(4, g, rho, Cd, A) / vt).toBeCloseTo(2, 9);
  });

  it('Stokes drag equals ½ρv²·(24/Re)·(πd²/4)', () => {
    const rho = 1.225, mu = 1.8e-5, v = 0.001, d = 0.1;
    const Re = reynolds(rho, v, d, mu);
    const A = (Math.PI * d * d) / 4;
    expect(stokesDrag(mu, d, v)).toBeCloseTo(dragForce(rho, v, stokesDragCoefficient(Re), A), 15);
  });

  it('the Stokes settling velocity balances drag against the buoyant weight', () => {
    const d = 1e-4, rhoP = 2500, rhoF = 1000, mu = 1e-3;
    const vt = stokesTerminalVelocity(d, rhoP, rhoF, mu, g);
    const netWeight = (Math.PI / 6) * d ** 3 * (rhoP - rhoF) * g;
    expect(stokesDrag(mu, d, vt)).toBeCloseTo(netWeight, 15);
    expect(vt).toBeGreaterThan(0);                          // denser-than-fluid particle sinks
  });

  it('drag grows with the square of velocity', () => {
    const rho = 1.225, Cd = 0.47, A = 0.01;
    expect(dragForce(rho, 20, Cd, A) / dragForce(rho, 10, Cd, A)).toBeCloseTo(4, 9);
  });
});
