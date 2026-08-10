export interface StepObjectRecord {
  user_id: string;
  storage_key: string;
  filename: string;
  size_bytes: number;
}

export type StepObjectAccessResult =
  | { ok: true; record: StepObjectRecord }
  | { ok: false; code: 'OBJECT_NOT_FOUND' | 'OBJECT_FORBIDDEN' | 'OBJECT_KEY_MISMATCH' | 'INVALID_OBJECT_SIZE' };

/** Fail-closed ownership check before private CAD bytes are downloaded. */
export function validateStepObjectAccess(
  record: StepObjectRecord | null | undefined,
  expectedUserId: string,
  requestedKey: string,
): StepObjectAccessResult {
  if (!record) return { ok: false, code: 'OBJECT_NOT_FOUND' };
  if (record.user_id !== expectedUserId) return { ok: false, code: 'OBJECT_FORBIDDEN' };
  if (record.storage_key !== requestedKey) return { ok: false, code: 'OBJECT_KEY_MISMATCH' };
  if (!Number.isSafeInteger(record.size_bytes) || record.size_bytes <= 0) {
    return { ok: false, code: 'INVALID_OBJECT_SIZE' };
  }
  return { ok: true, record };
}
