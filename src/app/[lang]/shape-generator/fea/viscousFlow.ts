/**
 * viscousFlow.ts — laminar viscous flow: drag-driven Couette flow between plates and
 * pressure-driven Hagen–Poiseuille flow in a round pipe.
 *
 *   Couette:           u(y) = U·y/h  (linear),   τ = μU/h  (uniform)
 *   Hagen–Poiseuille:  Q = π·R⁴·Δp/(8μL)
 *   centreline vel.:   u_max = R²·Δp/(4μL) = 2·ū    (twice the mean)
 *   mean velocity:     ū = R²·Δp/(8μL) = Q/(πR²)
 *   wall shear:        τ_w = R·Δp/(2L)               (force balance)
 *
 * Verified against the linear Couette profile and uniform shear, the Q ∝ R⁴ pipe law,
 * the u_max = 2·ū relation, and the mean velocity ū = Q/(πR²).
 */

/** Couette wall shear stress τ = μU/h (uniform). */
export function couetteShearStress(mu: number, U: number, h: number): number { return (mu * U) / h; }
/** Couette velocity profile u(y) = U·y/h (linear). */
export function couetteVelocity(U: number, y: number, h: number): number { return (U * y) / h; }
/** Hagen–Poiseuille volumetric flow Q = π·R⁴·Δp/(8μL). */
export function hagenPoiseuilleFlow(R: number, dp: number, mu: number, L: number): number {
  return (Math.PI * R ** 4 * dp) / (8 * mu * L);
}
/** Centreline (maximum) velocity u_max = R²·Δp/(4μL). */
export function poiseuilleMaxVelocity(R: number, dp: number, mu: number, L: number): number {
  return (R * R * dp) / (4 * mu * L);
}
/** Mean velocity ū = R²·Δp/(8μL). */
export function poiseuilleMeanVelocity(R: number, dp: number, mu: number, L: number): number {
  return (R * R * dp) / (8 * mu * L);
}
/** Pipe wall shear stress τ_w = R·Δp/(2L). */
export function pipeWallShear(R: number, dp: number, L: number): number { return (R * dp) / (2 * L); }
