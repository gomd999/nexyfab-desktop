/**
 * hertzContact.ts — Hertzian elastic contact of two spheres (or a sphere on a flat).
 * For a normal load F between bodies of radii R1,R2 (effective 1/R = 1/R1+1/R2) and
 * elastic moduli combined into E* (1/E* = (1−ν1²)/E1 + (1−ν2²)/E2):
 *
 *   contact radius   a  = (3·F·R / (4·E*))^{1/3}
 *   max pressure     p0 = 3F/(2πa²)
 *   approach         δ  = a²/R
 *   pressure         p(r) = p0·√(1 − (r/a)²)        (hemispherical)
 *   force–approach   F  = (4/3)·E*·√R·δ^{3/2}        (nonlinear contact stiffness)
 *
 * Verified against those closed forms, the integral ∫p dA = F, and F ∝ δ^{3/2}.
 */

/** Effective contact modulus 1/E* = (1−ν1²)/E1 + (1−ν2²)/E2. */
export function effectiveModulus(E1: number, nu1: number, E2: number, nu2: number): number {
  return 1 / ((1 - nu1 * nu1) / E1 + (1 - nu2 * nu2) / E2);
}

/** Effective radius 1/R = 1/R1 + 1/R2 (use R2 = Infinity for a flat). */
export function effectiveRadius(R1: number, R2: number): number {
  return 1 / (1 / R1 + 1 / R2);
}

/** Contact-patch radius under load F. */
export function contactRadius(F: number, R: number, Estar: number): number {
  return Math.cbrt((3 * F * R) / (4 * Estar));
}

/** Peak (central) contact pressure. */
export function maxPressure(F: number, a: number): number {
  return (3 * F) / (2 * Math.PI * a * a);
}

/** Mutual approach (indentation depth) under load F. */
export function approach(F: number, R: number, Estar: number): number {
  const a = contactRadius(F, R, Estar);
  return (a * a) / R;
}

/** Contact pressure at radius r within the patch (0 outside). */
export function pressureAt(r: number, a: number, p0: number): number {
  if (r >= a) return 0;
  return p0 * Math.sqrt(1 - (r / a) ** 2);
}

/** Normal force required to produce a given approach δ (Hertzian force–displacement). */
export function forceFromApproach(delta: number, R: number, Estar: number): number {
  return (4 / 3) * Estar * Math.sqrt(R) * Math.pow(Math.max(0, delta), 1.5);
}

/** Total force by integrating the pressure over the contact circle (∫p dA). */
export function integratedForce(a: number, p0: number, nr = 20000): number {
  const dr = a / nr;
  let s = 0;
  for (let i = 0; i < nr; i++) {
    const r = (i + 0.5) * dr;
    s += pressureAt(r, a, p0) * 2 * Math.PI * r * dr;
  }
  return s;
}
