import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { nativeCadSignoffPayload, type NativeCadExpertReview, type NativeCadExpertSignoff } from './nativeCadExpertReview';
import { buildNativeCadExpertReviewPacket, validateNativeCadExpertReviewPacket } from './nativeCadExpertReviewPacket';

const source = { sourceHash: 'a'.repeat(64), artifactHashes: ['b'.repeat(64)], jointDefinitionHash: 'c'.repeat(64), revision: 1 };
const pair = ['domain', 'independent'].map(reviewerId => ({ reviewerId, ...generateKeyPairSync('ed25519') }));
const trusted = Object.fromEntries(pair.map((item, index) => [item.reviewerId, { publicKey: item.publicKey.export({ type: 'spki', format: 'pem' }).toString(), roles: [index ? 'independent-reviewer' as const : 'domain-reviewer' as const] }]));
const makeReview = (packet: ReturnType<typeof buildNativeCadExpertReviewPacket>): NativeCadExpertReview => ({ schema: 'nexyfab.native-cad-expert-review.v1', target: packet.target, signoffs: pair.map((item, index) => { const unsigned = { role: (index ? 'independent-reviewer' : 'domain-reviewer') as NativeCadExpertSignoff['role'], reviewerId: item.reviewerId, decision: 'approved' as const, reviewedAt: '2026-08-01T00:00:00.000Z', targetHash: packet.targetHash }; return { ...unsigned, signature: sign(null, Buffer.from(nativeCadSignoffPayload(unsigned)), item.privateKey).toString('base64') }; }) });

describe('native CAD expert review packet', () => {
  it('builds a non-approving packet and accepts two offline signatures', () => { const packet = buildNativeCadExpertReviewPacket(source, { assembly: 'A', motion: [1, 2] }); expect(packet.signoffPayloadTemplates.every(item => item.decision === null && item.reviewerId === null)).toBe(true); expect(validateNativeCadExpertReviewPacket(packet, makeReview(packet), trusted)).toMatchObject({ approved: true, errors: [] }); });
  it('invalidates the packet after verification geometry changes', () => { const packet = buildNativeCadExpertReviewPacket(source, { assembly: 'A' }), review = makeReview(packet), edited = buildNativeCadExpertReviewPacket(source, { assembly: 'B' }); expect(validateNativeCadExpertReviewPacket(edited, review, trusted)).toMatchObject({ approved: false, errors: expect.arrayContaining(['expert_review_target_mismatch']) }); });
  it('rejects packet target-hash tampering', () => { const packet = buildNativeCadExpertReviewPacket(source, { assembly: 'A' }); packet.targetHash = 'f'.repeat(64); expect(validateNativeCadExpertReviewPacket(packet, makeReview(packet), trusted).errors).toContain('expert_review_packet_hash_mismatch'); });
});
