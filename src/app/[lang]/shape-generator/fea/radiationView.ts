/**
 * radiationView.ts — thermal-radiation view (configuration) factors and gray-body
 * exchange. F_ij is the fraction of radiation leaving surface i that reaches j, and
 * obeys
 *
 *   reciprocity:  A_i·F_ij = A_j·F_ji
 *   summation:    Σ_j F_ij = 1          (enclosure)
 *
 * Two-surface gray-body net exchange:
 *   Q = σ(T1⁴−T2⁴) / [ (1−ε1)/(ε1 A1) + 1/(A1 F12) + (1−ε2)/(ε2 A2) ]
 *
 * Verified: reciprocity and summation; the concentric (F12=1, F21=A1/A2) and coaxial-
 * disk factors; and the black-body limit Q = σ A1 F12 (T1⁴−T2⁴).
 */

export const SIGMA = 5.670374419e-8; // Stefan–Boltzmann (W/m²K⁴)

/** Concentric enclosure (small body 1 fully inside 2): F12=1, F21=A1/A2, F22=1−A1/A2. */
export function concentricViewFactors(A1: number, A2: number): { F12: number; F21: number; F22: number } {
  return { F12: 1, F21: A1 / A2, F22: 1 - A1 / A2 };
}

/** View factor between two coaxial parallel disks (radii r1,r2, separation L). */
export function coaxialDisksViewFactor(r1: number, r2: number, L: number): number {
  const R1 = r1 / L, R2 = r2 / L;
  const S = 1 + (1 + R2 * R2) / (R1 * R1);
  return 0.5 * (S - Math.sqrt(S * S - 4 * (r2 / r1) ** 2));
}

/** Reciprocal view factor F_ji = A_i·F_ij / A_j. */
export function reciprocal(Ai: number, Fij: number, Aj: number): number {
  return (Ai * Fij) / Aj;
}

/** Net radiative heat transfer from 1 to 2 in a two-surface gray enclosure (W). */
export function grayBodyExchange(T1: number, T2: number, eps1: number, eps2: number, A1: number, A2: number, F12: number): number {
  const resistance = (1 - eps1) / (eps1 * A1) + 1 / (A1 * F12) + (1 - eps2) / (eps2 * A2);
  return (SIGMA * (T1 ** 4 - T2 ** 4)) / resistance;
}

/** Black-body (ε=1) exchange limit: Q = σ·A1·F12·(T1⁴−T2⁴). */
export function blackBodyExchange(T1: number, T2: number, A1: number, F12: number): number {
  return SIGMA * A1 * F12 * (T1 ** 4 - T2 ** 4);
}
