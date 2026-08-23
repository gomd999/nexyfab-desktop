import { createHash, verify } from 'node:crypto';
import {
  cadExportBlockers,
  type CadExportPurpose,
  type CadReleaseStatus,
} from './cad-release-status';
import type { DomainAccuracyDomain } from './ai/domainAccuracyProgram';

export const CAD_ROUNDTRIP_KINDS = ['step', 'ifc', 'bom', 'drawing'] as const;
export type CadRoundtripKind = typeof CAD_ROUNDTRIP_KINDS[number];

export const CAD_RELEASE_PROFILES = ['mechanical', 'spatial'] as const;
export type CadReleaseProfile = typeof CAD_RELEASE_PROFILES[number];

export const CAD_RELEASE_PROFILE_REQUIRED_KINDS: Record<CadReleaseProfile, readonly CadRoundtripKind[]> = {
  mechanical: ['step', 'bom', 'drawing'],
  spatial: ['ifc', 'bom', 'drawing'],
};

export const CAD_ROUNDTRIP_REQUIRED_CHECKS: Record<CadRoundtripKind, readonly string[]> = {
  step: ['geometry', 'topology', 'dimensions'],
  ifc: ['guid', 'spatial_hierarchy', 'placement', 'properties', 'quantities'],
  bom: ['part_identity', 'quantity', 'material'],
  drawing: ['revision', 'views', 'dimensions'],
};

export interface CadRoundtripCheck {
  id: string;
  status: 'pass' | 'fail';
  expected?: number | string;
  actual?: number | string;
  tolerance?: number;
}

export interface CadArtifactRoundtripReceipt {
  schema: 'nexyfab.cad-artifact-roundtrip.v2';
  domain: DomainAccuracyDomain;
  kind: CadRoundtripKind;
  revisionSha256: string;
  exportedArtifactSha256: string;
  reimportedArtifactSha256: string;
  status: 'pass' | 'fail' | 'not_run';
  checks: readonly CadRoundtripCheck[];
  executedAt: string;
}

export interface CadDeliverableReviewPacket {
  schema: 'nexyfab.cad-deliverable-review-packet.v2';
  domain: DomainAccuracyDomain;
  revisionId: string;
  revisionSha256: string;
  roundtripEvidenceSha256: string;
  targetSha256: string;
  requestedStatus: 'expert_approved' | 'manufacturing_or_construction_approved';
}

export type CadDeliverableReviewerRole = 'domain-reviewer' | 'independent-reviewer';
export interface CadDeliverableSignoff {
  schema: 'nexyfab.cad-deliverable-signoff.v2';
  targetSha256: string;
  reviewerId: string;
  role: CadDeliverableReviewerRole;
  decision: 'approved' | 'rejected';
  reviewedAt: string;
  signature: string;
}

export interface TrustedCadDeliverableReviewer {
  publicKey: string;
  roles: readonly CadDeliverableReviewerRole[];
}
export type TrustedCadDeliverableReviewers = Record<string, TrustedCadDeliverableReviewer>;

export interface CadDeliverableReleaseInput {
  schema: 'nexyfab.cad-deliverable-release-input.v2';
  workflowStatus: CadReleaseStatus;
  purpose: CadExportPurpose;
  domain: DomainAccuracyDomain;
  revisionId: string;
  revisionSha256: string;
  roundtrips: readonly CadArtifactRoundtripReceipt[];
  reviewPacket?: CadDeliverableReviewPacket;
  signoffs?: readonly CadDeliverableSignoff[];
}

export interface CadDeliverableReleaseDecision {
  status: 'pass' | 'blocked';
  schema: 'nexyfab.cad-deliverable-release-decision.v2';
  profile: CadReleaseProfile;
  requiredRoundtrips: readonly CadRoundtripKind[];
  workflowStatus: CadReleaseStatus;
  purpose: CadExportPurpose;
  roundtripEvidenceSha256: string;
  validReviewerIds: string[];
  blockers: string[];
}

const SHA256 = /^[a-f0-9]{64}$/;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export function cadReleaseProfileForDomain(domain: DomainAccuracyDomain): CadReleaseProfile {
  return domain === 'mechanical' ? 'mechanical' : 'spatial';
}

/** Digest of the exact submitted receipts. Order in the submitted JSON cannot alter the signed target. */
export function cadRoundtripEvidenceSha256(receipts: readonly CadArtifactRoundtripReceipt[]): string {
  return sha256(canonical([...receipts].sort((a, b) => a.kind.localeCompare(b.kind))));
}

