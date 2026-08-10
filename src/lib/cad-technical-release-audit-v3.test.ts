import { describe, expect, it } from 'vitest';
import { cadTechnicalReleaseAuditV3Issues, REQUIRED_TECHNICAL_CAPABILITIES, type CadTechnicalReleaseAuditV3 } from './cad-technical-release-audit-v3';

const sha = 'a'.repeat(64);
const valid = (): CadTechnicalReleaseAuditV3 => ({
  schema: 'nexyfab.cad-technical-release-audit.v3', releaseId: '2026.08.09-technical-rc1', decisionScope: 'technical-private-pilot',
  deferred: { payment: true, legal: true }, externalCadRequired: false, runtimeKernelMode: 'wasm-only-no-stub',
  closedBetaIntegrity: { status: 'pass', reportSha256: sha, tableDiff: 0, fileDiff: 0 },
  referenceCorpus: { status: 'pass', manifestSha256: sha, sourceWrites: 0 },
  generationState: { ownerIsolation: 'pass', compareAndSwap: 'pass', durableProductionStore: 'pass', browserCannotRecordPassedStages: 'pass', evidenceSha256: sha },
  generationAccuracy: { deepSchemaValidation: 'pass', trustedEvidenceBinding: 'pass', numericParameterCoverage: 1, missingInputFailsClosed: 'pass', localRepairPreservesLockedParameters: 'pass', evidenceSha256: sha },
  capabilityMatrix: Object.entries(REQUIRED_TECHNICAL_CAPABILITIES).map(([id, threshold]) => ({ id: id as keyof typeof REQUIRED_TECHNICAL_CAPABILITIES, support: 'verified', publicClaimAllowed: true, evidenceSha256: sha, samples: threshold.minimumSamples, passed: threshold.minimumSamples, independentHoldout: true, limitations: [] })),
  operations: { rollback: 'pass', canary: 'pass', monitoring: 'pass', workerResume: 'pass', performanceBudget: 'pass', evidenceSha256: sha },
});

describe('CAD technical release audit v3', () => {
  it('accepts a fully evidenced technical private pilot while payment and legal remain deferred', () => expect(cadTechnicalReleaseAuditV3Issues(valid())).toEqual([]));
  it('fails closed when complex-product evidence is too small or not independent', () => {
    const audit = valid();
    const claim = audit.capabilityMatrix.find(item => item.id === 'ai-complex-product')!;
    claim.samples = 2; claim.passed = 2; claim.independentHoldout = false;
    expect(cadTechnicalReleaseAuditV3Issues(audit).map(issue => issue.code)).toEqual(expect.arrayContaining(['audit.capability.ai-complex-product.samples', 'audit.capability.ai-complex-product.holdout']));
  });
  it('cannot disguise a preview capability as a verified public claim', () => {
    const audit = valid();
    audit.capabilityMatrix[0]!.support = 'preview';
    expect(cadTechnicalReleaseAuditV3Issues(audit).map(issue => issue.code)).toContain(`audit.capability.${audit.capabilityMatrix[0]!.id}.support`);
  });
  it('requires durable server state, complete parameter evidence, and zero Closed Beta diff', () => {
    const audit = valid();
    audit.generationState.durableProductionStore = 'fail'; audit.generationAccuracy.numericParameterCoverage = 0.99; audit.closedBetaIntegrity.fileDiff = 1 as 0;
    expect(cadTechnicalReleaseAuditV3Issues(audit).map(issue => issue.code)).toEqual(expect.arrayContaining(['audit.generation_state.durableProductionStore', 'audit.generation_accuracy.parameter_coverage', 'audit.closed_beta_integrity']));
  });
});
