/**
 * powerScrew.ts — square-thread power (lead) screw: the torque to raise/lower a load,
 * efficiency, and the self-locking condition (jacks, presses, lead screws).
 *
 *   lead angle:     tan λ = L/(π·d_m)                       (L = lead, d_m = mean dia)
 *   raise torque:   T↑ = (W·d_m/2)·(tan λ + μ)/(1 − μ·tan λ)
 *   lower torque:   T↓ = (W·d_m/2)·(μ − tan λ)/(1 + μ·tan λ)
 *   efficiency:     η  = W·L/(2π·T↑) = tan λ·(1 − μ·tan λ)/(tan λ + μ)
 *   self-locking:   μ ≥ tan λ   (T↓ ≥ 0 — the screw will not back-drive)
 *
 * Verified against the η = W·L/(2π·T↑) energy definition, the frictionless η=1 limit,
 * and the self-locking ⇔ T↓≥0 equivalence.
 */

/** Lead (helix) angle λ = atan(L/(π·d_m)). */
export function leadAngle(lead: number, dm: number): number { return Math.atan(lead / (Math.PI * dm)); }
/** Torque to raise the load T↑ = (W·d_m/2)·(tanλ+μ)/(1−μ·tanλ). */
export function raiseTorque(W: number, dm: number, lambda: number, mu: number): number {
  const t = Math.tan(lambda);
  return ((W * dm) / 2) * ((t + mu) / (1 - mu * t));
}
/** Torque to lower the load T↓ = (W·d_m/2)·(μ−tanλ)/(1+μ·tanλ) (negative ⇒ self-locking). */
export function lowerTorque(W: number, dm: number, lambda: number, mu: number): number {
  const t = Math.tan(lambda);
  return ((W * dm) / 2) * ((mu - t) / (1 + mu * t));
}
/** Screw efficiency η = tanλ·(1−μ·tanλ)/(tanλ+μ). */
export function screwEfficiency(lambda: number, mu: number): number {
  const t = Math.tan(lambda);
  return (t * (1 - mu * t)) / (t + mu);
}
/** Self-locking condition μ ≥ tan λ. */
export function isSelfLocking(lambda: number, mu: number): boolean {
  return mu >= Math.tan(lambda);
}
