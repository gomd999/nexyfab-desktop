import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => ({ allowed: true })) }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: vi.fn(() => '203.0.113.61') }));

import { POST } from './route';

const URL = 'https://nexyfab.test/api/nexyfab/codecheck';

describe('codecheck bounded JSON ingress', () => {
  it('rejects an oversized declared Content-Length before parsing', async () => {
    const response = await POST(new NextRequest(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(2 * 1024 * 1024 + 1) },
      body: '{}',
    }));
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'codecheck 입력이 너무 큽니다.' });
  });

  it('measures and cancels a chunked oversize body despite a false Content-Length', async () => {
    let cancelled = false;
    const init = {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '1' },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(2 * 1024 * 1024));
          controller.enqueue(new Uint8Array([1]));
        },
        cancel() { cancelled = true; },
      }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' };
    const response = await POST(new NextRequest(URL, init as never));
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'codecheck 입력이 너무 큽니다.' });
    expect(cancelled).toBe(true);
  });

  it.each([
    ['malformed JSON', '{' as BodyInit],
    ['invalid UTF-8', new Uint8Array([0xff]) as BodyInit],
  ])('preserves the invalid-json contract for %s', async (_name, body) => {
    const response = await POST(new NextRequest(URL, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'invalid json' });
  });
});
