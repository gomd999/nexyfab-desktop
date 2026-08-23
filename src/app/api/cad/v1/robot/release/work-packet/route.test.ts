import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('@/lib/ai/robot/robotReleaseWorkPacketV2', () => ({ buildRobotReleaseWorkPacketV2: vi.fn(() => ({ schema: 'nexyfab.robot-release-evidence-work-packet.v3', packetHash: 'a'.repeat(64), programHash: 'b'.repeat(64), postIntegrationSha256: 'c'.repeat(64), integrationTargetHash: 'd'.repeat(64), catalogManifestSha256: 'e'.repeat(64), lineageId: 'robot-lineage', revision: 3, preciseReportHash: 'f'.repeat(64), applicationHash: '1'.repeat(64), applicationReceiptHash: '2'.repeat(64), housingSha256: '3'.repeat(64), externalCadRequired: false, sourceBytesEmbedded: false, privateKeysEmbedded: false, releaseReady: false, registryPreflight: { exactCadSignerKeys: 0, manufacturingReviewerKeys: 0, finalReview: { reviewerKeyCount: 0, domainEligibleCount: 0, independentEligibleCount: 0, distinctPairAvailable: false } }, exactCadTask: {}, manufacturingTask: {}, finalReviewTask: { releaseExecutionIncluded: false }, errors: [] })) }));
vi.mock('@/lib/ai/robot/robotReleaseEvidenceAuditV2', () => ({ parseTrustedRobotExactCadKeys: vi.fn(() => ({})) }));
import { POST } from './route';
describe('CAD-independent robot release work packet', () => {
  it('returns an internal exact-CAD work packet with no external CAD requirement', async () => {
    const form = new FormData(); form.set('postIntegration', new File(['{}'], 'post.json'));
    const response = await POST(new NextRequest('http://localhost/api/cad/v1/robot/release/work-packet', { method: 'POST', body: form, headers: { 'x-forwarded-for': 'work-v2' } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, externalCadRequired: false, releaseReady: false, packet: { externalCadRequired: false, registryPreflight: { exactCadSignerKeys: 0 } } });
  });
});
