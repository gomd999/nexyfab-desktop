/**
 * capillary.ts — surface-tension capillarity: capillary rise (Jurin's law) and the
 * Young–Laplace pressure jump across a curved interface.
 *
 *   Jurin's law:      h = 2·γ·cosθ/(ρ·g·r)         (θ < 90° rise, θ > 90° depression)
 *   Young–Laplace:    Δp = 2γ/r  (spherical drop/bubble),  Δp = γ/r  (cylinder)
 *
 *   γ = surface tension, θ = contact angle, r = tube/interface radius.
 * Verified against the h ∝ 1/r rise, the maximum rise at θ=0 (perfect wetting), the
 * negative rise (depression) for a non-wetting liquid (θ>90°, e.g. mercury), and the
 * sphere = 2× cylinder Young–Laplace pressure.
 */

/** Capillary rise (Jurin) h = 2·γ·cosθ/(ρ·g·r). */
export function capillaryRise(gamma: number, theta: number, rho: number, r: number, g: number): number {
  return (2 * gamma * Math.cos(theta)) / (rho * g * r);
}
/** Young–Laplace pressure across a spherical interface Δp = 2γ/r. */
export function youngLaplaceSphere(gamma: number, r: number): number { return (2 * gamma) / r; }
/** Young–Laplace pressure across a cylindrical interface Δp = γ/r. */
export function youngLaplaceCylinder(gamma: number, r: number): number { return gamma / r; }
/** True if the liquid wets the surface (contact angle < 90° ⇒ rises). */
export function isWetting(theta: number): boolean { return theta < Math.PI / 2; }
