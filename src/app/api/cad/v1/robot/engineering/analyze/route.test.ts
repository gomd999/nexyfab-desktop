import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { buildRobotEngineeringAnalysisPacketFixture } from '@/lib/ai/robot/robotEngineeringAnalysisPacket.testFixture';
import { POST } from './route';

function request(files: ReturnType<typeof buildRobotEngineeringAnalysisPacketFixture> | null, ip: string) {
  const form = new FormData();
  if (files) for (const [key, bytes] of Object.entries(files)) form.set(key, new File([new Uint8Array(bytes)], `${key}.json`));
  return new NextRequest('http://localhost/api/cad/v1/robot/engineering/analyze', { method: 'POST', body: form, headers: { 'x-forwarded-for': ip } });
}

describe('CAD v1 robot engineering analysis packet', () => {
  it('returns a fully bound analysis packet while keeping release blocked', async () => {
    const response = await POST(request(buildRobotEngineeringAnalysisPacketFixture(), 'robot-engineering-ok'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, releaseReady: false, externalValidationRequired: true, cadModified: false, quoteOrRfqSideEffects: false, report: { engineeringAnalysisReady: true, externalValidationComplete: false, releaseReady: false } });
  });

  it('fails closed when a required evidence file is absent', async () => {
    expect((await POST(request(null, 'robot-engineering-empty'))).status).toBe(400);
  });
});
