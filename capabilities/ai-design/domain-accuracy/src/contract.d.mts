export const DOMAIN_ACCURACY_DOMAINS: readonly ['mechanical', 'building', 'civil', 'landscape', 'interior'];
export type DomainAccuracyDomain = (typeof DOMAIN_ACCURACY_DOMAINS)[number];

export interface DomainAccuracyProfile {
  domain: DomainAccuracyDomain;
  requiredAxes: readonly string[];
  firstReleaseCapabilities: readonly string[];
}

export const DOMAIN_ACCURACY_PROFILES: Readonly<Record<DomainAccuracyDomain, DomainAccuracyProfile>>;
export const DEFAULT_DOMAIN_ACCURACY_POLICY: Readonly<{
  minimumCasesPerFamily: number;
  repeatsPerCampaign: number;
  consecutiveCampaigns: number;
  minimumAccuracy: number;
  minimumCoverage: number;
  requiredGatePassRate: 1;
  maximumFalseVerified: 0;
  maximumFalseClear: 0;
  maximumDestructivePartMerge: 0;
}>;

export interface DomainAxisEvidence {
  axis: string;
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

export interface DomainAccuracyAssessment {
  domain: DomainAccuracyDomain;
  eligible: boolean;
  axes: Array<DomainAxisEvidence & { accuracy: number | null; coverage: number | null }>;
  blockers: string[];
}

export function assessDomainAccuracy(
  evidence: DomainAccuracyEvidence,
  policy?: typeof DEFAULT_DOMAIN_ACCURACY_POLICY,
): DomainAccuracyAssessment;
