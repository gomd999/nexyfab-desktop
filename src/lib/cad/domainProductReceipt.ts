import { createHash } from 'node:crypto';
import {
  AUTHORITY_DOMAINS,
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
import { PRODUCT_STATES, type DomainProductState, type EvidenceStatus } from './domainProductState';

export const DOMAIN_PRODUCT_RECEIPT_SCHEMA = 'nexyfab.domain-product-receipt.v1' as const;
export const DOMAIN_PRODUCT_AXES = {
  mechanical: ['geometry', 'topology', 'constraints', 'assembly', 'manufacturability', 'drawing-consistency', 'exchange-roundtrip'],
  building: ['coordinates', 'spatial-semantics', 'hosted-elements', 'code-safety', 'quantity-consistency', 'drawing-consistency', 'ifc-roundtrip'],
  civil: ['survey-datum', 'surface', 'alignment-corridor', 'drainage-hydraulics', 'quantity-consistency', 'landxml-roundtrip'],
  landscape: ['terrain-grading', 'planting', 'mature-clearance', 'irrigation-hydraulics', 'water-budget', 'quantity-consistency', 'drawing-consistency'],
  interior: ['surveyed-host', 'space-closure', 'egress', 'door-swing', 'placement-clearance', 'finish-schedule', 'drawing-consistency', 'exchange-roundtrip'],
} as const satisfies Record<AuthorityDomain, readonly string[]>;

const SAFETY_CRITICAL_AXES = new Set([
  'constraints', 'assembly', 'exchange-roundtrip', 'coordinates', 'hosted-elements', 'code-safety', 'ifc-roundtrip',
  'survey-datum', 'drainage-hydraulics', 'landxml-roundtrip', 'mature-clearance', 'irrigation-hydraulics',
  'surveyed-host', 'egress', 'door-swing',
]);

export interface DomainValidationEvidence {
  axis: string;
  status: EvidenceStatus;
  caseCount: number;
  accuracyBasisPoints: number;
  coverageBasisPoints: number;
  falseVerificationCount: number;
  artifactSha256: string;
  sourceRevision: string;
}

export interface DeterminismCampaignEvidence {
  campaignId: string;
  status: EvidenceStatus;
  repeatCount: number;
  falseVerificationCount: number;
  artifactSha256: string;
  sourceRevision: string;
}

export interface IndependentReviewEvidence {
  reviewerId: string;
  status: 'APPROVED' | 'HOLD' | 'REJECTED';
  receiptSha256: string;
  sourceRevision: string;
}

export interface PilotEvidence {
  pilotId: string;
  status: 'PASS' | 'HOLD' | 'FAIL';
  receiptSha256: string;
  sourceRevision: string;
}

export interface DomainProductReceipt {
  schema: typeof DOMAIN_PRODUCT_RECEIPT_SCHEMA;
  domain: AuthorityDomain;
  productId: string;
  projectId: string;
  projectRevision: RevisionBinding;
  claimedState: DomainProductState;
  requirementsSha256: string;
  authorityManifestSha256: string | null;
  semanticModelSha256: string;
  geometryOrModelSha256: string;
  relationshipsSha256: string;
  calculationArtifactSha256s: string[];
  deliverableManifestSha256: string | null;
  exchangeReceiptSha256: string | null;
  validationEvidence: DomainValidationEvidence[];
  campaignEvidence: DeterminismCampaignEvidence[];
  independentReviews: IndependentReviewEvidence[];
  pilots: PilotEvidence[];
  currentBlockers: string[];
  issuedAt: string;
}

export interface DomainProductBindings {
  authorityManifest?: DomainAuthorityManifest;
  deliverableManifest?: DomainDeliverableManifest;
}

export interface DomainProductReceiptEvaluation {
  structurallyValid: boolean;
  status: 'PASS' | 'HOLD';
  eligibleState: DomainProductState;
  blockers: string[];
  canonicalSha256?: string;
}

const SHA = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const MAX_ITEMS = 128;
const RECEIPT_KEYS = ['schema', 'domain', 'productId', 'projectId', 'projectRevision', 'claimedState', 'requirementsSha256', 'authorityManifestSha256', 'semanticModelSha256', 'geometryOrModelSha256', 'relationshipsSha256', 'calculationArtifactSha256s', 'deliverableManifestSha256', 'exchangeReceiptSha256', 'validationEvidence', 'campaignEvidence', 'independentReviews', 'pilots', 'currentBlockers', 'issuedAt'];
const REVISION_KEYS = ['id', 'sha256'];
const VALIDATION_KEYS = ['axis', 'status', 'caseCount', 'accuracyBasisPoints', 'coverageBasisPoints', 'falseVerificationCount', 'artifactSha256', 'sourceRevision'];
const CAMPAIGN_KEYS = ['campaignId', 'status', 'repeatCount', 'falseVerificationCount', 'artifactSha256', 'sourceRevision'];
const REVIEW_KEYS = ['reviewerId', 'status', 'receiptSha256', 'sourceRevision'];
const PILOT_KEYS = ['pilotId', 'status', 'receiptSha256', 'sourceRevision'];

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
};
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
};
const unique = (items: string[]): string[] => [...new Set(items)];
const validHashOrNull = (value: unknown): boolean => value === null || (typeof value === 'string' && SHA.test(value));
const validCount = (value: unknown, minimum = 0): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
const validBasisPoints = (value: unknown): boolean => validCount(value) && (value as number) <= 10_000;

