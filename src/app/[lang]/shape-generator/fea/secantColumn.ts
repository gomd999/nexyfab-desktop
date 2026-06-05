/**
 * secantColumn.ts — the SECANT FORMULA for an eccentrically-loaded column (a beam-column
 * carrying axial load P applied at eccentricity e). Unlike pure Euler buckling, an
 * eccentric load bends the column from the start and the deflection/stress are amplified
 * as P approaches the critical load.
 *
 *   max stress:      σ_max = (P/A)·[1 + (e·c/r²)·sec( (Lₑ/2r)·√(P/(EA)) )]
 *   max deflection:  δ     = e·[ sec( (Lₑ/2)·√(P/(EI)) ) − 1 ]
 *
 *   r = √(I/A) radius of gyration, c = extreme-fibre distance, Lₑ = effective length.
 *   The secant argument → π/2 as P → P_cr = π²EI/Lₑ²  ⇒  stress and deflection → ∞.
 *
 * Verified against the P→0 limit σ→(P/A)(1+ec/r²) (combined axial+bending, no
 * amplification), the e→0 pure-axial limit σ→P/A, and the blow-up at the Euler load.
 */

const sec = (x: number): number => 1 / Math.cos(x);

/** Secant-formula maximum compressive stress in an eccentric column. */
export function secantMaxStress(P: number, A: number, e: number, c: number, r: number, Le: number, E: number): number {
  const arg = (Le / (2 * r)) * Math.sqrt(P / (E * A));
  return (P / A) * (1 + ((e * c) / (r * r)) * sec(arg));
}
/** Maximum lateral deflection of an eccentric column. */
export function secantDeflection(e: number, Le: number, P: number, E: number, I: number): number {
  return e * (sec((Le / 2) * Math.sqrt(P / (E * I))) - 1);
}
/** Euler critical load P_cr = π²EI/Lₑ² (the asymptote of the secant formula). */
export function eulerCritical(E: number, I: number, Le: number): number {
  return (Math.PI ** 2 * E * I) / (Le * Le);
}
