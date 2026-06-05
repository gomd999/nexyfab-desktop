/**
 * jetImpact.ts — force of a fluid jet from the steady momentum equation (turbines, Pelton
 * wheels, nozzle reaction).
 *
 *   flat plate (normal):   F = ρ·A·v² = ρ·Q·v
 *   moving plate:          F = ρ·A·(v − u)²              (relative velocity)
 *   deflecting vane:       F = ρ·Q·v·(1 − cosβ)         (β = deflection; 180° ⇒ 2ρQv)
 *   power on moving vane:   P = F·u   (max at u = v/3 for a flat plate)
 *
 * Verified against the flat-plate F=ρQv ≡ ρAv², the 90°-vane reduction to the flat-plate
 * force, the 180°-vane doubling, the relative-velocity moving-plate force, and the
 * maximum power transfer at u = v/3.
 */

/** Force on a stationary normal flat plate F = ρ·A·v². */
export function jetForceFlatPlate(rho: number, A: number, v: number): number { return rho * A * v * v; }
/** Force on a plate moving at u in the jet direction F = ρ·A·(v − u)². */
export function jetForceMovingPlate(rho: number, A: number, v: number, u: number): number {
  return rho * A * (v - u) ** 2;
}
/** Force on a vane deflecting the jet by β: F = ρ·Q·v·(1 − cosβ). */
export function jetForceVane(rho: number, Q: number, v: number, beta: number): number {
  return rho * Q * v * (1 - Math.cos(beta));
}
/** Power delivered to a moving surface P = F·u. */
export function jetPower(F: number, u: number): number { return F * u; }
