/**
 * acousticImpedance.ts — plane-wave reflection and transmission at the boundary between
 * two media of differing characteristic acoustic impedance.
 *
 *   characteristic impedance:  Z = ρ·c
 *   pressure reflection:       R = (Z₂ − Z₁)/(Z₂ + Z₁)
 *   pressure transmission:     T = 2Z₂/(Z₂ + Z₁)
 *   power transmission:        τ = 4Z₁Z₂/(Z₁ + Z₂)²
 *   power reflection:          ρ_p = R²
 *   energy conservation:       τ + ρ_p = 1
 *
 * Verified against the matched-impedance full transmission (R=0, τ=1), the energy
 * conservation τ+R²=1, the rigid-wall full reflection (Z₂→∞ ⇒ R→1), and Z=ρc.
 */

/** Characteristic (specific) acoustic impedance Z = ρ·c. */
export function acousticImpedance(rho: number, c: number): number { return rho * c; }
/** Pressure reflection coefficient R = (Z₂−Z₁)/(Z₂+Z₁). */
export function reflectionCoefficient(Z1: number, Z2: number): number { return (Z2 - Z1) / (Z2 + Z1); }
/** Pressure transmission coefficient T = 2Z₂/(Z₂+Z₁). */
export function transmissionCoefficient(Z1: number, Z2: number): number { return (2 * Z2) / (Z2 + Z1); }
/** Power transmission coefficient τ = 4Z₁Z₂/(Z₁+Z₂)². */
export function powerTransmission(Z1: number, Z2: number): number { return (4 * Z1 * Z2) / (Z1 + Z2) ** 2; }
/** Power reflection coefficient ρ_p = R². */
export function powerReflection(Z1: number, Z2: number): number { return reflectionCoefficient(Z1, Z2) ** 2; }
