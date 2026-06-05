/**
 * flowMeter.ts — differential-pressure flow measurement (orifice plate, venturi, nozzle)
 * and free-jet discharge, from Bernoulli + continuity.
 *
 *   beta ratio:        β = d_throat / d_pipe
 *   approach factor:   E = 1/√(1 − β⁴)              (velocity-of-approach correction)
 *   ideal throat vel:  v₂ = E·√(2ΔP/ρ)
 *   metered flow:      Q = C_d·A₂·E·√(2ΔP/ρ)        (C_d ≈ 0.6 orifice, ~0.98 venturi)
 *   Torricelli jet:    v = √(2gh)                    (tank draining under head h)
 *
 * Verified against the Torricelli head velocity, the β→0 limit E→1 (small meter in a
 * large pipe), continuity v₁A₁ = v₂A₂, and the discharge-coefficient reduction.
 */

const G = 9.80665; // m/s²

/** Diameter ratio β = d_throat / d_pipe. */
export function betaRatio(dThroat: number, dPipe: number): number { return dThroat / dPipe; }
/** Velocity-of-approach factor E = 1/√(1 − β⁴). */
export function approachFactor(beta: number): number { return 1 / Math.sqrt(1 - beta ** 4); }
/** Ideal throat velocity v₂ = E·√(2ΔP/ρ). */
export function throatVelocity(dP: number, rho: number, beta: number): number {
  return approachFactor(beta) * Math.sqrt((2 * dP) / rho);
}
/** Metered volumetric flow Q = C_d·A₂·E·√(2ΔP/ρ). */
export function meteredFlow(Cd: number, areaThroat: number, dP: number, rho: number, beta: number): number {
  return Cd * areaThroat * throatVelocity(dP, rho, beta);
}
/** Torricelli free-jet velocity from a head h: v = √(2gh). */
export function torricelliVelocity(h: number, g: number = G): number { return Math.sqrt(2 * g * h); }
/** Circular area πD²/4. */
export function circleArea(D: number): number { return (Math.PI * D * D) / 4; }
