import { describe, expect, it } from 'vitest';
import { isOwnedDirectStepKey, validateDirectStepUpload } from './directStepUploadPolicy';

const MB = 1024 * 1024;
describe('direct STEP upload policy', () => {
  it('accepts the 417 MB reference-class STEP without accepting arbitrary formats', () => {
    expect(validateDirectStepUpload('loader.step', 417 * MB)).toMatchObject({ ok: true });
    expect(validateDirectStepUpload('loader.iges', 100 * MB)).toEqual({ ok: false, code: 'INVALID_FILENAME' });
  });
  it('keeps small files on the bounded browser path and caps the product contract', () => {
    expect(validateDirectStepUpload('part.stp', 50 * MB)).toEqual({ ok: false, code: 'BROWSER_PATH_SUFFICIENT' });
    expect(validateDirectStepUpload('part.stp', 513 * MB)).toEqual({ ok: false, code: 'TOO_LARGE' });
  });
  it('binds completion keys to the authenticated user prefix', () => {
    expect(isOwnedDirectStepKey('private/files/u1/id/model.step', 'u1')).toBe(true);
    expect(isOwnedDirectStepKey('private/files/u2/id/model.step', 'u1')).toBe(false);
    expect(isOwnedDirectStepKey('private/files/u1/../u2/model.step', 'u1')).toBe(false);
  });
});
