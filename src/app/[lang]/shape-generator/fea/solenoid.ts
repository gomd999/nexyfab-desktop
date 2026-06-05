/**
 * solenoid.ts — solenoid/electromagnet magnetics: the interior field, inductance, stored
 * energy, and the Maxwell-stress pull on a ferromagnetic armature.
 *
 *   interior field:   B = μ₀·n·I                    (n = turns per metre)
 *   inductance:       L = μ₀·N²·A/ℓ
 *   stored energy:    W = ½·L·I² = (B²/2μ₀)·(A·ℓ)   (field-energy density B²/2μ₀)
 *   armature pull:    F = B²·A/(2μ₀)                 (Maxwell stress on a pole face)
 *   flux:             Φ = B·A
 *
 * Verified against B=μ₀nI, the inductance L=μ₀N²A/ℓ, the equivalence of ½LI² and the
 * B-field energy, the Maxwell-stress force, and the μ₀ field constant.
 */

export const MU0 = 4 * Math.PI * 1e-7; // T·m/A

/** Interior axial field B = μ₀·n·I. */
export function solenoidField(n: number, I: number, mu0: number = MU0): number { return mu0 * n * I; }
/** Solenoid inductance L = μ₀·N²·A/ℓ. */
export function solenoidInductance(N: number, A: number, length: number, mu0: number = MU0): number {
  return (mu0 * N * N * A) / length;
}
/** Stored magnetic energy W = ½·L·I². */
export function magneticEnergy(L: number, I: number): number { return 0.5 * L * I * I; }
/** Maxwell-stress pull on an armature pole face F = B²·A/(2μ₀). */
export function magneticForce(B: number, A: number, mu0: number = MU0): number { return (B * B * A) / (2 * mu0); }
/** Magnetic flux Φ = B·A. */
export function flux(B: number, A: number): number { return B * A; }
