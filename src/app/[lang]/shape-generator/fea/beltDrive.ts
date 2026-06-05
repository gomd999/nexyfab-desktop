/**
 * beltDrive.ts — flat/V-belt power transmission by the CAPSTAN (belt-friction) equation.
 *
 *   flat belt:   T1/T2 = e^{μθ}              (θ = wrap angle, T1 = tight, T2 = slack)
 *   V-belt:      T1/T2 = e^{μθ/sin(β/2)}     (β = groove angle ⇒ wedging amplifies grip)
 *   power:       P = (T1 − T2)·v             (v = belt speed)
 *   centrifugal: Tc = m·v²                   (m = belt mass per length)
 *   open-belt wrap angle:  θ = π − 2·asin((D−d)/(2C))   (small pulley)
 *
 * Verified against the capstan ratio, the V-belt amplification, the transmitted power,
 * the centrifugal tension, and the wrap-angle dependence.
 */

/** Flat-belt tension ratio T1/T2 = e^{μθ}. */
export function tensionRatioFlat(mu: number, theta: number): number { return Math.exp(mu * theta); }

/** V-belt tension ratio T1/T2 = e^{μθ/sin(β/2)} (β = full groove angle). */
export function tensionRatioV(mu: number, theta: number, grooveAngle: number): number {
  return Math.exp((mu * theta) / Math.sin(grooveAngle / 2));
}

/** Power transmitted P = (T1 − T2)·v. */
export function powerTransmitted(T1: number, T2: number, v: number): number { return (T1 - T2) * v; }

/** Centrifugal tension Tc = m·v². */
export function centrifugalTension(massPerLength: number, v: number): number { return massPerLength * v * v; }

/** Wrap angle on the smaller pulley of an open belt (radians). */
export function wrapAngleSmallPulley(D: number, d: number, C: number): number {
  return Math.PI - 2 * Math.asin((D - d) / (2 * C));
}
