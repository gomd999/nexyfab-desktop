export type NativeCadClientReviewRole = 'domain-reviewer' | 'independent-reviewer';
export type NativeCadClientReviewDecision = 'approved' | 'rejected' | 'changes_requested';

export interface NativeCadUnsignedSignoff {
  decision: NativeCadClientReviewDecision;
  reviewedAt: string;
  reviewerId: string;
  role: NativeCadClientReviewRole;
  targetHash: string;
}

export interface NativeCadSignatureResponse {
  schema: 'nexyfab.native-cad-expert-signature-response.v1';
  signoff: NativeCadUnsignedSignoff & { signature: string };
}

export function buildNativeCadUnsignedSignoff(input: { decision: NativeCadClientReviewDecision; reviewedAt: string; reviewerId: string; role: NativeCadClientReviewRole; targetHash: string }): NativeCadUnsignedSignoff {
  return { decision: input.decision, reviewedAt: input.reviewedAt, reviewerId: input.reviewerId.trim(), role: input.role, targetHash: input.targetHash };
}

export const serializeNativeCadUnsignedSignoff = (signoff: NativeCadUnsignedSignoff) =>
  JSON.stringify({ decision: signoff.decision, reviewedAt: signoff.reviewedAt, reviewerId: signoff.reviewerId, role: signoff.role, targetHash: signoff.targetHash });

const SHA256 = /^[a-f0-9]{64}$/;
const ED25519_BASE64 = /^[A-Za-z0-9+/]{86}==$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export function parseNativeCadSignatureResponse(value: unknown, expected: { role: NativeCadClientReviewRole; targetHash: string; unsigned?: NativeCadUnsignedSignoff }): { ok: true; response: NativeCadSignatureResponse } | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'signature_response_invalid' };
  const raw = value as { schema?: unknown; signoff?: unknown };
  if (raw.schema !== 'nexyfab.native-cad-expert-signature-response.v1' || !raw.signoff || typeof raw.signoff !== 'object' || Array.isArray(raw.signoff)) return { ok: false, error: 'signature_response_invalid' };
  const item = raw.signoff as Record<string, unknown>;
  if (item.role !== expected.role) return { ok: false, error: 'signature_response_role_mismatch' };
  if (item.targetHash !== expected.targetHash || !SHA256.test(String(item.targetHash))) return { ok: false, error: 'signature_response_target_mismatch' };
  if (item.decision !== 'approved' && item.decision !== 'rejected' && item.decision !== 'changes_requested') return { ok: false, error: 'signature_response_decision_invalid' };
  if (typeof item.reviewerId !== 'string' || !item.reviewerId.trim() || item.reviewerId !== item.reviewerId.trim()) return { ok: false, error: 'signature_response_reviewer_invalid' };
  if (typeof item.reviewedAt !== 'string' || !ISO_DATE.test(item.reviewedAt) || Number.isNaN(Date.parse(item.reviewedAt))) return { ok: false, error: 'signature_response_time_invalid' };
  if (typeof item.signature !== 'string' || !ED25519_BASE64.test(item.signature)) return { ok: false, error: 'signature_response_signature_invalid' };
  const signoff = buildNativeCadUnsignedSignoff({ decision: item.decision, reviewedAt: item.reviewedAt, reviewerId: item.reviewerId, role: expected.role, targetHash: expected.targetHash });
  if (expected.unsigned && serializeNativeCadUnsignedSignoff(signoff) !== serializeNativeCadUnsignedSignoff(expected.unsigned)) return { ok: false, error: 'signature_response_payload_mismatch' };
  return { ok: true, response: { schema: raw.schema, signoff: { ...signoff, signature: item.signature } } };
}
