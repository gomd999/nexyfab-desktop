/**
 * polytropic.ts — the polytropic process PVⁿ = const for an ideal gas (compression,
 * expansion, the limiting isothermal/adiabatic cases) and its boundary work.
 *
 *   state relation:   P·Vⁿ = const  ⇒  T₂/T₁ = (P₂/P₁)^((n−1)/n) = (V₁/V₂)^(n−1)
 *   boundary work:     W = (P₁V₁ − P₂V₂)/(n−1) = mR(T₁ − T₂)/(n−1)   (n ≠ 1)
 *   isothermal (n=1):  W = P₁V₁·ln(V₂/V₁)
 *   polytropic cₙ:     cₙ = cᵥ·(n − γ)/(n − 1)
 *
 * The exponent spans the regimes: n=0 isobaric, n=1 isothermal, n=γ adiabatic, n→∞
 * isochoric. Verified against the T–P relation, the work integral, the n→γ adiabatic
 * (cₙ=0) and n→0 isobaric (cₙ=cₚ) limits of the polytropic specific heat.
 */

/** Temperature ratio across a polytropic process: T₂/T₁ = (P₂/P₁)^((n−1)/n). */
export function polytropicTempRatio(P2: number, P1: number, n: number): number {
  return (P2 / P1) ** ((n - 1) / n);
}
/** Final temperature T₂ = T₁·(P₂/P₁)^((n−1)/n). */
export function polytropicFinalTemp(T1: number, P1: number, P2: number, n: number): number {
  return T1 * polytropicTempRatio(P2, P1, n);
}
/** Boundary work W = (P₁V₁ − P₂V₂)/(n−1) (n ≠ 1). */
export function polytropicWork(P1: number, V1: number, P2: number, V2: number, n: number): number {
  return (P1 * V1 - P2 * V2) / (n - 1);
}
/** Isothermal (n=1) boundary work W = P₁V₁·ln(V₂/V₁). */
export function isothermalWork(P1: number, V1: number, V2: number): number {
  return P1 * V1 * Math.log(V2 / V1);
}
/** Polytropic specific heat cₙ = cᵥ·(n − γ)/(n − 1). */
export function polytropicSpecificHeat(cv: number, n: number, gamma: number): number {
  return cv * ((n - gamma) / (n - 1));
}
