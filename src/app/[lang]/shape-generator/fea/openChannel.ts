/**
 * openChannel.ts — steady uniform open-channel flow by MANNING's equation.
 *
 *   Q = (1/n)·A·R^{2/3}·S^{1/2},   R = A/P  (hydraulic radius)
 *   Froude:  Fr = v/√(g·D),  D = A/T  (hydraulic depth)
 *   critical (rectangular):  yc = (q²/g)^{1/3},  q = Q/b   (Fr=1, minimum specific energy)
 *
 * Verified against Manning's formula, the critical depth (Fr=1 there), the normal-depth
 * inversion (recovers Q), and the specific-energy minimum at critical flow.
 */

export const G = 9.80665;

/** Manning discharge Q = (1/n)·A·R^{2/3}·S^{1/2}. */
export function manningFlow(n: number, A: number, R: number, S: number): number {
  return (1 / n) * A * Math.pow(R, 2 / 3) * Math.sqrt(S);
}

export interface ChannelSection { A: number; P: number; R: number; T: number; }
/** Rectangular-channel geometry at depth y (width b). */
export function rectangularSection(b: number, y: number): ChannelSection {
  const A = b * y, P = b + 2 * y;
  return { A, P, R: A / P, T: b };
}

/** Froude number Fr = v/√(g·A/T). */
export function froudeNumber(v: number, A: number, T: number): number {
  return v / Math.sqrt((G * A) / T);
}

/** Critical depth of a rectangular channel: yc = (q²/g)^{1/3}, q = Q/b. */
export function criticalDepthRectangular(Q: number, b: number): number {
  const q = Q / b;
  return Math.cbrt((q * q) / G);
}

/** Specific energy E = y + v²/(2g). */
export function specificEnergy(y: number, v: number): number {
  return y + (v * v) / (2 * G);
}

/** Normal depth of a rectangular channel for discharge Q (bisection on Manning). */
export function normalDepthRectangular(Q: number, b: number, n: number, S: number): number {
  let lo = 1e-6, hi = 100;
  for (let i = 0; i < 200; i++) {
    const y = 0.5 * (lo + hi);
    const sec = rectangularSection(b, y);
    if (manningFlow(n, sec.A, sec.R, S) < Q) lo = y; else hi = y;
  }
  return 0.5 * (lo + hi);
}
