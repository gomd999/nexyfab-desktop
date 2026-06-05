/**
 * bimetal.ts — thermal-mismatch effects: free expansion, fully-constrained thermal
 * stress, and the bending of a bonded bimetallic strip (thermostats, thermal switches).
 *
 *   free thermal strain:   ε_th = α·ΔT
 *   constrained stress:    σ = E·α·ΔT                          (fully restrained, no strain)
 *   differential growth:   δL = (α₂−α₁)·ΔT·L
 *   bimetal curvature:     κ = 1.5·(α₂−α₁)·ΔT/h                (Timoshenko, equal t & E)
 *   tip deflection:        δ = κ·L²/2                          (cantilever, small angle)
 *
 * Verified against the free strain α·ΔT, the constrained stress E·α·ΔT, the no-bending
 * case for matched α, the κ ∝ Δα·ΔT/h scaling, and the κ→δ cantilever relation.
 */

/** Free thermal strain ε = α·ΔT. */
export function thermalStrain(alpha: number, dT: number): number { return alpha * dT; }
/** Fully-constrained thermal stress σ = E·α·ΔT. */
export function constrainedThermalStress(E: number, alpha: number, dT: number): number { return E * alpha * dT; }
/** Differential length change between two materials δL = (α₂−α₁)·ΔT·L. */
export function differentialExpansion(alpha1: number, alpha2: number, dT: number, L: number): number {
  return (alpha2 - alpha1) * dT * L;
}
/** Bimetallic-strip curvature κ = 1.5·(α₂−α₁)·ΔT/h (equal thickness & modulus). */
export function bimetalCurvature(alpha1: number, alpha2: number, dT: number, h: number): number {
  return (1.5 * (alpha2 - alpha1) * dT) / h;
}
/** Cantilever tip deflection from curvature δ = κ·L²/2. */
export function bimetalTipDeflection(kappa: number, L: number): number { return (kappa * L * L) / 2; }
