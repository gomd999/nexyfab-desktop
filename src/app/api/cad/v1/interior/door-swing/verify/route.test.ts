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

  it('measures streamed bytes, ignores a falsely small Content-Length, and cancels oversize input', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"payload":"'));
        controller.enqueue(new Uint8Array(4 * 1024 * 1024));
      },
      cancel() { cancelled = true; },
    });
    const response = await POST(new NextRequest('http://localhost/api/cad/v1/interior/door-swing/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '1' },
      body,
      duplex: 'half',
    } as unknown as ConstructorParameters<typeof NextRequest>[1]));
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ ok: false, code: 'PAYLOAD_TOO_LARGE' });
    expect(cancelled).toBe(true);
  });

  it('preserves INVALID_INPUT for malformed JSON and invalid UTF-8', async () => {
    const malformed = await POST(new NextRequest('http://localhost/api/cad/v1/interior/door-swing/verify', { method: 'POST', body: '{' }));
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({ ok: false, code: 'INVALID_INPUT' });

    const invalidUtf8 = await POST(new NextRequest('http://localhost/api/cad/v1/interior/door-swing/verify', { method: 'POST', body: new Uint8Array([0xff]) }));
    expect(invalidUtf8.status).toBe(400);
    await expect(invalidUtf8.json()).resolves.toMatchObject({ ok: false, code: 'INVALID_INPUT' });
  });
});
