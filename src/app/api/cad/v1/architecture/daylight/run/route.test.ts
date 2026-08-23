import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeRadianceLocally, radianceExecutablePathsFromEnvironment } = vi.hoisted(() => ({
  executeRadianceLocally: vi.fn(),
  radianceExecutablePathsFromEnvironment: vi.fn(),
}));

vi.mock('@/lib/ai/radianceLocalExecution', () => ({ executeRadianceLocally, radianceExecutablePathsFromEnvironment }));

import { POST } from './route';

const request = (body: unknown) => new NextRequest('http://localhost/api/cad/v1/architecture/daylight/run', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-forwarded-for': `daylight-run-${Math.random()}` },
  body: JSON.stringify(body),
});

describe('daylight local run release boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    radianceExecutablePathsFromEnvironment.mockReturnValue({});
    executeRadianceLocally.mockResolvedValue({ status: 'pass', errors: [], outputs: { 'illuminance.rgb': new TextEncoder().encode('1 1 1\n') } });
  });

  it('keeps a successful local Radiance preview out of commercial release', async () => {
    const response = await POST(request({ kind: 'point_in_time', sceneRad: 'void plastic p 0 0 5 0.5\n', sensorsPts: '0 0 0\n', sensorCount: 1, skyRad: 'sky' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      status: 'pass',
      releaseReady: false,
      evidenceAuthority: 'local_execution_preview',
      releaseBlocker: 'SIGNED_INDEPENDENT_RELEASE_EVIDENCE_REQUIRED',
      quoteOrRfqSideEffects: false,
    });
  });
});
