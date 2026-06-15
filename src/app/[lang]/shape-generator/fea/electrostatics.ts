/**
 * electrostatics.ts — closed-form capacitance and stored energy for canonical
 * geometries:
 *
 *   parallel plate:     C = ε0·εr·A/d
 *   coaxial cylinder:   C = 2π·ε0·εr·L / ln(b/a)
 *   concentric spheres: C = 4π·ε0·εr·a·b/(b−a)        (isolated sphere: b→∞ ⇒ 4πε0εr·a)
 *   energy:             U = ½·C·V² = ½·Q²/C = ½·Q·V,  Q = C·V
 *
 * Verified against those formulas, the energy identities, series/parallel
 * combination rules, and the dielectric (εr) and field (E=V/d) relations.
 */

export const EPS0 = 8.8541878128e-12; // vacuum permittivity (F/m)

export function parallelPlateCapacitance(A: number, d: number, epsR = 1): number {
  return (EPS0 * epsR * A) / d;
}
export function coaxialCapacitance(a: number, b: number, L: number, epsR = 1): number {
  return (2 * Math.PI * EPS0 * epsR * L) / Math.log(b / a);
}
export function sphericalCapacitance(a: number, b: number, epsR = 1): number {
  return (4 * Math.PI * EPS0 * epsR * a * b) / (b - a);
}
export function isolatedSphereCapacitance(a: number, epsR = 1): number {
  return 4 * Math.PI * EPS0 * epsR * a;
}

export function charge(C: number, V: number): number { return C * V; }
/** Stored energy U = ½·C·V². */
export function energy(C: number, V: number): number { return 0.5 * C * V * V; }
/** Uniform field in a parallel-plate gap: E = V/d. */
export function parallelPlateField(V: number, d: number): number { return V / d; }

/** Series capacitance: 1/C = Σ 1/C_i. */
export function seriesCapacitance(caps: number[]): number {
  return 1 / caps.reduce((s, c) => s + 1 / c, 0);
}
/** Parallel capacitance: C = Σ C_i. */
export function parallelCapacitance(caps: number[]): number {
  return caps.reduce((s, c) => s + c, 0);
}
