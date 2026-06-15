/**
 * wallHeatTransfer.ts — steady heat transfer through composite walls by the THERMAL
 * RESISTANCE network (the heat-transfer analogue of electrical resistance):
 *
 *   conduction (plane):  R = L/(k·A)
 *   convection:          R = 1/(h·A)
 *   conduction (cyl.):   R = ln(r2/r1)/(2π·k·L)
 *   series: R_tot = ΣR_i;   parallel: 1/R = Σ(1/R_i);   Q = ΔT/R_tot;   U = 1/(A·R_tot)
 *
 * Verified against the resistance sums, Q=ΔT/R_tot, the interface temperatures (ΔT
 * across each layer ∝ its resistance), the overall U, and the cylindrical resistance.
 */

export function conductionResistance(L: number, k: number, A: number): number { return L / (k * A); }
export function convectionResistance(h: number, A: number): number { return 1 / (h * A); }
export function cylindricalResistance(r1: number, r2: number, k: number, L: number): number {
  return Math.log(r2 / r1) / (2 * Math.PI * k * L);
}

/** Series thermal resistance R_tot = ΣR_i. */
export function seriesResistance(R: number[]): number { return R.reduce((s, r) => s + r, 0); }
/** Parallel thermal resistance 1/R = Σ(1/R_i). */
export function parallelResistance(R: number[]): number { return 1 / R.reduce((s, r) => s + 1 / r, 0); }

/** Heat flow Q = ΔT/R_tot. */
export function heatFlow(deltaT: number, Rtot: number): number { return deltaT / Rtot; }
/** Overall heat-transfer coefficient U = 1/(A·R_tot). */
export function overallU(Rtot: number, A: number): number { return 1 / (A * Rtot); }

/** Interface temperatures along a series chain from T_hot through the resistances. */
export function interfaceTemperatures(Thot: number, Q: number, R: number[]): number[] {
  const temps = [Thot];
  let T = Thot;
  for (const r of R) { T -= Q * r; temps.push(T); }
  return temps;
}
