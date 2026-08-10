import type { CrossDomainVerificationResult } from './crossDomainVerification';
import type { ComplexProductAssessment } from './complexProductAccuracy';
import type { ComplexAssertionStatus } from './complexProductBenchmarkV2';
import type { DomainEvidenceAxis } from './domainProfile';
import { DOMAIN_ACCURACY_PROFILES, type DomainAccuracyDomain } from './domainAccuracyProgram';
import type { DomainAccuracyAssertionResult } from './domainAccuracyEvidence';
import type { MechanicalReleaseCertificate } from './mechanicalReleaseCertificate';
import type { BuildingReleaseCertificate } from './buildingReleaseCertificate';
import type { CivilReleaseCertificate } from './civilReleaseCertificate';
import type { LandscapeReleaseCertificate } from './landscapeReleaseCertificate';
import type { InteriorReleaseCertificate } from './interiorReleaseCertificate';

export interface ExplicitDomainGateResult {
  id: string;
  axis: DomainEvidenceAxis;
  status: 'passed' | 'failed' | 'not_run';
  reason: string;
}

const rank: Record<ComplexAssertionStatus, number> = { pass: 0, not_run: 1, fail: 2 };
const status = (value: 'passed' | 'failed' | 'not_run'): ComplexAssertionStatus =>
  value === 'passed' ? 'pass' : value === 'failed' ? 'fail' : 'not_run';

function merge(results: readonly DomainAccuracyAssertionResult[]): DomainAccuracyAssertionResult[] {
  const grouped = new Map<DomainEvidenceAxis, DomainAccuracyAssertionResult[]>();
  for (const result of results) grouped.set(result.axis, [...(grouped.get(result.axis) ?? []), result]);
  return [...grouped.entries()].map(([axis, values]) => ({
    axis,
    status: values.reduce((worst, value) => rank[value.status] > rank[worst] ? value.status : worst, 'pass' as ComplexAssertionStatus),
    reason: values.map(value => value.reason).join(' | '),
  }));
}

/** Fill every release axis explicitly. Missing validator evidence is not_run. */
export function completeDomainAssertions(
  domain: DomainAccuracyDomain,
  partial: readonly DomainAccuracyAssertionResult[],
): DomainAccuracyAssertionResult[] {
  const merged = new Map(merge(partial).map(item => [item.axis, item]));
  return DOMAIN_ACCURACY_PROFILES[domain].requiredAxes.map(axis => merged.get(axis) ?? ({
    axis,
    status: 'not_run',
    reason: `No ${domain} validator supplied evidence for ${axis}.`,
  }));
}

const CROSS_DOMAIN_AXIS: Record<CrossDomainVerificationResult['gates'][number]['id'], DomainEvidenceAxis> = {
  structure: 'semantic_objects',
  placement: 'relationships',
  'assembly-dof': 'joints',
  'precise-interference': 'collision_clearance',
  'space-boundary': 'space_closure',
  egress: 'egress',
  'door-swing': 'door_swing',
  'mep-interference': 'mep_coordination',
};

export function assertionsFromCrossDomain(
  domain: DomainAccuracyDomain,
  result: CrossDomainVerificationResult,
): DomainAccuracyAssertionResult[] {
  return completeDomainAssertions(domain, result.gates.map(gate => ({
    axis: domain === 'interior' && gate.id === 'mep-interference' ? 'ceiling_mep' : CROSS_DOMAIN_AXIS[gate.id],
    status: status(gate.status),
    reason: `${gate.id}: ${gate.reason}`,
  })));
}

const COMPLEX_PRODUCT_AXIS: Record<ComplexProductAssessment['gates'][number]['id'], DomainEvidenceAxis> = {
  decomposition: 'part_definitions',
  'part-evidence': 'features',
  interfaces: 'joints',
  'assembly-depth': 'hierarchy',
  'step-occurrences': 'step_roundtrip',
  'repair-isolation': 'repair',
};

export function assertionsFromComplexProduct(
  domain: DomainAccuracyDomain,
  result: ComplexProductAssessment,
): DomainAccuracyAssertionResult[] {
  if (domain !== 'mechanical') return completeDomainAssertions(domain, []);
  return completeDomainAssertions(domain, result.gates.map(gate => ({
    axis: COMPLEX_PRODUCT_AXIS[gate.id],
    status: gate.passed ? 'pass' : 'fail',
    reason: `${gate.id}: ${gate.reason}`,
  })));
}

/** Adapter for legacy/domain-specific calculators. Axis selection must be explicit. */
export function assertionsFromExplicitGates(
  domain: DomainAccuracyDomain,
  gates: readonly ExplicitDomainGateResult[],
): DomainAccuracyAssertionResult[] {
  return completeDomainAssertions(domain, gates.map(gate => ({
    axis: gate.axis,
    status: status(gate.status),
    reason: `${gate.id}: ${gate.reason}`,
  })));
}

/** Mechanical release assertions are already exact-revision and artifact-hash bound. */
export function assertionsFromMechanicalRelease(
  certificate: MechanicalReleaseCertificate,
): DomainAccuracyAssertionResult[] {
  return completeDomainAssertions('mechanical', certificate.assertions);
}

export function assertionsFromBuildingRelease(
  certificate: BuildingReleaseCertificate,
): DomainAccuracyAssertionResult[] {
  return completeDomainAssertions('building', certificate.assertions);
}

export function assertionsFromCivilRelease(
  certificate: CivilReleaseCertificate,
): DomainAccuracyAssertionResult[] {
  return completeDomainAssertions('civil', certificate.assertions);
}

export function assertionsFromLandscapeRelease(
  certificate: LandscapeReleaseCertificate,
): DomainAccuracyAssertionResult[] {
  return completeDomainAssertions('landscape', certificate.assertions);
}

export function assertionsFromInteriorRelease(
  certificate: InteriorReleaseCertificate,
): DomainAccuracyAssertionResult[] {
  return completeDomainAssertions('interior', certificate.assertions);
}
