/**
 * /api/nexyfab/r2-fetch — W10 D5 endpoint contract tests.
 *
 * Path-scope gate is the security boundary: a malicious payload
 * crafted with another user's key must be rejected at the route
 * before the storage adapter is touched.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getAuthUser = vi.fn();
const getSignedUrl = vi.fn();
const getStorage = vi.fn(() => ({ getSignedUrl }));

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser }));
vi.mock('@/lib/storage', () => ({ getStorage }));
vi.mock('@/app/[lang]/shape-generator/lib/telemetry', () => ({
  reportError: vi.fn(),
}));

let GET: typeof import('./route').GET;

beforeEach(async () => {
  vi.resetModules();
  getAuthUser.mockReset();
  getSignedUrl.mockReset();
  ({ GET } = await import('./route'));
});

function call(key?: string) {
  const url = key
    ? `http://test/api/nexyfab/r2-fetch?key=${encodeURIComponent(key)}`
    : 'http://test/api/nexyfab/r2-fetch';
  // The route uses NextRequest.nextUrl.searchParams. We build a
  // minimal stand-in that the handler reads — the real NextRequest
  // type-extends Request with a `nextUrl: URL` property.
  const req = new Request(url, { method: 'GET' });
  // Patch nextUrl onto the request — handlers cast (req as NextRequest)
  // and we just need searchParams to be accessible.
  Object.defineProperty(req, 'nextUrl', {
    value: new URL(url),
    writable: false,
  });
  return GET(req as unknown as Parameters<typeof GET>[0]);
}

describe('GET /api/nexyfab/r2-fetch', () => {
  beforeEach(() => {
    getAuthUser.mockResolvedValue({
      userId: 'user-abc', email: 'x@x', plan: 'pro', emailVerified: true,
      globalRole: 'user', roles: [], orgIds: [],
    });
  });

  it('401 when unauthenticated', async () => {
    getAuthUser.mockResolvedValue(null);
    const res = await call('occt-ops/user-abc/x.stl');
    expect(res.status).toBe(401);
  });

  it('400 when key missing', async () => {
    const res = await call();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/key required/);
  });

  it('400 on path traversal', async () => {
    const res = await call('occt-ops/user-abc/../other/secret.step');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid key');
  });

  it('400 on leading slash', async () => {
    const res = await call('/occt-ops/user-abc/x.stl');
    expect(res.status).toBe(400);
  });

  it('400 when prefix is not occt-ops/', async () => {
    const res = await call('something-else/user-abc/x.stl');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/key prefix not allowed/);
  });

  it('400 when path is too short for prefix check', async () => {
    const res = await call('occt-ops/onlytwo');
    expect(res.status).toBe(400);
  });

  it('403 cross-user prefix', async () => {
    const res = await call('occt-ops/other-user/x.stl');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('forbidden');
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('200 same-user key → returns signedUrl + ttl', async () => {
    getSignedUrl.mockResolvedValue('https://r2.example/signed?x=1');
    const res = await call('occt-ops/user-abc/boolean/t-x.stl');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.signedUrl).toBe('https://r2.example/signed?x=1');
    expect(body.expiresInSeconds).toBe(300);
    expect(getSignedUrl).toHaveBeenCalledWith('occt-ops/user-abc/boolean/t-x.stl', 300);
  });

  it('super_admin can read cross-user keys', async () => {
    getAuthUser.mockResolvedValue({
      userId: 'admin-1', email: 'a@x', plan: 'pro', emailVerified: true,
      globalRole: 'super_admin', roles: [], orgIds: [],
    });
    getSignedUrl.mockResolvedValue('https://r2.example/signed');
    const res = await call('occt-ops/user-abc/x.stl');
    expect(res.status).toBe(200);
  });

  it('500 when storage.getSignedUrl throws', async () => {
    getSignedUrl.mockRejectedValue(new Error('R2 unreachable'));
    const res = await call('occt-ops/user-abc/x.stl');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('sign failed');
  });

  it('400 when key exceeds 512 chars', async () => {
    const big = 'occt-ops/user-abc/' + 'x'.repeat(600);
    const res = await call(big);
    expect(res.status).toBe(400);
  });
});
