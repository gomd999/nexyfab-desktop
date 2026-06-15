/**
 * parisCrack.ts — fatigue crack growth by the PARIS law (fracture-mechanics fatigue,
 * complementing the S-N/Miner approach). A crack of length a under a cyclic stress
 * range Δσ grows per cycle as
 *
 *   da/dN = C·(ΔK)^m,   ΔK = Y·Δσ·√(π·a)        (Y = geometry factor)
 *
 * It runs away once K reaches the fracture toughness K_Ic (critical length a_c). The
 * cycles to failure follow from integrating da/(C·ΔK^m). Verified against the
 * closed-form life integral, the critical-length and ΔK formulas, and the strong Δσ
 * dependence of life.
 */

export interface ParisMaterial { C: number; m: number; Y: number; }

/** Stress-intensity-factor range ΔK = Y·Δσ·√(π·a). */
export function stressIntensityRange(dSigma: number, a: number, Y: number): number {
  return Y * dSigma * Math.sqrt(Math.PI * a);
}

/** Crack growth per cycle da/dN = C·ΔK^m. */
export function crackGrowthRate(dK: number, mat: ParisMaterial): number {
  return mat.C * Math.pow(dK, mat.m);
}

/** Critical crack length where K reaches the fracture toughness: a_c = (K_Ic/(Y·σ_max))²/π. */
export function criticalCrackLength(Kic: number, sigmaMax: number, Y: number): number {
  return (Kic / (Y * sigmaMax)) ** 2 / Math.PI;
}

/**
 * Closed-form cycles to grow a crack from a0 to af (constant Y, m ≠ 2):
 *   N = [af^{1−m/2} − a0^{1−m/2}] / [C·(Y·Δσ·√π)^m·(1−m/2)].
 */
export function cyclesToFailure(a0: number, af: number, dSigma: number, mat: ParisMaterial): number {
  const { C, m, Y } = mat;
  const k = C * Math.pow(Y * dSigma * Math.sqrt(Math.PI), m);
  const e = 1 - m / 2;
  return (Math.pow(af, e) - Math.pow(a0, e)) / (k * e);
}

/** Numerically integrate the crack from a0 to af, summing dN = da/(C·ΔK^m). */
export function integrateCrack(a0: number, af: number, dSigma: number, mat: ParisMaterial, steps = 200000): number {
  const da = (af - a0) / steps;
  let N = 0;
  for (let i = 0; i < steps; i++) {
    const a = a0 + (i + 0.5) * da;
    const dK = stressIntensityRange(dSigma, a, mat.Y);
    N += da / crackGrowthRate(dK, mat);
  }
  return N;
}
