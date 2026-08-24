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
  hashLandscapeProductContract,
  validateLandscapeProductContract,
  type LandscapeProductContract,
} from './contract';
import {
  generateLandscapeNativeArtifacts,
  hashLandscapeNativeArtifacts,
  type LandscapeNativeArtifact,
} from './artifacts';
import {
  verifyLandscapeProduct,
  type LandscapeVerificationOptions,
  type LandscapeVerificationResult,
} from './verify';
import { validateDomainDeliverableManifest } from '../../../src/lib/cad/domainDeliverableManifest';

export interface LandscapeProductQualificationOptions {
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
  verificationOptions?: LandscapeVerificationOptions;
  verify?: LandscapeVerificationOptions;
  requirementsSha256?: string;
  semanticModelSha256?: string;
  geometryOrModelSha256?: string;
  relationshipsSha256?: string;
  calculationArtifactSha256s?: string[];
  now?: string;
}

export interface LandscapeProductQualification {
  domain: 'landscape';
  status: 'PASS' | 'HOLD' | 'FAIL';
  currentRevisionVerified: boolean;
  productReceiptPromotionReady: false;
  contract: LandscapeProductContract | null;
  artifact: LandscapeNativeArtifact | null;
  verification: LandscapeVerificationResult;
  qualification: DomainProductQualificationResult | null;
  receipt: DomainProductQualificationResult['receipt'] | null;
  evaluation: DomainProductQualificationResult['evaluation'] | null;
  blockers: string[];
}

