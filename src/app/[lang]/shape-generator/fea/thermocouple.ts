/**
 * thermocouple.ts — thermoelectric temperature measurement via the Seebeck effect. A
 * junction of two dissimilar metals develops a voltage proportional to the temperature
 * difference between the measuring and reference junctions.
 *
 *   linear Seebeck:   V = S·(T_hot − T_cold)          (S = relative Seebeck coefficient)
 *   polynomial:       V = a·ΔT + ½·b·ΔT²              (curvature of real thermocouples)
 *   sensitivity:      dV/dT = a + b·ΔT
 *   cold-junction:    T_hot = T_ref + V/S             (reference-junction compensation)
 *   relative Seebeck: S = S_a − S_b
 *
 * Verified against the linear V=S·ΔT (zero at ΔT=0), the cold-junction recovery of the
 * hot-junction temperature, the polynomial sensitivity dV/dT, and the b=0 reduction to
 * the linear law.
 */

/** Linear Seebeck voltage V = S·(T_hot − T_cold). */
export function seebeckVoltage(S: number, Thot: number, Tcold: number): number { return S * (Thot - Tcold); }
/** Polynomial Seebeck voltage V = a·ΔT + ½·b·ΔT². */
export function seebeckVoltageQuadratic(a: number, b: number, dT: number): number { return a * dT + 0.5 * b * dT * dT; }
/** Local sensitivity dV/dT = a + b·ΔT. */
export function sensitivity(a: number, b: number, dT: number): number { return a + b * dT; }
/** Cold-junction-compensated hot temperature T_hot = T_ref + V/S. */
export function coldJunctionCompensation(Vmeasured: number, S: number, Tref: number): number {
  return Tref + Vmeasured / S;
}
/** Relative Seebeck coefficient of a pair S = S_a − S_b. */
export function relativeSeebeck(Sa: number, Sb: number): number { return Sa - Sb; }
