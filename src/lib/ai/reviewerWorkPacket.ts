import { createHash } from 'node:crypto';

export const REVIEWER_WORK_PACKET_SCHEMA = 'nexyfab.reviewer-work-packet.v1' as const;
export const REVIEWER_ATTESTATION_SCHEMA = 'nexyfab.reviewer-attestation.v1' as const;

export const REVIEW_PACKET_DOMAINS = [
  'architecture',
  'building',
  'interior',
  'civil',
  'landscape',
  'mechanical',
] as const;
export type ReviewPacketDomain = typeof REVIEW_PACKET_DOMAINS[number];

export const REVIEWER_ROLES = [
  'domain-expert',
  'independent-validator',
  'manufacturing-inspector',
  'licensed-authority',
] as const;
export type ReviewerRole = typeof REVIEWER_ROLES[number];
export type ReviewVerdict = 'PASS' | 'FAIL' | 'PENDING';

export interface ReviewerRoleRequirement {
  role: ReviewerRole;
  independentFromBuild: true;
}

export interface ReviewerWorkPacketTarget {
  schema: typeof REVIEWER_WORK_PACKET_SCHEMA;
  packetId: string;
  caseId: string;
  domain: ReviewPacketDomain;
  sourceInputSha256: string;
  holdoutSet: {
    id: string;
    sha256: string;
    sourceKind: 'external-holdout' | 'licensed-customer' | 'expert-authored' | 'internal-template';
    independentFromTrainingAndReference: boolean;
  };
  revision: {
    id: string;
    sha256: string;
  };
  artifactSha256: string[];
  evidenceRootSha256: string;
}

export interface ReviewerAttestation {
  schema: typeof REVIEWER_ATTESTATION_SCHEMA;
  reviewerId: string;
  role: ReviewerRole;
  independentFromBuild: boolean;
  verdict: ReviewVerdict;
  reviewedAt: string;
  targetPacketSha256: string;
  revisionSha256: string;
  attestationRef: string | null;
  signatureRef: `sha256:${string}` | null;
  signedPayloadSha256: string;
}

/**
 * Verification output from a trusted external signature verifier.  This is
 * deliberately outside the packet: a reviewer cannot make a PASS releasable
 * by setting a boolean on their own attestation.
 */
export interface TrustedVerificationRecord {
  reviewerId: string;
  signatureRef: string;
  targetPacketSha256: string;
  revisionSha256: string;
  verificationReceiptSha256: string;
  verifierId: string;
}

export interface ReviewerWorkPacket {
  schema: typeof REVIEWER_WORK_PACKET_SCHEMA;
  issuedAt: string;
  target: ReviewerWorkPacketTarget;
  targetSha256: string;
  requiredReviewers: ReviewerRoleRequirement[];
  attestations: ReviewerAttestation[];
}

export interface BuildReviewerWorkPacketInput {
  packetId: string;
  caseId: string;
  domain: ReviewPacketDomain;
  sourceInputSha256: string;
  holdoutSet: ReviewerWorkPacketTarget['holdoutSet'];
  revision: ReviewerWorkPacketTarget['revision'];
  artifactSha256: readonly string[];
  evidenceRootSha256: string;
  issuedAt: string;
  requiredReviewers?: readonly ReviewerRoleRequirement[];
}

export interface ReviewerWorkPacketValidation {
  valid: boolean;
  releaseReady: boolean;
  verdict: ReviewVerdict;
  issues: string[];
  targetSha256: string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const SIGNATURE_REF = /^sha256:[a-f0-9]{64}$/;
const ISO_DATE = (value: string): boolean => Number.isFinite(Date.parse(value));

/** Deterministic JSON used for hashes and external reviewer signatures. */
export function canonicalReviewPacket(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalReviewPacket).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalReviewPacket(item)}`)
      .join(',')}}`;
  }
  const rendered = JSON.stringify(value);
  if (rendered === undefined) throw new TypeError('review_packet_value_not_json_serializable');
  return rendered;
}

export function sha256ReviewPacket(value: unknown): string {
  return createHash('sha256').update(canonicalReviewPacket(value)).digest('hex');
}

function targetFromInput(input: BuildReviewerWorkPacketInput): ReviewerWorkPacketTarget {
  return {
    schema: REVIEWER_WORK_PACKET_SCHEMA,
    packetId: input.packetId,
    caseId: input.caseId,
    domain: input.domain,
    sourceInputSha256: input.sourceInputSha256,
    holdoutSet: {
      ...input.holdoutSet,
      id: input.holdoutSet.id,
      sha256: input.holdoutSet.sha256,
    },
    revision: { id: input.revision.id, sha256: input.revision.sha256 },
    artifactSha256: [...input.artifactSha256].sort(),
    evidenceRootSha256: input.evidenceRootSha256,
  };
}

