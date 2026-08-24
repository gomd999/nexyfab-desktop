import { createHash } from 'node:crypto';
import { buildDomainProductQualification, type DomainProductQualificationResult } from '../../../src/lib/cad/domainProductQualification';
import type { DeterminismCampaignEvidence, IndependentReviewEvidence, PilotEvidence } from '../../../src/lib/cad/domainProductReceipt';
import type { DomainProductState } from '../../../src/lib/cad/domainProductState';
import { validateDomainAuthorityManifest, type DomainAuthorityManifest } from '../../../src/lib/cad/domainAuthorityManifest';
import { validateDomainDeliverableManifest, type DomainDeliverableManifest } from '../../../src/lib/cad/domainDeliverableManifest';
import { generateInteriorNativeArtifacts, validateInteriorNativeArtifacts, type InteriorNativeArtifactSet } from './artifacts';
import { hashInteriorProductContract, validateInteriorProductContract, type InteriorProductContract } from './contract';
import { verifyInteriorProduct, type InteriorVerificationOptions, type InteriorVerificationResult } from './verify';

export interface InteriorProductQualificationOptions {
  authorityManifest?: DomainAuthorityManifest;
  deliverableManifest?: DomainDeliverableManifest;
  exchangeReceiptSha256?: string;
  verification?: InteriorVerificationOptions;
  campaignEvidence?: DeterminismCampaignEvidence[];
  independentReviews?: IndependentReviewEvidence[];
  pilots?: PilotEvidence[];
  claimedState?: DomainProductState;
  issuedAt?: string;
}

export interface InteriorProductQualification extends DomainProductQualificationResult {
  artifacts: InteriorNativeArtifactSet;
  verification: InteriorVerificationResult;
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

function projectRevision(contract: InteriorProductContract) {
  return { id: contract.identity.revision, sha256: contract.hostBinding.hostRevision.sha256 };
}

function rejectDetachedBindings(contract: InteriorProductContract, options: InteriorProductQualificationOptions): void {
  const revision = projectRevision(contract);
  if (options.authorityManifest) {
    const result = validateDomainAuthorityManifest(options.authorityManifest);
    if (result.status !== 'PASS') throw new Error(`interior_authority_manifest_invalid:${result.issues.join(',')}`);
    if (options.authorityManifest.domain !== 'interior' || options.authorityManifest.projectId !== contract.identity.id || !sameRevision(options.authorityManifest.projectRevision, revision)) throw new Error('interior_authority_manifest_detached');
  }
  if (options.deliverableManifest) {
    const result = validateDomainDeliverableManifest(options.deliverableManifest);
    if (!result.valid) throw new Error(`interior_deliverable_manifest_invalid:${result.errors.join(',')}`);
    if (options.deliverableManifest.domain !== 'interior' || options.deliverableManifest.projectRevision !== revision.id || options.deliverableManifest.modelContentHash !== contract.identity.contentSha256) throw new Error('interior_deliverable_manifest_detached');
  }
  if (options.exchangeReceiptSha256 !== undefined && !SHA.test(options.exchangeReceiptSha256)) throw new Error('interior_exchange_receipt_hash_invalid');
}

function axisEvidence(verification: InteriorVerificationResult) {
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

/** Qualifies one interior fit-out revision and leaves external gates HOLD until
 * real authority, exchange, review, and pilot evidence is supplied. */
export function qualifyInteriorProduct(contractInput: unknown, options: InteriorProductQualificationOptions = {}): InteriorProductQualification {
  const contractIssues = validateInteriorProductContract(contractInput);
  if (contractIssues.length) throw new Error(`interior_contract_invalid:${contractIssues.join(',')}`);
  const contract = contractInput as InteriorProductContract;
  rejectDetachedBindings(contract, options);
  const revision = projectRevision(contract);
  const artifacts = generateInteriorNativeArtifacts(contract, { sourceRevision: revision, modelSha256: contract.identity.contentSha256, coordinateFrameSha256: contract.coordinateFrameSha256 });
  const artifactIssues = validateInteriorNativeArtifacts(artifacts);
  if (artifactIssues.length || artifacts.modelSha256 !== hashInteriorProductContract(contract)) throw new Error(`interior_native_artifacts_invalid:${artifactIssues.join(',')}`);
  const verification = verifyInteriorProduct(contract, options.verification);
  const requirementsSha256 = sha256(contract.requirements);
  const relationshipsSha256 = sha256({ hostBinding: contract.hostBinding, objects: contract.objects.map(object => ({ id: object.id, kind: object.kind, hostRefs: object.hostRefs, data: object.data })) });
  const result = buildDomainProductQualification({
    domain: 'interior',
    productId: contract.identity.id,
    projectId: contract.identity.id,
    projectRevision: revision,
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