export function cadDeliverableReviewTargetSha256(
  packet: Omit<CadDeliverableReviewPacket, 'targetSha256'>,
): string {
  return sha256(canonical(packet));
}

export function buildCadDeliverableReviewPacket(input: {
  domain: DomainAccuracyDomain;
  revisionId: string;
  revisionSha256: string;
  roundtrips: readonly CadArtifactRoundtripReceipt[];
  requestedStatus: CadDeliverableReviewPacket['requestedStatus'];
}): CadDeliverableReviewPacket {
  const core = {
    schema: 'nexyfab.cad-deliverable-review-packet.v2' as const,
    domain: input.domain,
    revisionId: input.revisionId,
    revisionSha256: input.revisionSha256,
    roundtripEvidenceSha256: cadRoundtripEvidenceSha256(input.roundtrips),
    requestedStatus: input.requestedStatus,
  };
  return { ...core, targetSha256: cadDeliverableReviewTargetSha256(core) };
}

export function cadDeliverableSignoffPayload(
  signoff: Omit<CadDeliverableSignoff, 'signature'>,
): string {
  return canonical(signoff);
}

export function cadRoundtripIssues(
  domain: DomainAccuracyDomain,
  revisionSha256: string,
  receipts: readonly CadArtifactRoundtripReceipt[],
): string[] {
  const issues: string[] = [];
  const profile = cadReleaseProfileForDomain(domain);
  const requiredKinds = CAD_RELEASE_PROFILE_REQUIRED_KINDS[profile];
  if (!SHA256.test(revisionSha256)) issues.push('roundtrip:revision_hash_invalid');
  const grouped = new Map<CadRoundtripKind, CadArtifactRoundtripReceipt[]>();
  for (const receipt of receipts) {
    const values = grouped.get(receipt.kind) ?? [];
    values.push(receipt);
    grouped.set(receipt.kind, values);
  }

  for (const kind of requiredKinds) {
    const matches = grouped.get(kind) ?? [];
    if (matches.length !== 1) {
      issues.push(`roundtrip:${kind}:${matches.length ? 'duplicate' : 'missing'}`);
    }
  }
  for (const [kind, matches] of grouped) {
    if (!CAD_ROUNDTRIP_KINDS.includes(kind)) {
      issues.push(`roundtrip:${kind}:unsupported`);
      continue;
    }
    if (matches.length > 1) issues.push(`roundtrip:${kind}:duplicate`);
    for (const receipt of matches) {
      if (receipt.schema !== 'nexyfab.cad-artifact-roundtrip.v2') issues.push(`roundtrip:${kind}:schema`);
      if (receipt.domain !== domain) issues.push(`roundtrip:${kind}:domain_mismatch`);
      if (receipt.revisionSha256 !== revisionSha256) issues.push(`roundtrip:${kind}:revision_mismatch`);
      if (!SHA256.test(receipt.exportedArtifactSha256) || !SHA256.test(receipt.reimportedArtifactSha256)) {
        issues.push(`roundtrip:${kind}:artifact_hash_invalid`);
      }
      if (receipt.status !== 'pass') issues.push(`roundtrip:${kind}:${receipt.status}`);
      if (!Number.isFinite(Date.parse(receipt.executedAt))) issues.push(`roundtrip:${kind}:executed_at_invalid`);
      const checks = new Map((Array.isArray(receipt.checks) ? receipt.checks : []).map(check => [check.id, check]));
      for (const required of CAD_ROUNDTRIP_REQUIRED_CHECKS[kind]) {
        if (checks.get(required)?.status !== 'pass') issues.push(`roundtrip:${kind}:check:${required}`);
      }
      if ((receipt.checks ?? []).some(check => check.status === 'fail')) issues.push(`roundtrip:${kind}:failed_check_present`);
    }
  }
  return [...new Set(issues)];
}

