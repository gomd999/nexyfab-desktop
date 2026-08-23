const MAX_DFM_PARAMS = 128;
const MAX_DFM_KEY_LENGTH = 80;
const MAX_DFM_ABSOLUTE_VALUE = 1_000_000_000;
const MAX_DFM_FILE_ID_LENGTH = 128;

export interface ValidatedDfmRequest {
  params: Record<string, number>;
  fileId?: string;
}

export type DfmRequestValidation =
  | { ok: true; value: ValidatedDfmRequest }
  | { ok: false; error: string };

export function validateDfmRequest(body: unknown): DfmRequestValidation {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be an object' };
  }

  const record = body as Record<string, unknown>;
  const candidate = record.params === undefined
    ? Object.fromEntries(Object.entries(record).filter(([key, value]) => key !== 'fileId' && typeof value === 'number'))
    : record.params;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { ok: false, error: 'params must be an object' };
  }

  const entries = Object.entries(candidate as Record<string, unknown>);
  if (entries.length > MAX_DFM_PARAMS) return { ok: false, error: 'Too many DFM parameters' };
  const params: Record<string, number> = {};
  for (const [key, value] of entries) {
    if (!key || key.length > MAX_DFM_KEY_LENGTH) return { ok: false, error: 'Invalid DFM parameter name' };
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_DFM_ABSOLUTE_VALUE) {
      return { ok: false, error: `Invalid DFM parameter: ${key}` };
    }
    params[key] = value;
  }

  if (record.fileId !== undefined && (typeof record.fileId !== 'string' || !record.fileId.trim() || record.fileId.trim().length > MAX_DFM_FILE_ID_LENGTH)) {
    return { ok: false, error: 'Invalid fileId' };
  }
  const fileId = typeof record.fileId === 'string' ? record.fileId.trim() : undefined;
  return { ok: true, value: { params, ...(fileId ? { fileId } : {}) } };
}
