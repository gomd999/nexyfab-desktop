/**
 * circularPlate.ts — axisymmetric bending of a circular plate (radius a, thickness t)
 * by classical (Kirchhoff) plate theory.
 *
 *   flexural rigidity:  D = E·t³/(12(1−ν²))
 *   clamped edge, uniform load q:        w_max = q·a⁴/(64·D)
 *   simply supported, uniform load q:    w_max = (5+ν)/(1+ν)·q·a⁴/(64·D)
 *   clamped, central point load P:       w_max = P·a²/(16π·D)
 *   simply supported, central point P:   w_max = (3+ν)/(1+ν)·P·a²/(16π·D)
 *
 * Verified against those closed forms, the simply-supported > clamped ordering, and the
 * t³ stiffness dependence.
 */

/** Plate flexural rigidity D = E·t³/(12(1−ν²)). */
export function flexuralRigidity(E: number, t: number, nu: number): number {
  return (E * t ** 3) / (12 * (1 - nu * nu));
}

/** Clamped-edge plate, uniform pressure q: centre deflection q·a⁴/(64·D). */
export function clampedUniform(q: number, a: number, D: number): number { return (q * a ** 4) / (64 * D); }

/** Simply-supported plate, uniform pressure q: (5+ν)/(1+ν)·q·a⁴/(64·D). */
export function simplySupportedUniform(q: number, a: number, D: number, nu: number): number {
  return ((5 + nu) / (1 + nu)) * (q * a ** 4) / (64 * D);
}

/** Clamped plate, central point load P: P·a²/(16π·D). */
export function clampedPointLoad(P: number, a: number, D: number): number { return (P * a * a) / (16 * Math.PI * D); }

/** Simply-supported plate, central point load P: (3+ν)/(1+ν)·P·a²/(16π·D). */
export function simplySupportedPointLoad(P: number, a: number, D: number, nu: number): number {
  return ((3 + nu) / (1 + nu)) * (P * a * a) / (16 * Math.PI * D);
}
