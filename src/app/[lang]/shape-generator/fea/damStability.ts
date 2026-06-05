/**
 * damStability.ts — hydrostatic loading on a dam/retaining wall and its stability against
 * overturning and sliding (per unit width).
 *
 *   pressure at depth:  p = ρ·g·h                         (linear, zero at surface)
 *   resultant force:    F = ½·ρ·g·H²                       (acts at H/3 above the base)
 *   overturning moment: M_OT = F·(H/3)                     (about the toe)
 *   sliding FoS:        FS_s  = μ·W/F
 *   overturning FoS:    FS_OT = (W·x)/M_OT                 (W = weight, x = lever arm to toe)
 *
 * Verified against the H² force growth acting at H/3, the linear depth pressure, and the
 * sliding/overturning factors of safety (a heavier or wider dam is more stable).
 */

/** Hydrostatic pressure at depth p = ρ·g·h. */
export function pressureAtDepth(rho: number, g: number, h: number): number { return rho * g * h; }
/** Resultant hydrostatic force per unit width F = ½·ρ·g·H². */
export function hydrostaticForce(rho: number, g: number, H: number): number { return 0.5 * rho * g * H * H; }
/** Centre of pressure above the base H/3 (triangular distribution). */
export function centerOfPressure(H: number): number { return H / 3; }
/** Overturning moment about the toe M_OT = F·(H/3). */
export function overturningMoment(F: number, H: number): number { return (F * H) / 3; }
/** Factor of safety against sliding FS = μ·W/F. */
export function slidingFactorOfSafety(mu: number, W: number, F: number): number { return (mu * W) / F; }
/** Factor of safety against overturning FS = (W·x)/M_OT. */
export function overturningFactorOfSafety(W: number, x: number, F: number, H: number): number {
  return (W * x) / overturningMoment(F, H);
}
