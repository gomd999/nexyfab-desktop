import {
  hashDomainAuthorityManifest,
  validateDomainAuthorityManifest,
  type AuthorityDomain,
  type DomainAuthorityManifest,
  type RevisionBinding,
} from './domainAuthorityManifest';
import {
  canonicalDomainDeliverableManifestHash,
  validateDomainDeliverableManifest,
  type DomainDeliverableManifest,
} from './domainDeliverableManifest';
import {
  DOMAIN_PRODUCT_RECEIPT_SCHEMA,
  evaluateDomainProductReceipt,
  type DeterminismCampaignEvidence,
  type DomainProductReceipt,
  type DomainProductReceiptEvaluation,
  type DomainValidationEvidence,
  type IndependentReviewEvidence,
  type PilotEvidence,
} from './domainProductReceipt';
import type { DomainProductState } from './domainProductState';

export interface DomainProductQualificationInput {
  domain: AuthorityDomain;
  productId: string;
  projectId: string;
  projectRevision: RevisionBinding;
  claimedState: DomainProductState;
  requirementsSha256: string;
  semanticModelSha256: string;
  geometryOrModelSha256: string;
  relationshipsSha256: string;
  calculationArtifactSha256s: string[];
  exchangeReceiptSha256?: string;
  validationEvidence: DomainValidationEvidence[];
  campaignEvidence?: DeterminismCampaignEvidence[];
  independentReviews?: IndependentReviewEvidence[];
  pilots?: PilotEvidence[];
  currentBlockers?: string[];
  issuedAt: string;
  authorityManifest?: DomainAuthorityManifest;
  deliverableManifest?: DomainDeliverableManifest;
}

export interface DomainProductQualificationResult {
  receipt: DomainProductReceipt;
  evaluation: DomainProductReceiptEvaluation;
}

/**
 * Creates one immutable qualification receipt without accepting caller-supplied
 * authority or deliverable hashes. Invalid or unavailable bindings remain null,
 * so the common evaluator records a HOLD instead of blessing detached evidence.
 */
export function buildDomainProductQualification(input: DomainProductQualificationInput): DomainProductQualificationResult {
  const authorityValid = input.authorityManifest
    ? validateDomainAuthorityManifest(input.authorityManifest).status === 'PASS'
    : false;
  const deliverableValid = input.deliverableManifest
    ? validateDomainDeliverableManifest(input.deliverableManifest).valid
    : false;
  const receipt: DomainProductReceipt = {
    schema: DOMAIN_PRODUCT_RECEIPT_SCHEMA,
    domain: input.domain,
    productId: input.productId,
    projectId: input.projectId,
    projectRevision: { ...input.projectRevision },
    claimedState: input.claimedState,
    requirementsSha256: input.requirementsSha256,
    authorityManifestSha256: authorityValid ? hashDomainAuthorityManifest(input.authorityManifest!) : null,
    semanticModelSha256: input.semanticModelSha256,
    geometryOrModelSha256: input.geometryOrModelSha256,
    relationshipsSha256: input.relationshipsSha256,
    calculationArtifactSha256s: [...input.calculationArtifactSha256s],
    deliverableManifestSha256: deliverableValid ? canonicalDomainDeliverableManifestHash(input.deliverableManifest!) : null,
    exchangeReceiptSha256: input.exchangeReceiptSha256 ?? null,
    validationEvidence: input.validationEvidence.map(item => ({ ...item })),
    campaignEvidence: (input.campaignEvidence ?? []).map(item => ({ ...item })),
    independentReviews: (input.independentReviews ?? []).map(item => ({ ...item })),
    pilots: (input.pilots ?? []).map(item => ({ ...item })),
    currentBlockers: [...(input.currentBlockers ?? [])],
    issuedAt: input.issuedAt,
  };
  return {
    receipt,
    evaluation: evaluateDomainProductReceipt(receipt, {
      authorityManifest: input.authorityManifest,
      deliverableManifest: input.deliverableManifest,
    }),
  };
}
