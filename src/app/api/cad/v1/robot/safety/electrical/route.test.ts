import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { buildRobotSafetyElectricalEvidenceFixture } from '@/lib/ai/robot/robotSafetyElectricalEvidence.testFixture';
import { POST } from './route';

function request(fixture: ReturnType<typeof buildRobotSafetyElectricalEvidenceFixture> | null, ip: string) {
  const form = new FormData();
  if (fixture) {
    form.set('requirements', new File([new Uint8Array(fixture.requirementsBytes)], 'requirements.json'));
    form.set('safetyElectricalInput', new File([JSON.stringify(fixture.safetyInput)], 'safety-electrical.json'));
  }
  return new NextRequest('http://localhost/api/cad/v1/robot/safety/electrical', { method: 'POST', body: form, headers: { 'x-forwarded-for': ip } });
}

describe('CAD v1 robot safety and electrical design support', () => {
  it('returns complete design support while preserving expert, physical and certification boundaries', async () => {
    const response = await POST(request(buildRobotSafetyElectricalEvidenceFixture(), 'robot-safety-ok'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, releaseReady: false, expertReviewRequired: true, physicalFaultValidationRequired: true, certificationClaimed: false, cadModified: false, quoteOrRfqSideEffects: false, report: { designSupportReady: true, expertSafetyReviewComplete: false, physicalFaultValidationComplete: false, regulatoryConformityAssessed: false, releaseReady: false } });
  });

  it('returns 422 on incomplete safety I/O evidence', async () => {
    const fixture = buildRobotSafetyElectricalEvidenceFixture();
    fixture.safetyInput.electrical.safetyIo = [];
    const response = await POST(request(fixture, 'robot-safety-fail'));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, releaseReady: false, certificationClaimed: false, report: { designSupportReady: false } });
  });

  it('requires both files', async () => {
    expect((await POST(request(null, 'robot-safety-empty'))).status).toBe(400);
  });
});
