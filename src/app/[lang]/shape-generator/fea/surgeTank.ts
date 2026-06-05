/**
 * surgeTank.ts — surge-tank mass oscillation in a hydropower conduit. After a load
 * rejection the water column in the tunnel oscillates into the surge tank (a U-tube
 * analogue), bounding the water-hammer pressure.
 *
 *   continuity:   A_p·V = A_t·dZ/dt
 *   dynamics:     d²Z/dt² = −(g·A_p/(L·A_t))·Z          ⇒ SHM
 *   period:       T_s   = 2π·√(L·A_t/(g·A_p))
 *   max surge:    Z_max = V₀·√(L·A_p/(g·A_t))           (frictionless)
 *
 *   L = tunnel length, A_p = tunnel area, A_t = surge-tank area, V₀ = initial velocity.
 * Verified against the energy balance (½ρLA_p·V₀² = ½ρg·A_t·Z_max²), the SHM kinematic
 * Z_max = (A_p/A_t)·V₀/ω, and the tank-area trends (bigger tank ⇒ longer period, lower surge).
 */

/** Surge oscillation period T_s = 2π·√(L·A_t/(g·A_p)). */
export function surgePeriod(L: number, At: number, Ap: number, g: number): number {
  return 2 * Math.PI * Math.sqrt((L * At) / (g * Ap));
}
/** Angular frequency ω = √(g·A_p/(L·A_t)). */
export function surgeAngularFrequency(L: number, At: number, Ap: number, g: number): number {
  return Math.sqrt((g * Ap) / (L * At));
}
/** Maximum (frictionless) surge amplitude Z_max = V₀·√(L·A_p/(g·A_t)). */
export function maxSurgeAmplitude(V0: number, L: number, Ap: number, At: number, g: number): number {
  return V0 * Math.sqrt((L * Ap) / (g * At));
}
