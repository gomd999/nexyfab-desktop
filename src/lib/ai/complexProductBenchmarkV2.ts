import { AUXILIARY_PRODUCT_FAMILIES, COMPLEX_PRODUCT_FAMILIES, CORE_MECHANICAL_PRODUCT_FAMILIES, type ComplexBenchmarkCase, type ComplexBenchmarkFamily } from './complexProductBenchmark';

export const COMPLEX_ACCURACY_AXES = ['requirements', 'dimensions', 'features', 'part_definitions', 'occurrences', 'body_membership', 'hierarchy', 'transforms', 'joints', 'motion', 'collision_clearance', 'manufacturing', 'step_roundtrip', 'repair'] as const;
export type ComplexAccuracyAxis = typeof COMPLEX_ACCURACY_AXES[number];
export type ComplexProductTier = 'T1' | 'T2' | 'T3' | 'T4';
export type ComplexAssertionStatus = 'pass' | 'fail' | 'not_run';
export interface ComplexBenchmarkAssertionV2 { id: string; axis: ComplexAccuracyAxis; required: boolean; kpiEligible: boolean; provenance: 'authoritative-cad' | 'approved-manual' | 'standard' | 'customer-confirmed' | 'legacy-unreviewed'; tolerancePolicy: string; artifactHashes: string[]; }
export interface ComplexBenchmarkCaseV2 { schema: 'nexyfab.complex-benchmark-case.v2'; caseId: string; family: ComplexBenchmarkFamily; tier: ComplexProductTier; holdoutGroup: string; sourceHash: string; split: 'holdout'; assertions: ComplexBenchmarkAssertionV2[]; }
export interface ComplexBenchmarkAssertionRunV2 { assertionId: string; status: ComplexAssertionStatus; reason: string; artifactHashes: string[]; }
export interface ComplexBenchmarkRunV2 { schema: 'nexyfab.complex-benchmark-run.v2'; subject: 'reference_ground_truth' | 'ai_generation'; caseId: string; campaign: number; repeat: number; usedForTuning: false; requiredGatesPassed: boolean; verified: boolean; falseVerified: boolean; falseClear: boolean; destructivePartMerge: boolean; assertions: ComplexBenchmarkAssertionRunV2[]; }
export interface ComplexBenchmarkPolicyV2 { minimumCasesPerFamily: number; repeatsPerCampaign: number; consecutiveCampaigns: number; minimumAccuracy: number; minimumCoverage: number; requiredGatePassRate: 1; maximumFalseVerified: 0; maximumFalseClear: 0; maximumDestructivePartMerge: 0; requiredFamilies?: readonly ComplexBenchmarkFamily[]; }
export interface ComplexAxisMetricV2 { axis: ComplexAccuracyAxis; expected: number; measured: number; passed: number; failed: number; notRun: number; microAccuracy: number | null; macroAccuracy: number | null; coverage: number | null; }
export interface ComplexGroupMetricV2 { group: string; cases: number; runs: number; minimumRepeats: number; minimumRepeatsPerCampaign: number; campaigns: number; axes: ComplexAxisMetricV2[]; gatePassRate: number | null; falseVerified: number; falseClear: number; destructivePartMerge: number; minimumRunAccuracy: number | null; runAccuracyStdDev: number | null; eligible: boolean; blockers: string[]; }
export interface ComplexBenchmarkReportV2 { schema: 'nexyfab.complex-benchmark-report.v2'; policy: ComplexBenchmarkPolicyV2; requiredFamilies: ComplexBenchmarkFamily[]; referenceGroundTruthRuns: number; aiGenerationRuns: number; families: ComplexGroupMetricV2[]; tiers: ComplexGroupMetricV2[]; overall: ComplexGroupMetricV2; coreMechanicalEligible: boolean; auxiliaryServicesEligible: boolean; eligible: boolean; }

const SHA = /^[a-f0-9]{64}$/;
export const DEFAULT_COMPLEX_BENCHMARK_POLICY_V2: ComplexBenchmarkPolicyV2 = { minimumCasesPerFamily: 20, repeatsPerCampaign: 5, consecutiveCampaigns: 3, minimumAccuracy: 0.95, minimumCoverage: 0.95, requiredGatePassRate: 1, maximumFalseVerified: 0, maximumFalseClear: 0, maximumDestructivePartMerge: 0, requiredFamilies: CORE_MECHANICAL_PRODUCT_FAMILIES };
const ratio = (a: number, b: number) => b > 0 ? a / b : null;