export function buildReviewerWorkPacket(input: BuildReviewerWorkPacketInput): ReviewerWorkPacket {
  const target = targetFromInput(input);
  return {
    schema: REVIEWER_WORK_PACKET_SCHEMA,
    issuedAt: input.issuedAt,
    target,
    targetSha256: sha256ReviewPacket(target),
    requiredReviewers: [...(input.requiredReviewers ?? [
      { role: 'domain-expert', independentFromBuild: true },
      { role: 'independent-validator', independentFromBuild: true },
    ])],
    // Deliberately empty: a work packet requests review; it never invents approval.
    attestations: [],
  };
}

export function reviewerAttestationPayload(attestation: ReviewerAttestation): Omit<ReviewerAttestation, 'signedPayloadSha256'> {
  const { signedPayloadSha256: _signedPayloadSha256, ...payload } = attestation;
  return payload;
}

export function reviewerAttestationPayloadSha256(attestation: ReviewerAttestation): string {
  return sha256ReviewPacket(reviewerAttestationPayload(attestation));
}

function validRequiredReviewers(required: readonly ReviewerRoleRequirement[]): boolean {
  const roles = required.map(item => item.role);
  return required.length > 0
    && new Set(roles).size === roles.length
    && required.every(item => REVIEWER_ROLES.includes(item.role) && item.independentFromBuild === true);
}

/**
 * Fail-closed validation for a packet and any externally supplied attestations.
 * `currentRevisionSha256` is supplied by the caller at review time so stale
 * reviews cannot be promoted after a project edit.
 */
export function validateReviewerWorkPacket(
  packet: ReviewerWorkPacket,
  options: {
    currentRevisionSha256?: string;
    trustedVerificationRecords?: readonly TrustedVerificationRecord[];
    now?: number;
  } = {},
): ReviewerWorkPacketValidation {
  try {
    return validateReviewerWorkPacketInternal(packet, options);
  } catch {
    // API/evidence inputs are untrusted runtime data. A malformed packet must
    // become an invalid pending result, never a validator exception or PASS.
    return {
      valid: false,
      releaseReady: false,
      verdict: 'PENDING',
      issues: ['packet_runtime_shape_invalid'],
      targetSha256: '',
    };
  }
}

