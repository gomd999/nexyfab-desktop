import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { buildRobotDriveDutyThermalFixture } from '@/lib/ai/robot/robotDriveDutyThermal.testFixture';
import { POST } from './route';

function request(dynamicValue: Uint8Array | null, thermalValue: unknown | null, ip: string) {
  const form = new FormData();
  if (dynamicValue) form.set('dynamicReport', new File([new Uint8Array(dynamicValue)], 'dynamic.json'));
  if (thermalValue) form.set('thermalInput', new File([JSON.stringify(thermalValue)], 'thermal.json'));
  return new NextRequest('http://localhost/api/cad/v1/robot/thermal/evaluate', { method: 'POST', body: form, headers: { 'x-forwarded-for': ip } });
}

describe('CAD v1 robot thermal evaluation', () => {
  it('returns a bound steady-state report without release side effects', async () => {
    const fixture = buildRobotDriveDutyThermalFixture();
    const response = await POST(request(fixture.dynamicReportBytes, fixture.thermalInput, 'robot-thermal-ok'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, releaseReady: false, cadModified: false, quoteOrRfqSideEffects: false, report: { thermalReady: true, status: 'passed', releaseReady: false, sideEffects: { persisted: false, cadModified: false } } });
  });

  it('fails closed on an over-temperature result', async () => {
    const fixture = buildRobotDriveDutyThermalFixture();
    fixture.thermalInput.joints[0]!.motorThermal.maximumTemperatureC = 25;
    const response = await POST(request(fixture.dynamicReportBytes, fixture.thermalInput, 'robot-thermal-hot'));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, releaseReady: false, cadModified: false, report: { thermalReady: false } });
  });

  it('requires both evidence files', async () => {
    expect((await POST(request(null, null, 'robot-thermal-empty'))).status).toBe(400);
  });
});
