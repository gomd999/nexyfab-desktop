import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => ({ allowed: true })) }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: vi.fn(() => 'test') }));

const request = (body: unknown) => new NextRequest('http://localhost/api/cad/v1/interior/door-swing/verify', {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
});

describe('CAD v1 continuous door swing verification', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns conservative continuous clearance evidence without quote/RFQ effects', async () => {
    const response = await POST(request({
      pivot: { x: 0, y: 0 }, closedAngleDeg: 0, openAngleDeg: 90, widthMm: 900, thicknessMm: 40,
      obstacles: [{ id: 'wall', polygon: [{ x: 400, y: 380 }, { x: 500, y: 380 }, { x: 500, y: 480 }, { x: 400, y: 480 }] }],
    }));
    expect(await response.json()).toMatchObject({ ok: true, result: { clear: false, method: 'continuous_sector_capsule', conservative: true, collidingObstacleIds: ['wall'] }, quoteOrRfqSideEffects: false });
  });

  it('rejects malformed polygons and non-positive dimensions', async () => {
    const response = await POST(request({ pivot: { x: 0, y: 0 }, closedAngleDeg: 0, openAngleDeg: 90, widthMm: 0, thicknessMm: 40, obstacles: [{ id: 'bad', polygon: [] }] }));
    expect(response.status).toBe(400);
  });
});
