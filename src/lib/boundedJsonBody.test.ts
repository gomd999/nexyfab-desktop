import { describe, expect, it } from 'vitest';
import { readBoundedJson } from './boundedJsonBody';

describe('bounded JSON request reader', () => {
  it('reads valid JSON under the limit', async () => {
    await expect(readBoundedJson<{ value: number }>(new Request('http://localhost', { method: 'POST', body: '{"value":1}' }), 32)).resolves.toEqual({ value: 1 });
  });

  it('rejects an oversized declared length before reading', async () => {
    let cancelled = false;
    const request = new Request('http://localhost', {
      method: 'POST',
      headers: { 'content-length': '100' },
      body: new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    await expect(readBoundedJson(request, 10)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE', status: 413 });
    expect(cancelled).toBe(true);
  });

  it('enforces the measured stream size when Content-Length is absent', async () => {
    const request = new Request('http://localhost', { method: 'POST', body: JSON.stringify({ payload: 'x'.repeat(100) }) });
    await expect(readBoundedJson(request, 32)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE', status: 413 });
  });

  it('does not trust a falsely small Content-Length and cancels an oversized stream', async () => {
    let cancelled = false;
    const init = {
      method: 'POST',
      headers: { 'content-length': '1' },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"payload":"'));
          controller.enqueue(new Uint8Array(64));
        },
        cancel() { cancelled = true; },
      }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' };
    await expect(readBoundedJson(new Request('http://localhost', init), 32)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE', status: 413 });
    expect(cancelled).toBe(true);
  });

  it('sanitizes a request stream failure as a bad request', async () => {
    const init = {
      method: 'POST',
      body: new ReadableStream<Uint8Array>({ pull() { throw new Error('private stream failure'); } }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' };
    await expect(readBoundedJson(new Request('http://localhost', init), 32)).rejects.toMatchObject({ code: 'BAD_REQUEST', status: 400 });
  });

  it('rejects malformed JSON and invalid UTF-8', async () => {
    await expect(readBoundedJson(new Request('http://localhost', { method: 'POST', body: '{' }), 32)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(readBoundedJson(new Request('http://localhost', { method: 'POST', body: new Uint8Array([0xff]) }), 32)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
