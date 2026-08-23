import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/csrf', () => ({ checkOrigin: vi.fn(() => true) }));
vi.mock('@/lib/auth-middleware', () => ({
  getAuthUser: vi.fn(async () => ({ userId: 'user-boundary', email: 'boundary@nexyfab.test' })),
}));
vi.mock('@/lib/db-adapter', () => ({
  getDbAdapter: vi.fn(() => { throw new Error('database must not be reached for rejected bodies'); }),
}));

import { POST } from './route';

const RFQ_COMPARE_JSON_BYTES = 64 * 1024;

const URL = 'https://nexyfab.test/api/nexyfab/rfq/compare';

function streamedRequest(body: ReadableStream<Uint8Array>, contentLength: string) {
  const init = {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': contentLength },
    body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' };
  return new NextRequest(URL, init as never);
}

describe('RFQ compare bounded JSON ingress', () => {
  it('rejects and cancels an oversized declared Content-Length', async () => {
    let cancelled = false;
    const request = streamedRequest(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{}')); },
      cancel() { cancelled = true; },
    }), String(RFQ_COMPARE_JSON_BYTES + 1));

    const response = await POST(request);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: 'Request body too large' });
    expect(cancelled).toBe(true);
  });

  it('measures and cancels chunked oversize input despite a false Content-Length', async () => {
    let cancelled = false;
    const request = streamedRequest(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(RFQ_COMPARE_JSON_BYTES));
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() { cancelled = true; },
    }), '1');

    const response = await POST(request);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: 'Request body too large' });
    expect(cancelled).toBe(true);
  });

  it.each([
    ['malformed JSON', '{' as BodyInit],
    ['invalid UTF-8', new Uint8Array([0xff]) as BodyInit],
  ])('preserves the validation response for %s', async (_name, body) => {
    const response = await POST(new NextRequest(URL, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: '2~5개의 quoteId를 제공하세요.' });
  });
});
