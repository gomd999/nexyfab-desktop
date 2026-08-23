export class BoundedRawBodyError extends Error {
  constructor(public readonly code: 'BAD_REQUEST' | 'PAYLOAD_TOO_LARGE', public readonly status: 400 | 413) {
    super(code);
  }
}

/** Reads a Web Request body as exact bytes with a streaming cap, without trusting Content-Length. */
export async function readBoundedRawBody(request: Request, maximumBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw new TypeError('maximumBytes must be a positive safe integer.');
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    await request.body?.cancel('declared payload too large').catch(() => undefined);
    throw new BoundedRawBodyError('PAYLOAD_TOO_LARGE', 413);
  }
  if (!request.body) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (value.byteLength > maximumBytes - total) {
        await reader.cancel('payload too large').catch(() => undefined);
        throw new BoundedRawBodyError('PAYLOAD_TOO_LARGE', 413);
      }
      total += value.byteLength;
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof BoundedRawBodyError) throw error;
    throw new BoundedRawBodyError('BAD_REQUEST', 400);
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function boundedRawBodyError(error: unknown): { code: 'BAD_REQUEST' | 'PAYLOAD_TOO_LARGE'; status: 400 | 413 } | null {
  return error instanceof BoundedRawBodyError ? { code: error.code, status: error.status } : null;
}
