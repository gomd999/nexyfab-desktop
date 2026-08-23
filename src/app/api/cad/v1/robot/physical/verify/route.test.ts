import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { buildRobotPhysicalValidationReceiptFixture } from '@/lib/ai/robot/robotPhysicalValidationReceipt.testFixture';
import { POST } from './route';

function request(fixture: ReturnType<typeof buildRobotPhysicalValidationReceiptFixture> | null, ip: string) {
  const form = new FormData();
  if (fixture) {
    for (const [key, bytes] of Object.entries(fixture.upstream)) form.set(key, new File([new Uint8Array(bytes)], `${key}.json`));
    form.set('receipt', new File([new Uint8Array(fixture.receiptBytes)], 'receipt.json'));
    for (const [name, bytes] of fixture.artifacts) form.append('artifact', new File([new Uint8Array(bytes)], name));
  }
  return new NextRequest('http://localhost/api/cad/v1/robot/physical/verify', { method: 'POST', body: form, headers: { 'x-forwarded-for': ip } });
}

describe('CAD v1 robot physical validation verification', () => {
  it('verifies trusted dual-signed physical evidence but never executes final release', async () => {
    const fixture = buildRobotPhysicalValidationReceiptFixture();
    vi.stubEnv('NEXYFAB_ROBOT_PHYSICAL_VALIDATION_KEYS', JSON.stringify(fixture.trustedKeys));
    const response = await POST(request(fixture, 'robot-physical-ok'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, releaseReady: false, finalReleaseReviewRequired: true, cadModified: false, quoteOrRfqSideEffects: false, report: { physicalValidationReady: true, dualSignatureVerified: true, finalReleaseReviewRequired: true, releaseReady: false } });
    vi.unstubAllEnvs();
  });

  it('returns 422 without trusted physical-validation identities', async () => {
    const fixture = buildRobotPhysicalValidationReceiptFixture();
    vi.stubEnv('NEXYFAB_ROBOT_PHYSICAL_VALIDATION_KEYS', '');
    const response = await POST(request(fixture, 'robot-physical-untrusted'));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, releaseReady: false, report: { physicalValidationReady: false, dualSignatureVerified: false } });
    vi.unstubAllEnvs();
  });

  it('requires the complete upstream and raw artifact chain', async () => {
    expect((await POST(request(null, 'robot-physical-empty'))).status).toBe(400);
  });
});
