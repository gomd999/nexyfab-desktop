import { describe, it, expect } from 'vitest';
import { assertIfMatchUpdatedAt } from '@/lib/nfProjectConcurrency';

describe('nfProjectConcurrency', () => {
  it('skips check when ifMatch omitted', () => {
    expect(assertIfMatchUpdatedAt(99, undefined)).toEqual({ ok: true });
  });

  it('passes when timestamps match', () => {
    expect(assertIfMatchUpdatedAt(1_700_000_000_000, 1_700_000_000_000)).toEqual({ ok: true });
  });

  it('accepts Postgres BIGINT decimal strings as exact revision tokens', () => {
    expect(assertIfMatchUpdatedAt('1700000000000', '1700000000000')).toEqual({ ok: true });
  });

  it('fails on mismatch', () => {
    const r = assertIfMatchUpdatedAt(2, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/Conflict/i);
      expect(r.serverUpdatedAt).toBe(2);
      expect(r.clientExpected).toBe(1);
    }
  });

  it('fails closed for malformed revision tokens', () => {
    const r = assertIfMatchUpdatedAt('not-a-revision', '1700000000000');
    expect(r.ok).toBe(false);
  });
});
