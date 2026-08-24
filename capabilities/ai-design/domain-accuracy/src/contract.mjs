const COMMON_AXES = [
  'requirements',
  'coordinate_units',
  'semantic_objects',
  'geometry',
  'relationships',
  'provenance',
  'revision_integrity',
  'output_consistency',
];

export const DOMAIN_ACCURACY_DOMAINS = Object.freeze([
  'mechanical',
  'building',
  'civil',
  'landscape',
  'interior',
]);

export const DOMAIN_ACCURACY_PROFILES = Object.freeze({
  mechanical: {
    domain: 'mechanical',
    requiredAxes: [...COMMON_AXES, 'dimensions', 'features', 'part_definitions', 'occurrences', 'body_membership', 'hierarchy', 'transforms', 'joints', 'motion', 'tolerance', 'collision_clearance', 'materials', 'manufacturing', 'step_roundtrip', 'drawing_consistency', 'repair'],
    firstReleaseCapabilities: ['standards_catalog', 'feature_measurement', 'assembly_motion', 'manufacturing_drawing', 'step_roundtrip'],
  },
  building: {
    domain: 'building',
    requiredAxes: [...COMMON_AXES, 'site_coordinates', 'storeys_grids', 'space_closure', 'hosts_openings', 'egress', 'accessibility', 'envelope_continuity', 'mep_coordination', 'ifc_roundtrip', 'schedules_quantities', 'drawing_consistency', 'repair'],
    firstReleaseCapabilities: ['spatial_bim', 'space_closure', 'egress_accessibility', 'mep_coordination', 'ifc_drawing_schedule'],
  },
  civil: {
    domain: 'civil',
    requiredAxes: [...COMMON_AXES, 'survey_control', 'surface_quality', 'alignment', 'profile', 'cross_sections', 'corridor', 'earthwork', 'drainage', 'construction_stages', 'structures', 'ifc_landxml_roundtrip', 'civil_drawings', 'quantities', 'repair'],
    firstReleaseCapabilities: ['survey_surface', 'alignment_corridor', 'drainage_connectivity', 'earthwork_boq', 'civil_drawing_exchange'],
  },
  landscape: {
    domain: 'landscape',
    requiredAxes: [...COMMON_AXES, 'existing_conditions', 'terrain_grading', 'surface_flow', 'planting_data', 'mature_clearance', 'soil_volume', 'hardscape', 'irrigation', 'schedules_quantities', 'maintenance', 'drawing_consistency', 'repair'],
    firstReleaseCapabilities: ['terrain_grading', 'planting_growth', 'soil_hardscape', 'irrigation', 'schedule_maintenance'],
  },
  interior: {
    domain: 'interior',
    requiredAxes: [...COMMON_AXES, 'field_measurement', 'space_closure', 'hosts_openings', 'circulation', 'door_swing', 'egress', 'accessibility', 'furniture_clearance', 'ceiling_mep', 'finishes', 'millwork', 'lighting', 'acoustics', 'schedules_quantities', 'drawing_consistency', 'ifc_roundtrip', 'repair'],
    firstReleaseCapabilities: ['space_host', 'door_egress_clearance', 'ceiling_mep', 'finish_millwork', 'lighting_acoustics_boq'],
  },
});

export const DEFAULT_DOMAIN_ACCURACY_POLICY = Object.freeze({
  minimumCasesPerFamily: 20,
  repeatsPerCampaign: 5,
  consecutiveCampaigns: 3,
  minimumAccuracy: 0.95,
  minimumCoverage: 0.95,
  requiredGatePassRate: 1,
  maximumFalseVerified: 0,
  maximumFalseClear: 0,
  maximumDestructivePartMerge: 0,
});

const EVIDENCE_COUNT_FIELDS = [
  'approvedCases',
  'independentReviewers',
  'campaigns',
  'minimumRepeatsPerCase',
  'minimumRepeatsPerCampaign',
  'requiredGateRuns',
  'requiredGatePasses',
  'falseVerified',
  'falseClear',
  'destructivePartMerge',
];

const POLICY_POSITIVE_INTEGER_FIELDS = [
  'minimumCasesPerFamily',
  'repeatsPerCampaign',
  'consecutiveCampaigns',
];

const POLICY_NON_NEGATIVE_INTEGER_FIELDS = [
  'maximumFalseVerified',
  'maximumFalseClear',
  'maximumDestructivePartMerge',
];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function evidenceInvalid(path) {
  throw new TypeError(`DOMAIN_ACCURACY_EVIDENCE_INVALID:${path}`);
}

function policyInvalid(path) {
  throw new TypeError(`DOMAIN_ACCURACY_POLICY_INVALID:${path}`);
}

function assertDomainAccuracyEvidence(evidence) {
  if (!isRecord(evidence)) evidenceInvalid('root');
  const profile = DOMAIN_ACCURACY_PROFILES[evidence.domain];
  if (!profile) throw new TypeError(`DOMAIN_ACCURACY_DOMAIN_INVALID:${evidence.domain ?? 'missing'}`);

  for (const field of EVIDENCE_COUNT_FIELDS) {
    if (!Number.isInteger(evidence[field]) || evidence[field] < 0) evidenceInvalid(field);
  }
  if (!Array.isArray(evidence.axes)) evidenceInvalid('axes');

  const allowedAxes = new Set(profile.requiredAxes);
  const seenAxes = new Set();
  for (const [index, axis] of evidence.axes.entries()) {
    if (!isRecord(axis)) evidenceInvalid(`axes[${index}]`);
    if (typeof axis.axis !== 'string' || !allowedAxes.has(axis.axis)) {
      evidenceInvalid(`axes[${index}].axis`);
    }
    if (seenAxes.has(axis.axis)) evidenceInvalid(`axes[${index}].axis_duplicate`);
    seenAxes.add(axis.axis);
    for (const field of ['expected', 'measured', 'passed']) {
      if (!Number.isInteger(axis[field]) || axis[field] < 0) {
        evidenceInvalid(`axes[${index}].${field}`);
      }
    }
  }
}

function assertDomainAccuracyPolicy(policy) {
  if (!isRecord(policy)) policyInvalid('root');
  for (const field of POLICY_POSITIVE_INTEGER_FIELDS) {
    if (!Number.isInteger(policy[field]) || policy[field] < 1) policyInvalid(field);
  }
  for (const field of POLICY_NON_NEGATIVE_INTEGER_FIELDS) {
    if (!Number.isInteger(policy[field]) || policy[field] < 0) policyInvalid(field);
  }
  for (const field of ['minimumAccuracy', 'minimumCoverage']) {
    if (!Number.isFinite(policy[field]) || policy[field] <= 0 || policy[field] > 1) {
      policyInvalid(field);
    }
  }
  if (policy.requiredGatePassRate !== 1) policyInvalid('requiredGatePassRate');
}

const ratio = (numerator, denominator) => denominator > 0 ? numerator / denominator : null;

export function assessDomainAccuracy(evidence, policy = DEFAULT_DOMAIN_ACCURACY_POLICY) {
  assertDomainAccuracyEvidence(evidence);
  assertDomainAccuracyPolicy(policy);
  const profile = DOMAIN_ACCURACY_PROFILES[evidence.domain];
  const byAxis = new Map(evidence.axes.map(axis => [axis.axis, axis]));
  const blockers = [];

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
