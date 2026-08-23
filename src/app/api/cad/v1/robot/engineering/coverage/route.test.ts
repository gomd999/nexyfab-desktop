import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { buildRobotEngineeringCoverageMatrixFixture } from '@/lib/ai/robot/robotEngineeringCoverageMatrix.testFixture';
import { POST } from './route';

function request(fixture: ReturnType<typeof buildRobotEngineeringCoverageMatrixFixture> | null, ip: string) {
  const form = new FormData();
  if (fixture) {
    form.set('requirements', new File([new Uint8Array(fixture.requirementsBytes)], 'requirements.json'));
    form.set('manifest', new File([new Uint8Array(fixture.manifestBytes)], 'manifest.json'));
    for (const [name, bytes] of fixture.artifacts) form.append('artifact', new File([new Uint8Array(bytes)], name));
  }
  return new NextRequest('http://localhost/api/cad/v1/robot/engineering/coverage', { method: 'POST', body: form, headers: { 'x-forwarded-for': ip } });
}

describe('CAD v1 robot engineering coverage matrix', () => {
  it('returns full frozen requirement-combination coverage without release', async () => {
    const response = await POST(request(buildRobotEngineeringCoverageMatrixFixture(), 'robot-coverage-ok'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, releaseReady: false, externalValidationRequired: true, cadModified: false, quoteOrRfqSideEffects: false, report: { coverageReady: true, fullRequirementsCoverageComplete: true, externalValidationComplete: false, releaseReady: false } });
  });

  it('requires the complete evidence set', async () => {
    expect((await POST(request(null, 'robot-coverage-empty'))).status).toBe(400);
  });
});