const canonical = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : value !== null && typeof value === 'object'
    ? `{${Object.keys(value as Record<string, unknown>).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
    : JSON.stringify(value) ?? 'null';
const sha256 = (value: unknown): string => createHash('sha256').update(canonical(value), 'utf8').digest('hex');
const unique = (values: string[]): string[] => [...new Set(values)];

function landscapeRequirementsHash(contract: LandscapeProductContract): string {
  return sha256({ units: contract.units, authority: contract.authority });
}

function landscapeRelationshipsHash(contract: LandscapeProductContract): string {
  return sha256({
    grading: { spots: contract.grading.spotGrades.map(item => item.id), breaklines: contract.grading.breaklines.map(item => ({ id: item.id, pointRefs: item.pointRefs })), paths: contract.grading.drainagePaths.map(item => ({ id: item.id, pointRefs: item.pointRefs, outletRef: item.outletRef })) },
    planting: { zones: contract.plantingZones.map(item => ({ id: item.id, soilZoneRef: item.soilZoneRef, irrigationZoneRef: item.irrigationZoneRef })), plants: contract.plants.map(item => ({ id: item.id, plantingZoneRef: item.plantingZoneRef })) },
    irrigation: { valves: contract.irrigation.valves.map(item => ({ id: item.id, sourceRef: item.sourceRef, zoneRef: item.zoneRef })), zones: contract.irrigation.zones.map(item => ({ id: item.id, plantingZoneRefs: item.plantingZoneRefs, valveRef: item.valveRef })), pipes: contract.irrigation.pipes.map(item => ({ id: item.id, fromRef: item.fromRef, toRef: item.toRef })), emitters: contract.irrigation.emitters.map(item => ({ id: item.id, valveRef: item.valveRef, plantRefs: item.plantRefs })) },
    maintenance: { zones: contract.maintenance.zones.map(item => ({ id: item.id, objectRefs: item.objectRefs })), tasks: contract.maintenance.tasks.map(item => ({ id: item.id, zoneRef: item.zoneRef })) },
  });
}

function invalidResult(issues: string[]): LandscapeProductQualification {
  const verification = verifyLandscapeProduct(null);
  return { domain: 'landscape', status: 'FAIL', currentRevisionVerified: false, productReceiptPromotionReady: false, contract: null, artifact: null, verification, qualification: null, receipt: null, evaluation: null, blockers: unique(issues) };
}

function expectedHashBlockers(options: LandscapeProductQualificationOptions, derived: Record<string, string>, artifact: LandscapeNativeArtifact): string[] {
  const blockers: string[] = [];
  for (const key of ['requirementsSha256', 'semanticModelSha256', 'geometryOrModelSha256', 'relationshipsSha256'] as const) {
    const supplied = options[key];
    if (supplied !== undefined && supplied !== derived[key]) blockers.push(`caller_hash_mismatch:${key}`);
  }
  if (options.calculationArtifactSha256s !== undefined && canonical(options.calculationArtifactSha256s) !== canonical([artifact.artifactSha256])) blockers.push('caller_hash_mismatch:calculationArtifactSha256s');
  return blockers;
}

function manifestBlockers(options: LandscapeProductQualificationOptions, contract: LandscapeProductContract, artifact: LandscapeNativeArtifact): string[] {
  const blockers: string[] = [];
  const projectId = options.projectId ?? contract.identity.projectId;
  if (options.authorityManifest) {
    if (options.authorityManifest.domain !== 'landscape') blockers.push('authority_manifest_domain_mismatch');
    if (options.authorityManifest.projectId !== projectId) blockers.push('authority_manifest_project_mismatch');
    if (options.authorityManifest.projectRevision?.id !== contract.identity.revision.id || options.authorityManifest.projectRevision?.sha256 !== contract.identity.revision.sha256) blockers.push('authority_manifest_revision_mismatch');
  }
  if (options.deliverableManifest) {
    const validation = validateDomainDeliverableManifest(options.deliverableManifest);
    if (!validation.valid) blockers.push(...validation.errors.map(error => `deliverable_manifest:${error}`));
    if (options.deliverableManifest.domain !== 'landscape') blockers.push('deliverable_manifest:domain_mismatch');
    if (options.deliverableManifest.projectRevision !== contract.identity.revision.id) blockers.push('deliverable_manifest:revision_mismatch');
    if (options.deliverableManifest.modelContentHash !== artifact.artifactSha256) blockers.push('deliverable_manifest:model_hash_mismatch');
  }
  return blockers;
}

/** One current landscape revision is qualified here; external evidence remains explicit HOLD. */
export function qualifyLandscapeProduct(contractInput: unknown, options: LandscapeProductQualificationOptions = {}): LandscapeProductQualification {
  if (contractInput !== null && typeof contractInput === 'object' && 'contract' in contractInput && (contractInput as Record<string, unknown>).contract !== undefined) {
    const envelope = contractInput as Record<string, unknown>;
    contractInput = envelope.contract;
    options = { ...envelope, ...options } as LandscapeProductQualificationOptions;
  }
  const contractIssues = validateLandscapeProductContract(contractInput);
  if (contractIssues.length) return invalidResult(contractIssues.map(issue => `contract:${issue}`));
  const contract = contractInput as LandscapeProductContract;
  const artifact = (() => { try { return generateLandscapeNativeArtifacts(contract); } catch (error) { return null; } })();
  if (!artifact) return invalidResult(['native_artifact_generation_failed']);
  const verificationOptions = { ...(options.verificationOptions ?? options.verify ?? {}) };
  // The site-model binding is an external deliverable proof and must be passed
  // only through verifier options; it is never synthesized from the native artifact.
  const verification = verifyLandscapeProduct(contract, verificationOptions);
  const requirementsSha256 = landscapeRequirementsHash(contract);
  const semanticModelSha256 = hashLandscapeProductContract(contract);
  const geometryOrModelSha256 = artifact.artifactSha256;
  const relationshipsSha256 = landscapeRelationshipsHash(contract);
  const derived = { requirementsSha256, semanticModelSha256, geometryOrModelSha256, relationshipsSha256 };
  const blockers = unique([
    ...(hashLandscapeNativeArtifacts(artifact) === artifact.artifactSha256 ? [] : ['native_artifact_hash_mismatch']),
    ...expectedHashBlockers(options, derived, artifact),
    ...manifestBlockers(options, contract, artifact),
    ...verification.blockers,
  ]);
  const exchangeReceiptSha256 = options.exchangeReceiptSha256 !== undefined && /^[a-f0-9]{64}$/.test(options.exchangeReceiptSha256)
    ? options.exchangeReceiptSha256
    : undefined;
  if (options.exchangeReceiptSha256 !== undefined && !/^[a-f0-9]{64}$/.test(options.exchangeReceiptSha256)) blockers.push('exchange_receipt_sha256_invalid');
  const result = buildDomainProductQualification({
    domain: 'landscape', productId: options.productId ?? 'landscape-site-design', projectId: options.projectId ?? contract.identity.projectId,
    projectRevision: { ...contract.identity.revision }, claimedState: options.claimedState ?? 'DOMAIN_VERIFIED',
    requirementsSha256, semanticModelSha256, geometryOrModelSha256, relationshipsSha256,
    calculationArtifactSha256s: [artifact.artifactSha256], exchangeReceiptSha256,
    validationEvidence: verification.axisEvidence.map(axis => ({ axis: axis.axis, status: axis.status, caseCount: axis.caseCount, accuracyBasisPoints: axis.accuracyBasisPoints, coverageBasisPoints: axis.coverageBasisPoints, falseVerificationCount: axis.falseVerificationCount, artifactSha256: axis.artifactSha256, sourceRevision: axis.sourceRevision })),
    campaignEvidence: options.campaignEvidence, independentReviews: options.independentReviews, pilots: options.pilots,
    currentBlockers: blockers, issuedAt: options.now ?? '2026-08-24T00:00:00.000Z', authorityManifest: options.authorityManifest,
    deliverableManifest: options.deliverableManifest,
  });
  const allBlockers = unique([...blockers, ...result.evaluation.blockers]);
  return { domain: 'landscape', status: verification.status === 'FAIL' ? 'FAIL' : allBlockers.length ? 'HOLD' : 'PASS', currentRevisionVerified: verification.currentRevisionVerified, productReceiptPromotionReady: false, contract, artifact, verification, qualification: result, receipt: result.receipt, evaluation: result.evaluation, blockers: allBlockers };
}

export const qualifyLandscapeSite = qualifyLandscapeProduct;
export const qualifyLandscapeSiteProduct = qualifyLandscapeProduct;
export const qualifyLandscapeProductContract = qualifyLandscapeProduct;
export const qualifyLandscape = qualifyLandscapeProduct;
