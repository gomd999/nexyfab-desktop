/**
 * ottoDiesel.ts — air-standard internal-combustion cycle efficiencies (spark-ignition
 * Otto and compression-ignition Diesel).
 *
 *   compression ratio:  r = V₁/V₂
 *   Otto:               η = 1 − 1/r^(γ−1)
 *   Diesel:             η = 1 − (1/r^(γ−1))·(r_c^γ − 1)/(γ(r_c − 1))     (r_c = cutoff V₃/V₂)
 *
 * At equal compression ratio the Otto cycle is more efficient; the Diesel approaches it
 * as the cutoff ratio r_c → 1. Verified against the Otto efficiency rising with r, the
 * Diesel→Otto limit at r_c→1, the Otto > Diesel ordering at equal r, and the 0<η<1 bound.
 */

/** Compression ratio r = V₁/V₂. */
export function compressionRatio(V1: number, V2: number): number { return V1 / V2; }
/** Air-standard Otto efficiency η = 1 − 1/r^(γ−1). */
export function ottoEfficiency(r: number, gamma: number): number { return 1 - 1 / r ** (gamma - 1); }
/** Air-standard Diesel efficiency η = 1 − (1/r^(γ−1))·(r_c^γ−1)/(γ(r_c−1)). */
export function dieselEfficiency(r: number, rc: number, gamma: number): number {
  return 1 - (1 / r ** (gamma - 1)) * ((rc ** gamma - 1) / (gamma * (rc - 1)));
}