export function validateDomainProductReceiptStructure(input: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(input) || !exactKeys(input, RECEIPT_KEYS)) return ['receipt_keys_invalid'];
  const receipt = input as unknown as DomainProductReceipt;
  if (receipt.schema !== DOMAIN_PRODUCT_RECEIPT_SCHEMA) issues.push('schema_invalid');
  if (!AUTHORITY_DOMAINS.includes(receipt.domain)) issues.push('domain_invalid');
  for (const [name, value] of [['product_id', receipt.productId], ['project_id', receipt.projectId]] as const) if (typeof value !== 'string' || !SAFE_ID.test(value)) issues.push(`${name}_invalid`);
  if (!isRecord(receipt.projectRevision) || !exactKeys(receipt.projectRevision as unknown as Record<string, unknown>, REVISION_KEYS)) issues.push('project_revision_invalid');
  else {
    if (!SAFE_ID.test(receipt.projectRevision.id)) issues.push('project_revision_id_invalid');
    if (!SHA.test(receipt.projectRevision.sha256)) issues.push('project_revision_hash_invalid');
  }
  if (!PRODUCT_STATES.includes(receipt.claimedState)) issues.push('claimed_state_invalid');
  for (const [name, value] of [
    ['requirements', receipt.requirementsSha256], ['semantic_model', receipt.semanticModelSha256],
    ['geometry_or_model', receipt.geometryOrModelSha256], ['relationships', receipt.relationshipsSha256],
  ] as const) if (typeof value !== 'string' || !SHA.test(value)) issues.push(`${name}_hash_invalid`);
  for (const [name, value] of [
    ['authority_manifest', receipt.authorityManifestSha256], ['deliverable_manifest', receipt.deliverableManifestSha256],
    ['exchange_receipt', receipt.exchangeReceiptSha256],
  ] as const) if (!validHashOrNull(value)) issues.push(`${name}_hash_invalid`);
  if (!Array.isArray(receipt.calculationArtifactSha256s) || receipt.calculationArtifactSha256s.length > MAX_ITEMS || receipt.calculationArtifactSha256s.some(value => !SHA.test(value))) issues.push('calculation_hashes_invalid');
  if (!Array.isArray(receipt.currentBlockers) || receipt.currentBlockers.length > MAX_ITEMS || receipt.currentBlockers.some(value => typeof value !== 'string' || value.length === 0 || value.length > 256)) issues.push('current_blockers_invalid');
  if (typeof receipt.issuedAt !== 'string' || !ISO.test(receipt.issuedAt) || Number.isNaN(Date.parse(receipt.issuedAt))) issues.push('issued_at_invalid');

  const validateArray = (value: unknown, keys: readonly string[], name: string, visit: (item: Record<string, unknown>, index: number) => void) => {
    if (!Array.isArray(value) || value.length > MAX_ITEMS) { issues.push(`${name}_invalid`); return; }
    value.forEach((item, index) => {
      if (!isRecord(item) || !exactKeys(item, keys)) { issues.push(`${name}[${index}]_keys_invalid`); return; }
      visit(item, index);
    });
  };
  validateArray(receipt.validationEvidence, VALIDATION_KEYS, 'validation_evidence', (item, index) => {
    if (typeof item.axis !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(item.axis)) issues.push(`validation_evidence[${index}]_axis_invalid`);
    if (!['PASS', 'FAIL', 'HOLD', 'NOT_RUN', 'STALE'].includes(item.status as string)) issues.push(`validation_evidence[${index}]_status_invalid`);
    if (!validCount(item.caseCount) || !validBasisPoints(item.accuracyBasisPoints) || !validBasisPoints(item.coverageBasisPoints) || !validCount(item.falseVerificationCount)) issues.push(`validation_evidence[${index}]_metrics_invalid`);
    if (typeof item.artifactSha256 !== 'string' || !SHA.test(item.artifactSha256)) issues.push(`validation_evidence[${index}]_hash_invalid`);
    if (typeof item.sourceRevision !== 'string' || !SAFE_ID.test(item.sourceRevision)) issues.push(`validation_evidence[${index}]_revision_invalid`);
  });
  validateArray(receipt.campaignEvidence, CAMPAIGN_KEYS, 'campaign_evidence', (item, index) => {
    if (typeof item.campaignId !== 'string' || !SAFE_ID.test(item.campaignId)) issues.push(`campaign_evidence[${index}]_id_invalid`);
    if (!['PASS', 'FAIL', 'HOLD', 'NOT_RUN', 'STALE'].includes(item.status as string)) issues.push(`campaign_evidence[${index}]_status_invalid`);
    if (!validCount(item.repeatCount) || !validCount(item.falseVerificationCount)) issues.push(`campaign_evidence[${index}]_metrics_invalid`);
    if (typeof item.artifactSha256 !== 'string' || !SHA.test(item.artifactSha256)) issues.push(`campaign_evidence[${index}]_hash_invalid`);
    if (typeof item.sourceRevision !== 'string' || !SAFE_ID.test(item.sourceRevision)) issues.push(`campaign_evidence[${index}]_revision_invalid`);
  });
  validateArray(receipt.independentReviews, REVIEW_KEYS, 'independent_reviews', (item, index) => {
    if (typeof item.reviewerId !== 'string' || !SAFE_ID.test(item.reviewerId)) issues.push(`independent_reviews[${index}]_id_invalid`);
    if (!['APPROVED', 'HOLD', 'REJECTED'].includes(item.status as string)) issues.push(`independent_reviews[${index}]_status_invalid`);
    if (typeof item.receiptSha256 !== 'string' || !SHA.test(item.receiptSha256)) issues.push(`independent_reviews[${index}]_hash_invalid`);
    if (typeof item.sourceRevision !== 'string' || !SAFE_ID.test(item.sourceRevision)) issues.push(`independent_reviews[${index}]_revision_invalid`);
  });
  validateArray(receipt.pilots, PILOT_KEYS, 'pilots', (item, index) => {
    if (typeof item.pilotId !== 'string' || !SAFE_ID.test(item.pilotId)) issues.push(`pilots[${index}]_id_invalid`);
    if (!['PASS', 'HOLD', 'FAIL'].includes(item.status as string)) issues.push(`pilots[${index}]_status_invalid`);
    if (typeof item.receiptSha256 !== 'string' || !SHA.test(item.receiptSha256)) issues.push(`pilots[${index}]_hash_invalid`);
    if (typeof item.sourceRevision !== 'string' || !SAFE_ID.test(item.sourceRevision)) issues.push(`pilots[${index}]_revision_invalid`);
  });
  return unique(issues);
}

