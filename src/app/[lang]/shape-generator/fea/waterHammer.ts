/**
 * waterHammer.ts — transient pressure surge from rapid valve closure (the Joukowsky
 * equation) and the pressure-wave speed in an elastic pipe.
 *
 *   Joukowsky surge:   ΔP = ρ·a·Δv               (instantaneous closure)
 *   surge head:        Δh = a·Δv/g
 *   wave speed:        a  = √(K/ρ) / √(1 + (K/E)(D/t))   (fluid + pipe-wall elasticity)
 *   rigid-pipe limit:  a₀ = √(K/ρ)                (acoustic speed in the fluid)
 *   critical time:     t_c = 2L/a                  (wave reflection time; closure faster
 *                                                   than t_c gives the full surge)
 *
 * K = fluid bulk modulus, E = pipe Young's modulus, D = bore, t = wall thickness.
 * Verified against the rigid-pipe acoustic limit (E→∞ ⇒ a→√(K/ρ) ≈ 1480 m/s for water),
 * the surge-head identity Δh = ΔP/(ρg), pipe-elasticity lowering the wave speed, and the
 * 2L/a reflection time.
 */

const G = 9.80665;

/** Joukowsky pressure surge ΔP = ρ·a·Δv. */
export function joukowskySurge(rho: number, a: number, dv: number): number { return rho * a * dv; }
/** Surge head Δh = a·Δv/g. */
export function surgeHead(a: number, dv: number, g: number = G): number { return (a * dv) / g; }
/** Pressure-wave speed in an elastic pipe a = √(K/ρ)/√(1+(K/E)(D/t)). */
export function waveSpeed(K: number, rho: number, E: number, D: number, t: number): number {
  return Math.sqrt(K / rho) / Math.sqrt(1 + (K / E) * (D / t));
}
/** Rigid-pipe (acoustic) wave speed a₀ = √(K/ρ). */
export function acousticSpeed(K: number, rho: number): number { return Math.sqrt(K / rho); }
/** Critical (reflection) time t_c = 2L/a. */
export function criticalTime(L: number, a: number): number { return (2 * L) / a; }
