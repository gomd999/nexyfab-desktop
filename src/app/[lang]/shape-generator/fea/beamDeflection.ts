/**
 * beamDeflection.ts — standard closed-form maximum deflections of prismatic beams, with
 * linear superposition of load cases.
 *
 *   cantilever, end load P:     δ = P·L³/(3EI)
 *   cantilever, UDL w:          δ = w·L⁴/(8EI)
 *   simply supported, mid P:    δ = P·L³/(48EI)
 *   simply supported, UDL w:    δ = 5·w·L⁴/(384EI)
 *   superposition:              δ_total = Σ δ_i           (linear elastic)
 *
 * Verified against the textbook coefficients, the cantilever-to-simply-supported point-
 * load stiffness ratio (16×), the linear superposition of combined loads, and the L³/L⁴
 * scalings.
 */

/** Cantilever tip deflection under an end point load δ = PL³/(3EI). */
export function cantileverPointLoad(P: number, L: number, E: number, I: number): number {
  return (P * L ** 3) / (3 * E * I);
}
/** Cantilever tip deflection under a uniform load δ = wL⁴/(8EI). */
export function cantileverUDL(w: number, L: number, E: number, I: number): number {
  return (w * L ** 4) / (8 * E * I);
}
/** Simply-supported mid-span deflection under a central point load δ = PL³/(48EI). */
export function simplySupportedPointLoad(P: number, L: number, E: number, I: number): number {
  return (P * L ** 3) / (48 * E * I);
}
/** Simply-supported mid-span deflection under a uniform load δ = 5wL⁴/(384EI). */
export function simplySupportedUDL(w: number, L: number, E: number, I: number): number {
  return (5 * w * L ** 4) / (384 * E * I);
}
/** Linear superposition of deflection contributions. */
export function superpose(...deflections: number[]): number {
  return deflections.reduce((s, d) => s + d, 0);
}
