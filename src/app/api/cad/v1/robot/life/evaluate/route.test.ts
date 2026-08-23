import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { buildRobotBearingReducerLifeFixture } from '@/lib/ai/robot/robotBearingReducerLife.testFixture';
import { POST } from './route';

function request(dynamicValue: Uint8Array | null, lifeValue: unknown | null, ip: string) {
  const form = new FormData();
  if (dynamicValue) form.set('dynamicReport', new File([new Uint8Array(dynamicValue)], 'dynamic.json'));
  if (lifeValue) form.set('lifeInput', new File([JSON.stringify(lifeValue)], 'life.json'));
  return new NextRequest('http://localhost/api/cad/v1/robot/life/evaluate', { method: 'POST', body: form, headers: { 'x-forwarded-for': ip } });
}

describe('CAD v1 robot bearing and reducer life evaluation', () => {
  it('returns a bound life report without release side effects', async () => {
    const fixture = buildRobotBearingReducerLifeFixture();
    const response = await POST(request(fixture.dynamicReportBytes, fixture.lifeInput, 'robot-life-ok'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, releaseReady: false, cadModified: false, quoteOrRfqSideEffects: false, report: { lifeReady: true, status: 'passed', releaseReady: false, sideEffects: { persisted: false, cadModified: false } } });
  });

  it('fails closed on insufficient life capacity', async () => {
    const fixture = buildRobotBearingReducerLifeFixture();
    fixture.lifeInput.requiredServiceLifeCycles = 9_000_000_000_000;
    const response = await POST(request(fixture.dynamicReportBytes, fixture.lifeInput, 'robot-life-fail'));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, releaseReady: false, cadModified: false, report: { lifeReady: false } });
  });

  it('requires both evidence files', async () => {
    expect((await POST(request(null, null, 'robot-life-empty'))).status).toBe(400);
  });
});
