import { describe, expect, it } from 'vitest';
import { nativeCadSignoffPayload } from './nativeCadExpertReview';
import { buildNativeCadUnsignedSignoff, parseNativeCadSignatureResponse, serializeNativeCadUnsignedSignoff } from './nativeCadReviewClient';

describe('native CAD browser signoff payload', () => {
  it('serializes byte-for-byte like the server verifier', () => {
    const signoff = buildNativeCadUnsignedSignoff({ decision: 'approved', reviewedAt: '2026-08-09T00:00:00.000Z', reviewerId: ' reviewer-1 ', role: 'domain-reviewer', targetHash: 'a'.repeat(64) });
    expect(serializeNativeCadUnsignedSignoff(signoff)).toBe(nativeCadSignoffPayload(signoff));
    expect(signoff.reviewerId).toBe('reviewer-1');
  });
  it('imports only a role/target/payload-bound Ed25519 response', () => {
    const unsigned = buildNativeCadUnsignedSignoff({ decision: 'approved', reviewedAt: '2026-08-01T00:00:00.000Z', reviewerId: 'reviewer-1', role: 'domain-reviewer', targetHash: 'a'.repeat(64) });
    const response = { schema: 'nexyfab.native-cad-expert-signature-response.v1', signoff: { ...unsigned, signature: 'A'.repeat(86) + '==' } };
    expect(parseNativeCadSignatureResponse(response, { role: 'domain-reviewer', targetHash: 'a'.repeat(64), unsigned })).toMatchObject({ ok: true });
    expect(parseNativeCadSignatureResponse(response, { role: 'independent-reviewer', targetHash: 'a'.repeat(64) })).toEqual({ ok: false, error: 'signature_response_role_mismatch' });
    expect(parseNativeCadSignatureResponse(response, { role: 'domain-reviewer', targetHash: 'b'.repeat(64) })).toEqual({ ok: false, error: 'signature_response_target_mismatch' });
    expect(parseNativeCadSignatureResponse({ ...response, signoff: { ...response.signoff, decision: 'rejected' } }, { role: 'domain-reviewer', targetHash: 'a'.repeat(64), unsigned })).toEqual({ ok: false, error: 'signature_response_payload_mismatch' });
  });
});
