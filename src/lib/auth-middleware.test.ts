// Unit tests for auth-middleware
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { signJWT } from './jwt';

// NextRequest is a superset of Request; cast via unknown to satisfy the type
// without importing from next/server (which would trigger the Next.js runtime).
async function importModule() {
  const mod = await import('./auth-middleware');
  return mod.getAuthUser;
}

type TestRequest = Request & {
  cookies: { get: () => undefined };
};

function asNextRequest(req: TestRequest): NextRequest {
  return req as unknown as NextRequest;
}

function makeRequest(token?: string): TestRequest {
  const req = new Request('http://localhost/api/test', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }) as TestRequest;
  // Simulate NextRequest.cookies (getAuthUser reads cookies first)
  req.cookies = { get: () => undefined };
  return req;
}

let apiKeyFixtureEnabled = false;
let userFixtureExists = true;
let userFixtureLockedUntil: number | null = null;

describe('getAuthUser', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    apiKeyFixtureEnabled = false;
    userFixtureExists = true;
    userFixtureLockedUntil = null;
    vi.doMock('./db-adapter', () => ({
      getDbAdapter: () => ({
        queryAll: vi.fn().mockResolvedValue([]),
        queryOne: vi.fn(async (sql: string) => {
          if (apiKeyFixtureEnabled && sql.includes('FROM nf_api_keys')) return { id: 'ak-1', user_id: 'user-42', scopes: '["read:projects"]', ip_whitelist: '[]', status: 'active', expires_at: null };
          if (apiKeyFixtureEnabled && sql.includes('SELECT id, email, plan FROM nf_users')) return { id: 'user-42', email: 'api@example.com', plan: 'pro' };
          if (sql.includes('FROM nf_users WHERE id = ?')) {
            if (!userFixtureExists) return undefined;
            return {
              email: apiKeyFixtureEnabled ? 'api@example.com' : 'hello@example.com',
              plan: 'pro',
              role: 'user',
              email_verified: 1,
              locked_until: userFixtureLockedUntil,
              pro_grace_until: null,
              plan_expires_at: null,
              plan_fallback: null,
            };
          }
          return undefined;
        }),
        execute: vi.fn().mockResolvedValue({ changes: 0 }),
      }),
    }));
    // Ensure we're not accidentally in demo-auth mode
    delete process.env.ALLOW_DEMO_AUTH;
    delete process.env.DEMO_TOKEN_LIST;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('returns null when Authorization header is missing', async () => {
    const getAuthUser = await importModule();
    const req = makeRequest();
    const result = await getAuthUser(asNextRequest(req));
    expect(result).toBeNull();
  });

  it('returns null when Authorization header has no Bearer prefix', async () => {
    const getAuthUser = await importModule();
    const req = new Request('http://localhost/api/test', {
      headers: { Authorization: 'Basic sometoken' },
    }) as TestRequest;
    req.cookies = { get: () => undefined };
    const result = await getAuthUser(asNextRequest(req));
    expect(result).toBeNull();
  });

  it('returns null for a malformed / invalid token string', async () => {
    const getAuthUser = await importModule();
    const req = makeRequest('not.a.valid.jwt.at.all');
    const result = await getAuthUser(asNextRequest(req));
    expect(result).toBeNull();
  });

  it('returns null for an expired token', async () => {
    const getAuthUser = await importModule();
    const expired = await signJWT(
      { sub: 'user-1', email: 'exp@example.com', plan: 'free' },
      -1, // already expired
    );
    const req = makeRequest(expired);
    const result = await getAuthUser(asNextRequest(req));
    expect(result).toBeNull();
  });

  it('returns AuthUser for a valid token', async () => {
    const getAuthUser = await importModule();
    const token = await signJWT({
      sub: 'user-42',
      email: 'hello@example.com',
      plan: 'pro',
    });
    const req = makeRequest(token);
    const result = await getAuthUser(asNextRequest(req));
    expect(result).not.toBeNull();
    expect(result?.userId).toBe('user-42');
    expect(result?.email).toBe('hello@example.com');
    expect(result?.plan).toBe('pro');
  });

  it('rejects a still-valid access token after the account is deleted', async () => {
    userFixtureExists = false;
    const getAuthUser = await importModule();
    const token = await signJWT({ sub: 'user-42', email: 'old@example.com', plan: 'pro' });

    expect(await getAuthUser(asNextRequest(makeRequest(token)))).toBeNull();
  });

  it('rejects a still-valid access token after the account is locked', async () => {
    userFixtureLockedUntil = Date.now() + 60_000;
    const getAuthUser = await importModule();
    const token = await signJWT({ sub: 'user-42', email: 'old@example.com', plan: 'pro' });

    expect(await getAuthUser(asNextRequest(makeRequest(token)))).toBeNull();
  });

  it('attaches validated API key id and scopes without exposing the raw key', async () => {
    apiKeyFixtureEnabled = true;
    const getAuthUser = await importModule();
    const raw = `nf_live_${'a'.repeat(64)}`;
    const result = await getAuthUser(asNextRequest(makeRequest(raw)));
    expect(result?.apiKey).toEqual({ id: 'ak-1', scopes: ['read:projects'] });
    expect(JSON.stringify(result)).not.toContain(raw);
  });

  it('returns null for demo token when ALLOW_DEMO_AUTH is not set', async () => {
    // NODE_ENV=test (vitest default), no ALLOW_DEMO_AUTH
    process.env.DEMO_TOKEN_LIST = 'demo-token-testuser';
    const getAuthUser = await importModule();
    const req = makeRequest('demo-token-testuser');
    const result = await getAuthUser(asNextRequest(req));
    // Should fall through to JWT verification and fail (not a real JWT)
    expect(result).toBeNull();
  });

  it('returns null for demo token when DEMO_TOKEN_LIST is empty even with ALLOW_DEMO_AUTH=true', async () => {
    // Simulate development environment with ALLOW_DEMO_AUTH but no tokens listed
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'development', writable: true, configurable: true });
    process.env.ALLOW_DEMO_AUTH = 'true';
    process.env.DEMO_TOKEN_LIST = '';
    const getAuthUser = await importModule();
    const req = makeRequest('demo-token-anyuser');
    // No matching demo token → falls through to JWT verify → null
    const result = await getAuthUser(asNextRequest(req));
    expect(result).toBeNull();
  });
});
