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

describe('getAuthUser', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.doMock('./db-adapter', () => ({
      getDbAdapter: () => ({
        queryAll: vi.fn().mockResolvedValue([]),
        queryOne: vi.fn().mockResolvedValue({ role: 'user', email_verified: 1 }),
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
