/**
 * diffraction.ts — wave optics: the diffraction-grating equation, single-slit minima,
 * two-slit (Young) fringes, and grating resolving power.
 *
 *   grating:          d·sinθ = m·λ                    (m = diffraction order)
 *   single slit:      a·sinθ = m·λ                    (minima, m = 1,2,…)
 *   Young fringes:    Δy = λ·L/d
 *   resolving power:  R = λ/Δλ = m·N                   (N illuminated lines)
 *
 * Verified against the grating equation d·sinθ=mλ, the larger angle of higher orders, the
 * resolving power m·N, and the fringe spacing λL/d.
 */

/** Grating line spacing d from lines-per-metre. */
export function gratingSpacing(linesPerMetre: number): number { return 1 / linesPerMetre; }
/** Diffraction angle from d·sinθ = m·λ. */
export function gratingAngle(m: number, lambda: number, d: number): number { return Math.asin((m * lambda) / d); }
/** Single-slit minimum angle from a·sinθ = m·λ. */
export function singleSlitMinimum(m: number, lambda: number, a: number): number { return Math.asin((m * lambda) / a); }
/** Grating resolving power R = m·N. */
export function resolvingPower(m: number, N: number): number { return m * N; }
/** Two-slit fringe spacing Δy = λ·L/d. */
export function fringeSpacing(lambda: number, L: number, d: number): number { return (lambda * L) / d; }
