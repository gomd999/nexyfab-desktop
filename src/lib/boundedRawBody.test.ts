import { describe, expect, it } from 'vitest';
import { readBoundedRawBody } from './boundedRawBody';

describe('bounded raw request reader', () => {
  it('preserves exact bytes, including bytes that are not valid UTF-8', async () => {
    const input = new Uint8Array([0x7b, 0xff, 0x00, 0x7d]);
    const bytes = await readBoundedRawBody(new Request('http://localhost', { method: 'POST', body: input }), 4);
    expect([...bytes]).toEqual([...input]);
  });

  it('returns an empty byte array for an absent or empty body', async () => {
    await expect(readBoundedRawBody(new Request('http://localhost', { method: 'POST' }), 4)).resolves.toHaveLength(0);
    await expect(readBoundedRawBody(new Request('http://localhost', { method: 'POST', body: '' }), 4)).resolves.toHaveLength(0);
  });

  it('rejects an oversized declared length before reading and cancels the source', async () => {
    let cancelled = false;
    const request = new Request('http://localhost', {
      method: 'POST',
      headers: { 'content-length': '5' },
      body: new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    await expect(readBoundedRawBody(request, 4)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE', status: 413 });
    expect(cancelled).toBe(true);
  });

  it('does not trust a falsely small Content-Length and cancels an oversized stream', async () => {
    let cancelled = false;
    const request = new Request('http://localhost', {
      method: 'POST',
      headers: { 'content-length': '1' },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.enqueue(new Uint8Array([3, 4, 5]));
        },
        cancel() { cancelled = true; },
      }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    await expect(readBoundedRawBody(request, 4)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE', status: 413 });
    expect(cancelled).toBe(true);
  });

  it('sanitizes a request stream failure as a bad request', async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      body: new ReadableStream<Uint8Array>({ pull() { throw new Error('private stream failure'); } }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    await expect(readBoundedRawBody(request, 4)).rejects.toMatchObject({ code: 'BAD_REQUEST', status: 400 });
  });
});
