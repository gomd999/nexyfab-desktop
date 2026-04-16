// Unit tests for csrf
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// checkOrigin reads ALLOWED_ORIGINS at module load time, so we must
// re-import the module after mutating process.env for origin-allowlist tests.
async function importCheckOrigin() {
  const { checkOrigin } = await import('./csrf');
  return checkOrigin;
}

function makeReq(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/test', { headers });
}

describe('checkOrigin', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.ALLOWED_ORIGINS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('returns true when no origin header is present (server-to-server)', async () => {
    const checkOrigin = await importCheckOrigin();
    const req = makeReq({});
    expect(checkOrigin(req)).toBe(true);
  });

  it('returns false when Sec-Fetch-Site is "cross-site"', async () => {
    const checkOrigin = await importCheckOrigin();
    const req = makeReq({ 'sec-fetch-site': 'cross-site' });
    expect(checkOrigin(req)).toBe(false);
  });

  it('returns true when Sec-Fetch-Site is "same-origin"', async () => {
    const checkOrigin = await importCheckOrigin();
    // same-origin with matching host
    const req = makeReq({
      'sec-fetch-site': 'same-origin',
      origin: 'http://localhost',
      host: 'localhost',
    });
    expect(checkOrigin(req)).toBe(true);
  });

  it('returns true when Sec-Fetch-Site is "none" (navigation)', async () => {
    const checkOrigin = await importCheckOrigin();
    const req = makeReq({ 'sec-fetch-site': 'none' });
    expect(checkOrigin(req)).toBe(true);
  });

  it('returns false for an unknown origin not in the allowlist', async () => {
    const checkOrigin = await importCheckOrigin();
    const req = makeReq({ origin: 'https://evil.example.com' });
    expect(checkOrigin(req)).toBe(false);
  });

  it('returns true for localhost:3000 origin (dev allowlist)', async () => {
    const checkOrigin = await importCheckOrigin();
    const req = makeReq({ origin: 'http://localhost:3000' });
    expect(checkOrigin(req)).toBe(true);
  });

  it('returns true for localhost:3001 origin (dev allowlist)', async () => {
    const checkOrigin = await importCheckOrigin();
    const req = makeReq({ origin: 'http://localhost:3001' });
    expect(checkOrigin(req)).toBe(true);
  });

  it('returns true when origin host matches request host header', async () => {
    const checkOrigin = await importCheckOrigin();
    const req = makeReq({
      origin: 'https://app.nexyfab.com',
      host: 'app.nexyfab.com',
    });
    expect(checkOrigin(req)).toBe(true);
  });

  it('returns true when origin matches NEXT_PUBLIC_SITE_URL via ALLOWED_ORIGINS', async () => {
    process.env.ALLOWED_ORIGINS = 'https://nexyfab.com';
    const checkOrigin = await importCheckOrigin();
    const req = makeReq({ origin: 'https://nexyfab.com' });
    expect(checkOrigin(req)).toBe(true);
  });

  it('returns true when origin host alone is in ALLOWED_ORIGINS', async () => {
    process.env.ALLOWED_ORIGINS = 'nexyfab.com';
    const checkOrigin = await importCheckOrigin();
    const req = makeReq({ origin: 'https://nexyfab.com' });
    expect(checkOrigin(req)).toBe(true);
  });

  it('returns false for a cross-site header even if origin is in allowlist', async () => {
    process.env.ALLOWED_ORIGINS = 'https://nexyfab.com';
    const checkOrigin = await importCheckOrigin();
    // sec-fetch-site is checked first; cross-site always rejected
    const req = makeReq({
      'sec-fetch-site': 'cross-site',
      origin: 'https://nexyfab.com',
    });
    expect(checkOrigin(req)).toBe(false);
  });
});
