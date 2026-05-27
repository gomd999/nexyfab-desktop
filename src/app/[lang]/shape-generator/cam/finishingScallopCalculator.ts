/**
 * finishingScallopCalculator.ts — Scallop height from step-over for
 * ball-nose finishing passes.
 *
 * For a ball-end mill of radius R with parallel-pass step-over s, the
 * residual peak between adjacent passes is:
 *
 *   h = R − √(R² − (s/2)²)
 *
 * Inversely, the step-over required to hit a target scallop h_target is:
 *
 *   s = 2 · √(2·R·h − h²)
 *
 * For curved surfaces, the *effective* radius is reduced by surface
 * curvature: R_eff = R · k / (k + 1/ρ) for convex (ρ > 0). On concave
 * surfaces (ρ < 0) the effective radius increases — scallop drops.
 */

export interface ScallopInput {
  toolRadiusMm: number;
  stepOverMm: number;
  surfaceCurvatureKmm?: number; // 1/ρ (positive = convex, negative = concave). Optional.
}

export interface ScallopTargetInput {
  toolRadiusMm: number;
  targetScallopMm: number;
  surfaceCurvatureKmm?: number;
}

export interface ScallopResult {
  scallopHeightMm: number;
  effectiveRadiusMm: number;
  withinTolerance: boolean | null;
  toleranceTargetMm: number | null;
}

export function calcScallop(input: ScallopInput, toleranceMm?: number): ScallopResult {
  const R = input.toolRadiusMm;
  const s = input.stepOverMm;
  if (R <= 0 || s <= 0) {
    return { scallopHeightMm: 0, effectiveRadiusMm: R, withinTolerance: null, toleranceTargetMm: toleranceMm ?? null };
  }
  const Reff = effectiveRadius(R, input.surfaceCurvatureKmm);
  const half = s / 2;
  if (half >= Reff) {
    // step-over exceeds tool diameter → cusp = full radius (flat between)
    return { scallopHeightMm: Reff, effectiveRadiusMm: Reff, withinTolerance: toleranceMm == null ? null : false, toleranceTargetMm: toleranceMm ?? null };
  }
  const h = Reff - Math.sqrt(Reff * Reff - half * half);
  return {
    scallopHeightMm: h,
    effectiveRadiusMm: Reff,
    withinTolerance: toleranceMm == null ? null : h <= toleranceMm,
    toleranceTargetMm: toleranceMm ?? null,
  };
}

/** Solve required step-over for a target scallop height. */
export function stepOverForScallop(input: ScallopTargetInput): number {
  const R = input.toolRadiusMm;
  const h = input.targetScallopMm;
  if (R <= 0 || h <= 0) return 0;
  const Reff = effectiveRadius(R, input.surfaceCurvatureKmm);
  const hClamped = Math.min(h, Reff);
  return 2 * Math.sqrt(Math.max(0, 2 * Reff * hClamped - hClamped * hClamped));
}

function effectiveRadius(R: number, k: number | undefined): number {
  if (k == null || k === 0) return R;
  // R_eff for combined tool + surface curvature: 1/R_eff = 1/R + k
  const inv = 1 / R + k;
  if (inv <= 0) return Infinity; // concave matches tool: scallop disappears
  return 1 / inv;
}

/** Recommend step-over for several common Ra targets (in µm). */
export interface StepOverRecommendation {
  raMicrometers: number;
  approxScallopMm: number;
  stepOverMm: number;
}

export function recommendStepOvers(toolRadiusMm: number, surfaceCurvatureKmm?: number): StepOverRecommendation[] {
  // empirical: scallop ≈ 5×Ra for ball mill finishing
  const targets = [0.4, 0.8, 1.6, 3.2, 6.3];
  return targets.map(ra => {
    const h = ra * 0.005; // µm → mm × empirical factor (5×Ra in µm = h in µm → mm)
    return {
      raMicrometers: ra,
      approxScallopMm: h,
      stepOverMm: stepOverForScallop({ toolRadiusMm, targetScallopMm: h, ...(surfaceCurvatureKmm !== undefined ? { surfaceCurvatureKmm } : {}) }),
    };
  });
}

export function summarize(r: ScallopResult): { scallopHeightMm: number; effectiveRadiusMm: number; withinTolerance: boolean | null } {
  return { scallopHeightMm: r.scallopHeightMm, effectiveRadiusMm: r.effectiveRadiusMm, withinTolerance: r.withinTolerance };
}
