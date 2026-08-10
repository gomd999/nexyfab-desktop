export type TechnicalReleaseStatus = 'pass' | 'fail';
export type CapabilitySupport = 'verified' | 'preview' | 'unsupported';

export const REQUIRED_TECHNICAL_CAPABILITIES = {
  'ai-complex-product': { minimumSamples: 30, minimumPassRate: 0.95 },
  'manual-parametric-editing': { minimumSamples: 20, minimumPassRate: 0.95 },
  'expert-precision-cad': { minimumSamples: 20, minimumPassRate: 0.95 },
  'assembly-motion': { minimumSamples: 20, minimumPassRate: 0.95 },
  'continuous-collision': { minimumSamples: 20, minimumPassRate: 0.95 },
  'step-exchange': { minimumSamples: 20, minimumPassRate: 0.95 },
  'drawing-bom-manufacturing': { minimumSamples: 10, minimumPassRate: 0.95 },
} as const;

export type RequiredTechnicalCapabilityId = keyof typeof REQUIRED_TECHNICAL_CAPABILITIES;

export interface TechnicalCapabilityEvidence {
  id: RequiredTechnicalCapabilityId;
  support: CapabilitySupport;
  publicClaimAllowed: boolean;
  evidenceSha256: string;
  samples: number;
  passed: number;
  independentHoldout: boolean;
  limitations: string[];
}

export interface CadTechnicalReleaseAuditV3 {
  schema: 'nexyfab.cad-technical-release-audit.v3';
  releaseId: string;
  decisionScope: 'technical-private-pilot';
  deferred: { payment: true; legal: true };
  externalCadRequired: false;
  runtimeKernelMode: 'wasm-only-no-stub';
  closedBetaIntegrity: { status: TechnicalReleaseStatus; reportSha256: string; tableDiff: number; fileDiff: number };
  referenceCorpus: { status: TechnicalReleaseStatus; manifestSha256: string; sourceWrites: number };
  generationState: {
    ownerIsolation: TechnicalReleaseStatus;
    compareAndSwap: TechnicalReleaseStatus;
    durableProductionStore: TechnicalReleaseStatus;
    browserCannotRecordPassedStages: TechnicalReleaseStatus;
    evidenceSha256: string;
  };
  generationAccuracy: {
    deepSchemaValidation: TechnicalReleaseStatus;
    trustedEvidenceBinding: TechnicalReleaseStatus;
    numericParameterCoverage: number;
    missingInputFailsClosed: TechnicalReleaseStatus;
    localRepairPreservesLockedParameters: TechnicalReleaseStatus;
    evidenceSha256: string;
  };
  capabilityMatrix: TechnicalCapabilityEvidence[];
  operations: {
    rollback: TechnicalReleaseStatus;
    canary: TechnicalReleaseStatus;
    monitoring: TechnicalReleaseStatus;
    workerResume: TechnicalReleaseStatus;
    performanceBudget: TechnicalReleaseStatus;
    evidenceSha256: string;
  };
}

export interface TechnicalReleaseAuditIssue { code: string; message: string }
const SHA256 = /^[a-f0-9]{64}$/i;

