import { describe, expect, it } from 'vitest';
import { validateStepObjectAccess, type StepObjectRecord } from './objectKeyAccess';

const owned: StepObjectRecord = {
  user_id: 'user-a', storage_key: 'private/files/user-a/id/model.step', filename: 'model.step', size_bytes: 1024,
};

describe('validateStepObjectAccess', () => {
  it('allows an exact owner/key match', () => {
    expect(validateStepObjectAccess(owned, 'user-a', owned.storage_key)).toEqual({ ok: true, record: owned });
  });

  it('does not reveal or allow another user object', () => {
    expect(validateStepObjectAccess(owned, 'user-b', owned.storage_key)).toEqual({ ok: false, code: 'OBJECT_FORBIDDEN' });
  });

  it('rejects a mismatched requested key and invalid metadata', () => {
    expect(validateStepObjectAccess(owned, 'user-a', 'private/other.step')).toEqual({ ok: false, code: 'OBJECT_KEY_MISMATCH' });
    expect(validateStepObjectAccess({ ...owned, size_bytes: 0 }, 'user-a', owned.storage_key))
      .toEqual({ ok: false, code: 'INVALID_OBJECT_SIZE' });
  });
});
