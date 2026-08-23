import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { buildRobotVerifiedSystemsReleaseAuditFixture } from '@/lib/ai/robot/robotVerifiedSystemsReleaseAudit.testFixture';
import { POST } from './route';

function request(fixture: ReturnType<typeof buildRobotVerifiedSystemsReleaseAuditFixture> | null, ip: string) {
  const form = new FormData();
  if (fixture) {
    for (const [key, bytes] of Object.entries(fixture.files)) form.set(key, new File([new Uint8Array(bytes)], `${key}.json`));
    for (const [name, bytes] of fixture.artifacts) form.append('artifact', new File([new Uint8Array(bytes)], name));
  }
  return new NextRequest('http://localhost/api/cad/v1/robot/release/verified-audit', { method: 'POST', body: form, headers: { 'x-forwarded-for': ip } });
}

describe('CAD v1 robot Verified Systems release audit', () => {
  it('creates a final-review target from the complete trusted chain without releasing', async () => {
    const fixture = buildRobotVerifiedSystemsReleaseAuditFixture();
    vi.stubEnv('NEXYFAB_ROBOT_EXACT_CAD_SIGNER_KEYS', JSON.stringify(fixture.trusted.exactCad));
    vi.stubEnv('NEXYFAB_ROBOT_MANUFACTURING_REVIEWER_KEYS', JSON.stringify(fixture.trusted.manufacturing));
    vi.stubEnv('NEXYFAB_ROBOT_PHYSICAL_VALIDATION_KEYS', JSON.stringify(fixture.trusted.physical));
    vi.stubEnv('NEXYFAB_ROBOT_VERIFIED_AUDIT_SIGNER', JSON.stringify(fixture.auditSigner));
    const response = await POST(request(fixture, 'robot-verified-audit-ok'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, releaseReady: false, releaseExecuted: false, finalReviewRequired: true, cadModified: false, quoteOrRfqSideEffects: false, report: { schema: 'nexyfab.robot-verified-systems-release-audit.v2', status: 'ready_for_final_review', physicalValidationValid: true, auditIssuerId: 'verified-auditor-1', signature: expect.any(String), releaseReady: false, releaseExecuted: false } });
    vi.unstubAllEnvs();
  });

  it('fails closed without trusted identities', async () => {
    const fixture = buildRobotVerifiedSystemsReleaseAuditFixture();
    vi.stubEnv('NEXYFAB_ROBOT_EXACT_CAD_SIGNER_KEYS', '');
    vi.stubEnv('NEXYFAB_ROBOT_MANUFACTURING_REVIEWER_KEYS', '');
    vi.stubEnv('NEXYFAB_ROBOT_PHYSICAL_VALIDATION_KEYS', '');
    vi.stubEnv('NEXYFAB_ROBOT_VERIFIED_AUDIT_SIGNER', '');
    const response = await POST(request(fixture, 'robot-verified-audit-untrusted'));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, releaseReady: false, releaseExecuted: false, report: { status: 'not_ready' } });
    vi.unstubAllEnvs();
  });

  it('requires the complete evidence and artifact set', async () => {
    expect((await POST(request(null, 'robot-verified-audit-empty'))).status).toBe(400);
  });
});