export function validateComplexBenchmarkV2(cases: readonly ComplexBenchmarkCaseV2[], runs: readonly ComplexBenchmarkRunV2[]): string[] {
  const issues: string[] = [], caseIds = new Set<string>(), groups = new Map<string, ComplexBenchmarkFamily>();
  for (const item of cases) {
    if (!item.caseId.trim() || caseIds.has(item.caseId)) issues.push(`case_id_invalid:${item.caseId}`); caseIds.add(item.caseId);
    if (!COMPLEX_PRODUCT_FAMILIES.includes(item.family)) issues.push(`case_family_invalid:${item.caseId}`);
    if (!['T1', 'T2', 'T3', 'T4'].includes(item.tier)) issues.push(`case_tier_invalid:${item.caseId}`);
    if (item.split !== 'holdout') issues.push(`case_not_holdout:${item.caseId}`);
    if (!SHA.test(item.sourceHash)) issues.push(`case_source_hash_invalid:${item.caseId}`);
    const prior = groups.get(item.holdoutGroup); if (!item.holdoutGroup.trim() || (prior && prior !== item.family)) issues.push(`holdout_group_invalid:${item.caseId}`); else groups.set(item.holdoutGroup, item.family);
    const assertionIds = new Set<string>();
    for (const assertion of item.assertions) { if (!assertion.id.trim() || assertionIds.has(assertion.id)) issues.push(`assertion_id_invalid:${item.caseId}:${assertion.id}`); assertionIds.add(assertion.id); if (!COMPLEX_ACCURACY_AXES.includes(assertion.axis)) issues.push(`assertion_axis_invalid:${item.caseId}:${assertion.id}`); if (!assertion.tolerancePolicy.trim()) issues.push(`assertion_tolerance_missing:${item.caseId}:${assertion.id}`); if (!assertion.artifactHashes.length || assertion.artifactHashes.some(hash => !SHA.test(hash))) issues.push(`assertion_artifact_hash_invalid:${item.caseId}:${assertion.id}`); if (assertion.provenance === 'legacy-unreviewed' && assertion.kpiEligible) issues.push(`legacy_assertion_kpi_forbidden:${item.caseId}:${assertion.id}`); }
  }
  const caseById = new Map(cases.map(item => [item.caseId, item])), runKeys = new Set<string>();
  for (const run of runs) {
    const item = caseById.get(run.caseId), key = `${run.caseId}:${run.campaign}:${run.repeat}`;
    if (!item) { issues.push(`run_case_unknown:${run.caseId}`); continue; }
    if (runKeys.has(key)) issues.push(`run_duplicate:${key}`); runKeys.add(key);
    if (!Number.isInteger(run.campaign) || run.campaign < 1 || !Number.isInteger(run.repeat) || run.repeat < 1) issues.push(`run_index_invalid:${key}`);
    if (run.usedForTuning !== false) issues.push(`run_tuning_forbidden:${key}`);
    if (run.subject !== 'reference_ground_truth' && run.subject !== 'ai_generation') issues.push(`run_subject_invalid:${key}`);
    const expected = new Set(item.assertions.map(assertion => assertion.id)), seen = new Set<string>();
    for (const result of run.assertions) { if (!expected.has(result.assertionId) || seen.has(result.assertionId)) issues.push(`run_assertion_invalid:${key}:${result.assertionId}`); seen.add(result.assertionId); if (!result.reason.trim()) issues.push(`run_assertion_reason_missing:${key}:${result.assertionId}`); if (result.artifactHashes.some(hash => !SHA.test(hash))) issues.push(`run_artifact_hash_invalid:${key}:${result.assertionId}`); }
    if (run.verified && !run.requiredGatesPassed) issues.push(`verified_without_gates:${key}`);
  }
  return issues;
}

