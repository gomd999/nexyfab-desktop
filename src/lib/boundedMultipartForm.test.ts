import { describe, expect, it } from 'vitest';
import { readBoundedMultipartForm } from './boundedMultipartForm';

function multipartBytes() {
  const boundary = 'nexyfab-test-boundary';
  const text = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="evidence"; filename="evidence.json"',
    'Content-Type: application/json',
    '',
    '{"ok":true}',
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return { boundary, bytes: new TextEncoder().encode(text) };
}

function streamedRequest(bytes: Uint8Array, headers: HeadersInit, onCancel?: () => void) {
  const init = {
    method: 'POST',
    headers,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, Math.max(1, Math.floor(bytes.byteLength / 2))));
        controller.enqueue(bytes.slice(Math.max(1, Math.floor(bytes.byteLength / 2))));
        controller.close();
      },
      cancel() {
        onCancel?.();
      },
    }),
    duplex: 'half',
  } as RequestInit & { duplex: 'half' };
  return new Request('http://localhost/api/cad/v1/robot/test', init);
}

describe('bounded multipart form parser', () => {
  it('parses a chunked multipart body without Content-Length', async () => {
    const { boundary, bytes } = multipartBytes();
    const result = await readBoundedMultipartForm(streamedRequest(bytes, { 'content-type': `multipart/form-data; boundary=${boundary}` }), bytes.byteLength);
    expect(result.tooLarge).toBe(false);
    expect(await (result.form?.get('evidence') as File).text()).toBe('{"ok":true}');
  });

  it('measures the body when Content-Length falsely declares one byte', async () => {
    const { boundary, bytes } = multipartBytes();
    const result = await readBoundedMultipartForm(streamedRequest(bytes, {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': '1',
      'transfer-encoding': 'chunked',
    }), bytes.byteLength);
    expect(result.tooLarge).toBe(false);
    expect(result.form?.get('evidence')).toBeInstanceOf(File);
  });

  it('cancels and fails closed when streamed bytes exceed the cap', async () => {
    const { boundary, bytes } = multipartBytes();
    let cancelled = false;
    const result = await readBoundedMultipartForm(streamedRequest(bytes, {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': '1',
    }, () => { cancelled = true; }), 8);
    expect(result).toEqual({ form: null, tooLarge: true });
    expect(cancelled).toBe(true);
  });

  it('keeps malformed multipart input on the route BAD_REQUEST path', async () => {
    const result = await readBoundedMultipartForm(new Request('http://localhost', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=missing' },
      body: new Uint8Array([1, 2, 3]),
    }), 10);
    expect(result).toEqual({ form: null, tooLarge: false });
  });
});
