/**
 * accumulator.ts — gas-charged hydraulic accumulator energy storage. A precharged gas
 * volume is compressed as fluid is pumped in and gives it back on demand.
 *
 *   Boyle (isothermal):   P₁V₁ = P₂V₂
 *   polytropic gas:        P₁V₁ⁿ = P₂V₂ⁿ                (n=1.4 fast/adiabatic, stiffer)
 *   usable fluid volume:   ΔV = P₀V₀·(1/P₁ − 1/P₂)      (precharge P₀V₀, between P₁ and P₂)
 *   stored energy (iso):   W  = P₁V₁·ln(P₂/P₁)
 *
 * Verified against the Boyle product P₁V₁=P₂V₂, the compression V₂<V₁ for P₂>P₁, the
 * stiffer adiabatic response (smaller volume swing than isothermal), and the usable
 * volume being positive over a valid pressure band.
 */

/** Isothermal (Boyle) final gas volume V₂ = P₁V₁/P₂. */
export function boyleVolume(P1: number, V1: number, P2: number): number { return (P1 * V1) / P2; }
/** Polytropic gas volume V₂ = V₁·(P₁/P₂)^(1/n). */
export function polytropicVolume(P1: number, V1: number, P2: number, n: number): number {
  return V1 * (P1 / P2) ** (1 / n);
}
/** Usable (delivered) fluid volume ΔV = P₀V₀·(1/P₁ − 1/P₂). */
export function usableVolume(P0: number, V0: number, P1: number, P2: number): number {
  return P0 * V0 * (1 / P1 - 1 / P2);
}
/** Isothermal stored energy W = P₁V₁·ln(P₂/P₁). */
export function accumulatorEnergy(P1: number, V1: number, P2: number): number {
  return P1 * V1 * Math.log(P2 / P1);
}
