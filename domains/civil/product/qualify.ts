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
import type { DomainAuthorityManifest } from '../../../src/lib/cad/domainAuthorityManifest';
import type { DomainDeliverableManifest } from '../../../src/lib/cad/domainDeliverableManifest';
import type { DomainProductState } from '../../../src/lib/cad/domainProductState';
import {
  hashCivilSiteAccessRoadDrainageContract,
  validateCivilSiteAccessRoadDrainageContract,
  type CivilSiteAccessRoadDrainageContract,
} from './contract';
import {
  generateCivilNativeArtifacts,
  hashCivilNativeArtifacts,
  type CivilNativeArtifact,
} from './artifacts';
import {
  verifyCivilProduct,
  type CivilVerificationOptions,
  type CivilVerificationResult,
} from './verify';
import { validateDomainDeliverableManifest } from '../../../src/lib/cad/domainDeliverableManifest';

export interface CivilProductQualificationOptions {
  productId?: string;
  projectId?: string;
  claimedState?: DomainProductState;
  authorityManifest?: DomainAuthorityManifest;
  deliverableManifest?: DomainDeliverableManifest;
  /** Exchange receipt hashes are external evidence and must be supplied explicitly. */
  exchangeReceiptSha256?: string;
  campaignEvidence?: DeterminismCampaignEvidence[];
  independentReviews?: IndependentReviewEvidence[];
  pilots?: PilotEvidence[];
  verificationOptions?: CivilVerificationOptions;
  /** Alias retained for callers that pass verifier options directly. */
  verify?: CivilVerificationOptions;
  /** Optional expected values are checked against recomputed values, never used as sources. */
  requirementsSha256?: string;
  semanticModelSha256?: string;
  geometryOrModelSha256?: string;
  relationshipsSha256?: string;
  calculationArtifactSha256s?: string[];
  now?: string;
}

export interface CivilProductQualification {
  domain: 'civil';
  status: 'PASS' | 'HOLD' | 'FAIL';
  currentRevisionVerified: boolean;
  productReceiptPromotionReady: false;
  contract: CivilSiteAccessRoadDrainageContract | null;
  artifact: CivilNativeArtifact | null;
  verification: CivilVerificationResult;
  qualification: DomainProductQualificationResult | null;
  receipt: DomainProductQualificationResult['receipt'] | null;
  evaluation: DomainProductQualificationResult['evaluation'] | null;
  blockers: string[];
}

