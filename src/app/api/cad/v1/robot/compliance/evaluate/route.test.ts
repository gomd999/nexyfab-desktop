import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { buildRobotStructuralComplianceFixture } from '@/lib/ai/robot/robotStructuralCompliance.testFixture';
import { POST } from './route';

function request(requirements: Uint8Array | null, complianceInput: unknown | null, ip: string) {
  const form = new FormData();
  if (requirements) form.set('requirements', new File([new Uint8Array(requirements)], 'requirements.json'));
  if (complianceInput) form.set('complianceInput', new File([JSON.stringify(complianceInput)], 'compliance.json'));
  return new NextRequest('http://localhost/api/cad/v1/robot/compliance/evaluate', { method: 'POST', body: form, headers: { 'x-forwarded-for': ip } });
}

describe('CAD v1 robot structural compliance evaluation', () => {
  it('returns a bound calculation without release effects', async () => {
    const fixture = buildRobotStructuralComplianceFixture();
    const response = await POST(request(fixture.requirementsBytes, fixture.complianceInput, 'robot-compliance-ok'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, releaseReady: false, physicalStiffnessValidationRequired: true, cadModified: false, quoteOrRfqSideEffects: false, report: { structuralComplianceReady: true, physicalStiffnessValidationComplete: false, releaseReady: false } });
  });

  it('returns 422 when structural deflection exceeds its allocation', async () => {
    const fixture = buildRobotStructuralComplianceFixture();
    fixture.complianceInput.jointStiffness[0]!.minimumOutputTorsionalStiffnessNmPerRad = 1_000;
    const response = await POST(request(fixture.requirementsBytes, fixture.complianceInput, 'robot-compliance-fail'));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, releaseReady: false, report: { structuralComplianceReady: false } });
  });

  it('requires both evidence files', async () => {
    expect((await POST(request(null, null, 'robot-compliance-empty'))).status).toBe(400);
  });
});
