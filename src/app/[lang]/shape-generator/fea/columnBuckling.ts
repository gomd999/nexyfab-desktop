/**
 * columnBuckling.ts — Euler/Johnson column buckling with end-condition EFFECTIVE
 * LENGTH.
 *
 *   Euler:        P_cr = π²EI/(K·L)²,   σ_cr = π²E/λ²,   λ = L_e/r,  r = √(I/A)
 *   end factors:  pinned-pinned K=1, fixed-fixed K=0.5, fixed-pinned K=0.7, fixed-free K=2
 *   transition:   λ1 = √(2π²E/Sy)   (Euler for λ>λ1, Johnson parabola for λ<λ1)
 *   Johnson:      σ_cr = Sy − (Sy·λ/(2π))²/E
 *
 * Verified: the end-condition factors and the resulting 4× capacity of fixed-fixed vs
 * pinned, σ_cr = P_cr/A, the slenderness, and the Euler/Johnson transition.
 */

export type EndCondition = 'pinned-pinned' | 'fixed-fixed' | 'fixed-pinned' | 'fixed-free';

/** Effective-length factor K for the end condition. */
export function effectiveLengthFactor(end: EndCondition): number {
  return { 'pinned-pinned': 1, 'fixed-fixed': 0.5, 'fixed-pinned': 0.7, 'fixed-free': 2 }[end];
}
/** Effective (buckling) length L_e = K·L. */
export function effectiveLength(L: number, end: EndCondition): number { return effectiveLengthFactor(end) * L; }

/** Euler buckling load P_cr = π²·E·I/L_e². */
export function eulerLoad(E: number, I: number, Le: number): number { return (Math.PI ** 2 * E * I) / (Le * Le); }

/** Radius of gyration r = √(I/A). */
export function radiusOfGyration(I: number, A: number): number { return Math.sqrt(I / A); }
/** Slenderness ratio λ = L_e/r. */
export function slendernessRatio(Le: number, r: number): number { return Le / r; }
/** Euler critical stress σ_cr = π²E/λ². */
export function criticalStress(E: number, lambda: number): number { return (Math.PI ** 2 * E) / (lambda * lambda); }

/** Transition slenderness λ1 = √(2π²E/Sy) (Euler valid above it). */
export function transitionSlenderness(E: number, Sy: number): number { return Math.sqrt((2 * Math.PI ** 2 * E) / Sy); }
/** Johnson parabola critical stress for short columns: σ_cr = Sy − (Sy·λ/(2π))²/E. */
export function johnsonStress(Sy: number, lambda: number, E: number): number {
  return Sy - ((Sy * lambda) / (2 * Math.PI)) ** 2 / E;
}
