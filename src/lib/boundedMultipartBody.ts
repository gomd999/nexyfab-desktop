export class BoundedMultipartBodyError extends Error {
  constructor(public readonly code: 'BAD_REQUEST' | 'PAYLOAD_TOO_LARGE', public readonly status: 400 | 413) {
    super(code);
  }
}

/** Reads a Web Request body with an enforced byte cap before multipart parsing. */
export async function readBoundedMultipartBody(request: Request, maximumBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw new TypeError('maximumBytes must be a positive safe integer.');
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await request.body?.cancel('declared payload too large').catch(() => undefined);
    throw new BoundedMultipartBodyError('PAYLOAD_TOO_LARGE', 413);
  }
  if (!request.body) throw new BoundedMultipartBodyError('BAD_REQUEST', 400);

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
        throw new BoundedMultipartBodyError('PAYLOAD_TOO_LARGE', 413);
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } catch (error) {
    if (error instanceof BoundedMultipartBodyError) throw error;
    throw new BoundedMultipartBodyError('BAD_REQUEST', 400);
  } finally {
    reader.releaseLock();
  }

  if (total === 0) throw new BoundedMultipartBodyError('BAD_REQUEST', 400);
  const bytes = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function boundedMultipartBodyError(error: unknown): { code: 'BAD_REQUEST' | 'PAYLOAD_TOO_LARGE'; status: 400 | 413 } | null {
  return error instanceof BoundedMultipartBodyError ? { code: error.code, status: error.status } : null;
}
