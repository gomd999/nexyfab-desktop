/**
 * flywheel.ts — rotational kinetic-energy storage and speed regulation of a flywheel.
 * A flywheel absorbs the surplus energy of a cycle and gives it back, smoothing the speed
 * between ω_max and ω_min.
 *
 *   kinetic energy:    E = ½·I·ω²
 *   energy swing:      ΔE = ½·I·(ω_max² − ω_min²) = I·ω_mean²·C_s
 *   fluctuation coef.: C_s = (ω_max − ω_min)/ω_mean
 *   required inertia:  I = ΔE/(ω_mean²·C_s)
 *   thin ring:         I = m·r²   (radius of gyration k = r)
 *
 * Verified against E=½Iω², the ΔE = I·ω_mean²·C_s identity, the inverse sizing
 * I = ΔE/(ω_mean²·C_s), and the ω² energy scaling.
 */

/** Rotational kinetic energy E = ½·I·ω². */
export function kineticEnergy(I: number, omega: number): number { return 0.5 * I * omega * omega; }
/** Energy swing across a cycle ΔE = ½·I·(ω_max² − ω_min²). */
export function energyFluctuation(I: number, omegaMax: number, omegaMin: number): number {
  return 0.5 * I * (omegaMax * omegaMax - omegaMin * omegaMin);
}
/** Coefficient of fluctuation of speed C_s = (ω_max − ω_min)/ω_mean. */
export function coefficientOfFluctuation(omegaMax: number, omegaMin: number, omegaMean: number): number {
  return (omegaMax - omegaMin) / omegaMean;
}
/** Required flywheel inertia I = ΔE/(ω_mean²·C_s). */
export function requiredInertia(deltaE: number, omegaMean: number, Cs: number): number {
  return deltaE / (omegaMean * omegaMean * Cs);
}
/** Thin-ring moment of inertia I = m·r². */
export function ringInertia(m: number, r: number): number { return m * r * r; }
