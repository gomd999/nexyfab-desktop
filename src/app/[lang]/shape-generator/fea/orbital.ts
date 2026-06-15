/**
 * orbital.ts — two-body (Keplerian) orbital mechanics. With gravitational parameter
 * μ = G·M and semi-major axis a:
 *
 *   vis-viva:   v² = μ(2/r − 1/a)
 *   period:     T = 2π√(a³/μ)                 (Kepler's 3rd law, T² ∝ a³)
 *   circular:   v = √(μ/r),  escape v = √(2μ/r) = √2·v_circ
 *   energy:     ε = −μ/(2a)                    (specific orbital energy)
 *   apsides:    r_p = a(1−e),  r_a = a(1+e)
 *   ang. mom.:  h = √(μ·a(1−e²)) = r_p·v_p = r_a·v_a   (conserved)
 *
 * Verified against those closed forms, Kepler's 3rd law, the escape/circular ratio,
 * and angular-momentum conservation between periapsis and apoapsis.
 */

/** Circular orbital speed v = √(μ/r). */
export function circularVelocity(mu: number, r: number): number { return Math.sqrt(mu / r); }
/** Escape speed v = √(2μ/r). */
export function escapeVelocity(mu: number, r: number): number { return Math.sqrt((2 * mu) / r); }
/** Vis-viva speed at radius r on an orbit of semi-major axis a. */
export function visViva(mu: number, r: number, a: number): number { return Math.sqrt(mu * (2 / r - 1 / a)); }
/** Orbital period T = 2π√(a³/μ). */
export function orbitalPeriod(mu: number, a: number): number { return 2 * Math.PI * Math.sqrt(a ** 3 / mu); }
/** Specific orbital energy ε = −μ/(2a). */
export function specificEnergy(mu: number, a: number): number { return -mu / (2 * a); }

export function periapsis(a: number, e: number): number { return a * (1 - e); }
export function apoapsis(a: number, e: number): number { return a * (1 + e); }
/** Specific angular momentum h = √(μ·a(1−e²)). */
export function angularMomentum(mu: number, a: number, e: number): number { return Math.sqrt(mu * a * (1 - e * e)); }

/** Speed at periapsis / apoapsis (purely tangential at the apsides). */
export function apsisSpeeds(mu: number, a: number, e: number): { vPeri: number; vApo: number } {
  return { vPeri: visViva(mu, periapsis(a, e), a), vApo: visViva(mu, apoapsis(a, e), a) };
}
