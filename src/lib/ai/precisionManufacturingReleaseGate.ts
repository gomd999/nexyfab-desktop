export const PRECISION_MANUFACTURING_DOMAINS = ['piping', 'welded-fabrication', 'mold-tooling'] as const;
export type PrecisionManufacturingDomain = typeof PRECISION_MANUFACTURING_DOMAINS[number];

export type PrecisionManufacturingStageStatus = 'PASS' | 'FAIL' | 'HOLD' | 'NOT_RUN';

export interface PrecisionManufacturingStageEvidence {
  status: PrecisionManufacturingStageStatus;
  supported: boolean;
  evidenceId?: string;
}

export interface PrecisionManufacturingReleaseInput {
  domain: PrecisionManufacturingDomain;
  geometry?: PrecisionManufacturingStageEvidence;
  dfm?: PrecisionManufacturingStageEvidence;
  validation?: PrecisionManufacturingStageEvidence;
  manufacturingExport?: PrecisionManufacturingStageEvidence;
  releaseAuthorization?: PrecisionManufacturingStageEvidence;
}

export interface PrecisionManufacturingReleaseGate {
  /** Local contract completeness only; this is never a commercial release. */
  status: 'PASS_LOCAL' | 'HOLD';
  contractComplete: boolean;
  localPass: boolean;
  /** Deliberately hard-false until an independently signed receipt is verified. */
  releaseReady: false;
  commercialReleaseReady: false;
  blockers: string[];
  commercialBlockers: string[];
}

const STAGES = ['geometry', 'dfm', 'validation', 'manufacturingExport', 'releaseAuthorization'] as const;

/** A preview, route, or cut list is not a manufacturing release. */
export function evaluatePrecisionManufacturingRelease(
  input: PrecisionManufacturingReleaseInput | null | undefined,
): PrecisionManufacturingReleaseGate {
  const blockers: string[] = [];
  const commercialBlockers = ['signed_independent_release_evidence_required'];
  if (!input || !PRECISION_MANUFACTURING_DOMAINS.includes(input.domain)) {
    return {
      status: 'HOLD',
      contractComplete: false,
      localPass: false,
      releaseReady: false,
      commercialReleaseReady: false,
      blockers: ['domain_invalid'],
      commercialBlockers,
    };
  }
  for (const stage of STAGES) {
    const evidence = input[stage];
    if (!evidence) {
      blockers.push(`${stage}_not_run`);
      continue;
    }
    if (!evidence.supported) blockers.push(`${stage}_unsupported`);
    if (evidence.status !== 'PASS') blockers.push(`${stage}_${evidence.status.toLowerCase()}`);
    if (typeof evidence.evidenceId !== 'string' || !evidence.evidenceId.trim()) blockers.push(`${stage}_evidence_missing`);
  }
  const uniqueBlockers = [...new Set(blockers)];
  const contractComplete = uniqueBlockers.length === 0;
  return {
    status: contractComplete ? 'PASS_LOCAL' : 'HOLD',
    contractComplete,
    localPass: contractComplete,
    releaseReady: false,
    commercialReleaseReady: false,
    blockers: uniqueBlockers,
    commercialBlockers,
  };
}

export function unrunPrecisionManufacturingRelease(domain: PrecisionManufacturingDomain): PrecisionManufacturingReleaseGate {
  return evaluatePrecisionManufacturingRelease({ domain });
}
