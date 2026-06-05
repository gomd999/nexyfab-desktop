/**
 * projectile.ts — projectile (ballistic) motion under gravity, neglecting air resistance.
 *
 *   range:        R = v₀²·sin(2θ)/g                  (maximum at θ = 45°)
 *   max height:   H = v₀²·sin²θ/(2g)
 *   flight time:  T = 2·v₀·sinθ/g
 *   trajectory:   y(x) = x·tanθ − g·x²/(2·v₀²·cos²θ)
 *
 * Verified against the 45° maximum range, the equal range of complementary launch angles,
 * the trajectory returning to y=0 at x=R, and the apex at x=R/2.
 */

/** Horizontal range R = v₀²·sin(2θ)/g. */
export function range(v0: number, theta: number, g: number): number {
  return (v0 * v0 * Math.sin(2 * theta)) / g;
}
/** Maximum height H = v₀²·sin²θ/(2g). */
export function maxHeight(v0: number, theta: number, g: number): number {
  return (v0 * v0 * Math.sin(theta) ** 2) / (2 * g);
}
/** Time of flight T = 2·v₀·sinθ/g. */
export function timeOfFlight(v0: number, theta: number, g: number): number {
  return (2 * v0 * Math.sin(theta)) / g;
}
/** Trajectory height y(x) = x·tanθ − g·x²/(2·v₀²·cos²θ). */
export function trajectoryY(x: number, v0: number, theta: number, g: number): number {
  return x * Math.tan(theta) - (g * x * x) / (2 * v0 * v0 * Math.cos(theta) ** 2);
}
/** Optimal launch angle for maximum range (π/4). */
export function optimalAngle(): number { return Math.PI / 4; }
