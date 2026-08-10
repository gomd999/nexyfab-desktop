import {
  cadTechnicalReleaseAuditV3Issues,
  REQUIRED_TECHNICAL_CAPABILITIES,
  type CadTechnicalReleaseAuditV3,
  type RequiredTechnicalCapabilityId,
  type TechnicalReleaseAuditIssue,
} from './cad-technical-release-audit-v3';
import {
  assessDomainAccuracy,
  DOMAIN_ACCURACY_DOMAINS,
  type DomainAccuracyAssessment,
  type DomainAccuracyDomain,
  type DomainAccuracyEvidence,
} from './ai/domainAccuracyProgram';

export type EvidenceMaturity = 'verified' | 'code_verified' | 'dry_run' | 'not_run' | 'blocked';

export interface ReleaseEvidenceObservation {
  maturity: EvidenceMaturity;
  evidenceSha256: string;
  reasons: string[];
}

export interface CapabilityEvidenceObservation extends ReleaseEvidenceObservation {
  samples: number;
  passed: number;
  independentHoldout: boolean;
  limitations: string[];
}

export interface TechnicalPrivatePilotCandidateInput {
  releaseId: string;
  closedBeta: ReleaseEvidenceObservation & { tableDiff: number; fileDiff: number };
  referenceCorpus: ReleaseEvidenceObservation & { sourceWrites: number };
  generationState: {
    ownerIsolation: EvidenceMaturity;
    compareAndSwap: EvidenceMaturity;
    durableProductionStore: EvidenceMaturity;
    browserCannotRecordPassedStages: EvidenceMaturity;
    evidenceSha256: string;
    reasons: string[];
  };
  generationAccuracy: {
    deepSchemaValidation: EvidenceMaturity;
    trustedEvidenceBinding: EvidenceMaturity;
    numericParameterCoverage: number;
    missingInputFailsClosed: EvidenceMaturity;
    localRepairPreservesLockedParameters: EvidenceMaturity;
    evidenceSha256: string;
    reasons: string[];
  };
  capabilities: Record<RequiredTechnicalCapabilityId, CapabilityEvidenceObservation>;
  operations: {
    rollback: EvidenceMaturity;
    canary: EvidenceMaturity;
    monitoring: EvidenceMaturity;
    workerResume: EvidenceMaturity;
    performanceBudget: EvidenceMaturity;
    evidenceSha256: string;
    reasons: string[];
  };
  domainEvidence: Partial<Record<DomainAccuracyDomain, DomainAccuracyEvidence>>;
}

export interface TechnicalPrivatePilotReadinessReport {
  schema: 'nexyfab.technical-private-pilot-readiness.v1';
  releaseId: string;
  decision: 'pass' | 'blocked';
  releaseReady: boolean;
  paymentDeferred: true;
  legalDeferred: true;
  externalCadRequired: false;
  audit: CadTechnicalReleaseAuditV3;
  auditIssues: TechnicalReleaseAuditIssue[];
  domains: Array<{
    domain: DomainAccuracyDomain;
    status: 'verified' | 'not_run' | 'blocked';
    assessment: DomainAccuracyAssessment | null;
    blockers: string[];
  }>;
  evidenceMaturity: {
    closedBeta: EvidenceMaturity;
    referenceCorpus: EvidenceMaturity;
    capabilities: Record<RequiredTechnicalCapabilityId, EvidenceMaturity>;
  };
  blockingActions: string[];
}

const pass = (maturity: EvidenceMaturity): 'pass' | 'fail' => maturity === 'verified' ? 'pass' : 'fail';

/**
 * Produces the exact v3 audit candidate and the five-domain verdict together.
 * Unit tests and dry-runs stay visible, but can never be promoted to a release
 * claim merely because they passed locally.
 */