function reviewIssues(
  input: CadDeliverableReleaseInput,
  evidenceSha256: string,
  trustedReviewers: TrustedCadDeliverableReviewers,
  now: number,
): { issues: string[]; validReviewerIds: string[] } {
  const issues: string[] = [];
  const packet = input.reviewPacket;
  if (!packet) return { issues: ['review:packet_missing'], validReviewerIds: [] };
  if (packet.schema !== 'nexyfab.cad-deliverable-review-packet.v2') issues.push('review:packet_schema');
  if (packet.domain !== input.domain || packet.revisionId !== input.revisionId || packet.revisionSha256 !== input.revisionSha256) {
    issues.push('review:packet_revision_mismatch');
  }
  if (packet.roundtripEvidenceSha256 !== evidenceSha256) issues.push('review:roundtrip_evidence_mismatch');
  const { targetSha256: _target, ...core } = packet;
  if (!SHA256.test(packet.targetSha256) || packet.targetSha256 !== cadDeliverableReviewTargetSha256(core)) {
    issues.push('review:target_hash_invalid');
  }
  if (packet.requestedStatus !== input.workflowStatus) issues.push('review:workflow_status_mismatch');

  const valid = new Map<CadDeliverableReviewerRole, Set<string>>([
    ['domain-reviewer', new Set()],
    ['independent-reviewer', new Set()],
  ]);
  for (const signoff of input.signoffs ?? []) {
    const code = `review:signoff:${signoff.reviewerId || 'missing'}`;
    if (signoff.schema !== 'nexyfab.cad-deliverable-signoff.v2' || signoff.targetSha256 !== packet.targetSha256) {
      issues.push(`${code}:target`);
      continue;
    }
    if (signoff.decision !== 'approved') {
      issues.push(`${code}:rejected`);
      continue;
    }
    const reviewedAt = Date.parse(signoff.reviewedAt);
    if (!Number.isFinite(reviewedAt) || reviewedAt > now || now - reviewedAt > 90 * 86_400_000) {
      issues.push(`${code}:freshness`);
      continue;
    }
    const registration = trustedReviewers[signoff.reviewerId];
    if (!registration?.roles.includes(signoff.role)) {
      issues.push(`${code}:trust`);
      continue;
    }
    let signatureValid = false;
    try {
      const { signature, ...unsigned } = signoff;
      signatureValid = verify(
        null,
        Buffer.from(cadDeliverableSignoffPayload(unsigned)),
        registration.publicKey,
        Buffer.from(signature, 'base64'),
      );
    } catch { signatureValid = false; }
    if (!signatureValid) issues.push(`${code}:signature`);
    else valid.get(signoff.role)!.add(signoff.reviewerId);
  }
  const domain = valid.get('domain-reviewer')!;
  const independent = valid.get('independent-reviewer')!;
  if (!domain.size || !independent.size || [...domain].some(id => independent.has(id))) issues.push('review:dual_independent_approval_missing');
  return { issues, validReviewerIds: [...new Set([...domain, ...independent])].sort() };
}

/**
 * One fail-closed decision used by API and exporters. Expert/manufacturing
 * status is never trusted as a label alone: the exact revision, every
 * domain-required roundtrip and two distinct registered signatures must agree.
 */
export function evaluateCadDeliverableRelease(
  input: CadDeliverableReleaseInput,
  trustedReviewers: TrustedCadDeliverableReviewers = {},
  now = Date.now(),
): CadDeliverableReleaseDecision {
  const profile = cadReleaseProfileForDomain(input.domain);
  const evidenceSha256 = cadRoundtripEvidenceSha256(input.roundtrips);
  const blockers = [...cadExportBlockers(input.workflowStatus, input.purpose)];
  if (input.schema !== 'nexyfab.cad-deliverable-release-input.v2') blockers.push('release:input_schema');
  let validReviewerIds: string[] = [];
  if (input.workflowStatus === 'expert_approved' || input.workflowStatus === 'manufacturing_or_construction_approved') {
    const approval = reviewIssues(input, evidenceSha256, trustedReviewers, now);
    blockers.push(...approval.issues);
    validReviewerIds = approval.validReviewerIds;
  }
  if (input.purpose === 'manufacturing_or_construction' || input.workflowStatus === 'manufacturing_or_construction_approved') {
    blockers.push(...cadRoundtripIssues(input.domain, input.revisionSha256, input.roundtrips));
  }
  const uniqueBlockers = [...new Set(blockers)];
  return {
    schema: 'nexyfab.cad-deliverable-release-decision.v2',
    status: uniqueBlockers.length ? 'blocked' : 'pass',
    profile,
    requiredRoundtrips: CAD_RELEASE_PROFILE_REQUIRED_KINDS[profile],
    workflowStatus: input.workflowStatus,
    purpose: input.purpose,
    roundtripEvidenceSha256: evidenceSha256,
    validReviewerIds,
    blockers: uniqueBlockers,
  };
}

export function parseTrustedCadDeliverableReviewers(value: string | undefined): TrustedCadDeliverableReviewers {
  if (!value?.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as TrustedCadDeliverableReviewers
      : {};
  } catch { return {}; }
}
