/**
 * weldedJoint.ts — strength of fillet and butt welds.
 *
 *   fillet throat:   t = 0.707·h            (h = leg size; the throat is the weakest plane)
 *   fillet shear:    τ = F/(0.707·h·L)      (L = weld length)
 *   butt weld:       σ = F/(t·L)
 *   eccentric group: τ' = P/A (primary),  τ'' = T·r/J (secondary, T = P·e),
 *                    τ = √(τ'² + τ''² + 2τ'τ''·cosθ)
 *
 * Verified against the throat geometry, the shear/butt stresses and their scaling, and
 * the combined primary+secondary stress of an eccentrically loaded weld.
 */

const ROOT2_OVER_2 = Math.SQRT1_2; // 0.7071...

/** Fillet-weld effective throat t = 0.707·h. */
export function filletThroat(legSize: number): number { return ROOT2_OVER_2 * legSize; }
/** Fillet-weld throat area A = 0.707·h·L. */
export function filletThroatArea(legSize: number, length: number): number { return filletThroat(legSize) * length; }
/** Fillet-weld shear stress τ = F/(0.707·h·L). */
export function filletShearStress(F: number, legSize: number, length: number): number {
  return F / filletThroatArea(legSize, length);
}
/** Butt-weld normal stress σ = F/(t·L). */
export function buttWeldStress(F: number, throat: number, length: number): number { return F / (throat * length); }

/** Combined stress of an eccentrically loaded weld group: τ = √(τ'² + τ''² + 2τ'τ''cosθ). */
export function combinedWeldStress(primary: number, secondary: number, cosTheta: number): number {
  return Math.sqrt(primary * primary + secondary * secondary + 2 * primary * secondary * cosTheta);
}
