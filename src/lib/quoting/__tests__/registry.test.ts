/**
 * Quoting registry — exports + default-provider selection.
 *
 * These tests lock down the registry contract: at least internal + xometry
 * present, getProvider lookup by id, getDefaultProvider always returns a
 * configured provider with internal as the fallback. The XOMETRY_API_KEY
 * env-var gate is also asserted so we catch a regression that would
 * silently flip the default away from internal in production.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { listProviders, getProvider, getDefaultProvider } from '../registry';
import { internalQuoteProvider } from '../internalProvider';
import { xometryQuoteProvider } from '../xometryProvider';

describe('quoting/registry', () => {
  const origEnv = process.env.XOMETRY_API_KEY;
  beforeEach(() => { delete process.env.XOMETRY_API_KEY; });
  afterEach(() => {
    if (origEnv === undefined) delete process.env.XOMETRY_API_KEY;
    else process.env.XOMETRY_API_KEY = origEnv;
  });

  it('listProviders returns at least internal + xometry', () => {
    const ids = listProviders().map(p => p.id);
    expect(ids).toContain('internal');
    expect(ids).toContain('xometry');
    expect(ids.length).toBeGreaterThanOrEqual(2);
  });

  it("getProvider('internal') returns the internal provider", () => {
    expect(getProvider('internal')).toBe(internalQuoteProvider);
  });

  it("getProvider('xometry') returns the xometry provider", () => {
    expect(getProvider('xometry')).toBe(xometryQuoteProvider);
  });

  it("getProvider('unknown') returns null", () => {
    expect(getProvider('unknown')).toBeNull();
    expect(getProvider('')).toBeNull();
  });

  it('getDefaultProvider returns internal when XOMETRY_API_KEY is unset', () => {
    // beforeEach already cleared the env var.
    expect(getDefaultProvider()).toBe(internalQuoteProvider);
  });

  it('Xometry isConfigured returns false in the test env (no API key)', () => {
    expect(xometryQuoteProvider.isConfigured()).toBe(false);
  });
});
