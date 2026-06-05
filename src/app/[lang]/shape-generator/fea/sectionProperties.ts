/**
 * sectionProperties.ts — cross-section geometric properties for beam/column analysis.
 *
 *   centroid:        ȳ = Σ(A_i·y_i)/ΣA_i
 *   parallel axis:   I = I_c + A·d²
 *   rectangle:       A = b·h,  I = b·h³/12
 *   circle:          A = πd²/4,  I = πd⁴/64
 *   section modulus: S = I/c   (c = distance to extreme fibre)
 *   radius of gyration: r = √(I/A)
 *
 * Verified against the standard shape formulas, the parallel-axis theorem, and a
 * composite (built-up) section's centroid and moment of inertia.
 */

export interface AreaI { A: number; I: number; }       // area + centroidal moment of inertia
export interface AreaIy extends AreaI { y: number; }    // ...plus the part's centroid location

/** Rectangle (width b, height h): A=bh, I=bh³/12 about its own centroid. */
export function rectangle(b: number, h: number): AreaI { return { A: b * h, I: (b * h ** 3) / 12 }; }
/** Solid circle (diameter d): A=πd²/4, I=πd⁴/64. */
export function circle(d: number): AreaI { return { A: (Math.PI * d * d) / 4, I: (Math.PI * d ** 4) / 64 }; }

/** Parallel-axis theorem: I about a parallel axis a distance d away = I_c + A·d². */
export function parallelAxis(Ic: number, A: number, d: number): number { return Ic + A * d * d; }

/** Centroid of a composite section: ȳ = Σ(A_i y_i)/ΣA_i. */
export function compositeCentroid(parts: AreaIy[]): number {
  const A = parts.reduce((s, p) => s + p.A, 0);
  return parts.reduce((s, p) => s + p.A * p.y, 0) / A;
}

/** Moment of inertia of a composite section about its own centroid (parallel axis on each part). */
export function compositeInertia(parts: AreaIy[]): number {
  const yc = compositeCentroid(parts);
  return parts.reduce((s, p) => s + parallelAxis(p.I, p.A, p.y - yc), 0);
}

/** Section modulus S = I/c. */
export function sectionModulus(I: number, c: number): number { return I / c; }
/** Radius of gyration r = √(I/A). */
export function radiusOfGyration(I: number, A: number): number { return Math.sqrt(I / A); }
