/**
 * rocketEquation.ts — ideal rocket propulsion: the Tsiolkovsky equation, thrust, and the
 * mass-ratio relations.
 *
 *   exhaust velocity:  v_e = I_sp·g₀
 *   delta-v:           Δv  = v_e·ln(m₀/m_f) = I_sp·g₀·ln(MR)
 *   thrust:            F   = ṁ·v_e                       (ideal, pressure-matched)
 *   mass ratio:        MR  = m₀/m_f
 *   propellant frac.:  ζ   = 1 − m_f/m₀
 *
 * Verified against the Δv = v_e·ln(MR) logarithm (e-fold mass ratio ⇒ Δv = v_e), the
 * v_e = I_sp·g₀ identity, the thrust ṁ·v_e, and the propellant-fraction relation.
 */

const G0 = 9.80665;

/** Effective exhaust velocity v_e = I_sp·g₀. */
export function exhaustVelocity(Isp: number, g0: number = G0): number { return Isp * g0; }
/** Tsiolkovsky delta-v Δv = v_e·ln(m₀/m_f). */
export function deltaV(ve: number, m0: number, mf: number): number { return ve * Math.log(m0 / mf); }
/** Ideal thrust F = ṁ·v_e. */
export function thrust(mdot: number, ve: number): number { return mdot * ve; }
/** Mass ratio MR = m₀/m_f. */
export function massRatio(m0: number, mf: number): number { return m0 / mf; }
/** Propellant mass fraction ζ = 1 − m_f/m₀. */
export function propellantFraction(m0: number, mf: number): number { return 1 - mf / m0; }
