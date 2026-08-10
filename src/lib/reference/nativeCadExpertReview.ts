import { createHash, createPublicKey, verify } from 'node:crypto';

const SHA256 = /^[a-f0-9]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export interface NativeCadReviewTarget {
  sourceHash: string;
  artifactHashes: string[];
  jointDefinitionHash: string;
  verificationInputHash: string;
  revision: number;
}

export interface NativeCadExpertSignoff {
  role: 'domain-reviewer' | 'independent-reviewer';
  reviewerId: string;
  decision: 'approved' | 'rejected' | 'changes_requested';
  reviewedAt: string;
  targetHash: string;
  signature: string;
}

export interface NativeCadExpertReview {
  schema: 'nexyfab.native-cad-expert-review.v1';
  target: NativeCadReviewTarget;
  signoffs: NativeCadExpertSignoff[];
}

export type NativeCadReviewerRole = NativeCadExpertSignoff['role'];
export type TrustedReviewerKeys = Record<string, { publicKey: string; roles: NativeCadReviewerRole[] }>;

const publicKeyFingerprint = (publicKey: string) => {
  try { return createHash('sha256').update(createPublicKey(publicKey).export({ type: 'spki', format: 'der' })).digest('hex'); }
  catch { return null; }
};

const canonicalTarget = (target: NativeCadReviewTarget) => JSON.stringify({
  artifactHashes: [...target.artifactHashes].sort(),
  jointDefinitionHash: target.jointDefinitionHash,
  revision: target.revision,
  sourceHash: target.sourceHash,
  verificationInputHash: target.verificationInputHash,
});

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonicalize(child)]));
};

export const hashNativeCadVerificationInput = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');

export const hashNativeCadReviewTarget = (target: NativeCadReviewTarget) =>
  createHash('sha256').update(canonicalTarget(target)).digest('hex');

export const nativeCadSignoffPayload = (signoff: Omit<NativeCadExpertSignoff, 'signature'>) =>
  JSON.stringify({ decision: signoff.decision, reviewedAt: signoff.reviewedAt, reviewerId: signoff.reviewerId, role: signoff.role, targetHash: signoff.targetHash });

export function parseTrustedReviewerKeys(raw = process.env.NEXYFAB_CAD_REVIEWER_KEYS): TrustedReviewerKeys {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([id, entry]) => {
      if (!id.trim() || !entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
      const candidate = entry as { publicKey?: unknown; roles?: unknown }, rawRoles = candidate.roles;
      const roles = Array.isArray(rawRoles) ? rawRoles.filter((role): role is NativeCadReviewerRole => role === 'domain-reviewer' || role === 'independent-reviewer') : [];
      if (typeof candidate.publicKey !== 'string' || !Array.isArray(rawRoles) || roles.length !== rawRoles.length || roles.length === 0 || !publicKeyFingerprint(candidate.publicKey)) return [];
      const normalized = createPublicKey(candidate.publicKey).export({ type: 'spki', format: 'pem' }).toString();
      return [[id, { publicKey: normalized, roles: [...new Set(roles)] }]];
    }));
  } catch { return {}; }
}

export function summarizeTrustedReviewerRegistry(trustedKeys: TrustedReviewerKeys) {
  const entries = Object.entries(trustedKeys);
  const domain = entries.filter(([, item]) => item.roles.includes('domain-reviewer')).map(([id]) => id);
  const independent = entries.filter(([, item]) => item.roles.includes('independent-reviewer')).map(([id]) => id);
  const distinctPairAvailable = domain.some(domainId => independent.some(independentId => independentId !== domainId && publicKeyFingerprint(trustedKeys[domainId]!.publicKey) !== publicKeyFingerprint(trustedKeys[independentId]!.publicKey)));
  return { reviewerKeyCount: entries.length, domainEligibleCount: domain.length, independentEligibleCount: independent.length, distinctPairAvailable };
}

export function verifyNativeCadExpertReview(review: NativeCadExpertReview | undefined, expected: NativeCadReviewTarget, trustedKeys: TrustedReviewerKeys) {
  const errors: string[] = [];
  if (!review || review.schema !== 'nexyfab.native-cad-expert-review.v1') return { approved: false, errors: ['expert_review_missing_or_invalid'] };
  const validTarget = SHA256.test(expected.sourceHash) && SHA256.test(expected.jointDefinitionHash) && SHA256.test(expected.verificationInputHash) && expected.artifactHashes.length > 0 && expected.artifactHashes.every(hash => SHA256.test(hash)) && new Set(expected.artifactHashes).size === expected.artifactHashes.length && Number.isInteger(expected.revision) && expected.revision >= 1;
  if (!validTarget) errors.push('expert_review_target_invalid');
  const expectedHash = hashNativeCadReviewTarget(expected);
  try {
    if (!review.target || !Array.isArray(review.target.artifactHashes) || hashNativeCadReviewTarget(review.target) !== expectedHash) errors.push('expert_review_target_mismatch');
  } catch { errors.push('expert_review_target_mismatch'); }
  const roles = ['domain-reviewer', 'independent-reviewer'] as const;
  const rawSignoffs = Array.isArray(review.signoffs) ? review.signoffs : [];
  const selected = roles.map(role => rawSignoffs.filter(item => item && item.role === role));
  if (selected.some(items => items.length !== 1) || rawSignoffs.length !== 2) errors.push('expert_review_dual_signoff_invalid');
  const signoffs = selected.flat();
  if (signoffs.length === 2 && signoffs[0]!.reviewerId === signoffs[1]!.reviewerId) errors.push('expert_reviewers_not_independent');
  if (signoffs.length === 2) {
    const first = trustedKeys[signoffs[0]!.reviewerId], second = trustedKeys[signoffs[1]!.reviewerId];
    const firstFingerprint = first && publicKeyFingerprint(first.publicKey), secondFingerprint = second && publicKeyFingerprint(second.publicKey);
    if (firstFingerprint && firstFingerprint === secondFingerprint) errors.push('expert_reviewer_keys_not_independent');
  }
  for (const signoff of signoffs) {
    if (!signoff || signoff.targetHash !== expectedHash) errors.push(`expert_review_target_mismatch:${signoff?.role ?? 'unknown'}`);
    if (signoff.decision !== 'approved') errors.push(`expert_review_not_approved:${signoff.role}`);
    if (!ISO_DATE.test(signoff.reviewedAt) || Number.isNaN(Date.parse(signoff.reviewedAt)) || Date.parse(signoff.reviewedAt) > Date.now() + 300_000) errors.push(`expert_review_time_invalid:${signoff.role}`);
    const registration = trustedKeys[signoff.reviewerId];
    if (registration && !registration.roles.includes(signoff.role)) errors.push(`expert_review_role_unauthorized:${signoff.role}`);
    try {
      const { signature: _signature, ...unsigned } = signoff;
      if (!registration || !verify(null, Buffer.from(nativeCadSignoffPayload(unsigned)), registration.publicKey, Buffer.from(signoff.signature, 'base64'))) errors.push(`expert_review_signature_invalid:${signoff.role}`);
    } catch { errors.push(`expert_review_signature_invalid:${signoff.role}`); }
  }
  return { approved: errors.length === 0, targetHash: expectedHash, errors: [...new Set(errors)] };
}
