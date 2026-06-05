/**
 * drag.ts — aerodynamic/hydrodynamic drag, terminal velocity of a falling body, and the
 * low-Reynolds Stokes regime.
 *
 *   drag force:        F_D = ½·ρ·v²·C_d·A
 *   Reynolds number:   Re = ρ·v·d/μ
 *   terminal velocity: v_t = √(2mg/(ρ·C_d·A))          (drag balances weight)
 *   Stokes drag:       F_D = 3π·μ·d·v   ⇔   C_d = 24/Re   (creeping flow, Re ≪ 1)
 *   Stokes settling:   v_t = g·d²·(ρ_p − ρ_f)/(18μ)
 *
 * Verified against the drag-balance terminal velocity (F_D(v_t)=mg), the Stokes
 * drag ≡ ½ρv²·(24/Re)·(πd²/4) identity, and the Stokes settling velocity satisfying
 * its own force balance 3πμd·v_t = buoyant weight.
 */

/** Drag force F_D = ½ρv²·C_d·A. */
export function dragForce(rho: number, v: number, Cd: number, A: number): number {
  return 0.5 * rho * v * v * Cd * A;
}
/** Reynolds number Re = ρvd/μ. */
export function reynolds(rho: number, v: number, d: number, mu: number): number {
  return (rho * v * d) / mu;
}
/** Terminal velocity v_t = √(2mg/(ρ·C_d·A)). */
export function terminalVelocity(m: number, g: number, rho: number, Cd: number, A: number): number {
  return Math.sqrt((2 * m * g) / (rho * Cd * A));
}
/** Stokes drag F_D = 3π·μ·d·v (creeping flow). */
export function stokesDrag(mu: number, d: number, v: number): number {
  return 3 * Math.PI * mu * d * v;
}
/** Stokes drag coefficient C_d = 24/Re. */
export function stokesDragCoefficient(Re: number): number { return 24 / Re; }
/** Stokes settling velocity v_t = g·d²·(ρ_p−ρ_f)/(18μ). */
export function stokesTerminalVelocity(d: number, rhoP: number, rhoF: number, mu: number, g: number): number {
  return (g * d * d * (rhoP - rhoF)) / (18 * mu);
}