function groupMetric(group: string, cases: readonly ComplexBenchmarkCaseV2[], runs: readonly ComplexBenchmarkRunV2[], policy: ComplexBenchmarkPolicyV2, requireCaseMinimum: boolean): ComplexGroupMetricV2 {
  const ids = new Set(cases.map(item => item.caseId)), selected = runs.filter(run => ids.has(run.caseId) && run.subject === 'ai_generation'), expectedByCase = new Map(cases.map(item => [item.caseId, new Map(item.assertions.filter(a => a.required && a.kpiEligible).map(a => [a.id, a]))]));
  const axes = COMPLEX_ACCURACY_AXES.map(axis => {
    let expected = 0, measured = 0, passed = 0, failed = 0, notRun = 0; const perRun: number[] = [];
    for (const run of selected) { const definitions = expectedByCase.get(run.caseId)!; const resultById = new Map(run.assertions.map(item => [item.assertionId, item])); let runMeasured = 0, runPassed = 0; for (const definition of definitions.values()) if (definition.axis === axis) { expected++; const status = resultById.get(definition.id)?.status ?? 'not_run'; if (status === 'pass') { measured++; passed++; runMeasured++; runPassed++; } else if (status === 'fail') { measured++; failed++; runMeasured++; } else notRun++; } if (runMeasured) perRun.push(runPassed / runMeasured); }
    return { axis, expected, measured, passed, failed, notRun, microAccuracy: ratio(passed, measured), macroAccuracy: perRun.length ? perRun.reduce((a, b) => a + b, 0) / perRun.length : null, coverage: ratio(measured, expected) };
  });
  const byCaseCampaign = new Map<string, Set<number>>(), repeats = new Map<string, Set<string>>(); for (const run of selected) { const c = byCaseCampaign.get(run.caseId) ?? new Set<number>(); c.add(run.campaign); byCaseCampaign.set(run.caseId, c); const r = repeats.get(run.caseId) ?? new Set<string>(); r.add(`${run.campaign}:${run.repeat}`); repeats.set(run.caseId, r); }
  const minimumRepeats = cases.length ? Math.min(...cases.map(item => repeats.get(item.caseId)?.size ?? 0)) : 0, campaigns = cases.length ? Math.min(...cases.map(item => byCaseCampaign.get(item.caseId)?.size ?? 0)) : 0;
  const minimumRepeatsPerCampaign = cases.length ? Math.min(...cases.flatMap(item => Array.from({ length: policy.consecutiveCampaigns }, (_, index) => {
    const campaign = index + 1;
    return new Set(selected.filter(run => run.caseId === item.caseId && run.campaign === campaign).map(run => run.repeat)).size;
  }))) : 0;
  const runScores = selected.map(run => { const definitions = expectedByCase.get(run.caseId)!, results = new Map(run.assertions.map(item => [item.assertionId, item])); let p = 0, m = 0; for (const definition of definitions.values()) { const status = results.get(definition.id)?.status; if (status === 'pass') { p++; m++; } else if (status === 'fail') m++; } return ratio(p, m); }).filter((value): value is number => value !== null);
  const mean = runScores.length ? runScores.reduce((a, b) => a + b, 0) / runScores.length : null, std = mean === null ? null : Math.sqrt(runScores.reduce((sum, value) => sum + (value - mean) ** 2, 0) / runScores.length);
  const falseVerified = selected.filter(run => run.falseVerified).length, falseClear = selected.filter(run => run.falseClear).length, destructivePartMerge = selected.filter(run => run.destructivePartMerge).length, gatePassRate = ratio(selected.filter(run => run.requiredGatesPassed).length, selected.length), blockers: string[] = [];
  if (requireCaseMinimum && cases.length < policy.minimumCasesPerFamily) blockers.push(`cases_below_minimum:${cases.length}/${policy.minimumCasesPerFamily}`);
  if (![...expectedByCase.values()].some(items => items.size > 0)) blockers.push('no_kpi_eligible_assertions');
  const requiredRuns = policy.repeatsPerCampaign * policy.consecutiveCampaigns; if (minimumRepeats < requiredRuns) blockers.push(`repeats_below_minimum:${minimumRepeats}/${requiredRuns}`); if (campaigns < policy.consecutiveCampaigns) blockers.push(`campaigns_below_minimum:${campaigns}/${policy.consecutiveCampaigns}`); if (minimumRepeatsPerCampaign < policy.repeatsPerCampaign) blockers.push(`campaign_repeats_below_minimum:${minimumRepeatsPerCampaign}/${policy.repeatsPerCampaign}`);
  for (const metric of axes.filter(item => item.expected > 0)) { if (metric.microAccuracy === null || metric.microAccuracy < policy.minimumAccuracy) blockers.push(`axis_micro_accuracy:${metric.axis}`); if (metric.macroAccuracy === null || metric.macroAccuracy < policy.minimumAccuracy) blockers.push(`axis_macro_accuracy:${metric.axis}`); if (metric.coverage === null || metric.coverage < policy.minimumCoverage) blockers.push(`axis_coverage:${metric.axis}`); }
  if (gatePassRate !== 1) blockers.push('required_gate_pass_rate'); if (falseVerified) blockers.push('false_verified'); if (falseClear) blockers.push('false_clear'); if (destructivePartMerge) blockers.push('destructive_part_merge');
  return { group, cases: cases.length, runs: selected.length, minimumRepeats, minimumRepeatsPerCampaign, campaigns, axes, gatePassRate, falseVerified, falseClear, destructivePartMerge, minimumRunAccuracy: runScores.length ? Math.min(...runScores) : null, runAccuracyStdDev: std, eligible: blockers.length === 0, blockers };
}

