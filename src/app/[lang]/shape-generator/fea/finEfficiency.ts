/**
 * finEfficiency.ts — extended-surface (fin) heat transfer for a straight fin of uniform
 * cross-section, from the 1-D fin equation d²θ/dx² = m²θ with θ = T − T∞.
 *
 *   fin parameter:    m = √(hP/(kA_c))            (P = perimeter, A_c = cross-section)
 *   adiabatic tip:    q = √(hP k A_c)·θ_b·tanh(mL)
 *   efficiency:       η  = tanh(mL)/(mL)          (actual / ideal isothermal fin)
 *   effectiveness:    ε  = q/(h A_c θ_b)          (fin vs no-fin bare base)
 *   tip temperature:  θ(L)/θ_b = 1/cosh(mL)        (adiabatic tip)
 *
 * Verified against the η→1 short/thick-fin limit (mL→0), the η→1/(mL) long-fin
 * asymptote, the η·(mL) = tanh(mL) identity, and the tip temperature 1/cosh(mL).
 */

/** Fin parameter m = √(hP/(k·A_c)). */
export function finParameter(h: number, P: number, k: number, Ac: number): number {
  return Math.sqrt((h * P) / (k * Ac));
}
/** Fin efficiency η = tanh(mL)/(mL) for an adiabatic-tip straight fin. */
export function finEfficiency(m: number, L: number): number {
  const mL = m * L;
  return Math.tanh(mL) / mL;
}
/** Heat dissipated by an adiabatic-tip fin q = √(hPkA_c)·θ_b·tanh(mL). */
export function finHeatRate(h: number, P: number, k: number, Ac: number, thetaB: number, L: number): number {
  const m = finParameter(h, P, k, Ac);
  return Math.sqrt(h * P * k * Ac) * thetaB * Math.tanh(m * L);
}
/** Fin effectiveness ε = q/(h·A_c·θ_b). */
export function finEffectiveness(h: number, P: number, k: number, Ac: number, thetaB: number, L: number): number {
  return finHeatRate(h, P, k, Ac, thetaB, L) / (h * Ac * thetaB);
}
/** Dimensionless tip temperature θ(L)/θ_b = 1/cosh(mL) (adiabatic tip). */
export function tipTemperatureRatio(m: number, L: number): number {
  return 1 / Math.cosh(m * L);
}
