import { createHash } from 'node:crypto';
import {
  buildDomainProductQualification,
  type DomainProductQualificationResult,
} from '../../../src/lib/cad/domainProductQualification';
import type {
  DeterminismCampaignEvidence,
  IndependentReviewEvidence,
  PilotEvidence,
} from '../../../src/lib/cad/domainProductReceipt';
import type { DomainProductState } from '../../../src/lib/cad/domainProductState';
import {
  validateDomainAuthorityManifest,
  type DomainAuthorityManifest,
} from '../../../src/lib/cad/domainAuthorityManifest';
import {
  validateDomainDeliverableManifest,
  type DomainDeliverableManifest,
} from '../../../src/lib/cad/domainDeliverableManifest';
import {
  generateBuildingNativeArtifacts,
  validateBuildingNativeArtifacts,
  type BuildingNativeArtifactSet,
} from './artifacts';
import { hashBuildingProductContract, validateBuildingProductContract, type BuildingProductContract } from './contract';
import { verifyBuildingProduct, type BuildingVerificationOptions, type BuildingVerificationResult } from './verify';

export interface BuildingProductQualificationOptions {
  authorityManifest?: DomainAuthorityManifest;
  deliverableManifest?: DomainDeliverableManifest;
  exchangeReceiptSha256?: string;
  verification?: BuildingVerificationOptions;
  campaignEvidence?: DeterminismCampaignEvidence[];
  independentReviews?: IndependentReviewEvidence[];
  pilots?: PilotEvidence[];
  claimedState?: DomainProductState;
  issuedAt?: string;
}

export interface BuildingProductQualification extends DomainProductQualificationResult {
  artifacts: BuildingNativeArtifactSet;
  verification: BuildingVerificationResult;
  requirementsSha256: string;
  relationshipsSha256: string;
}

const SHA = /^[a-f0-9]{64}$/;
const canonical = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : value !== null && typeof value === 'object'
    ? `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
    : JSON.stringify(value) ?? 'null';
const sha256 = (value: unknown): string => createHash('sha256').update(canonical(value), 'utf8').digest('hex');
const sameRevision = (a: { id: string; sha256: string }, b: { id: string; sha256: string }): boolean => a.id === b.id && a.sha256 === b.sha256;
const unique = (values: string[]): string[] => [...new Set(values)];

function rejectDetachedBindings(contract: BuildingProductContract, options: BuildingProductQualificationOptions): void {
  const projectRevision = contract.identity.revision;
  if (options.authorityManifest) {
    const result = validateDomainAuthorityManifest(options.authorityManifest);
    if (result.status !== 'PASS') throw new Error(`building_authority_manifest_invalid:${result.issues.join(',')}`);
    if (options.authorityManifest.domain !== 'building' || options.authorityManifest.projectId !== contract.identity.projectId || !sameRevision(options.authorityManifest.projectRevision, projectRevision)) {
      throw new Error('building_authority_manifest_detached');
    }
  }
  if (options.deliverableManifest) {
    const result = validateDomainDeliverableManifest(options.deliverableManifest);
    if (!result.valid) throw new Error(`building_deliverable_manifest_invalid:${result.errors.join(',')}`);
    if (options.deliverableManifest.domain !== 'building' || options.deliverableManifest.projectRevision !== projectRevision.id || options.deliverableManifest.modelContentHash !== contract.identity.contentSha256) {
      throw new Error('building_deliverable_manifest_detached');
    }
  }
  if (options.exchangeReceiptSha256 !== undefined && !SHA.test(options.exchangeReceiptSha256)) throw new Error('building_exchange_receipt_hash_invalid');
}

function axisEvidence(verification: BuildingVerificationResult) {
  return verification.axisEvidence.map(axis => ({
    axis: axis.axis,
    status: axis.status,
    caseCount: axis.caseCount,
    accuracyBasisPoints: axis.accuracyBasisPoints,
    coverageBasisPoints: axis.coverageBasisPoints,
    falseVerificationCount: axis.falseVerificationCount,
    artifactSha256: axis.artifactSha256,
    sourceRevision: axis.sourceRevision,
  }));
}

/**
 * Qualifies exactly one current building revision. Native schedules are
 * regenerated from the validated contract; caller-provided hashes and
 * detached manifests are never trusted. The common evaluator intentionally
 * keeps this one-case result below commercial promotion thresholds.
 */
export function qualifyBuildingProduct(contractInput: unknown, options: BuildingProductQualificationOptions = {}): BuildingProductQualification {
  const contractIssues = validateBuildingProductContract(contractInput);
  if (contractIssues.length) throw new Error(`building_contract_invalid:${contractIssues.join(',')}`);
  const contract = contractInput as BuildingProductContract;
  rejectDetachedBindings(contract, options);
  const artifacts = generateBuildingNativeArtifacts(contract, {
    sourceRevision: contract.identity.revision,
    modelSha256: contract.identity.contentSha256,
  });
  const artifactIssues = validateBuildingNativeArtifacts(artifacts);
  if (artifactIssues.length || artifacts.modelSha256 !== hashBuildingProductContract(contract)) throw new Error(`building_native_artifacts_invalid:${artifactIssues.join(',')}`);
  const verification = verifyBuildingProduct(contract, options.verification);
  const projectRevision = contract.identity.revision;
  const requirementsSha256 = sha256(contract.requirements);
  const relationshipsSha256 = sha256(contract.relationships);
  const result = buildDomainProductQualification({
    domain: 'building',
    productId: contract.identity.projectId,
    projectId: contract.identity.projectId,
    projectRevision,
    claimedState: options.claimedState ?? 'PRODUCT_QUALIFIED',
    requirementsSha256,
    semanticModelSha256: artifacts.contentSha256,
    geometryOrModelSha256: contract.identity.contentSha256,
    relationshipsSha256,
    calculationArtifactSha256s: [artifacts.contentSha256],
    exchangeReceiptSha256: options.exchangeReceiptSha256,
    validationEvidence: axisEvidence(verification),
    campaignEvidence: options.campaignEvidence,
    independentReviews: options.independentReviews,
    pilots: options.pilots,
    currentBlockers: unique(verification.blockers),
    issuedAt: options.issuedAt ?? new Date().toISOString(),
    authorityManifest: options.authorityManifest,
    deliverableManifest: options.deliverableManifest,
  });
  return { ...result, artifacts, verification, requirementsSha256, relationshipsSha256 };
}

export const qualifyArchitectureProduct = qualifyBuildingProduct;
