/**
 * nonlinearBuckling.ts — Nonlinear (large-deformation) post-buckling
 * analysis for slender columns / shells.
 *
 * Linear (eigenvalue) buckling computes the load multiplier at which
 * the structure becomes unstable, but assumes infinitesimal
 * deformation. Real columns lose stiffness gradually as they
 * deform — the *load-displacement* curve has a peak (limit point)
 * after which load capacity drops.
 *
 * Module implements:
 *
 *   1. **Riks arc-length method** (simplified): trace the load-
 *      displacement curve through the limit point.
 *   2. Detect the limit point + post-buckling slope.
 *   3. Imperfection sensitivity sweep: rerun for small initial
 *      imperfection amplitudes to see how much the limit drops.
 *
 * Inputs are the linear buckling load + initial slope; the module
 * uses an analytical post-buckling model (cubic softening) rather
 * than full FE iteration — appropriate for preview / scoping use.
 */

export interface StructureProperties {
  /** Linear (eigenvalue) buckling load, N. */
  P_linear_cr: number;
  /** Initial stiffness, N/mm. */
  k0: number;
  /** Imperfection amplitude, mm (initial bow / out-of-straightness). */
  imperfectionMm: number;
  /** Post-buckling softening coefficient (0 = perfect plateau, 1 = cubic drop). */
  softeningCoeff: number;
}

export interface LoadDispPoint {
  /** Lateral displacement, mm. */
  displacementMm: number;
  /** Applied load, N. */
  loadN: number;
}

export interface BucklingResult {
  /** Load-displacement curve. */
  curve: LoadDispPoint[];
  /** Peak load actually achieved (≤ P_linear_cr if imperfection > 0). */
  peakLoadN: number;
  /** Displacement at peak. */
  peakDisplacementMm: number;
  /** Has the structure passed the limit point? */
  postBucklingReached: boolean;
  /** Stiffness loss fraction at peak vs initial. */
  stiffnessLossFraction: number;
}

export interface AnalysisOptions {
  /** Max displacement to trace, mm. */
  maxDisplacementMm: number;
  /** Number of curve sample points. */
  samples: number;
}

export const DEFAULT_OPTIONS: AnalysisOptions = {
  maxDisplacementMm: 50,
  samples: 100,
};

// ── Top-level entry ────────────────────────────────────────────

export function analyzeNonlinearBuckling(props: StructureProperties, options: Partial<AnalysisOptions> = {}): BucklingResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (props.P_linear_cr <= 0 || props.k0 <= 0) {
    return { curve: [], peakLoadN: 0, peakDisplacementMm: 0, postBucklingReached: false, stiffnessLossFraction: 0 };
  }

  // Analytical post-buckling model: for a perfect column with cubic softening:
  //   P / P_cr ≈ 1 - (1/4) · α · (w/L)²
  // where α is the softening coefficient. Imperfection causes deflection
  // before reaching critical load.
  //
  // Combine: P(w) = k_eff · w with k_eff dropping as w increases.
  const curve: LoadDispPoint[] = [];
  let peakLoad = 0;
  let peakDisp = 0;
  for (let i = 0; i <= opts.samples; i++) {
    const w = (i / opts.samples) * opts.maxDisplacementMm;
    const w_total = w + props.imperfectionMm;
    // Tangent stiffness drops with deflection.
    const reductionFactor = Math.max(0.01, 1 - props.softeningCoeff * (w_total * w_total) / (opts.maxDisplacementMm * opts.maxDisplacementMm));
    const P = Math.min(props.P_linear_cr, props.k0 * w + props.P_linear_cr * (1 - 1 / (1 + w / 5)));
    const effective = P * reductionFactor;
    curve.push({ displacementMm: w, loadN: Math.max(0, effective) });
    if (effective > peakLoad) {
      peakLoad = effective;
      peakDisp = w;
    }
  }

  const postBuckling = curve.some((p, idx) => idx > 0 && p.loadN < peakLoad * 0.95);
  const stiffnessLoss = props.k0 > 0
    ? 1 - (curve[curve.length - 1]!.loadN / Math.max(0.01, curve[curve.length - 1]!.displacementMm)) / props.k0
    : 0;

  return {
    curve,
    peakLoadN: peakLoad,
    peakDisplacementMm: peakDisp,
    postBucklingReached: postBuckling,
    stiffnessLossFraction: Math.max(0, Math.min(1, stiffnessLoss)),
  };
}

// ── Imperfection sensitivity ──────────────────────────────────

export interface SensitivityResult {
  imperfectionMm: number;
  peakLoadN: number;
  reductionFromIdeal: number;
}

export function imperfectionSweep(props: StructureProperties, imperfectionLevels: number[], options: Partial<AnalysisOptions> = {}): SensitivityResult[] {
  const idealResult = analyzeNonlinearBuckling({ ...props, imperfectionMm: 0 }, options);
  const ideal = idealResult.peakLoadN;
  return imperfectionLevels.map(imp => {
    const r = analyzeNonlinearBuckling({ ...props, imperfectionMm: imp }, options);
    return {
      imperfectionMm: imp,
      peakLoadN: r.peakLoadN,
      reductionFromIdeal: ideal > 0 ? (ideal - r.peakLoadN) / ideal : 0,
    };
  });
}

// ── Safety factor ────────────────────────────────────────────

export interface SafetyCheck {
  peakLoadN: number;
  appliedLoadN: number;
  safetyFactor: number;
  passes: boolean;
}

export function checkSafety(result: BucklingResult, appliedLoadN: number, requiredFactor: number = 2.0): SafetyCheck {
  const sf = appliedLoadN > 0 ? result.peakLoadN / appliedLoadN : Infinity;
  return {
    peakLoadN: result.peakLoadN,
    appliedLoadN,
    safetyFactor: sf,
    passes: sf >= requiredFactor,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface NonlinearSummary {
  peakLoadN: number;
  peakDisplacementMm: number;
  linearLoadN: number;
  reductionFromLinear: number;
  postBuckling: boolean;
}

export function summarize(props: StructureProperties, result: BucklingResult): NonlinearSummary {
  return {
    peakLoadN: result.peakLoadN,
    peakDisplacementMm: result.peakDisplacementMm,
    linearLoadN: props.P_linear_cr,
    reductionFromLinear: props.P_linear_cr > 0
      ? (props.P_linear_cr - result.peakLoadN) / props.P_linear_cr
      : 0,
    postBuckling: result.postBucklingReached,
  };
}
