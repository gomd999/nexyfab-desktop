/**
 * frictionDrive.ts — friction-wheel / traction drive: power transmitted by rolling
 * contact, limited by the available friction before gross slip.
 *
 *   max traction:    F_t = μ·N                          (N = contact normal force)
 *   torque:          T   = F_t·r = μ·N·r
 *   surface speed:   v   = ω·r
 *   power:           P   = F_t·v = T·ω
 *   speed ratio:     ω₁/ω₂ = r₂/r₁                       (rolling, no slip ⇒ v₁ = v₂)
 *   required force:  N   = T/(μ·r)
 *
 * Verified against the torque T=μNr, the required-force inverse N=T/(μr), the rolling
 * speed ratio, and the power identity P = F_t·v = T·ω.
 */

/** Maximum tangential (traction) force before slip F_t = μ·N. */
export function tangentialForce(mu: number, N: number): number { return mu * N; }
/** Transmitted torque T = μ·N·r. */
export function transmittedTorque(mu: number, N: number, r: number): number { return mu * N * r; }
/** Surface (pitch-line) velocity v = ω·r. */
export function surfaceVelocity(omega: number, r: number): number { return omega * r; }
/** Transmitted power P = F_t·v. */
export function tractionPower(Ft: number, v: number): number { return Ft * v; }
/** Rolling speed ratio ω₁/ω₂ = r₂/r₁. */
export function speedRatio(r1: number, r2: number): number { return r2 / r1; }
/** Required normal force for a torque N = T/(μ·r). */
export function requiredNormalForce(T: number, mu: number, r: number): number { return T / (mu * r); }
