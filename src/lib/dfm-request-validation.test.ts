import { describe, expect, it } from 'vitest';
import { validateDfmRequest } from './dfm-request-validation';

describe('validateDfmRequest', () => {
  it('accepts the structured and legacy flat request shapes', () => {
    expect(validateDfmRequest({ params: { wallThickness: 1.2 }, fileId: 'cad-1' })).toEqual({
      ok: true,
      value: { params: { wallThickness: 1.2 }, fileId: 'cad-1' },
    });
    expect(validateDfmRequest({ wallThickness: 1.2, draftAngle: 2 })).toEqual({
      ok: true,
      value: { params: { wallThickness: 1.2, draftAngle: 2 } },
    });
  });

  it.each([
    { params: [] },
    { params: { width: Number.NaN } },
    { params: { width: Number.POSITIVE_INFINITY } },
    { params: { width: 1_000_000_001 } },
    { params: Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`p${index}`, index])) },
    { params: {}, fileId: 'x'.repeat(129) },
  ])('rejects unbounded or malformed input %#', body => {
    expect(validateDfmRequest(body).ok).toBe(false);
  });
});
