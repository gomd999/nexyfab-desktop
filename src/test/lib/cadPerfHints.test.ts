/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { getSuppressCadPerfToasts, setSuppressCadPerfToasts } from '@/lib/cadPerfHints';

describe('cadPerfHints', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to off', () => {
    expect(getSuppressCadPerfToasts()).toBe(false);
  });

  it('persists suppress flag', () => {
    setSuppressCadPerfToasts(true);
    expect(getSuppressCadPerfToasts()).toBe(true);
    setSuppressCadPerfToasts(false);
    expect(getSuppressCadPerfToasts()).toBe(false);
  });
});
