/**
 * beamColumn.ts — beam-column behaviour: an axial load P amplifies the bending of a
 * laterally-loaded member, running away as P approaches the Euler buckling load.
 *
 *   amplification (code):  AF = 1 / (1 − P/Pcr)
 *   exact (equal end M):   M_max = M0·sec(u),   u = (L/2)·√(P/EI),   Pcr = π²EI/L²
 *   interaction (utilisation):  P/Pcr + M/M_allow
 *
 * Both the approximate AF and the exact secant diverge at P = Pcr (u = π/2), and they
 * agree for small P. Verified against those forms, the divergence at buckling, and
 * the no-load limit AF = 1.
 */

/** Euler buckling load of a pinned column: Pcr = π²·EI/L². */
export function eulerLoad(EI: number, L: number): number {
  return (Math.PI * Math.PI * EI) / (L * L);
}

/** Moment/deflection amplification factor AF = 1/(1 − P/Pcr). */
export function amplificationFactor(P: number, Pcr: number): number {
  return 1 / (1 - P / Pcr);
}

/** Exact moment amplification for equal end moments: sec((L/2)√(P/EI)). */
export function secantAmplification(P: number, EI: number, L: number): number {
  const u = (L / 2) * Math.sqrt(P / EI);
  return 1 / Math.cos(u);
}

/** Magnified maximum moment M = M0·AF. */
export function magnifiedMoment(M0: number, P: number, Pcr: number): number {
  return M0 * amplificationFactor(P, Pcr);
}

/** Magnified maximum deflection δ = δ0·AF. */
export function magnifiedDeflection(delta0: number, P: number, Pcr: number): number {
  return delta0 * amplificationFactor(P, Pcr);
}

/** Combined axial-plus-bending utilisation P/Pcr + M/M_allow (≤ 1 is safe). */
export function interactionRatio(P: number, Pcr: number, M: number, Mallow: number): number {
  return P / Pcr + M / Mallow;
}
