import {
  DEFAULT_COMPLEX_BENCHMARK_POLICY_V2,
  type ComplexAccuracyAxis,
  type ComplexBenchmarkPolicyV2,
} from './complexProductBenchmarkV2';

export const DOMAIN_ACCURACY_DOMAINS = [
  'mechanical',
  'civil',
  'building',
  'landscape',
  'interior',
] as const;

export type DomainAccuracyDomain = (typeof DOMAIN_ACCURACY_DOMAINS)[number];

export interface DomainAccuracyProfile {
  domain: DomainAccuracyDomain;
  requiredAxes: readonly ComplexAccuracyAxis[];
  firstReleaseCapabilities: readonly string[];
}

export const DOMAIN_ACCURACY_PROFILES: Record<DomainAccuracyDomain, DomainAccuracyProfile> = {
  mechanical: {
    domain: 'mechanical',
    requiredAxes: [
      'requirements', 'dimensions', 'features', 'part_definitions', 'occurrences',
      'body_membership', 'hierarchy', 'transforms', 'joints', 'motion',
      'collision_clearance', 'manufacturing', 'step_roundtrip', 'repair',
    ],
    firstReleaseCapabilities: [
      'standards_catalog', 'feature_measurement', 'assembly_motion',
      'manufacturing_drawing', 'step_roundtrip',
    ],
  },
  civil: {
    domain: 'civil',
    requiredAxes: [
      'requirements', 'dimensions', 'features', 'part_definitions', 'hierarchy',
      'transforms', 'collision_clearance', 'manufacturing', 'step_roundtrip', 'repair',
    ],
    firstReleaseCapabilities: [
      'retaining_wall_geometry_to_check', 'culvert_check', 'drainage_connectivity',
      'earthwork_boq', 'civil_drawing',
    ],
  },
  building: {
    domain: 'building',
    requiredAxes: [
      'requirements', 'dimensions', 'features', 'part_definitions', 'occurrences',
      'body_membership', 'hierarchy', 'transforms', 'collision_clearance',
      'manufacturing', 'step_roundtrip', 'repair',
    ],
    firstReleaseCapabilities: [
      'structural_grid', 'load_path', 'member_checks', 'foundation_reactions',
      'structural_drawing',
    ],
  },
  landscape: {
    domain: 'landscape',
    requiredAxes: [
      'requirements', 'dimensions', 'features', 'part_definitions', 'occurrences',
      'hierarchy', 'transforms', 'collision_clearance', 'manufacturing',
      'step_roundtrip', 'repair',
    ],
    firstReleaseCapabilities: [
      'timber_member_check', 'wind_overturning', 'grading_drainage',
      'paving_boq', 'planting_schedule',
    ],
  },
  interior: {
    domain: 'interior',
    requiredAxes: [
      'requirements', 'dimensions', 'features', 'part_definitions', 'occurrences',
      'body_membership', 'hierarchy', 'transforms', 'joints', 'motion',
      'collision_clearance', 'manufacturing', 'step_roundtrip', 'repair',
    ],
    firstReleaseCapabilities: [
      'space_closure', 'wall_openings', 'door_swing', 'egress_path',
      'finish_boq',
    ],
  },
};

export interface DomainAxisEvidence {
  axis: ComplexAccuracyAxis;
  expected: number;
  measured: number;
  passed: number;
}

export interface DomainAccuracyEvidence {
  domain: DomainAccuracyDomain;
  approvedCases: number;
  independentReviewers: number;
  campaigns: number;
  minimumRepeatsPerCase: number;
  minimumRepeatsPerCampaign: number;
  requiredGateRuns: number;
  requiredGatePasses: number;
  falseVerified: number;
  falseClear: number;
  destructivePartMerge: number;
  axes: readonly DomainAxisEvidence[];
}

export interface DomainAxisAssessment extends DomainAxisEvidence {
  accuracy: number | null;
  coverage: number | null;
}

export interface DomainAccuracyAssessment {
  domain: DomainAccuracyDomain;
  eligible: boolean;
  axes: DomainAxisAssessment[];
  blockers: string[];
}

const ratio = (numerator: number, denominator: number) =>
  denominator > 0 ? numerator / denominator : null;

/**
 * Shared, fail-closed 95% release contract for parallel domain tracks.
 * It certifies evidence completeness; it does not generate or infer evidence.
 */
export function assessDomainAccuracy(
  evidence: DomainAccuracyEvidence,
  policy: ComplexBenchmarkPolicyV2 = DEFAULT_COMPLEX_BENCHMARK_POLICY_V2,
): DomainAccuracyAssessment {
  const profile = DOMAIN_ACCURACY_PROFILES[evidence.domain];
  const byAxis = new Map(evidence.axes.map(axis => [axis.axis, axis]));
  const blockers: string[] = [];

  if (evidence.approvedCases < policy.minimumCasesPerFamily) {
    blockers.push(`approved_cases:${evidence.approvedCases}/${policy.minimumCasesPerFamily}`);
  }
  if (evidence.independentReviewers < 2) blockers.push('independent_reviewers:minimum_2');
  if (evidence.campaigns < policy.consecutiveCampaigns) {
    blockers.push(`campaigns:${evidence.campaigns}/${policy.consecutiveCampaigns}`);
  }
  const requiredRepeats = policy.repeatsPerCampaign * policy.consecutiveCampaigns;
  if (evidence.minimumRepeatsPerCase < requiredRepeats) {
    blockers.push(`repeats:${evidence.minimumRepeatsPerCase}/${requiredRepeats}`);
  }
  if (evidence.minimumRepeatsPerCampaign < policy.repeatsPerCampaign) {
    blockers.push(`campaign_repeats:${evidence.minimumRepeatsPerCampaign}/${policy.repeatsPerCampaign}`);
  }

  const axes = profile.requiredAxes.map(axis => {
    const value = byAxis.get(axis) ?? { axis, expected: 0, measured: 0, passed: 0 };
    const accuracy = ratio(value.passed, value.measured);
    const coverage = ratio(value.measured, value.expected);
    if (accuracy === null || accuracy < policy.minimumAccuracy) blockers.push(`accuracy:${axis}`);
    if (coverage === null || coverage < policy.minimumCoverage) blockers.push(`coverage:${axis}`);
    if (value.passed > value.measured || value.measured > value.expected) blockers.push(`counts_invalid:${axis}`);
    return { ...value, accuracy, coverage };
  });

  if (evidence.requiredGateRuns < 1 || evidence.requiredGatePasses !== evidence.requiredGateRuns) {
    blockers.push('required_gate_pass_rate');
  }
  if (evidence.falseVerified > policy.maximumFalseVerified) blockers.push('false_verified');
  if (evidence.falseClear > policy.maximumFalseClear) blockers.push('false_clear');
  if (evidence.destructivePartMerge > policy.maximumDestructivePartMerge) blockers.push('destructive_part_merge');

  return { domain: evidence.domain, eligible: blockers.length === 0, axes, blockers };
}
