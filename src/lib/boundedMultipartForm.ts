import { boundedMultipartBodyError, readBoundedMultipartBody } from './boundedMultipartBody';

export type BoundedMultipartFormResult = {
  form: FormData | null;
  tooLarge: boolean;
};

/**
 * Buffers at most `maximumBytes` before invoking the platform multipart parser.
 * Invalid or empty multipart bodies remain a normal null form so route-specific
 * BAD_REQUEST responses are preserved; measured oversize bodies are explicit.
 */
export async function readBoundedMultipartForm(request: Request, maximumBytes: number): Promise<BoundedMultipartFormResult> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await readBoundedMultipartBody(request, maximumBytes);
  } catch (error) {
    const bounded = boundedMultipartBodyError(error);
    return { form: null, tooLarge: bounded?.status === 413 };
  }

  const headers = new Headers(request.headers);
  headers.delete('content-length');
  headers.delete('transfer-encoding');
  const replay = new Request(request.url, {
    method: request.method,
    headers,
    body: bytes,
  });
  const form = await replay.formData().catch(() => null);
  return { form, tooLarge: false };
}
