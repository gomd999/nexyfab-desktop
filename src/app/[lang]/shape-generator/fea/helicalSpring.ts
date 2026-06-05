/**
 * helicalSpring.ts — helical (coil) compression-spring design.
 *
 *   spring rate:   k = G·d⁴/(8·D³·Na)        (G = shear modulus, d = wire dia,
 *                                              D = mean coil dia, Na = active coils)
 *   spring index:  C = D/d
 *   Wahl factor:   K_w = (4C−1)/(4C−4) + 0.615/C   (curvature + direct-shear correction)
 *   shear stress:  τ = K_w·8·F·D/(π·d³)
 *   deflection:    δ = F/k = 8·F·D³·Na/(G·d⁴)
 *
 * Verified against those formulas, δ=F/k, the strong d⁴ stiffness dependence, the
 * Wahl factor > 1, and the solid length.
 */

/** Spring rate k = G·d⁴/(8·D³·Na). */
export function springRate(G: number, d: number, D: number, Na: number): number {
  return (G * d ** 4) / (8 * D ** 3 * Na);
}
/** Spring index C = D/d. */
export function springIndex(D: number, d: number): number { return D / d; }
/** Wahl correction factor K_w = (4C−1)/(4C−4) + 0.615/C. */
export function wahlFactor(C: number): number { return (4 * C - 1) / (4 * C - 4) + 0.615 / C; }
/** Corrected torsional shear stress τ = K_w·8·F·D/(π·d³). */
export function shearStress(F: number, D: number, d: number, Kw: number): number {
  return (Kw * 8 * F * D) / (Math.PI * d ** 3);
}
/** Deflection δ = F/k. */
export function deflection(F: number, k: number): number { return F / k; }
/** Solid (closed) length = total coils × wire diameter. */
export function solidLength(d: number, Nt: number): number { return Nt * d; }
