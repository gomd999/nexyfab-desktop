import { generateKeyPairSync, sign } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyAdmin } from '@/lib/admin-auth';
import { nativeCadSignoffPayload, type NativeCadExpertSignoff } from '@/lib/reference/nativeCadExpertReview';
import { buildNativeCadExpertReviewPacket } from '@/lib/reference/nativeCadExpertReviewPacket';
import { GET, POST } from './route';

vi.mock('@/lib/admin-auth', () => ({ verifyAdmin: vi.fn() }));
const reviewers = ['domain', 'independent'].map(reviewerId => ({ reviewerId, ...generateKeyPairSync('ed25519') }));
const trusted = Object.fromEntries(reviewers.map((item, index) => [item.reviewerId, { publicKey: item.publicKey.export({ type: 'spki', format: 'pem' }).toString(), roles: [index ? 'independent-reviewer' : 'domain-reviewer'] }]));
const packet = buildNativeCadExpertReviewPacket({ sourceHash: 'a'.repeat(64), artifactHashes: ['b'.repeat(64)], jointDefinitionHash: 'c'.repeat(64), revision: 1 }, { state: { parts: [] }, animation: { tracks: [] }, localBoxes: {}, featureTrees: {} });
const review = () => ({ schema: 'nexyfab.native-cad-expert-review.v1' as const, target: packet.target, signoffs: reviewers.map((item, index) => { const unsigned = { role: (index ? 'independent-reviewer' : 'domain-reviewer') as NativeCadExpertSignoff['role'], reviewerId: item.reviewerId, decision: 'approved' as const, reviewedAt: '2026-08-01T00:00:00.000Z', targetHash: packet.targetHash }; return { ...unsigned, signature: sign(null, Buffer.from(nativeCadSignoffPayload(unsigned)), item.privateKey).toString('base64') }; }) });
const request = (body: unknown) => new NextRequest('http://localhost/api/admin/native-cad-workers/expert-review', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `native-review-${Math.random()}` }, body: JSON.stringify(body) });
const streamedRequest = (body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) => new NextRequest('http://localhost/api/admin/native-cad-workers/expert-review', {
  method: 'POST', body, headers: { 'content-type': 'application/json', 'x-forwarded-for': `native-review-${Math.random()}`, ...headers }, duplex: 'half',
} as unknown as NonNullable<ConstructorParameters<typeof NextRequest>[1]>);

describe('admin native CAD expert review API', () => {
  beforeEach(() => { vi.mocked(verifyAdmin).mockResolvedValue(true); process.env.NEXYFAB_CAD_REVIEWER_KEYS = JSON.stringify(trusted); });
  it('requires administrator authentication', async () => { vi.mocked(verifyAdmin).mockResolvedValue(false); expect(await (await POST(request({ packet, review: review() }))).json()).toMatchObject({ ok: false, error: 'Forbidden' }); });
  it('returns only non-identifying role readiness counts', async () => { const response = await GET(new NextRequest('http://localhost/api/admin/native-cad-workers/expert-review', { headers: { 'x-forwarded-for': 'registry-readiness' } })); const json = await response.json(); expect(json).toEqual({ ok: true, registry: { reviewerKeyCount: 2, domainEligibleCount: 1, independentEligibleCount: 1, distinctPairAvailable: true }, exposesReviewerIdentity: false, exposesPublicKeys: false }); expect(JSON.stringify(json)).not.toContain('PUBLIC KEY'); expect(JSON.stringify(json)).not.toContain('domain"'); });
  it('validates two role-authorized offline signatures without release side effects', async () => expect(await (await POST(request({ packet, review: review() }))).json()).toMatchObject({ ok: true, validation: { approved: true, trustedReviewerKeyCount: 2, errors: [] }, releaseSideEffects: false }));
  it('fails closed when the immutable packet hash is changed', async () => { const tampered = { ...packet, targetHash: 'f'.repeat(64) }; expect(await (await POST(request({ packet: tampered, review: review() }))).json()).toMatchObject({ ok: true, validation: { approved: false, errors: expect.arrayContaining(['expert_review_packet_hash_mismatch']) }, releaseSideEffects: false }); });
  it('does not throw on malformed packet input', async () => expect(await (await POST(request({ packet: {}, review: {} }))).json()).toMatchObject({ ok: true, validation: { approved: false, errors: ['expert_review_packet_invalid'] } }));
  it('cancels declared and measured oversized expert review streams', async () => {
    let declaredCancelled = false;
    const declared = new ReadableStream<Uint8Array>({ cancel() { declaredCancelled = true; } });
    const declaredResponse = await POST(streamedRequest(declared, { 'content-length': String(512 * 1024 + 1) }));
    expect(declaredResponse.status).toBe(413);
    expect(declaredCancelled).toBe(true);

    let measuredCancelled = false;
    const measured = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x7b]));
        controller.enqueue(new Uint8Array(512 * 1024));
      },
      cancel() { measuredCancelled = true; },
    });
    const measuredResponse = await POST(streamedRequest(measured, { 'content-length': '1' }));
    expect(measuredResponse.status).toBe(413);
    expect(measuredCancelled).toBe(true);
  });
  it('rejects invalid UTF-8 before expert packet or signature validation', async () => {
    const response = await POST(new NextRequest('http://localhost/api/admin/native-cad-workers/expert-review', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `native-review-${Math.random()}` }, body: new Uint8Array([0xff]),
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'Invalid JSON' });
  });
});
