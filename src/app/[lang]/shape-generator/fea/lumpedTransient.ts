/**
 * lumpedTransient.ts — transient heat conduction by the lumped-capacitance method, valid
 * when the internal resistance is negligible against the surface resistance (Bi < 0.1).
 *
 *   Biot number:     Bi = h·L_c/k          (L_c = V/A_s characteristic length)
 *   time constant:   τ  = ρ·V·c_p/(h·A_s) = ρ·c_p·L_c/h
 *   cooling curve:   (T−T∞)/(Ti−T∞) = exp(−t/τ)
 *   diffusivity:     α  = k/(ρ·c_p)
 *   Fourier number:  Fo = α·t/L_c²    ⇒    t/τ = Bi·Fo
 *
 * Verified against the one-time-constant decay to 1/e, the identity t/τ = Bi·Fo (so
 * θ=exp(−Bi·Fo)), the Bi<0.1 validity threshold, and the Ti/T∞ end conditions.
 */

/** Biot number Bi = h·L_c/k. */
export function biotNumber(h: number, Lc: number, k: number): number { return (h * Lc) / k; }
/** Lumped time constant τ = ρ·V·c_p/(h·A_s). */
export function timeConstant(rho: number, V: number, cp: number, h: number, As: number): number {
  return (rho * V * cp) / (h * As);
}
/** Lumped temperature at time t: T = T∞ + (Ti−T∞)·exp(−t/τ). */
export function lumpedTemperature(Ti: number, Tinf: number, t: number, tau: number): number {
  return Tinf + (Ti - Tinf) * Math.exp(-t / tau);
}
/** Thermal diffusivity α = k/(ρ·c_p). */
export function thermalDiffusivity(k: number, rho: number, cp: number): number { return k / (rho * cp); }
/** Fourier number Fo = α·t/L_c². */
export function fourierNumber(alpha: number, t: number, Lc: number): number { return (alpha * t) / (Lc * Lc); }
/** Lumped-capacitance validity (Bi < 0.1). */
export function isLumpedValid(Bi: number): boolean { return Bi < 0.1; }
