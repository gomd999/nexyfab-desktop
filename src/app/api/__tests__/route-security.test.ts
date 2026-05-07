/**
 * API Route Security Integration Tests
 *
 * Validates that every protected endpoint correctly enforces:
 *   1. Authentication (401 without a valid token)
 *   2. Admin authorisation (401 for non-admin callers on /api/admin/*)
 *   3. CSRF protection (403 on cross-origin state-changing requests)
 *   4. Plan guards (403 for free-tier users on premium endpoints)
 *
 * These tests import the route handlers directly and call them with
 * mock Request objects — no actual HTTP server is spun up.
 *
 * Heavy dependencies (DB, auth, CSRF) are mocked at module level.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Module-level mocks (hoisted before any import that uses them) ────────────

vi.mock('@/lib/auth-middleware', () => ({
  getAuthUser: vi.fn(),
}));

vi.mock('@/lib/admin-auth', () => ({
  verifyAdmin: vi.fn(),
}));

vi.mock('@/lib/db-adapter', () => ({
  getDbAdapter: vi.fn(() => ({
    queryOne: vi.fn().mockResolvedValue(null),
    queryAll: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(undefined),
  })),
  toBool: (v: unknown) => Boolean(v),
}));

vi.mock('@/lib/csrf', () => ({
  checkOrigin: vi.fn(() => true), // default: same-origin (allowed)
}));

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn(() => ({ allowed: true, remaining: 99, resetAt: Date.now() + 60_000 })),
  rateLimitAsync: vi.fn().mockResolvedValue({ allowed: true, remaining: 99, resetAt: Date.now() + 60_000 }),
  rateLimitHeaders: vi.fn(() => ({})),
}));

// ─── Import mocks + route handlers ───────────────────────────────────────────

import { getAuthUser } from '@/lib/auth-middleware';
import { verifyAdmin } from '@/lib/admin-auth';
import { checkOrigin } from '@/lib/csrf';
import { GET as authAccountGET, DELETE as authAccountDELETE } from '../auth/account/route';
import { GET as adminUsersGET, PATCH as adminUsersPATCH, DELETE as adminUsersDELETE } from '../admin/users/route';
import { POST as userApiKeysPOST, GET as userApiKeysGET } from '../user/api-keys/route';
import { GET as healthLiveGET } from '../health/live/route';

const mockGetAuthUser = getAuthUser as ReturnType<typeof vi.fn>;
const mockVerifyAdmin = verifyAdmin as ReturnType<typeof vi.fn>;
const mockCheckOrigin = checkOrigin as ReturnType<typeof vi.fn>;

// ─── Helper: build a minimal NextRequest-compatible object ───────────────────

function makeReq(
  url = 'http://localhost/api/test',
  opts: RequestInit & { cookies?: Record<string, string> } = {},
): Request & { cookies: { get: (name: string) => { value: string } | undefined }; nextUrl: URL } {
  const { cookies = {}, ...fetchOpts } = opts;
  const req = new Request(url, fetchOpts);
  (req as any).cookies = {
    get: (name: string) => (name in cookies ? { value: cookies[name] } : undefined),
  };
  (req as any).nextUrl = new URL(url);
  return req as any;
}

/** Build a free-tier AuthUser stub */
function freeUser() {
  return {
    userId: 'user-free-001',
    email: 'free@test.com',
    plan: 'free' as const,
    globalRole: 'user' as const,
    roles: {},
    orgIds: [],
  };
}

