import type { ComplexAccuracyAxis, ComplexAssertionStatus } from './complexProductBenchmarkV2';
import {
  DOMAIN_ACCURACY_PROFILES,
  assessDomainAccuracy,
  type DomainAccuracyAssessment,
  type DomainAccuracyDomain,
  type DomainAccuracyEvidence,
} from './domainAccuracyProgram';

export interface DomainAccuracyCase {
  caseId: string;
  domain: DomainAccuracyDomain;
  sourceHash: string;
  split: 'holdout';
  approvalReviewerIds: readonly string[];
  groundTruthAssertions: readonly DomainAccuracyGroundTruthAssertion[];
}

export interface DomainAccuracyGroundTruthAssertion {
  axis: ComplexAccuracyAxis;
  tolerancePolicy: string;
  provenance: string;
  artifactHashes: readonly string[];
}

export interface DomainAccuracyAssertionResult {
  axis: ComplexAccuracyAxis;
  status: ComplexAssertionStatus;
  reason: string;
}

export interface DomainAccuracyRun {
  caseId: string;
  domain: DomainAccuracyDomain;
  campaign: number;
  repeat: number;
  usedForTuning: false;
  sourceHash: string;
  requiredGatesPassed: boolean;
  falseVerified: boolean;
  falseClear: boolean;
  destructivePartMerge: boolean;
  assertions: readonly DomainAccuracyAssertionResult[];
}

export interface DomainAccuracyEvidenceBundle {
  evidence: DomainAccuracyEvidence;
  assessment: DomainAccuracyAssessment;
  issues: string[];
}

const SHA256 = /^[a-f0-9]{64}$/;

/**
 * Converts independently reviewed holdout runs from any domain validator into
 * the one release contract. Invalid or unapproved data remains visible in
 * `issues` and is never counted as accuracy evidence.
 */
