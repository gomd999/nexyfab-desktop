import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/ai/robot/robotReleaseEvidenceAuditV2', () => ({
  parseTrustedRobotExactCadKeys: vi.fn(() => ({})),
  auditRobotReleaseEvidenceV2: vi.fn((_post, exact, manufacturing) => ({
    schema: 'nexyfab.robot-release-evidence-audit.v3', status: exact && manufacturing ? 'ready_for_final_review' : 'not_ready',
    releaseTargetHash: exact && manufacturing ? 'a'.repeat(64) : null, programHash: 'b'.repeat(64),
    postIntegrationSha256: 'c'.repeat(64), exactCadEvidenceSha256: exact ? 'd'.repeat(64) : null,
    manufacturingEvidenceSha256: manufacturing ? 'e'.repeat(64) : null,
    exactCadEvidenceValid: Boolean(exact), manufacturingEvidenceValid: Boolean(manufacturing),
    externalCadRequired: false, releaseReady: false, errors: exact && manufacturing ? [] : ['missing'],
    blockers: exact && manufacturing ? ['final_release_dual_signoff_required'] : ['nexyfab_exact_cad_evidence_required'],
    sideEffects: { persisted: false, cadModified: false, quoteCreated: false, rfqSent: false },
  })),
}));
import { POST } from './route';

function request(withEvidence: boolean, ip: string) {
  const form = new FormData(); form.set('postIntegration', new File(['{}'], 'post.json'));
  if (withEvidence) { form.set('exactCadEvidence', new File(['{}'], 'exact.json')); form.set('manufacturingEvidence', new File(['{}'], 'manufacturing.json')); }
  return new NextRequest('http://localhost/api/cad/v1/robot/release/audit', { method: 'POST', body: form, headers: { 'x-forwarded-for': ip } });
}

describe('CAD-independent robot release audit route', () => {
  it('accepts NexyFab exact CAD plus manufacturing evidence', async () => {
    const response = await POST(request(true, 'audit-ok'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, externalCadRequired: false, releaseReady: false, report: { exactCadEvidenceValid: true } });
  });
  it('audits missing evidence without inventing a pass', async () => {
    const response = await POST(request(false, 'audit-gap'));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, externalCadRequired: false });
  });
});
