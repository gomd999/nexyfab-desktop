/**
 * dcMotor.ts — permanent-magnet DC motor steady-state characteristics from the armature
 * circuit and the linear torque–speed line.
 *
 *   circuit:        V = I·R + k_e·ω                  (k_e·ω = back-EMF)
 *   torque:         T = k_t·I
 *   stall (ω=0):    I_stall = V/R,  T_stall = k_t·V/R
 *   no-load (T=0):  ω_nl = V/k_e
 *   torque–speed:   T = T_stall·(1 − ω/ω_nl)         (straight line)
 *   power:          P = T·ω,  maximum at ω = ω_nl/2
 *
 * Verified against the stall and no-load endpoints, the linear torque–speed line, the
 * circuit balance V = IR + k_e·ω, and the peak mechanical power at half the no-load speed.
 */

/** Back-EMF k_e·ω. */
export function backEMF(ke: number, omega: number): number { return ke * omega; }
/** Armature current I = (V − k_e·ω)/R. */
export function motorCurrent(V: number, ke: number, omega: number, R: number): number { return (V - ke * omega) / R; }
/** Output torque T = k_t·I. */
export function motorTorque(kt: number, I: number): number { return kt * I; }
/** Stall torque T_stall = k_t·V/R. */
export function stallTorque(kt: number, V: number, R: number): number { return (kt * V) / R; }
/** No-load speed ω_nl = V/k_e. */
export function noLoadSpeed(V: number, ke: number): number { return V / ke; }
/** Linear torque–speed line T = T_stall·(1 − ω/ω_nl). */
export function torqueAtSpeed(Tstall: number, omega: number, omegaNoLoad: number): number {
  return Tstall * (1 - omega / omegaNoLoad);
}
/** Mechanical power P = T·ω. */
export function mechanicalPower(T: number, omega: number): number { return T * omega; }