export function buildDomainAccuracyEvidence(
  domain: DomainAccuracyDomain,
  cases: readonly DomainAccuracyCase[],
  runs: readonly DomainAccuracyRun[],
): DomainAccuracyEvidenceBundle {
  const issues: string[] = [];
  const caseIds = new Set<string>();
  const validCases = new Map<string, DomainAccuracyCase>();

  for (const item of cases) {
    if (!item.caseId.trim() || caseIds.has(item.caseId)) issues.push(`case_id_invalid:${item.caseId}`);
    caseIds.add(item.caseId);
    if (item.domain !== domain) issues.push(`case_domain_mismatch:${item.caseId}`);
    if (item.split !== 'holdout') issues.push(`case_not_holdout:${item.caseId}`);
    if (!SHA256.test(item.sourceHash)) issues.push(`case_source_hash_invalid:${item.caseId}`);
    const reviewers = new Set(item.approvalReviewerIds.filter(Boolean));
    if (reviewers.size < 2) issues.push(`case_approval_incomplete:${item.caseId}`);
    const requiredAxes = new Set(DOMAIN_ACCURACY_PROFILES[domain].requiredAxes);
    const truthAxes = new Set<ComplexAccuracyAxis>();
    for (const truth of item.groundTruthAssertions ?? []) {
      if (truthAxes.has(truth.axis)) issues.push(`case_ground_truth_axis_duplicate:${item.caseId}:${truth.axis}`);
      truthAxes.add(truth.axis);
      if (!requiredAxes.has(truth.axis)) issues.push(`case_ground_truth_axis_out_of_scope:${item.caseId}:${truth.axis}`);
      if (!truth.tolerancePolicy.trim()) issues.push(`case_tolerance_missing:${item.caseId}:${truth.axis}`);
      if (!truth.provenance.trim()) issues.push(`case_provenance_missing:${item.caseId}:${truth.axis}`);
      if (!truth.artifactHashes.length || truth.artifactHashes.some(hash => !SHA256.test(hash))) issues.push(`case_artifact_hash_invalid:${item.caseId}:${truth.axis}`);
    }
    const truthComplete = [...requiredAxes].every(axis => truthAxes.has(axis));
    if (!truthComplete) issues.push(`case_ground_truth_incomplete:${item.caseId}`);
    if (
      item.caseId.trim() && item.domain === domain && item.split === 'holdout'
      && SHA256.test(item.sourceHash) && reviewers.size >= 2 && truthComplete
    ) validCases.set(item.caseId, item);
  }

  const runKeys = new Set<string>();
  const validRuns: DomainAccuracyRun[] = [];
  const requiredAxes = new Set(DOMAIN_ACCURACY_PROFILES[domain].requiredAxes);

  for (const run of runs) {
    const key = `${run.caseId}:${run.campaign}:${run.repeat}`;
    let valid = true;
    if (runKeys.has(key)) { issues.push(`run_duplicate:${key}`); valid = false; }
    runKeys.add(key);
    if (run.domain !== domain) { issues.push(`run_domain_mismatch:${key}`); valid = false; }
    if (!validCases.has(run.caseId)) { issues.push(`run_case_not_approved:${key}`); valid = false; }
    if (!Number.isInteger(run.campaign) || run.campaign < 1 || !Number.isInteger(run.repeat) || run.repeat < 1) {
      issues.push(`run_index_invalid:${key}`); valid = false;
    }
    if (run.usedForTuning !== false) { issues.push(`run_tuning_forbidden:${key}`); valid = false; }
    const approvedCase = validCases.get(run.caseId);
    if (!SHA256.test(run.sourceHash) || run.sourceHash !== approvedCase?.sourceHash) { issues.push(`run_source_hash_mismatch:${key}`); valid = false; }
    const seenAxes = new Set<ComplexAccuracyAxis>();
    for (const assertion of run.assertions) {
      if (seenAxes.has(assertion.axis)) { issues.push(`run_axis_duplicate:${key}:${assertion.axis}`); valid = false; }
      seenAxes.add(assertion.axis);
      if (!requiredAxes.has(assertion.axis)) { issues.push(`run_axis_out_of_scope:${key}:${assertion.axis}`); valid = false; }
      if (!assertion.reason.trim()) { issues.push(`run_reason_missing:${key}:${assertion.axis}`); valid = false; }
    }
    if (valid) validRuns.push(run);
  }

  const runsByCase = new Map<string, DomainAccuracyRun[]>();
  for (const run of validRuns) runsByCase.set(run.caseId, [...(runsByCase.get(run.caseId) ?? []), run]);
  const approvedCaseIds = [...validCases.keys()];
  const reviewerIds = new Set([...validCases.values()].flatMap(item => [...item.approvalReviewerIds]));

  const campaignCounts = approvedCaseIds.map(caseId => new Set((runsByCase.get(caseId) ?? []).map(run => run.campaign)).size);
  const repeatCounts = approvedCaseIds.map(caseId => new Set((runsByCase.get(caseId) ?? []).map(run => `${run.campaign}:${run.repeat}`)).size);
  const repeatsPerCampaign = approvedCaseIds.flatMap(caseId => {
    const caseRuns = runsByCase.get(caseId) ?? [];
    return Array.from({ length: 3 }, (_, index) => {
      const campaign = index + 1;
      return new Set(caseRuns.filter(run => run.campaign === campaign).map(run => run.repeat)).size;
    });
  });
  const axes = DOMAIN_ACCURACY_PROFILES[domain].requiredAxes.map(axis => {
    const assertions = validRuns.map(run => run.assertions.find(item => item.axis === axis));
    const measured = assertions.filter(item => item?.status === 'pass' || item?.status === 'fail');
    return {
      axis,
      expected: validRuns.length,
      measured: measured.length,
      passed: measured.filter(item => item?.status === 'pass').length,
    };
  });

  const evidence: DomainAccuracyEvidence = {
    domain,
    approvedCases: validCases.size,
    independentReviewers: reviewerIds.size,
    campaigns: campaignCounts.length ? Math.min(...campaignCounts) : 0,
    minimumRepeatsPerCase: repeatCounts.length ? Math.min(...repeatCounts) : 0,
    minimumRepeatsPerCampaign: repeatsPerCampaign.length ? Math.min(...repeatsPerCampaign) : 0,
    requiredGateRuns: validRuns.length,
    requiredGatePasses: validRuns.filter(run => run.requiredGatesPassed).length,
    falseVerified: validRuns.filter(run => run.falseVerified).length,
    falseClear: validRuns.filter(run => run.falseClear).length,
    destructivePartMerge: validRuns.filter(run => run.destructivePartMerge).length,
    axes,
  };

  const assessment = assessDomainAccuracy(evidence);
  if (issues.length) assessment.blockers.unshift('evidence_integrity');
  assessment.eligible = assessment.blockers.length === 0;
  return { evidence, assessment, issues };
}
