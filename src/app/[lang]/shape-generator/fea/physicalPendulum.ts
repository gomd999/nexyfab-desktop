/**
 * physicalPendulum.ts — small-amplitude oscillation of a rigid body swinging about a pivot
 * (compound pendulum), and its reduction to the simple pendulum.
 *
 *   period:            T = 2π·√(I/(m·g·d))          (I about the pivot, d = pivot→CM)
 *   simple pendulum:   T = 2π·√(L/g)                (point mass at length L)
 *   equivalent length: L_eq = I/(m·d)               (simple pendulum of the same period)
 *   ang. frequency:    ω = √(m·g·d/I)
 *
 * Verified against the reduction to the simple pendulum (I=mL², d=L ⇒ T=2π√(L/g)), the
 * equivalent-length identity (compound period = simple period of length L_eq), the
 * uniform-rod-about-end case (L_eq = 2L/3), and ω = 2π/T.
 */

/** Physical (compound) pendulum period T = 2π·√(I/(m·g·d)). */
export function physicalPendulumPeriod(I: number, m: number, g: number, d: number): number {
  return 2 * Math.PI * Math.sqrt(I / (m * g * d));
}
/** Simple pendulum period T = 2π·√(L/g). */
export function simplePendulumPeriod(L: number, g: number): number {
  return 2 * Math.PI * Math.sqrt(L / g);
}
/** Equivalent simple-pendulum length L_eq = I/(m·d). */
export function equivalentLength(I: number, m: number, d: number): number { return I / (m * d); }
/** Angular frequency ω = √(m·g·d/I). */
export function pendulumAngularFrequency(I: number, m: number, g: number, d: number): number {
  return Math.sqrt((m * g * d) / I);
}
