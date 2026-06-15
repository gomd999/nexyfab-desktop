/**
 * diffusion.ts — mass diffusion by Fick's laws (carburising, doping, drug release).
 *
 *   Fick 1st (flux):   J = −D·dC/dx
 *   Fick 2nd (step into a semi-infinite solid, constant surface C_s):
 *                      (C − C₀)/(C_s − C₀) = erfc( x/(2√(Dt)) )
 *   diffusion length:  L = 2·√(Dt)                         (penetration depth ∝ √t)
 *
 * Verified against the surface/deep boundary values (C=C_s at x=0, C→C₀ deep), the
 * √t growth of the diffusion length, the self-similar fixed concentration at x=2√(Dt),
 * and Fick's first law opposing the gradient.
 */

/** Error function erf(x) (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7). */
export function erf(x: number): number {
  const sign = Math.sign(x);
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
}
/** Complementary error function erfc(x) = 1 − erf(x). */
export function erfc(x: number): number { return 1 - erf(x); }

/** Fick's first-law flux J = −D·dC/dx. */
export function fickFlux(D: number, dC: number, dx: number): number { return -D * (dC / dx); }
/** Diffusion (penetration) length L = 2·√(Dt). */
export function diffusionLength(D: number, t: number): number { return 2 * Math.sqrt(D * t); }
/** Fick 2nd-law concentration C = C₀ + (C_s−C₀)·erfc(x/(2√(Dt))). */
export function concentrationProfile(x: number, D: number, t: number, C0: number, Cs: number): number {
  return C0 + (Cs - C0) * erfc(x / (2 * Math.sqrt(D * t)));
}
