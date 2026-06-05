/**
 * boundaryLayer.ts — laminar flat-plate boundary layer from the Blasius similarity
 * solution.
 *
 *   Reynolds (local):   Re_x = U·x/ν
 *   thickness:          δ   = 5.0·x/√(Re_x)            (δ ∝ √(νx/U) — grows like √x)
 *   displacement:       δ*  = 1.721·x/√(Re_x)
 *   momentum:           θ   = 0.664·x/√(Re_x)
 *   wall shear:         τ_w = 0.332·ρU²/√(Re_x) = ½ρU²·C_f
 *   local skin friction: C_f = 0.664/√(Re_x)
 *   plate drag coef.:   C_D = 1.328/√(Re_L)            (= 2·C_f at the trailing edge)
 *
 * Verified against the √x growth of δ, the fixed shape ratios (δ-star over δ, θ over δ),
 * the τ_w = ½ρU²·C_f identity, and the plate-average C_D = 2·C_f(L).
 */

/** Local Reynolds number Re_x = U·x/ν. */
export function reynoldsX(U: number, x: number, nu: number): number { return (U * x) / nu; }
/** Boundary-layer thickness δ = 5.0·x/√(Re_x). */
export function blasiusThickness(x: number, Rex: number): number { return (5.0 * x) / Math.sqrt(Rex); }
/** Displacement thickness δ* = 1.721·x/√(Re_x). */
export function displacementThickness(x: number, Rex: number): number { return (1.721 * x) / Math.sqrt(Rex); }
/** Momentum thickness θ = 0.664·x/√(Re_x). */
export function momentumThickness(x: number, Rex: number): number { return (0.664 * x) / Math.sqrt(Rex); }
/** Wall shear stress τ_w = 0.332·ρU²/√(Re_x). */
export function wallShearStress(rho: number, U: number, Rex: number): number {
  return (0.332 * rho * U * U) / Math.sqrt(Rex);
}
/** Local skin-friction coefficient C_f = 0.664/√(Re_x). */
export function skinFrictionLocal(Rex: number): number { return 0.664 / Math.sqrt(Rex); }
/** Plate-average drag coefficient C_D = 1.328/√(Re_L). */
export function dragCoefficientPlate(ReL: number): number { return 1.328 / Math.sqrt(ReL); }
