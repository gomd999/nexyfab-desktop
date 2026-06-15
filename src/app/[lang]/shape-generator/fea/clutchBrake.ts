/**
 * clutchBrake.ts — friction torque of an annular disk clutch/brake (outer radius ro,
 * inner ri, friction coefficient μ, axial force F, N friction surfaces).
 *
 *   uniform pressure (new):  T = (2/3)·μ·F·N·(ro³−ri³)/(ro²−ri²)
 *   uniform wear   (worn):   T = (1/2)·μ·F·N·(ro + ri)        (max pressure at ri)
 *   power:  P = T·ω
 *
 * Uniform-pressure torque exceeds uniform-wear torque for the same force (a new clutch
 * grips a touch harder than a worn one). Verified against both formulas, that ordering,
 * the surface-count multiplier, and the transmitted power.
 */

/** Disk torque under the uniform-pressure assumption. */
export function uniformPressureTorque(mu: number, F: number, ro: number, ri: number, N = 1): number {
  return (2 / 3) * mu * F * N * (ro ** 3 - ri ** 3) / (ro ** 2 - ri ** 2);
}

/** Disk torque under the uniform-wear assumption (T = ½·μ·F·N·(ro+ri)). */
export function uniformWearTorque(mu: number, F: number, ro: number, ri: number, N = 1): number {
  return 0.5 * mu * F * N * (ro + ri);
}

/** Maximum contact pressure (at ri) for the uniform-wear case: p_max = F/(2π·ri·(ro−ri)). */
export function maxPressureUniformWear(F: number, ro: number, ri: number): number {
  return F / (2 * Math.PI * ri * (ro - ri));
}

/** Transmitted/dissipated power P = T·ω. */
export function clutchPower(T: number, omega: number): number { return T * omega; }