export function cadTechnicalReleaseAuditV3Issues(value: unknown): TechnicalReleaseAuditIssue[] {
  const audit = value as Partial<CadTechnicalReleaseAuditV3> | null;
  if (!audit || typeof audit !== 'object') return [{ code: 'audit.missing', message: 'CAD technical release audit v3 is required' }];
  const issues: TechnicalReleaseAuditIssue[] = [];
  if (audit.schema !== 'nexyfab.cad-technical-release-audit.v3') issues.push({ code: 'audit.schema', message: 'technical release audit schema must be v3' });
  if (!audit.releaseId?.trim()) issues.push({ code: 'audit.release_id', message: 'releaseId is required' });
  if (audit.decisionScope !== 'technical-private-pilot') issues.push({ code: 'audit.scope', message: 'this gate may decide only technical private-pilot readiness' });
  if (audit.deferred?.payment !== true || audit.deferred?.legal !== true) issues.push({ code: 'audit.deferred_scope', message: 'payment and legal must remain explicitly deferred, not silently passed' });
  if (audit.externalCadRequired !== false) issues.push({ code: 'audit.external_cad', message: 'the supported workflow must not require external CAD installation' });
  if (audit.runtimeKernelMode !== 'wasm-only-no-stub') issues.push({ code: 'audit.kernel_mode', message: 'release runtime must use the real WASM kernel without stub fallback' });

  if (audit.closedBetaIntegrity?.status !== 'pass' || audit.closedBetaIntegrity?.tableDiff !== 0 || audit.closedBetaIntegrity?.fileDiff !== 0) {
    issues.push({ code: 'audit.closed_beta_integrity', message: 'Closed Beta protected tables and files must have zero diff' });
  }
  requireSha(issues, 'audit.closed_beta_sha256', audit.closedBetaIntegrity?.reportSha256, 'Closed Beta integrity report');
  if (audit.referenceCorpus?.status !== 'pass' || audit.referenceCorpus?.sourceWrites !== 0) issues.push({ code: 'audit.reference_corpus', message: 'reference corpus must be read-only with zero source writes' });
  requireSha(issues, 'audit.reference_manifest_sha256', audit.referenceCorpus?.manifestSha256, 'reference utilization manifest');

  for (const key of ['ownerIsolation', 'compareAndSwap', 'durableProductionStore', 'browserCannotRecordPassedStages'] as const) {
    if (audit.generationState?.[key] !== 'pass') issues.push({ code: `audit.generation_state.${key}`, message: `generation state ${key} evidence must pass` });
  }
  requireSha(issues, 'audit.generation_state.sha256', audit.generationState?.evidenceSha256, 'generation state evidence');

  for (const key of ['deepSchemaValidation', 'trustedEvidenceBinding', 'missingInputFailsClosed', 'localRepairPreservesLockedParameters'] as const) {
    if (audit.generationAccuracy?.[key] !== 'pass') issues.push({ code: `audit.generation_accuracy.${key}`, message: `generation accuracy ${key} evidence must pass` });
  }
  if (audit.generationAccuracy?.numericParameterCoverage !== 1) issues.push({ code: 'audit.generation_accuracy.parameter_coverage', message: 'every numeric geometry parameter must have accepted provenance' });
  requireSha(issues, 'audit.generation_accuracy.sha256', audit.generationAccuracy?.evidenceSha256, 'generation accuracy evidence');

  const claims = new Map((Array.isArray(audit.capabilityMatrix) ? audit.capabilityMatrix : []).map(claim => [claim?.id, claim]));
  for (const [id, threshold] of Object.entries(REQUIRED_TECHNICAL_CAPABILITIES) as Array<[RequiredTechnicalCapabilityId, { minimumSamples: number; minimumPassRate: number }]>) {
    const claim = claims.get(id);
    if (!claim) { issues.push({ code: `audit.capability.${id}.missing`, message: `${id} support evidence is required` }); continue; }
    if (claim.support !== 'verified' || claim.publicClaimAllowed !== true) issues.push({ code: `audit.capability.${id}.support`, message: `${id} must be verified before it is a release claim` });
    if (!claim.independentHoldout) issues.push({ code: `audit.capability.${id}.holdout`, message: `${id} requires an independent holdout set` });
    if (!Number.isInteger(claim.samples) || claim.samples < threshold.minimumSamples) issues.push({ code: `audit.capability.${id}.samples`, message: `${id} requires at least ${threshold.minimumSamples} samples` });
    const passRate = claim.samples > 0 ? claim.passed / claim.samples : 0;
    if (!Number.isInteger(claim.passed) || claim.passed < 0 || claim.passed > claim.samples || passRate < threshold.minimumPassRate) issues.push({ code: `audit.capability.${id}.pass_rate`, message: `${id} requires ${(threshold.minimumPassRate * 100).toFixed(0)}% holdout pass rate` });
    requireSha(issues, `audit.capability.${id}.sha256`, claim.evidenceSha256, `${id} evidence`);
  }
  if (claims.size !== Object.keys(REQUIRED_TECHNICAL_CAPABILITIES).length) issues.push({ code: 'audit.capability.unrecognized', message: 'capability matrix must contain each required capability exactly once and no unrecognized claims' });

  for (const key of ['rollback', 'canary', 'monitoring', 'workerResume', 'performanceBudget'] as const) {
    if (audit.operations?.[key] !== 'pass') issues.push({ code: `audit.operations.${key}`, message: `operations ${key} evidence must pass` });
  }
  requireSha(issues, 'audit.operations.sha256', audit.operations?.evidenceSha256, 'operations evidence');
  return issues;
}

function requireSha(issues: TechnicalReleaseAuditIssue[], code: string, value: unknown, label: string): void {
  if (!SHA256.test(String(value ?? ''))) issues.push({ code, message: `${label} must be bound by SHA-256` });
}
