/**
 * viscoelastic.ts — linear viscoelasticity by the Maxwell (spring–dashpot in series) and
 * Kelvin–Voigt (spring–dashpot in parallel) models.
 *
 *   relaxation/retardation time:  τ = η/E
 *   Maxwell stress relaxation:    σ(t) = σ₀·exp(−t/τ)          (decays fully — fluid-like)
 *   Maxwell creep:                ε(t) = σ/E + σ·t/η           (unbounded — viscous flow)
 *   Kelvin–Voigt creep:           ε(t) = (σ/E)·(1 − exp(−t/τ)) (bounded → σ/E — solid-like)
 *   relaxation modulus:           E(t) = E·exp(−t/τ)
 *
 * Verified against the Maxwell relaxation to σ₀/e at t=τ and to 0 at long time, the
 * Maxwell instant-elastic-then-linear creep, the Kelvin–Voigt delayed creep starting at
 * 0 and asymptoting to σ/E, and τ=η/E.
 */

/** Relaxation/retardation time τ = η/E. */
export function relaxationTime(eta: number, E: number): number { return eta / E; }
/** Maxwell stress relaxation σ(t) = σ₀·exp(−t/τ). */
export function maxwellRelaxation(sigma0: number, t: number, tau: number): number {
  return sigma0 * Math.exp(-t / tau);
}
/** Maxwell creep strain ε(t) = σ/E + σ·t/η (unbounded). */
export function maxwellCreep(sigma: number, E: number, eta: number, t: number): number {
  return sigma / E + (sigma * t) / eta;
}
/** Kelvin–Voigt creep strain ε(t) = (σ/E)·(1 − exp(−t/τ)). */
export function kelvinVoigtCreep(sigma: number, E: number, tau: number, t: number): number {
  return (sigma / E) * (1 - Math.exp(-t / tau));
}
/** Relaxation modulus E(t) = E·exp(−t/τ). */
export function relaxationModulus(E: number, t: number, tau: number): number {
  return E * Math.exp(-t / tau);
}
