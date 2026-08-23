import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { buildRobotCableLifeSweepFixture } from '@/lib/ai/robot/robotCableLifeSweep.testFixture';
import { POST } from './route';

function request(fixture: ReturnType<typeof buildRobotCableLifeSweepFixture> | null, ip: string) {
  const form = new FormData();
  if (fixture) {
    form.set('requirements', new File([new Uint8Array(fixture.requirementsBytes)], 'requirements.json'));
    form.set('motionReport', new File([new Uint8Array(fixture.motionReportBytes)], 'motion.json'));
    form.set('cableInput', new File([JSON.stringify(fixture.cableInput)], 'cable.json'));
  }
  return new NextRequest('http://localhost/api/cad/v1/robot/cable/life', { method: 'POST', body: form, headers: { 'x-forwarded-for': ip } });
}

describe('CAD v1 robot cable life sweep', () => {
  it('returns a full-motion cable life calculation without release effects', async () => {
    const response = await POST(request(buildRobotCableLifeSweepFixture(), 'robot-cable-ok'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, releaseReady: false, physicalFlexValidationRequired: true, cadModified: false, quoteOrRfqSideEffects: false, report: { cableLifeReady: true, fullMotionCombinationCoverageComplete: true, physicalFlexValidationComplete: false, releaseReady: false } });
  });

  it('returns 422 on a bend-life violation', async () => {
    const fixture = buildRobotCableLifeSweepFixture();
    fixture.cableInput.combinations[0]!.cableStates[0]!.routePointsMm = [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, { x: 5, y: 5, z: 0 }];
    const response = await POST(request(fixture, 'robot-cable-fail'));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, releaseReady: false, report: { cableLifeReady: false } });
  });

  it('requires all three evidence files', async () => {
    expect((await POST(request(null, 'robot-cable-empty'))).status).toBe(400);
  });
});
