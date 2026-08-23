import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => ({ allowed: true })) }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: vi.fn(() => '203.0.113.45') }));

import { POST } from './face-map/route';

function streamRequest(body: ReadableStream<Uint8Array>): NextRequest {
  const init = {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': '1' },
    body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' };
  return new NextRequest('https://nexyfab.test/api/nexyfab/drawing/face-map', init as never);
}

describe('remaining drawing route streaming JSON boundary', () => {
  it('measures and cancels an oversized chunked body despite a false Content-Length', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024));
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() { cancelled = true; },
    });
    const response = await POST(streamRequest(body));
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'face-map 입력이 너무 큽니다.' });
    expect(cancelled).toBe(true);
  });

  it.each([
    ['malformed JSON', '{' as BodyInit],
    ['invalid UTF-8', new Uint8Array([0xff]) as BodyInit],
  ])('preserves the invalid-json contract for %s', async (_name, body) => {
    const response = await POST(new NextRequest('https://nexyfab.test/api/nexyfab/drawing/face-map', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'invalid json' });
  });
});
