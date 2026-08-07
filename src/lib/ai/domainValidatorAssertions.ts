import type { CrossDomainVerificationResult } from './crossDomainVerification';
import type { ComplexProductAssessment } from './complexProductAccuracy';
import type { ComplexAccuracyAxis, ComplexAssertionStatus } from './complexProductBenchmarkV2';
import { DOMAIN_ACCURACY_PROFILES, type DomainAccuracyDomain } from './domainAccuracyProgram';
import type { DomainAccuracyAssertionResult } from './domainAccuracyEvidence';

export interface ExplicitDomainGateResult {
  id: string;
  axis: ComplexAccuracyAxis;
  status: 'passed' | 'failed' | 'not_run';
  reason: string;
}

const rank: Record<ComplexAssertionStatus, number> = { pass: 0, not_run: 1, fail: 2 };
const status = (value: 'passed' | 'failed' | 'not_run'): ComplexAssertionStatus =>
  value === 'passed' ? 'pass' : value === 'failed' ? 'fail' : 'not_run';

function merge(results: readonly DomainAccuracyAssertionResult[]): DomainAccuracyAssertionResult[] {
  const grouped = new Map<ComplexAccuracyAxis, DomainAccuracyAssertionResult[]>();
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

const CROSS_DOMAIN_AXIS: Record<CrossDomainVerificationResult['gates'][number]['id'], ComplexAccuracyAxis> = {
  structure: 'hierarchy',
  placement: 'transforms',
  'assembly-dof': 'joints',
  'precise-interference': 'collision_clearance',
  'space-boundary': 'body_membership',
  egress: 'manufacturing',
  'door-swing': 'motion',
  'mep-interference': 'collision_clearance',
};

export function assertionsFromCrossDomain(
  domain: DomainAccuracyDomain,
  result: CrossDomainVerificationResult,
): DomainAccuracyAssertionResult[] {
  return completeDomainAssertions(domain, result.gates.map(gate => ({
    axis: CROSS_DOMAIN_AXIS[gate.id],
    status: status(gate.status),
    reason: `${gate.id}: ${gate.reason}`,
  })));
}

const COMPLEX_PRODUCT_AXIS: Record<ComplexProductAssessment['gates'][number]['id'], ComplexAccuracyAxis> = {
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