export function canonicalDomainProductReceiptJson(receipt: DomainProductReceipt): string {
  const issues = validateDomainProductReceiptStructure(receipt);
  if (issues.length) throw new Error(`invalid_domain_product_receipt:${issues.join(',')}`);
  return canonical(receipt);
}

export function hashDomainProductReceipt(receipt: DomainProductReceipt): string {
  return createHash('sha256').update(canonicalDomainProductReceiptJson(receipt), 'utf8').digest('hex');
}

export function evaluateDomainProductReceipt(input: unknown, bindings: DomainProductBindings = {}): DomainProductReceiptEvaluation {
  const structureIssues = validateDomainProductReceiptStructure(input);
  if (structureIssues.length) return { structurallyValid: false, status: 'HOLD', eligibleState: 'CONCEPT', blockers: structureIssues };
  const receipt = input as DomainProductReceipt;
  const stageBlockers: Record<Exclude<DomainProductState, 'CONCEPT'>, string[]> = {
    DESIGN_CANDIDATE: [], DOMAIN_VERIFIED: [], DELIVERY_CANDIDATE: [], PRODUCT_QUALIFIED: [],
  };

  if (receipt.currentBlockers.length) stageBlockers.DESIGN_CANDIDATE.push(...receipt.currentBlockers.map(value => `current_blocker:${value}`));
  if (!bindings.authorityManifest) stageBlockers.DESIGN_CANDIDATE.push('authority_manifest_not_run');
  else {
    const authority = validateDomainAuthorityManifest(bindings.authorityManifest);
    if (authority.status !== 'PASS') stageBlockers.DESIGN_CANDIDATE.push(...authority.issues.map(value => `authority:${value}`));
    else if (receipt.authorityManifestSha256 !== hashDomainAuthorityManifest(bindings.authorityManifest)) stageBlockers.DESIGN_CANDIDATE.push('authority_manifest_hash_mismatch');
    if (bindings.authorityManifest.domain !== receipt.domain) stageBlockers.DESIGN_CANDIDATE.push('authority_domain_mismatch');
    if (bindings.authorityManifest.projectId !== receipt.projectId) stageBlockers.DESIGN_CANDIDATE.push('authority_project_mismatch');
    if (bindings.authorityManifest.projectRevision.id !== receipt.projectRevision.id || bindings.authorityManifest.projectRevision.sha256 !== receipt.projectRevision.sha256) stageBlockers.DESIGN_CANDIDATE.push('authority_revision_mismatch');
  }
  if (!receipt.authorityManifestSha256) stageBlockers.DESIGN_CANDIDATE.push('authority_manifest_hash_missing');

  const axes = new Map<string, DomainValidationEvidence>();
  for (const evidence of receipt.validationEvidence) {
    if (axes.has(evidence.axis)) stageBlockers.DOMAIN_VERIFIED.push(`validation_axis_duplicate:${evidence.axis}`);
    axes.set(evidence.axis, evidence);
  }
  for (const axis of DOMAIN_PRODUCT_AXES[receipt.domain]) {
    const evidence = axes.get(axis);
    if (!evidence) { stageBlockers.DOMAIN_VERIFIED.push(`validation_axis_not_run:${axis}`); continue; }
    if (evidence.status !== 'PASS') stageBlockers.DOMAIN_VERIFIED.push(`validation_axis_${evidence.status.toLowerCase()}:${axis}`);
    if (evidence.sourceRevision !== receipt.projectRevision.id) stageBlockers.DOMAIN_VERIFIED.push(`validation_axis_stale:${axis}`);
    if (evidence.caseCount < 20) stageBlockers.DOMAIN_VERIFIED.push(`validation_axis_case_count:${axis}`);
    const threshold = SAFETY_CRITICAL_AXES.has(axis) ? 10_000 : 9_500;
    if (evidence.accuracyBasisPoints < threshold) stageBlockers.DOMAIN_VERIFIED.push(`validation_axis_accuracy:${axis}`);
    if (evidence.coverageBasisPoints < threshold) stageBlockers.DOMAIN_VERIFIED.push(`validation_axis_coverage:${axis}`);
    if (evidence.falseVerificationCount !== 0) stageBlockers.DOMAIN_VERIFIED.push(`validation_axis_false_verification:${axis}`);
  }
  for (const axis of axes.keys()) if (!(DOMAIN_PRODUCT_AXES[receipt.domain] as readonly string[]).includes(axis)) stageBlockers.DOMAIN_VERIFIED.push(`validation_axis_unknown:${axis}`);
  if (receipt.calculationArtifactSha256s.length === 0) stageBlockers.DOMAIN_VERIFIED.push('calculation_artifact_not_run');
  const campaignIds = new Set<string>();
  for (const campaign of receipt.campaignEvidence) {
    if (campaignIds.has(campaign.campaignId)) stageBlockers.DOMAIN_VERIFIED.push(`campaign_duplicate:${campaign.campaignId}`);
    campaignIds.add(campaign.campaignId);
    if (campaign.status !== 'PASS') stageBlockers.DOMAIN_VERIFIED.push(`campaign_${campaign.status.toLowerCase()}:${campaign.campaignId}`);
    if (campaign.sourceRevision !== receipt.projectRevision.id) stageBlockers.DOMAIN_VERIFIED.push(`campaign_stale:${campaign.campaignId}`);
    if (campaign.repeatCount < 5) stageBlockers.DOMAIN_VERIFIED.push(`campaign_repeat_count:${campaign.campaignId}`);
    if (campaign.falseVerificationCount !== 0) stageBlockers.DOMAIN_VERIFIED.push(`campaign_false_verification:${campaign.campaignId}`);
  }
  if (campaignIds.size < 3) stageBlockers.DOMAIN_VERIFIED.push('campaign_count_below_three');

  if (!bindings.deliverableManifest) stageBlockers.DELIVERY_CANDIDATE.push('deliverable_manifest_not_run');
  else {
    const delivery = validateDomainDeliverableManifest(bindings.deliverableManifest);
    if (!delivery.valid) stageBlockers.DELIVERY_CANDIDATE.push(...delivery.errors.map(value => `deliverable:${value}`));
    else if (receipt.deliverableManifestSha256 !== canonicalDomainDeliverableManifestHash(bindings.deliverableManifest)) stageBlockers.DELIVERY_CANDIDATE.push('deliverable_manifest_hash_mismatch');
    if (bindings.deliverableManifest.domain !== receipt.domain) stageBlockers.DELIVERY_CANDIDATE.push('deliverable_domain_mismatch');
    if (bindings.deliverableManifest.projectRevision !== receipt.projectRevision.id) stageBlockers.DELIVERY_CANDIDATE.push('deliverable_revision_mismatch');
    if (bindings.deliverableManifest.modelContentHash !== receipt.geometryOrModelSha256) stageBlockers.DELIVERY_CANDIDATE.push('deliverable_model_hash_mismatch');
  }
  if (!receipt.deliverableManifestSha256) stageBlockers.DELIVERY_CANDIDATE.push('deliverable_manifest_hash_missing');
  if (!receipt.exchangeReceiptSha256) stageBlockers.DELIVERY_CANDIDATE.push('exchange_receipt_not_run');

  const reviewers = new Set<string>();
  for (const review of receipt.independentReviews) {
    if (reviewers.has(review.reviewerId)) stageBlockers.PRODUCT_QUALIFIED.push(`reviewer_duplicate:${review.reviewerId}`);
    reviewers.add(review.reviewerId);
    if (review.status !== 'APPROVED') stageBlockers.PRODUCT_QUALIFIED.push(`review_${review.status.toLowerCase()}:${review.reviewerId}`);
    if (review.sourceRevision !== receipt.projectRevision.id) stageBlockers.PRODUCT_QUALIFIED.push(`review_stale:${review.reviewerId}`);
  }
  if (reviewers.size < 2) stageBlockers.PRODUCT_QUALIFIED.push('independent_review_count_below_two');
  const pilots = new Set<string>();
  for (const pilot of receipt.pilots) {
    if (pilots.has(pilot.pilotId)) stageBlockers.PRODUCT_QUALIFIED.push(`pilot_duplicate:${pilot.pilotId}`);
    pilots.add(pilot.pilotId);
    if (pilot.status !== 'PASS') stageBlockers.PRODUCT_QUALIFIED.push(`pilot_${pilot.status.toLowerCase()}:${pilot.pilotId}`);
    if (pilot.sourceRevision !== receipt.projectRevision.id) stageBlockers.PRODUCT_QUALIFIED.push(`pilot_stale:${pilot.pilotId}`);
  }
  if (pilots.size < 3) stageBlockers.PRODUCT_QUALIFIED.push('pilot_count_below_three');

  let eligibleState: DomainProductState = 'CONCEPT';
  for (const state of PRODUCT_STATES.slice(1)) {
    if (stageBlockers[state as Exclude<DomainProductState, 'CONCEPT'>].length) break;
    eligibleState = state;
  }
  const claimedIndex = PRODUCT_STATES.indexOf(receipt.claimedState);
  const claimBlockers = unique(PRODUCT_STATES.slice(1, claimedIndex + 1).flatMap(state => stageBlockers[state as Exclude<DomainProductState, 'CONCEPT'>]));
  return {
    structurallyValid: true,
    status: claimBlockers.length ? 'HOLD' : 'PASS',
    eligibleState,
    blockers: claimBlockers,
    canonicalSha256: hashDomainProductReceipt(receipt),
  };
}
