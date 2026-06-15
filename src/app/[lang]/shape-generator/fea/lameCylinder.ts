/**
 * lameCylinder.ts — Lamé solution for a thick-walled cylinder (pressure vessel) under
 * internal pressure pi and external pressure po (inner radius a, outer b):
 *
 *   σr(r) = A − B/r²,   σθ(r) = A + B/r²
 *   A = (pi·a² − po·b²)/(b²−a²),   B = (pi − po)·a²·b²/(b²−a²)
 *
 * Key results: σr+σθ = 2A (constant), the boundary tractions σr(a)=−pi, σr(b)=−po, the
 * peak hoop stress at the inner wall σθ,max = pi(b²+a²)/(b²−a²) (internal pressure), and
 * the thin-wall limit σθ → pi·r/t. Verified against those closed forms.
 */

export interface LameConstants { A: number; B: number; }

/** Lamé constants for the given pressures and radii. */
export function lameConstants(a: number, b: number, pi: number, po: number): LameConstants {
  const den = b * b - a * a;
  return { A: (pi * a * a - po * b * b) / den, B: ((pi - po) * a * a * b * b) / den };
}

export function radialStress(r: number, k: LameConstants): number { return k.A - k.B / (r * r); }
export function hoopStress(r: number, k: LameConstants): number { return k.A + k.B / (r * r); }

/** Peak hoop stress (at the inner wall) under internal pressure only: pi(b²+a²)/(b²−a²). */
export function maxHoopStress(a: number, b: number, pi: number): number {
  return (pi * (b * b + a * a)) / (b * b - a * a);
}

/** Thin-wall hoop-stress approximation σθ = pi·r/t. */
export function thinWallHoop(pi: number, r: number, t: number): number {
  return (pi * r) / t;
}

/** von Mises stress at radius r (plane-stress, σz≈0): √(σr²−σrσθ+σθ²). */
export function vonMisesAt(r: number, k: LameConstants): number {
  const sr = radialStress(r, k), st = hoopStress(r, k);
  return Math.sqrt(sr * sr - sr * st + st * st);
}