const SHA = /^[a-f0-9]{64}$/;
const canonical = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : value !== null && typeof value === 'object'
    ? `{${Object.keys(value as Record<string, unknown>).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
    : JSON.stringify(value) ?? 'null';
const sha256 = (value: unknown): string => createHash('sha256').update(canonical(value), 'utf8').digest('hex');
const unique = (values: string[]): string[] => [...new Set(values)];

function civilRequirementsHash(contract: CivilSiteAccessRoadDrainageContract): string {
  return sha256({ units: contract.units, authority: contract.authority, criteria: contract.criteria });
}

function civilRelationshipsHash(contract: CivilSiteAccessRoadDrainageContract): string {
  return sha256({
    breaklines: contract.breaklines.map(item => ({ id: item.id, pointIds: item.pointIds })),
    tin: contract.tinTriangles.map(item => ({ id: item.id, vertexPointIds: item.vertexPointIds, neighborTriangleIds: item.neighborTriangleIds })),
    corridor: contract.corridorAssemblies.map(item => ({ id: item.id, alignmentSegmentIds: item.alignmentSegmentIds, crossSectionIds: item.crossSectionIds, targets: item.targets })),
    drainage: { catchments: contract.catchments.map(item => ({ id: item.id, outletNodeId: item.outletNodeId })), pipes: contract.pipes.map(item => ({ id: item.id, fromNodeId: item.fromNodeId, toNodeId: item.toNodeId })), outfalls: contract.outfalls.map(item => ({ id: item.id, nodeId: item.nodeId })) },
    earthwork: contract.earthworkSurfaces.map(item => ({ id: item.id, kind: item.kind, triangleIds: item.triangleIds })),
    stages: contract.constructionStages.map(item => ({ id: item.id, dependsOnStageIds: item.dependsOnStageIds, objectIds: item.objectIds })),
  });
}

function invalidResult(issues: string[]): CivilProductQualification {
  const verification = verifyCivilProduct(null);
  return { domain: 'civil', status: 'FAIL', currentRevisionVerified: false, productReceiptPromotionReady: false, contract: null, artifact: null, verification, qualification: null, receipt: null, evaluation: null, blockers: unique(issues) };
}

function expectedHashBlockers(options: CivilProductQualificationOptions, derived: Record<string, string>, artifact: CivilNativeArtifact): string[] {
  const blockers: string[] = [];
  for (const key of ['requirementsSha256', 'semanticModelSha256', 'geometryOrModelSha256', 'relationshipsSha256'] as const) {
    const supplied = options[key];
    if (supplied !== undefined && supplied !== derived[key]) blockers.push(`caller_hash_mismatch:${key}`);
  }
  if (options.calculationArtifactSha256s !== undefined && canonical(options.calculationArtifactSha256s) !== canonical([artifact.artifactSha256])) blockers.push('caller_hash_mismatch:calculationArtifactSha256s');
  return blockers;
}

function manifestBlockers(options: CivilProductQualificationOptions, contract: CivilSiteAccessRoadDrainageContract, artifact: CivilNativeArtifact): string[] {
  const blockers: string[] = [];
  const projectId = options.projectId ?? contract.identity.id;
  if (options.authorityManifest) {
    if (options.authorityManifest.domain !== 'civil') blockers.push('authority_manifest_domain_mismatch');
    if (options.authorityManifest.projectId !== projectId) blockers.push('authority_manifest_project_mismatch');
    if (options.authorityManifest.projectRevision?.id !== contract.identity.revision.id || options.authorityManifest.projectRevision?.sha256 !== contract.identity.revision.sha256) blockers.push('authority_manifest_revision_mismatch');
  }
  if (options.deliverableManifest) {
    const validation = validateDomainDeliverableManifest(options.deliverableManifest);
    if (!validation.valid) blockers.push(...validation.errors.map(error => `deliverable_manifest:${error}`));
    if (options.deliverableManifest.domain !== 'civil') blockers.push('deliverable_manifest:domain_mismatch');
    if (options.deliverableManifest.projectRevision !== contract.identity.revision.id) blockers.push('deliverable_manifest:revision_mismatch');
    if (options.deliverableManifest.modelContentHash !== artifact.artifactSha256) blockers.push('deliverable_manifest:model_hash_mismatch');
  }
  return blockers;
}

function verifyArtifact(artifact: CivilNativeArtifact): string[] {
  return hashCivilNativeArtifacts(artifact) === artifact.artifactSha256 ? [] : ['native_artifact_hash_mismatch'];
}

/**
 * Qualifies one current civil revision. This is intentionally a one-case
 * qualification: common evaluation still requires campaigns, external
 * exchange/survey evidence, independent reviews, and pilots before release.
 */
export function qualifyCivilProduct(contractInput: unknown, options: CivilProductQualificationOptions = {}): CivilProductQualification {
  if (contractInput !== null && typeof contractInput === 'object' && 'contract' in contractInput && (contractInput as Record<string, unknown>).contract !== undefined) {
    const envelope = contractInput as Record<string, unknown>;
    contractInput = envelope.contract;
    options = { ...envelope, ...options } as CivilProductQualificationOptions;
  }
  const contractIssues = validateCivilSiteAccessRoadDrainageContract(contractInput);
  if (contractIssues.length) return invalidResult(contractIssues.map(issue => `contract:${issue}`));
  const contract = contractInput as CivilSiteAccessRoadDrainageContract;
  const artifact = (() => { try { return generateCivilNativeArtifacts(contract); } catch (error) { return null; } })();
  if (!artifact) return invalidResult(['native_artifact_generation_failed']);
  const verification = verifyCivilProduct(contract, options.verificationOptions ?? options.verify ?? {});
  const requirementsSha256 = civilRequirementsHash(contract);
  const semanticModelSha256 = hashCivilSiteAccessRoadDrainageContract(contract);
  const geometryOrModelSha256 = artifact.artifactSha256;
  const relationshipsSha256 = civilRelationshipsHash(contract);
  const derived = { requirementsSha256, semanticModelSha256, geometryOrModelSha256, relationshipsSha256 };
  const blockers = unique([
    ...verifyArtifact(artifact),
    ...expectedHashBlockers(options, derived, artifact),
    ...manifestBlockers(options, contract, artifact),
    ...verification.blockers,
  ]);
  const exchangeReceiptSha256 = options.exchangeReceiptSha256 !== undefined && SHA.test(options.exchangeReceiptSha256)
    ? options.exchangeReceiptSha256
    : undefined;
  if (options.exchangeReceiptSha256 !== undefined && !SHA.test(options.exchangeReceiptSha256)) blockers.push('exchange_receipt_sha256_invalid');
  const result = buildDomainProductQualification({
    domain: 'civil', productId: options.productId ?? 'civil-site-access-road-drainage', projectId: options.projectId ?? contract.identity.id,
    projectRevision: { ...contract.identity.revision }, claimedState: options.claimedState ?? 'DOMAIN_VERIFIED',
    requirementsSha256, semanticModelSha256, geometryOrModelSha256, relationshipsSha256,
    calculationArtifactSha256s: [artifact.artifactSha256], exchangeReceiptSha256,
    validationEvidence: verification.axisEvidence.map(axis => ({ axis: axis.axis, status: axis.status, caseCount: axis.caseCount, accuracyBasisPoints: axis.accuracyBasisPoints, coverageBasisPoints: axis.coverageBasisPoints, falseVerificationCount: axis.falseVerificationCount, artifactSha256: axis.artifactSha256, sourceRevision: axis.sourceRevision })),
    campaignEvidence: options.campaignEvidence, independentReviews: options.independentReviews, pilots: options.pilots,
    currentBlockers: blockers, issuedAt: options.now ?? '2026-08-24T00:00:00.000Z', authorityManifest: options.authorityManifest,
    deliverableManifest: options.deliverableManifest,
  });
  const allBlockers = unique([...blockers, ...result.evaluation.blockers]);
  return { domain: 'civil', status: verification.status === 'FAIL' ? 'FAIL' : allBlockers.length ? 'HOLD' : 'PASS', currentRevisionVerified: verification.currentRevisionVerified, productReceiptPromotionReady: false, contract, artifact, verification, qualification: result, receipt: result.receipt, evaluation: result.evaluation, blockers: allBlockers };
}

export const qualifyCivilSiteAccessRoadDrainage = qualifyCivilProduct;
export const qualifyCivilSiteAccessRoadDrainageProduct = qualifyCivilProduct;
export const qualifyCivilSiteAccessRoadDrainageContract = qualifyCivilProduct;
export const qualifyCivil = qualifyCivilProduct;