function validateReviewerWorkPacketInternal(
  packet: ReviewerWorkPacket,
  options: {
    currentRevisionSha256?: string;
    trustedVerificationRecords?: readonly TrustedVerificationRecord[];
    now?: number;
  },
): ReviewerWorkPacketValidation {
  const issues: string[] = [];
  const targetSha256 = sha256ReviewPacket(packet.target);
  const now = options.now ?? Date.now();
  if (packet.schema !== REVIEWER_WORK_PACKET_SCHEMA) issues.push('packet_schema_invalid');
  if (!ISO_DATE(packet.issuedAt)) issues.push('issued_at_invalid');
  else if (Date.parse(packet.issuedAt) > now) issues.push('issued_at_in_future');
  if (packet.targetSha256 !== targetSha256) issues.push('packet_target_tampered');
  if (!packet.target.packetId.trim()) issues.push('packet_id_missing');
  if (!packet.target.caseId.trim()) issues.push('case_id_missing');
  if (!REVIEW_PACKET_DOMAINS.includes(packet.target.domain)) issues.push('domain_invalid');
  if (!SHA256.test(packet.target.sourceInputSha256)) issues.push('source_input_hash_invalid');
  if (!packet.target.holdoutSet.id.trim()) issues.push('holdout_set_id_missing');
  if (!SHA256.test(packet.target.holdoutSet.sha256)) issues.push('holdout_set_hash_invalid');
  if (packet.target.holdoutSet.sourceKind === 'internal-template') issues.push('internal_template_not_independent_holdout');
  if (packet.target.holdoutSet.independentFromTrainingAndReference !== true) issues.push('holdout_independence_unproven');
  if (!packet.target.revision.id.trim()) issues.push('revision_id_missing');
  if (!SHA256.test(packet.target.revision.sha256)) issues.push('revision_hash_invalid');
  if (options.currentRevisionSha256 !== undefined && options.currentRevisionSha256 !== packet.target.revision.sha256) {
    issues.push('stale_revision');
  }
  if (!SHA256.test(packet.target.evidenceRootSha256)) issues.push('evidence_root_hash_invalid');
  if (!packet.target.artifactSha256.length) issues.push('artifact_hashes_missing');
  if (packet.target.artifactSha256.some(hash => !SHA256.test(hash))) issues.push('artifact_hash_invalid');
  if (new Set(packet.target.artifactSha256).size !== packet.target.artifactSha256.length) issues.push('artifact_hash_duplicate');
  if (!validRequiredReviewers(packet.requiredReviewers)) issues.push('reviewer_requirements_invalid');

  const trustedRecords = options.trustedVerificationRecords ?? [];
  const trustedRecordKeys = new Set<string>();
  for (const record of trustedRecords) {
    const label = record?.reviewerId || 'unknown';
    if (!record || typeof record !== 'object') {
      issues.push('verification_record_shape_invalid');
      continue;
    }
    if (!record.reviewerId.trim() || !record.verifierId.trim()) issues.push(`verification_identity_missing:${label}`);
    if (!SIGNATURE_REF.test(record.signatureRef)) issues.push(`verification_signature_ref_invalid:${label}`);
    if (!SHA256.test(record.targetPacketSha256)) issues.push(`verification_target_hash_invalid:${label}`);
    if (!SHA256.test(record.revisionSha256)) issues.push(`verification_revision_hash_invalid:${label}`);
    if (!SHA256.test(record.verificationReceiptSha256)) issues.push(`verification_receipt_hash_invalid:${label}`);
    if (record.targetPacketSha256 !== targetSha256) issues.push(`verification_target_mismatch:${label}`);
    if (record.revisionSha256 !== packet.target.revision.sha256) issues.push(`verification_revision_mismatch:${label}`);
    const key = `${record.reviewerId}\0${record.signatureRef}\0${record.targetPacketSha256}\0${record.revisionSha256}`;
    if (trustedRecordKeys.has(key)) issues.push(`duplicate_verification_record:${label}`);
    trustedRecordKeys.add(key);
  }

  const seenReviewers = new Set<string>();
  const seenRoles = new Set<ReviewerRole>();
  for (const attestation of packet.attestations) {
    const label = attestation.reviewerId || 'unknown';
    if (attestation.schema !== REVIEWER_ATTESTATION_SCHEMA) issues.push(`attestation_schema_invalid:${label}`);
    if (!attestation.reviewerId.trim()) issues.push('reviewer_identity_missing');
    if (seenReviewers.has(attestation.reviewerId)) issues.push(`duplicate_reviewer:${label}`);
    seenReviewers.add(attestation.reviewerId);
    if (seenRoles.has(attestation.role)) issues.push(`duplicate_reviewer_role:${attestation.role}`);
    seenRoles.add(attestation.role);
    if (!REVIEWER_ROLES.includes(attestation.role)) issues.push(`reviewer_role_invalid:${label}`);
    if (attestation.independentFromBuild !== true) issues.push(`reviewer_not_independent:${label}`);
    if (!['PASS', 'FAIL', 'PENDING'].includes(attestation.verdict)) issues.push(`verdict_invalid:${label}`);
    if (!ISO_DATE(attestation.reviewedAt)) issues.push(`review_date_invalid:${label}`);
    if (attestation.targetPacketSha256 !== targetSha256) issues.push(`attestation_target_mismatch:${label}`);
    if (attestation.revisionSha256 !== packet.target.revision.sha256) issues.push(`attestation_revision_mismatch:${label}`);
    if (attestation.signedPayloadSha256 !== reviewerAttestationPayloadSha256(attestation)) issues.push(`attestation_tampered:${label}`);
    if (attestation.verdict === 'PASS') {
      if (!attestation.attestationRef?.trim()) issues.push(`pass_attestation_missing:${label}`);
      if (!attestation.signatureRef || !SIGNATURE_REF.test(attestation.signatureRef)) issues.push(`pass_signature_missing:${label}`);
      // Missing external verification intentionally adds no error: the work
      // packet remains a valid request, but its verdict stays PENDING.
    }
    if (ISO_DATE(attestation.reviewedAt) && Date.parse(attestation.reviewedAt) > now) issues.push(`review_date_in_future:${label}`);
    if (ISO_DATE(packet.issuedAt) && ISO_DATE(attestation.reviewedAt) && Date.parse(attestation.reviewedAt) < Date.parse(packet.issuedAt)) {
      issues.push(`review_before_packet_issued:${label}`);
    }
  }

  const requiredRoles = new Set(packet.requiredReviewers.map(item => item.role));
  const passes = packet.attestations.filter(item => item.verdict === 'PASS' && requiredRoles.has(item.role) && trustedRecords.some(record =>
    record?.reviewerId === item.reviewerId
    && record.signatureRef === item.signatureRef
    && record.targetPacketSha256 === targetSha256
    && record.revisionSha256 === packet.target.revision.sha256
    && SHA256.test(record.verificationReceiptSha256)
    && Boolean(record.verifierId?.trim()),
  ));
  const hasFail = packet.attestations.some(item => item.verdict === 'FAIL');
  const allRequiredPassed = packet.requiredReviewers.every(requirement => passes.some(item => item.role === requirement.role));
  const verdict: ReviewVerdict = hasFail ? 'FAIL' : allRequiredPassed ? 'PASS' : 'PENDING';
  const valid = issues.length === 0;
  const currentRevisionConfirmed = options.currentRevisionSha256 === packet.target.revision.sha256;
  return { valid, releaseReady: valid && verdict === 'PASS' && currentRevisionConfirmed, verdict, issues, targetSha256 };
}
