/**
 * stressConcentration.ts — elastic stress-concentration factors K_t = σ_max/σ_nom and
 * the fatigue notch factor.
 *
 *   elliptical hole (load ⟂ to the a-axis):  K_t = 1 + 2a/b = 1 + 2√(a/ρ),  ρ = b²/a
 *   circular hole (a=b):  K_t = 3;   crack-like (b→0, ρ→0):  K_t → ∞
 *   fatigue notch factor:  K_f = 1 + q·(K_t − 1)   (0 ≤ q ≤ 1, notch sensitivity)
 *
 * Verified: the circular-hole K_t=3, the two equivalent elliptical forms, the crack-
 * like divergence, and K_f between 1 and K_t.
 */

/** Circular-hole concentration factor in an infinite plate under uniaxial tension. */
export function circularHoleKt(): number { return 3; }

/** Elliptical-hole K_t = 1 + 2a/b (semi-axis a perpendicular to the load). */
export function ellipticalHoleKt(a: number, b: number): number { return 1 + (2 * a) / b; }

/** Elliptical-hole K_t from the tip radius: K_t = 1 + 2√(a/ρ). */
export function ellipticalHoleKtFromRadius(a: number, rho: number): number { return 1 + 2 * Math.sqrt(a / rho); }

/** Tip radius of curvature of an ellipse at the a-axis end: ρ = b²/a. */
export function ellipseTipRadius(a: number, b: number): number { return (b * b) / a; }

/** Maximum (peak) stress σ_max = K_t·σ_nom. */
export function maxStress(nominal: number, Kt: number): number { return Kt * nominal; }

/** Fatigue notch factor K_f = 1 + q·(K_t − 1). */
export function fatigueNotchFactor(Kt: number, q: number): number { return 1 + q * (Kt - 1); }