/** Build a pro-tier AuthUser stub */
function proUser() {
  return { ...freeUser(), userId: 'user-pro-001', email: 'pro@test.com', plan: 'pro' as const };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Authentication boundary (/api/auth/account)
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/auth/account — authentication boundary', () => {
  beforeEach(() => { mockGetAuthUser.mockReset(); });

  it('returns 401 when no token is provided', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const res = await authAccountGET(makeReq('http://localhost/api/auth/account') as any);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it('returns 401 for an expired/invalid token', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const res = await authAccountGET(
      makeReq('http://localhost/api/auth/account', {
        headers: { Authorization: 'Bearer invalid.token.here' },
      }) as any,
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 when authenticated but user not in DB', async () => {
    mockGetAuthUser.mockResolvedValue(freeUser());
    // DB mock already returns null for queryOne
    const res = await authAccountGET(makeReq('http://localhost/api/auth/account') as any);
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/auth/account — authentication boundary', () => {
  beforeEach(() => { mockGetAuthUser.mockReset(); });

  it('returns 401 when not authenticated', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const res = await authAccountDELETE(
      makeReq('http://localhost/api/auth/account', { method: 'DELETE' }) as any,
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 when authenticated but confirmation phrase is wrong', async () => {
    mockGetAuthUser.mockResolvedValue(freeUser());
    const { DELETE } = await import('../auth/account/route');
    const res = await DELETE(
      makeReq('http://localhost/api/auth/account', {
        method: 'DELETE',
        body: JSON.stringify({ password: 'pw', confirm: 'wrong phrase' }),
        headers: { 'Content-Type': 'application/json' },
      }) as any,
    );
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Admin authorisation boundary (/api/admin/*)
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/admin/users — admin authorisation boundary', () => {
  beforeEach(() => { mockVerifyAdmin.mockReset(); });

  it('returns 401 when called without admin credentials', async () => {
    mockVerifyAdmin.mockResolvedValue(false);
    const res = await adminUsersGET(makeReq('http://localhost/api/admin/users') as any);
    expect(res.status).toBe(401);
  });

  it('passes through when admin credentials are valid', async () => {
    mockVerifyAdmin.mockResolvedValue(true);
    const res = await adminUsersGET(makeReq('http://localhost/api/admin/users') as any);
    // DB returns empty list → 200 with { users: [], total: 0 } or similar
    expect(res.status).toBe(200);
  });
});

describe('PATCH /api/admin/users — admin authorisation boundary', () => {
  beforeEach(() => { mockVerifyAdmin.mockReset(); });

  it('returns 401 when called without admin credentials', async () => {
    mockVerifyAdmin.mockResolvedValue(false);
    const { PATCH } = await import('../admin/users/route');
    const res = await PATCH(
      makeReq('http://localhost/api/admin/users', {
        method: 'PATCH',
        body: JSON.stringify({ userId: 'u1', plan: 'pro' }),
        headers: { 'Content-Type': 'application/json' },
      }) as any,
    );
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/admin/users — admin authorisation boundary', () => {
  beforeEach(() => { mockVerifyAdmin.mockReset(); });

  it('returns 401 when called without admin credentials', async () => {
    mockVerifyAdmin.mockResolvedValue(false);
    const res = await adminUsersDELETE(
      makeReq('http://localhost/api/admin/users', {
        method: 'DELETE',
        body: JSON.stringify({ userId: 'u1' }),
        headers: { 'Content-Type': 'application/json' },
      }) as any,
    );
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. CSRF protection (/api/user/api-keys POST)
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/user/api-keys — CSRF protection', () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    mockCheckOrigin.mockReset();
  });

  it('returns 403 when request origin is cross-site', async () => {
    mockCheckOrigin.mockReturnValue(false); // cross-origin
    mockGetAuthUser.mockResolvedValue(proUser());
    const res = await userApiKeysPOST(
      makeReq('http://localhost/api/user/api-keys', {
        method: 'POST',
        body: JSON.stringify({ name: 'My Key', scopes: [] }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://evil.com',
        },
      }) as any,
    );
    expect(res.status).toBe(403);
  });

  it('returns 401 when CSRF passes but user is not authenticated', async () => {
    mockCheckOrigin.mockReturnValue(true);
    mockGetAuthUser.mockResolvedValue(null);
    const res = await userApiKeysPOST(
      makeReq('http://localhost/api/user/api-keys', {
        method: 'POST',
        body: JSON.stringify({ name: 'My Key', scopes: [] }),
        headers: { 'Content-Type': 'application/json' },
      }) as any,
    );
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Plan guard (/api/user/api-keys POST — free plan blocked)
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/user/api-keys — plan guard', () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    mockCheckOrigin.mockReturnValue(true);
  });

  it('returns 403 for free-plan users trying to create an API key', async () => {
    mockGetAuthUser.mockResolvedValue(freeUser()); // free plan → limit = 0
    const { POST } = await import('../user/api-keys/route');
    const res = await POST(
      makeReq('http://localhost/api/user/api-keys', {
        method: 'POST',
        body: JSON.stringify({ name: 'My Key', scopes: [] }),
        headers: { 'Content-Type': 'application/json' },
      }) as any,
    );
    expect(res.status).toBe(403);
  });

  it('returns 200-level for pro users (DB creates key)', async () => {
    mockGetAuthUser.mockResolvedValue(proUser()); // pro plan → limit = 1
    const { getDbAdapter } = await import('@/lib/db-adapter');
    const mockDb = getDbAdapter as ReturnType<typeof vi.fn>;
    mockDb.mockReturnValue({
      queryOne: vi.fn().mockResolvedValue({ c: 0 }), // 0 existing keys
      execute: vi.fn().mockResolvedValue(undefined),
    });

    const res = await userApiKeysPOST(
      makeReq('http://localhost/api/user/api-keys', {
        method: 'POST',
        body: JSON.stringify({ name: 'My Key', scopes: ['read:rfq'] }),
        headers: { 'Content-Type': 'application/json' },
      }) as any,
    );
    // 200 or 201 — key created
    expect(res.status).toBeLessThan(300);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. GET /api/user/api-keys — authentication
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/user/api-keys — authentication', () => {
  beforeEach(() => { mockGetAuthUser.mockReset(); });

  it('returns 401 without a token', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const res = await userApiKeysGET(makeReq('http://localhost/api/user/api-keys') as any);
    expect(res.status).toBe(401);
  });

  it('returns 200 with an empty list when authenticated and no keys exist', async () => {
    mockGetAuthUser.mockResolvedValue(freeUser());
    const { getDbAdapter } = await import('@/lib/db-adapter');
    const mockDb = getDbAdapter as ReturnType<typeof vi.fn>;
    mockDb.mockReturnValue({ queryAll: vi.fn().mockResolvedValue([]) });

    const res = await userApiKeysGET(makeReq('http://localhost/api/user/api-keys') as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.keys)).toBe(true);
    expect(body.keys).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Health endpoints (public, no auth required)
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/health/live — public endpoint', () => {
  it('returns 200 without any authentication', async () => {
    const res = await healthLiveGET();
    expect(res.status).toBe(200);
  });
});
