/**
 * liftAirfoil.ts — aerodynamic lift from the Kutta–Joukowski theorem and thin-airfoil
 * theory.
 *
 *   Kutta–Joukowski:  L' = ρ·V∞·Γ                  (lift per unit span from circulation Γ)
 *   dynamic pressure: q  = ½·ρ·V²
 *   lift coefficient: C_L = L/(q·S)
 *   thin airfoil:     C_L = 2π·α                    (α = angle of attack, rad)
 *                     Γ   = π·c·V·α                  (so L' = ρVΓ = q·c·C_L are consistent)
 *
 * Verified against the Kutta–Joukowski L'=ρVΓ, the thin-airfoil C_L=2πα, the consistency
 * ρVΓ ≡ q·c·C_L of the two lift expressions, and the C_L=L/(qS) inverse.
 */

/** Lift per unit span L' = ρ·V·Γ (Kutta–Joukowski). */
export function kuttaJoukowskiLift(rho: number, V: number, Gamma: number): number { return rho * V * Gamma; }
/** Dynamic pressure q = ½·ρ·V². */
export function dynamicPressure(rho: number, V: number): number { return 0.5 * rho * V * V; }
/** Lift coefficient C_L = L/(q·S). */
export function liftCoefficient(L: number, q: number, S: number): number { return L / (q * S); }
/** Lift from a coefficient L = C_L·q·S. */
export function liftFromCoefficient(CL: number, q: number, S: number): number { return CL * q * S; }
/** Thin-airfoil lift-curve slope C_L = 2π·α. */
export function thinAirfoilCL(alpha: number): number { return 2 * Math.PI * alpha; }
/** Thin-airfoil bound circulation Γ = π·c·V·α. */
export function thinAirfoilCirculation(chord: number, V: number, alpha: number): number {
  return Math.PI * chord * V * alpha;
}