const LEGACY_AXIS: Record<ComplexBenchmarkCase['requiredChecks'][number], ComplexAccuracyAxis> = { dimensions: 'dimensions', features: 'features', parts: 'part_definitions', assembly: 'hierarchy', step_roundtrip: 'step_roundtrip' };
/** Structural migration only. Legacy aggregate checks lack assertion-level reviewed ground truth and remain excluded from KPI until review. */
export function migrateComplexBenchmarkCaseV1(value: ComplexBenchmarkCase, tier: ComplexProductTier): ComplexBenchmarkCaseV2 {
  return { schema: 'nexyfab.complex-benchmark-case.v2', caseId: value.caseId, family: value.family, tier, holdoutGroup: value.holdoutGroup, sourceHash: value.sourceHash, split: 'holdout', assertions: value.requiredChecks.map(check => ({ id: `legacy:${check}`, axis: LEGACY_AXIS[check], required: true, kpiEligible: false, provenance: 'legacy-unreviewed', tolerancePolicy: 'legacy-review-required', artifactHashes: [value.sourceHash] })) };
}

export function buildComplexBenchmarkReportV2(cases: readonly ComplexBenchmarkCaseV2[], runs: readonly ComplexBenchmarkRunV2[], policy: ComplexBenchmarkPolicyV2 = DEFAULT_COMPLEX_BENCHMARK_POLICY_V2): ComplexBenchmarkReportV2 {
  const issues = validateComplexBenchmarkV2(cases, runs); if (issues.length) throw new TypeError(issues.join(' '));
  const requiredFamilies = resolveRequiredFamilies(policy.requiredFamilies);
  const families = COMPLEX_PRODUCT_FAMILIES.map(family => groupMetric(family, cases.filter(item => item.family === family), runs, policy, requiredFamilies.includes(family)));
  const tiers = (['T1', 'T2', 'T3', 'T4'] as const).map(tier => groupMetric(tier, cases.filter(item => item.tier === tier), runs, policy, false));
  const overall = groupMetric('overall', cases, runs, policy, false);
  const metricByFamily = new Map(families.map(item => [item.group as ComplexBenchmarkFamily, item]));
  const coreMechanicalEligible = CORE_MECHANICAL_PRODUCT_FAMILIES.every(family => metricByFamily.get(family)?.eligible === true);
  const auxiliaryServicesEligible = AUXILIARY_PRODUCT_FAMILIES.every(family => metricByFamily.get(family)?.eligible === true);
  return { schema: 'nexyfab.complex-benchmark-report.v2', policy: { ...policy, requiredFamilies }, requiredFamilies, referenceGroundTruthRuns: runs.filter(item => item.subject === 'reference_ground_truth').length, aiGenerationRuns: runs.filter(item => item.subject === 'ai_generation').length, families, tiers, overall, coreMechanicalEligible, auxiliaryServicesEligible, eligible: requiredFamilies.every(family => metricByFamily.get(family)?.eligible === true) && tiers.filter(item => item.cases > 0 && item.group !== 'T4').every(item => item.eligible) && overall.eligible };
}

export function resolveRequiredFamilies(value?: readonly ComplexBenchmarkFamily[]): ComplexBenchmarkFamily[] {
  const selected = value?.length ? [...new Set(value)] : [...CORE_MECHANICAL_PRODUCT_FAMILIES];
  if (!selected.length || selected.some(family => !COMPLEX_PRODUCT_FAMILIES.includes(family))) throw new TypeError('benchmark_required_families_invalid');
  return selected;
}
