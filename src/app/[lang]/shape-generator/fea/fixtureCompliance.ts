/**
 * fixtureCompliance.ts — Fixture compliance assessment for FEA.
 *
 * In real-world testing, the fixture / clamp / fixture-bolt that
 * holds the part has finite stiffness. If the fixture is too
 * compliant relative to the part, the measured response (stress,
 * deflection, frequency) shifts noticeably from "ideal rigid
 * support" predictions.
 *
 * Rule of thumb (NAFEMS NEL/NS):
 *   k_fixture >= 10 × k_part  ⇒ rigid fixture (safe to assume)
 *   k_fixture >= 3 × k_part   ⇒ moderate (5-10% shift)
 *   k_fixture <  k_part       ⇒ fixture dominates response
 *
 * Module computes:
 *   - Estimated effective stiffness of part at each fixture point.
 *   - Stiffness ratio = k_fixture / k_part.
 *   - Recommended classification + corrective action.
 */

export interface FixturePoint {
  id: string;
  /** Location on the part. */
  point: { x: number; y: number; z: number };
  /** Fixture stiffness in normal direction (N/mm). */
  fixtureStiffnessN_mm: number;
  /** Friction coefficient if shear is relevant. */
  friction?: number;
}

export interface PartProperties {
  /** Young modulus, MPa. */
  youngMpa: number;
  /** Characteristic dimension near the fixture (mm). */
  characteristicLengthMm: number;
  /** Wall thickness near fixture (mm). */
  thicknessMm: number;
}

export interface ComplianceResult {
  fixtureId: string;
  partLocalStiffness: number;
  fixtureStiffness: number;
  ratio: number;
  classification: 'rigid' | 'moderate' | 'compliant' | 'dominated';
  recommendation: string;
}

export interface ComplianceOptions {
  /** Override the "rigid" threshold (default 10). */
  rigidThreshold: number;
  /** Override the "moderate" threshold (default 3). */
  moderateThreshold: number;
}

export const DEFAULT_OPTIONS: ComplianceOptions = {
  rigidThreshold: 10,
  moderateThreshold: 3,
};

// ── Top-level entry ────────────────────────────────────────────

export function assessFixtureCompliance(
  fixtures: FixturePoint[],
  part: PartProperties,
  options: Partial<ComplianceOptions> = {},
): ComplianceResult[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  return fixtures.map(f => assessSingleFixture(f, part, opts));
}

function assessSingleFixture(fixture: FixturePoint, part: PartProperties, opts: ComplianceOptions): ComplianceResult {
  const partStiff = estimatePartLocalStiffness(part);
  const ratio = partStiff > 0 ? fixture.fixtureStiffnessN_mm / partStiff : Infinity;
  let classification: ComplianceResult['classification'];
  let recommendation: string;
  if (ratio >= opts.rigidThreshold) {
    classification = 'rigid';
    recommendation = 'Fixture is rigid enough; rigid-support FEA assumption is valid.';
  } else if (ratio >= opts.moderateThreshold) {
    classification = 'moderate';
    recommendation = 'Use elastic support (spring) in FEA; expect 5-10% shift in stress.';
  } else if (ratio >= 1) {
    classification = 'compliant';
    recommendation = 'Model the fixture explicitly. Rigid-support results will overestimate stiffness by >10%.';
  } else {
    classification = 'dominated';
    recommendation = 'Fixture dominates response. Either stiffen fixture or include it as a structural body.';
  }
  return {
    fixtureId: fixture.id,
    partLocalStiffness: partStiff,
    fixtureStiffness: fixture.fixtureStiffnessN_mm,
    ratio,
    classification,
    recommendation,
  };
}

// ── Part-local stiffness estimate ──────────────────────────────

/**
 * Estimate the local stiffness of the part at a fixture, modelled
 * as a plate-bending or rod stiffness, k ≈ E·t / L.
 */
function estimatePartLocalStiffness(part: PartProperties): number {
  const { youngMpa, thicknessMm, characteristicLengthMm } = part;
  if (characteristicLengthMm <= 0) return 0;
  // Plate-bending equivalent — simplified Euler-Bernoulli local stiffness.
  return (youngMpa * thicknessMm * thicknessMm * thicknessMm) / Math.pow(characteristicLengthMm, 3);
}

// ── Aggregate "worst case" ────────────────────────────────────

export interface AggregateAssessment {
  worstClassification: ComplianceResult['classification'];
  worstRatio: number;
  rigidCount: number;
  moderateCount: number;
  compliantCount: number;
  dominatedCount: number;
  recommendedAction: string;
}

export function aggregate(results: ComplianceResult[]): AggregateAssessment {
  let worstClass: ComplianceResult['classification'] = 'rigid';
  let worstRatio = Infinity;
  const counts = { rigid: 0, moderate: 0, compliant: 0, dominated: 0 };
  const order: ComplianceResult['classification'][] = ['rigid', 'moderate', 'compliant', 'dominated'];
  for (const r of results) {
    counts[r.classification]++;
    if (order.indexOf(r.classification) > order.indexOf(worstClass)) {
      worstClass = r.classification;
    }
    if (r.ratio < worstRatio) worstRatio = r.ratio;
  }
  let action: string;
  switch (worstClass) {
    case 'rigid':
      action = 'No fixture refinement needed.';
      break;
    case 'moderate':
      action = 'Replace rigid BCs with spring elements at the soft fixtures.';
      break;
    case 'compliant':
      action = 'Include fixture geometry in the FEA model with contact.';
      break;
    case 'dominated':
      action = 'Test result will not match part-only FEA. Either stiffen the fixture or redesign the test.';
      break;
  }
  return {
    worstClassification: worstClass,
    worstRatio: results.length === 0 ? Infinity : worstRatio,
    rigidCount: counts.rigid,
    moderateCount: counts.moderate,
    compliantCount: counts.compliant,
    dominatedCount: counts.dominated,
    recommendedAction: action,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface ComplianceSummary {
  fixtureCount: number;
  worstClassification: ComplianceResult['classification'];
  worstRatio: number;
  rigidFraction: number;
}

export function summarize(results: ComplianceResult[]): ComplianceSummary {
  const agg = aggregate(results);
  return {
    fixtureCount: results.length,
    worstClassification: agg.worstClassification,
    worstRatio: agg.worstRatio,
    rigidFraction: results.length === 0 ? 0 : agg.rigidCount / results.length,
  };
}
