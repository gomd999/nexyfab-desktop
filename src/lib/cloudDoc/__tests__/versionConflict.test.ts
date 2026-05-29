/**
 * assertIfMatchDocVersion — D1 PDM optimistic concurrency helper.
 *
 * 9 cases:
 *  - undefined client = no-op pass
 *  - matching versions pass
 *  - mismatched versions fail with both values surfaced
 *  - NaN / Infinity / non-number protected (pass — caller validates)
 *  - zero vs positive distinguished
 */

import { describe, it, expect } from 'vitest';
import { assertIfMatchDocVersion } from '../versionConflict';

describe('assertIfMatchDocVersion', () => {
  it('passes when ifMatchVersion is undefined (header not set)', () => {
    expect(assertIfMatchDocVersion(5, undefined)).toEqual({ ok: true });
  });

  it('passes when versions are equal', () => {
    expect(assertIfMatchDocVersion(7, 7)).toEqual({ ok: true });
  });

  it('passes for version=0 match', () => {
    expect(assertIfMatchDocVersion(0, 0)).toEqual({ ok: true });
  });

  it('fails when client version is stale (lower than server)', () => {
    const r = assertIfMatchDocVersion(5, 3);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.serverVersion).toBe(5);
      expect(r.clientExpected).toBe(3);
      expect(r.message).toContain('Conflict');
    }
  });

  it('fails when client version is ahead (impossible — but still 409)', () => {
    const r = assertIfMatchDocVersion(2, 4);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.serverVersion).toBe(2);
      expect(r.clientExpected).toBe(4);
    }
  });

  it('passes when serverVersion is NaN (caller validates)', () => {
    expect(assertIfMatchDocVersion(NaN, 5)).toEqual({ ok: true });
  });

  it('passes when ifMatchVersion is NaN (caller validates)', () => {
    expect(assertIfMatchDocVersion(5, NaN)).toEqual({ ok: true });
  });

  it('passes when Infinity passed (caller validates)', () => {
    expect(assertIfMatchDocVersion(5, Infinity)).toEqual({ ok: true });
  });

  it('distinguishes 0 from 1 (off-by-one not silently masked)', () => {
    const r = assertIfMatchDocVersion(1, 0);
    expect(r.ok).toBe(false);
  });
});
