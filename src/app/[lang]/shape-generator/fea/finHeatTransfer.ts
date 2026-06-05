/**
 * finHeatTransfer.ts — heat dissipation from an extended surface (fin) with an
 * adiabatic tip. With θ = T−T∞, fin parameter m = √(hP/(kA_c)):
 *
 *   temperature:  θ(x)/θb = cosh(m(L−x)) / cosh(mL)
 *   heat rate:    q = √(h·P·k·A_c)·θb·tanh(mL) = −k·A_c·dθ/dx|_0
 *   efficiency:   η = tanh(mL)/(mL)      (actual heat ÷ ideal isothermal fin)
 *   effectiveness:ε = q / (h·A_c·θb)
 *
 * Verified against those closed forms, the base-gradient heat balance, and the short-
 * fin (η→1) and long-fin (η→0) limits.
 */

/** Fin parameter m = √(h·P/(k·A_c)). */
export function finParameter(h: number, P: number, k: number, Ac: number): number {
  return Math.sqrt((h * P) / (k * Ac));
}

/** Fin efficiency η = tanh(mL)/(mL). */
export function finEfficiency(mL: number): number {
  if (mL < 1e-12) return 1;
  return Math.tanh(mL) / mL;
}

/** Temperature excess θ(x) = θb·cosh(m(L−x))/cosh(mL). */
export function finTemperature(x: number, L: number, m: number, thetaB: number): number {
  return thetaB * Math.cosh(m * (L - x)) / Math.cosh(m * L);
}

/** Fin heat rate q = √(hPkA_c)·θb·tanh(mL). */
export function finHeatRate(h: number, P: number, k: number, Ac: number, L: number, thetaB: number): number {
  const m = finParameter(h, P, k, Ac);
  return Math.sqrt(h * P * k * Ac) * thetaB * Math.tanh(m * L);
}

/** Fin effectiveness ε = q/(h·A_c·θb) — must exceed 1 to be worthwhile. */
export function finEffectiveness(h: number, P: number, k: number, Ac: number, L: number, thetaB: number): number {
  return finHeatRate(h, P, k, Ac, L, thetaB) / (h * Ac * thetaB);
}
