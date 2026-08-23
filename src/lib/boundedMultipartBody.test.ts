import { describe, expect, it } from 'vitest';
import { readBoundedMultipartBody } from './boundedMultipartBody';

describe('bounded multipart request reader', () => {
  it('cancels a body rejected by its declared length', async () => {
    let cancelled = false;
    const request = new Request('http://localhost', {
      method: 'POST',
      headers: { 'content-length': '100' },
      body: new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    await expect(readBoundedMultipartBody(request, 10)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE', status: 413 });
    expect(cancelled).toBe(true);
  });

  it('rejects a chunked body as soon as the measured bytes exceed the cap', async () => {
    let cancelled = false;
    const requestInit = {
      method: 'POST',
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1]));
          controller.enqueue(new Uint8Array(11));
        },
        cancel() {
          cancelled = true;
        },
      }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' };
    const request = new Request('http://localhost', requestInit);
    await expect(readBoundedMultipartBody(request, 10)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE', status: 413 });
    expect(cancelled).toBe(true);
  });

  it('rejects an empty body before parsing', async () => {
    await expect(readBoundedMultipartBody(new Request('http://localhost', { method: 'POST' }), 10)).rejects.toMatchObject({ code: 'BAD_REQUEST', status: 400 });
  });
});
