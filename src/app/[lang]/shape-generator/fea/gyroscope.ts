/**
 * gyroscope.ts — steady precession of a spinning rigid body (gyroscope / spinning top)
 * under an applied torque.
 *
 *   spin momentum:    L = I·ω
 *   precession rate:  Ω = τ/(I·ω) = τ/L              (faster spin ⇒ slower precession)
 *   gravity torque:   τ = m·g·d                       (d = pivot→CM offset)
 *   precession period: T_p = 2π/Ω
 *
 * Verified against Ω=τ/(Iω), the inverse-spin trend (Ω ∝ 1/ω), the spin angular momentum
 * L=Iω, and the gravity-torque precession of a top.
 */

/** Spin angular momentum L = I·ω. */
export function angularMomentum(I: number, omega: number): number { return I * omega; }
/** Steady precession rate Ω = τ/(I·ω). */
export function precessionRate(torque: number, I: number, omega: number): number { return torque / (I * omega); }
/** Gravity torque on a top τ = m·g·d. */
export function gyroscopeTorque(m: number, g: number, d: number): number { return m * g * d; }
/** Precession period T_p = 2π/Ω. */
export function precessionPeriod(Omega: number): number { return (2 * Math.PI) / Omega; }
