export class BoundedJsonBodyError extends Error {
  constructor(public readonly code: 'BAD_REQUEST' | 'PAYLOAD_TOO_LARGE', public readonly status: 400 | 413) {
    super(code);
  }
}

/** Reads a Web Request body with an enforced byte cap even when Content-Length is absent or false. */
export async function readBoundedJson<T>(request: Request, maximumBytes: number): Promise<T> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw new TypeError('maximumBytes must be a positive safe integer.');
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    await request.body?.cancel('declared payload too large').catch(() => undefined);
    throw new BoundedJsonBodyError('PAYLOAD_TOO_LARGE', 413);
  }
  if (!request.body) throw new BoundedJsonBodyError('BAD_REQUEST', 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel('payload too large').catch(() => undefined);
        throw new BoundedJsonBodyError('PAYLOAD_TOO_LARGE', 413);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof BoundedJsonBodyError) throw error;
    throw new BoundedJsonBodyError('BAD_REQUEST', 400);
  } finally { reader.releaseLock(); }
  if (total === 0) throw new BoundedJsonBodyError('BAD_REQUEST', 400);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T; }
  catch { throw new BoundedJsonBodyError('BAD_REQUEST', 400); }
}

export function boundedJsonError(error: unknown): { code: 'BAD_REQUEST' | 'PAYLOAD_TOO_LARGE'; status: 400 | 413 } | null {
  return error instanceof BoundedJsonBodyError ? { code: error.code, status: error.status } : null;
}