export function buildTechnicalPrivatePilotReadiness(
  input: TechnicalPrivatePilotCandidateInput,
): TechnicalPrivatePilotReadinessReport {
  const capabilityMatrix = (Object.keys(REQUIRED_TECHNICAL_CAPABILITIES) as RequiredTechnicalCapabilityId[])
    .map(id => {
      const observation = input.capabilities[id];
      const verified = observation.maturity === 'verified' && observation.independentHoldout;
      return {
        id,
        support: verified ? 'verified' as const : observation.maturity === 'not_run' ? 'unsupported' as const : 'preview' as const,
        publicClaimAllowed: verified,
        evidenceSha256: observation.evidenceSha256,
        samples: observation.samples,
        passed: observation.passed,
        independentHoldout: observation.independentHoldout,
        limitations: [...new Set([...observation.limitations, ...observation.reasons])],
      };
    });

  const audit: CadTechnicalReleaseAuditV3 = {
    schema: 'nexyfab.cad-technical-release-audit.v3',
    releaseId: input.releaseId,
    decisionScope: 'technical-private-pilot',
    deferred: { payment: true, legal: true },
    externalCadRequired: false,
    runtimeKernelMode: 'wasm-only-no-stub',
    closedBetaIntegrity: {
      status: pass(input.closedBeta.maturity),
      reportSha256: input.closedBeta.evidenceSha256,
      tableDiff: input.closedBeta.tableDiff,
      fileDiff: input.closedBeta.fileDiff,
    },
    referenceCorpus: {
      status: pass(input.referenceCorpus.maturity),
      manifestSha256: input.referenceCorpus.evidenceSha256,
      sourceWrites: input.referenceCorpus.sourceWrites,
    },
    generationState: {
      ownerIsolation: pass(input.generationState.ownerIsolation),
      compareAndSwap: pass(input.generationState.compareAndSwap),
      durableProductionStore: pass(input.generationState.durableProductionStore),
      browserCannotRecordPassedStages: pass(input.generationState.browserCannotRecordPassedStages),
      evidenceSha256: input.generationState.evidenceSha256,
    },
    generationAccuracy: {
      deepSchemaValidation: pass(input.generationAccuracy.deepSchemaValidation),
      trustedEvidenceBinding: pass(input.generationAccuracy.trustedEvidenceBinding),
      numericParameterCoverage: input.generationAccuracy.numericParameterCoverage,
      missingInputFailsClosed: pass(input.generationAccuracy.missingInputFailsClosed),
      localRepairPreservesLockedParameters: pass(input.generationAccuracy.localRepairPreservesLockedParameters),
      evidenceSha256: input.generationAccuracy.evidenceSha256,
    },
    capabilityMatrix,
    operations: {
      rollback: pass(input.operations.rollback),
      canary: pass(input.operations.canary),
      monitoring: pass(input.operations.monitoring),
      workerResume: pass(input.operations.workerResume),
      performanceBudget: pass(input.operations.performanceBudget),
      evidenceSha256: input.operations.evidenceSha256,
    },
  };

  const domains = DOMAIN_ACCURACY_DOMAINS.map(domain => {
    const evidence = input.domainEvidence[domain];
    if (!evidence) return { domain, status: 'not_run' as const, assessment: null, blockers: ['approved_signed_independent_campaign_missing'] };
    const assessment = assessDomainAccuracy(evidence);
    return {
      domain,
      status: assessment.eligible ? 'verified' as const : 'blocked' as const,
      assessment,
      blockers: assessment.blockers,
    };
  });
  const auditIssues = cadTechnicalReleaseAuditV3Issues(audit);
  const domainBlockers = domains.flatMap(item => item.blockers.map(reason => `domain.${item.domain}:${reason}`));
  const blockingActions = [...new Set([
    ...input.closedBeta.reasons,
    ...input.referenceCorpus.reasons,
    ...input.generationState.reasons,
    ...input.generationAccuracy.reasons,
    ...Object.values(input.capabilities).flatMap(item => item.reasons),
    ...input.operations.reasons,
    ...auditIssues.map(issue => issue.code),
    ...domainBlockers,
  ])];
  const releaseReady = auditIssues.length === 0 && domains.every(item => item.status === 'verified');

  return {
    schema: 'nexyfab.technical-private-pilot-readiness.v1',
    releaseId: input.releaseId,
    decision: releaseReady ? 'pass' : 'blocked',
    releaseReady,
    paymentDeferred: true,
    legalDeferred: true,
    externalCadRequired: false,
    audit,
    auditIssues,
    domains,
    evidenceMaturity: {
      closedBeta: input.closedBeta.maturity,
      referenceCorpus: input.referenceCorpus.maturity,
      capabilities: Object.fromEntries(
        (Object.keys(REQUIRED_TECHNICAL_CAPABILITIES) as RequiredTechnicalCapabilityId[])
          .map(id => [id, input.capabilities[id].maturity]),
      ) as Record<RequiredTechnicalCapabilityId, EvidenceMaturity>,
    },
    blockingActions,
  };
}
