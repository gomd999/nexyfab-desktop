import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { buildRobotTcpPositionErrorBudgetFixture } from '@/lib/ai/robot/robotTcpPositionErrorBudget.testFixture';
import { POST } from './route';

function request(requirements: Uint8Array | null, precisionInput: unknown | null, ip: string) {
  const form = new FormData();
  if (requirements) form.set('requirements', new File([new Uint8Array(requirements)], 'requirements.json'));
  if (precisionInput) form.set('precisionInput', new File([JSON.stringify(precisionInput)], 'precision.json'));
  return new NextRequest('http://localhost/api/cad/v1/robot/precision/evaluate', { method: 'POST', body: form, headers: { 'x-forwarded-for': ip } });
}

describe('CAD v1 robot precision evaluation', () => {
  it('returns a bound fail-closed precision budget without release effects', async () => {
    const fixture = buildRobotTcpPositionErrorBudgetFixture();
    const response = await POST(request(fixture.requirementsBytes, fixture.precisionInput, 'robot-precision-ok'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, releaseReady: false, physicalValidationRequired: true, cadModified: false, quoteOrRfqSideEffects: false, report: { precisionBudgetReady: true, physicalValidationComplete: false, releaseReady: false } });
  });

  it('returns 422 when the guaranteed worst-case bound fails', async () => {
    const fixture = buildRobotTcpPositionErrorBudgetFixture();
    fixture.precisionInput.contributors[3]!.accuracyBound = 1;
    const response = await POST(request(fixture.requirementsBytes, fixture.precisionInput, 'robot-precision-fail'));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, releaseReady: false, report: { precisionBudgetReady: false } });
  });

  it('requires both governed evidence files', async () => {
    expect((await POST(request(null, null, 'robot-precision-empty'))).status).toBe(400);
  });
});
