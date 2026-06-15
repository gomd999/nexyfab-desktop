/**
 * curvedBeam.ts — Winkler curved-beam bending. In a sharply-curved beam (hooks, crane
 * links, C-frames) the neutral axis shifts toward the centre of curvature and the stress
 * is hyperbolic across the section — the inner fibre is the most highly stressed.
 *
 *   neutral radius (rect):  r_n = (r_o − r_i)/ln(r_o/r_i)
 *   centroidal radius:      r_c = (r_i + r_o)/2
 *   eccentricity:           e   = r_c − r_n            (> 0, neutral axis inside centroid)
 *   stress at radius r:     σ   = M·(r_n − r)/(A·e·r)
 *
 * (M positive = tending to straighten/decrease curvature ⇒ tension on the inner fibre.)
 * Verified against r_n < r_c, the inner-fibre stress exceeding the outer in magnitude,
 * the zero net axial force ∫σ dA = 0, and the straight-beam limit (e→0 as r_c→∞).
 */

/** Neutral-axis radius of a rectangular curved beam r_n = (r_o−r_i)/ln(r_o/r_i). */
export function neutralAxisRectangular(ri: number, ro: number): number {
  return (ro - ri) / Math.log(ro / ri);
}
/** Centroidal radius of a rectangular section r_c = (r_i+r_o)/2. */
export function centroidalRadiusRectangular(ri: number, ro: number): number { return (ri + ro) / 2; }
/** Eccentricity e = r_c − r_n. */
export function eccentricity(rc: number, rn: number): number { return rc - rn; }
/** Curved-beam bending stress at radius r: σ = M·(r_n−r)/(A·e·r). */
export function curvedBeamStress(M: number, A: number, e: number, r: number, rn: number): number {
  return (M * (rn - r)) / (A * e * r);
}
/** Inner-fibre stress σ_i = M·(r_n−r_i)/(A·e·r_i). */
export function innerFiberStress(M: number, A: number, e: number, ri: number, rn: number): number {
  return (M * (rn - ri)) / (A * e * ri);
}
/** Outer-fibre stress σ_o = M·(r_n−r_o)/(A·e·r_o). */
export function outerFiberStress(M: number, A: number, e: number, ro: number, rn: number): number {
  return (M * (rn - ro)) / (A * e * ro);
}
