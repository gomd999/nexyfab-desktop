/**
 * transmissionLine.ts — RF transmission-line mismatch: reflection coefficient, standing-
 * wave ratio, return loss, and quarter-wave matching.
 *
 *   reflection:    Γ = (Z_L − Z₀)/(Z_L + Z₀)
 *   VSWR:          S = (1 + |Γ|)/(1 − |Γ|)
 *   return loss:   RL = −20·log₁₀|Γ|   [dB]
 *   power reflected: |Γ|²
 *   quarter-wave:  Z_T = √(Z₀·Z_L)       (λ/4 transformer matching Z₀ to Z_L)
 *
 * Verified against the matched case (Γ=0, S=1, RL=∞), the open/short extremes (|Γ|=1,
 * S→∞), the quarter-wave geometric-mean impedance, and the VSWR from |Γ|.
 */

/** Voltage reflection coefficient Γ = (Z_L − Z₀)/(Z_L + Z₀). */
export function reflectionCoefficient(ZL: number, Z0: number): number { return (ZL - Z0) / (ZL + Z0); }
/** Voltage standing-wave ratio S = (1+|Γ|)/(1−|Γ|). */
export function vswr(gamma: number): number {
  const g = Math.abs(gamma);
  return (1 + g) / (1 - g);
}
/** Return loss RL = −20·log₁₀|Γ| (dB). */
export function returnLoss(gamma: number): number { return -20 * Math.log10(Math.abs(gamma)); }
/** Fraction of incident power reflected |Γ|². */
export function powerReflected(gamma: number): number { return gamma * gamma; }
/** Quarter-wave transformer impedance Z_T = √(Z₀·Z_L). */
export function quarterWaveImpedance(Z0: number, ZL: number): number { return Math.sqrt(Z0 * ZL); }
