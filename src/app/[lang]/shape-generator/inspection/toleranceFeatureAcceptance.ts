/**
 * toleranceFeatureAcceptance.ts — Determine whether a measured
 * feature passes its tolerance specification.
 *
 * For each inspected feature the module evaluates:
 *
 *   - Bilateral tolerance: nominal ± plus/minus.
 *   - Unilateral tolerance: e.g. +0.05/0.
 *   - GD&T position tolerance (cylindrical zone).
 *   - GD&T form tolerance (flatness, circularity, cylindricity).
 *
 * Decision:
 *
 *   - inside → pass
 *   - within "amber zone" (between user-defined warn band and outer) → marginal
 *   - outside → fail
 *
 * Module supports per-feature decision + bulk pass/fail rollup.
 */

export type ToleranceKind = 'bilateral' | 'unilateral' | 'position' | 'form-flatness' | 'form-circularity' | 'form-cylindricity';

export interface ToleranceSpec {
  kind: ToleranceKind;
  /** Nominal value (for dimensional). */
  nominalMm?: number;
  /** Plus tolerance (mm). */
  plusMm?: number;
  /** Minus tolerance (mm). */
  minusMm?: number;
  /** Diameter of position zone (mm). */
  positionZoneDiameterMm?: number;
  /** Maximum form deviation. */
  formMaxMm?: number;
}

export interface FeatureMeasurement {
  id: string;
  spec: ToleranceSpec;
  /** Measured value (dimensional). */
  measuredMm?: number;
  /** Measured deviation from true position (mm). */
  positionDeviationMm?: number;
  /** Measured form deviation. */
  formMm?: number;
}

export interface AcceptanceOptions {
  /** Warning band as fraction of tolerance (default 0.85 → last 15% is marginal). */
  warnBandFraction: number;
}

export const DEFAULT_OPTIONS: AcceptanceOptions = {
  warnBandFraction: 0.85,
};

export type Decision = 'pass' | 'marginal' | 'fail';

export interface AcceptanceResult {
  featureId: string;
  decision: Decision;
  reason: string;
  /** Deviation from nominal / zero (mm). */
  deviationMm: number;
  /** Tolerance window envelope (for dimensional) or zone (for GD&T). */
  toleranceWidthMm: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function evaluateAcceptance(
  features: FeatureMeasurement[],
  options: Partial<AcceptanceOptions> = {},
): AcceptanceResult[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  return features.map(f => evaluateOne(f, opts));
}

function evaluateOne(f: FeatureMeasurement, opts: AcceptanceOptions): AcceptanceResult {
  switch (f.spec.kind) {
    case 'bilateral':
    case 'unilateral': {
      const nominal = f.spec.nominalMm ?? 0;
      const plus = f.spec.plusMm ?? 0;
      const minus = f.spec.minusMm ?? 0;
      const measured = f.measuredMm ?? nominal;
      const deviation = measured - nominal;
      const lowerBound = -minus;
      const upperBound = plus;
      const width = plus + minus;
      let decision: Decision;
      let reason: string;
      if (deviation >= lowerBound && deviation <= upperBound) {
        // Inside. Check warn band.
        const warnLow = lowerBound * opts.warnBandFraction;
        const warnHigh = upperBound * opts.warnBandFraction;
        if (deviation < warnLow || deviation > warnHigh) {
          decision = 'marginal';
          reason = `Within tolerance but in warn band (deviation ${deviation.toFixed(3)} mm).`;
        } else {
          decision = 'pass';
          reason = `Within tolerance (deviation ${deviation.toFixed(3)} mm).`;
        }
      } else {
        decision = 'fail';
        reason = `Out of tolerance (deviation ${deviation.toFixed(3)} mm, limits [${lowerBound.toFixed(3)}, ${upperBound.toFixed(3)}]).`;
      }
      return { featureId: f.id, decision, reason, deviationMm: deviation, toleranceWidthMm: width };
    }
    case 'position': {
      const zoneDia = f.spec.positionZoneDiameterMm ?? 0;
      const dev = f.positionDeviationMm ?? 0;
      const radius = zoneDia / 2;
      let decision: Decision;
      let reason: string;
      if (dev <= radius) {
        if (dev > radius * opts.warnBandFraction) {
          decision = 'marginal';
          reason = `Position deviation ${dev.toFixed(3)} mm in warn band (zone radius ${radius.toFixed(3)}).`;
        } else {
          decision = 'pass';
          reason = `Position within zone (deviation ${dev.toFixed(3)} mm).`;
        }
      } else {
        decision = 'fail';
        reason = `Position deviation ${dev.toFixed(3)} mm exceeds zone radius ${radius.toFixed(3)}.`;
      }
      return { featureId: f.id, decision, reason, deviationMm: dev, toleranceWidthMm: zoneDia };
    }
    case 'form-flatness':
    case 'form-circularity':
    case 'form-cylindricity': {
      const maxForm = f.spec.formMaxMm ?? 0;
      const form = f.formMm ?? 0;
      let decision: Decision;
      let reason: string;
      if (form <= maxForm) {
        if (form > maxForm * opts.warnBandFraction) {
          decision = 'marginal';
          reason = `Form deviation ${form.toFixed(4)} mm in warn band.`;
        } else {
          decision = 'pass';
          reason = `Form deviation within spec.`;
        }
      } else {
        decision = 'fail';
        reason = `Form deviation ${form.toFixed(4)} mm exceeds spec ${maxForm.toFixed(4)} mm.`;
      }
      return { featureId: f.id, decision, reason, deviationMm: form, toleranceWidthMm: maxForm };
    }
  }
}

// ── Rollup ────────────────────────────────────────────────────

export interface RollupReport {
  totalFeatures: number;
  passCount: number;
  marginalCount: number;
  failCount: number;
  acceptanceRate: number;
}

export function rollup(results: AcceptanceResult[]): RollupReport {
  let pass = 0, marg = 0, fail = 0;
  for (const r of results) {
    if (r.decision === 'pass') pass++;
    else if (r.decision === 'marginal') marg++;
    else fail++;
  }
  return {
    totalFeatures: results.length,
    passCount: pass,
    marginalCount: marg,
    failCount: fail,
    acceptanceRate: results.length === 0 ? 1 : (pass + marg) / results.length,
  };
}

// ── Worst features ────────────────────────────────────────────

export function worstFeatures(results: AcceptanceResult[], n: number = 5): AcceptanceResult[] {
  return results
    .filter(r => r.decision !== 'pass')
    .slice()
    .sort((a, b) => Math.abs(b.deviationMm) - Math.abs(a.deviationMm))
    .slice(0, n);
}

// ── Summary ────────────────────────────────────────────────────

export interface AcceptanceSummary {
  totalFeatures: number;
  acceptanceRate: number;
  failCount: number;
  marginalCount: number;
}

export function summarize(results: AcceptanceResult[]): AcceptanceSummary {
  const r = rollup(results);
  return {
    totalFeatures: r.totalFeatures,
    acceptanceRate: r.acceptanceRate,
    failCount: r.failCount,
    marginalCount: r.marginalCount,
  };
}
