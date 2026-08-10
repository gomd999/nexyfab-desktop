import { describe, expect, it } from 'vitest';
import { REQUIRED_TECHNICAL_CAPABILITIES, type RequiredTechnicalCapabilityId } from './cad-technical-release-audit-v3';
import { DOMAIN_ACCURACY_DOMAINS, DOMAIN_ACCURACY_PROFILES, type DomainAccuracyEvidence } from './ai/domainAccuracyProgram';
import { buildTechnicalPrivatePilotReadiness, type CapabilityEvidenceObservation, type TechnicalPrivatePilotCandidateInput } from './technicalPrivatePilotReadiness';

const sha = 'a'.repeat(64);
const capability = (maturity: CapabilityEvidenceObservation['maturity'] = 'verified'): CapabilityEvidenceObservation => ({
  maturity,
  evidenceSha256: sha,
  samples: 30,
  passed: 30,
  independentHoldout: true,
  limitations: [],
  reasons: [],
});
const domainEvidence = (domain: typeof DOMAIN_ACCURACY_DOMAINS[number]): DomainAccuracyEvidence => ({
  domain,
  approvedCases: 30,
  independentReviewers: 2,
  campaigns: 3,
  minimumRepeatsPerCase: 15,
  minimumRepeatsPerCampaign: 5,
  requiredGateRuns: 450,
  requiredGatePasses: 450,
  falseVerified: 0,
  falseClear: 0,
  destructivePartMerge: 0,
  axes: DOMAIN_ACCURACY_PROFILES[domain].requiredAxes.map(axis => ({ axis, expected: 450, measured: 450, passed: 450 })),
});
const valid = (): TechnicalPrivatePilotCandidateInput => ({
  releaseId: '2026.08.10-technical-rc1',
  closedBeta: { maturity: 'verified', evidenceSha256: sha, tableDiff: 0, fileDiff: 0, reasons: [] },
  referenceCorpus: { maturity: 'verified', evidenceSha256: sha, sourceWrites: 0, reasons: [] },
  generationState: { ownerIsolation: 'verified', compareAndSwap: 'verified', durableProductionStore: 'verified', browserCannotRecordPassedStages: 'verified', evidenceSha256: sha, reasons: [] },
  generationAccuracy: { deepSchemaValidation: 'verified', trustedEvidenceBinding: 'verified', numericParameterCoverage: 1, missingInputFailsClosed: 'verified', localRepairPreservesLockedParameters: 'verified', evidenceSha256: sha, reasons: [] },
  capabilities: Object.fromEntries((Object.keys(REQUIRED_TECHNICAL_CAPABILITIES) as RequiredTechnicalCapabilityId[]).map(id => [id, capability()])) as TechnicalPrivatePilotCandidateInput['capabilities'],
  operations: { rollback: 'verified', canary: 'verified', monitoring: 'verified', workerResume: 'verified', performanceBudget: 'verified', evidenceSha256: sha, reasons: [] },
  domainEvidence: Object.fromEntries(DOMAIN_ACCURACY_DOMAINS.map(domain => [domain, domainEvidence(domain)])),
});

describe('technical private-pilot readiness', () => {
  it('passes only when the technical audit and all five domain campaigns pass', () => {
    const report = buildTechnicalPrivatePilotReadiness(valid());
    expect(report).toMatchObject({ decision: 'pass', releaseReady: true, paymentDeferred: true, legalDeferred: true, externalCadRequired: false });
    expect(report.domains).toHaveLength(5);
  });

  it('never promotes a dry-run into a verified public capability claim', () => {
    const input = valid();
    input.capabilities['ai-complex-product'] = capability('dry_run');
    const report = buildTechnicalPrivatePilotReadiness(input);
    expect(report.releaseReady).toBe(false);
    expect(report.audit.capabilityMatrix.find(item => item.id === 'ai-complex-product')).toMatchObject({ support: 'preview', publicClaimAllowed: false });
    expect(report.auditIssues.map(issue => issue.code)).toContain('audit.capability.ai-complex-product.support');
  });

  it('keeps a missing domain campaign visible even when every v3 control passes', () => {
    const input = valid();
    delete input.domainEvidence.interior;
    const report = buildTechnicalPrivatePilotReadiness(input);
    expect(report.auditIssues).toEqual([]);
    expect(report.releaseReady).toBe(false);
    expect(report.domains.find(item => item.domain === 'interior')).toMatchObject({ status: 'not_run', blockers: ['approved_signed_independent_campaign_missing'] });
  });

  it('requires production evidence for durable state and operations, not code verification', () => {
    const input = valid();
    input.generationState.durableProductionStore = 'code_verified';
    input.operations.rollback = 'dry_run';
    const report = buildTechnicalPrivatePilotReadiness(input);
    expect(report.auditIssues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'audit.generation_state.durableProductionStore',
      'audit.operations.rollback',
    ]));
  });
});
