/**
 * fatigueAnalysis.ts — High-cycle fatigue life prediction.
 *
 * Stage 1 FEA reports peak stress. But parts under cyclic load fail
 * long before peak stress reaches the yield strength — fatigue. This
 * module implements the standard high-cycle fatigue checks:
 *
 *   - **Goodman** — most common; conservative.
 *   - **Soderberg** — uses yield strength as the cap; most conservative.
 *   - **Gerber** — parabolic; least conservative for ductile metals.
 *
 * All three combine *mean stress* σ_m and *alternating stress* σ_a
 * against material properties:
 *
 *   Goodman:    σ_a / S_e + σ_m / S_ut = 1
 *   Soderberg:  σ_a / S_e + σ_m / S_y  = 1
 *   Gerber:     σ_a / S_e + (σ_m / S_ut)² = 1
 *
 *   - S_e  = endurance limit (~0.5 × S_ut for steel; lower for Al)
 *   - S_ut = ultimate tensile strength
 *   - S_y  = yield strength
 *
 * Also includes a Basquin power-law for finite life (number of cycles
 * to failure when alternating stress is above the endurance limit).
 */

export type FatigueCriterion = 'goodman' | 'soderberg' | 'gerber';

export interface FatigueLoadCase {
  /** Peak stress in the loading cycle (MPa, positive = tension). */
  maxStressMpa: number;
  /** Minimum stress in the loading cycle (MPa). */
  minStressMpa: number;
}

export interface FatigueMaterial {
  /** Ultimate tensile strength S_ut (MPa). */
  ultimateStrengthMpa: number;
  /** Yield strength S_y (MPa). */
  yieldStrengthMpa: number;
  /** Endurance limit S_e at 10⁷ cycles (MPa). */
  enduranceLimitMpa: number;
  /** Basquin exponent for finite-life (-) — default 0.1 for steels. */
  basquinExponent?: number;
}

export interface FatigueResult {
  /** Mean stress σ_m = (σ_max + σ_min) / 2 (MPa). */
  meanStressMpa: number;
  /** Alternating stress σ_a = (σ_max - σ_min) / 2 (MPa). */
  alternatingStressMpa: number;
  /** R-ratio = σ_min / σ_max. */
  stressRatio: number;
  /** Goodman / Soderberg / Gerber safety factors. */
  goodmanSf: number;
  soderbergSf: number;
  gerberSf: number;
  /** Estimated cycles to failure (Basquin). Infinity if below endurance limit. */
  cyclesToFailure: number;
  /** Pass = safety factor ≥ 1 by Goodman. */
  passGoodman: boolean;
}

export function analyzeFatigue(
  load: FatigueLoadCase,
  material: FatigueMaterial,
): FatigueResult {
  const meanStress = (load.maxStressMpa + load.minStressMpa) / 2;
  const altStress = (load.maxStressMpa - load.minStressMpa) / 2;
  const stressRatio = load.maxStressMpa === 0 ? 0 : load.minStressMpa / load.maxStressMpa;
  const Sut = material.ultimateStrengthMpa;
  const Sy = material.yieldStrengthMpa;
  const Se = material.enduranceLimitMpa;

  // Goodman SF — distance to failure envelope.
  // Envelope: σ_a/Se + σ_m/Sut = 1. Failure when LHS = 1.
  const goodmanLhs = altStress / Se + meanStress / Sut;
  const goodmanSf = goodmanLhs > 0 ? 1 / goodmanLhs : Infinity;

  const soderbergLhs = altStress / Se + meanStress / Sy;
  const soderbergSf = soderbergLhs > 0 ? 1 / soderbergLhs : Infinity;

  // Gerber — σ_a / Se + (σ_m / Sut)² = 1
  // For finding SF: solve n·(σ_a/Se) + (n·σ_m/Sut)² = 1
  let gerberSf: number;
  if (meanStress === 0) {
    gerberSf = altStress > 0 ? Se / altStress : Infinity;
  } else {
    // Quadratic in n: (σ_m²/Sut²)·n² + (σ_a/Se)·n - 1 = 0
    const a = (meanStress * meanStress) / (Sut * Sut);
    const b = altStress / Se;
    const c = -1;
    const disc = b * b - 4 * a * c;
    gerberSf = disc >= 0 ? (-b + Math.sqrt(disc)) / (2 * a) : Infinity;
  }

  // Basquin life: σ_a = S_f · (2N)^b
  // → N = 0.5 · (σ_a / S_f)^(1/b)
  // where S_f is a coefficient and b is the basquin exponent.
  // Approximation: S_f ≈ Sut, b ≈ -basquinExponent (default 0.1).
  const exponent = material.basquinExponent ?? 0.1;
  let cyclesToFailure: number;
  if (altStress <= Se) {
    cyclesToFailure = Infinity;
  } else if (altStress >= Sut) {
    cyclesToFailure = 1; // immediate failure
  } else {
    cyclesToFailure = 0.5 * Math.pow(Sut / altStress, 1 / exponent);
  }

  return {
    meanStressMpa: meanStress,
    alternatingStressMpa: altStress,
    stressRatio,
    goodmanSf,
    soderbergSf,
    gerberSf,
    cyclesToFailure,
    passGoodman: goodmanSf >= 1,
  };
}

/** Miner's rule cumulative damage from N load blocks. Returns
 *  cumulative damage D = Σ n_i / N_i. Failure when D = 1. */
export function minerCumulativeDamage(
  blocks: Array<{ cycles: number; load: FatigueLoadCase }>,
  material: FatigueMaterial,
): { damage: number; failed: boolean; perBlockDamage: number[] } {
  const perBlock: number[] = [];
  let total = 0;
  for (const blk of blocks) {
    const r = analyzeFatigue(blk.load, material);
    const d = blk.cycles / r.cyclesToFailure;
    perBlock.push(d);
    total += d;
  }
  return { damage: total, failed: total >= 1, perBlockDamage: perBlock };
}
