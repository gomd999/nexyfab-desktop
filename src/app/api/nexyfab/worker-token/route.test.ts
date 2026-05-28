/**
 * /api/nexyfab/worker-token — W17 endpoint contract tests.
 *
 * Verifies the auth gate, payload shape, and TTL claim. Mocks
 * getAuthUser + signJWT so the test stays isolated from the real
 * auth middleware (which would need a populated DB).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getAuthUser = vi.fn();
const signJWT = vi.fn();

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser }));
vi.mock('@/lib/jwt', () => ({ signJWT }));

let GET: typeof import('./route').GET;

beforeEach(async () => {
  vi.resetModules();
  getAuthUser.mockReset();
  signJWT.mockReset();
  ({ GET } = await import('./route'));
});

function call() {
  const req = new Request('http://test/api/nexyfab/worker-token', {
    method: 'GET',
  });
  return GET(req as unknown as Parameters<typeof GET>[0]);
}

describe('GET /api/nexyfab/worker-token', () => {
  it('returns 401 when getAuthUser returns null', async () => {
    getAuthUser.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorized');
    expect(signJWT).not.toHaveBeenCalled();
  });

  it('returns token + 900s TTL for authenticated user', async () => {
    getAuthUser.mockResolvedValue({
      userId: 'u1', email: 'x@x', plan: 'pro', emailVerified: true,
      globalRole: 'user', roles: [], orgIds: [],
    });
    signJWT.mockResolvedValue('eyJ.test.token');
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe('eyJ.test.token');
    expect(body.expiresInSeconds).toBe(900);
  });

  it('embeds service=occt-worker claim in the signed JWT', async () => {
    getAuthUser.mockResolvedValue({
      userId: 'u1', email: 'x@x', plan: 'pro', emailVerified: false,
      globalRole: 'user', roles: [], orgIds: [],
    });
    signJWT.mockResolvedValue('tok');
    await call();
    expect(signJWT).toHaveBeenCalledOnce();
    const [payload, ttl] = signJWT.mock.calls[0]!;
    expect(payload.service).toBe('occt-worker');
    expect(payload.sub).toBe('u1');
    expect(payload.email).toBe('x@x');
    expect(payload.plan).toBe('pro');
    expect(payload.emailVerified).toBe(false);
    expect(ttl).toBe(900);
  });

  it('returns 500 when signJWT throws', async () => {
    getAuthUser.mockResolvedValue({
      userId: 'u1', email: 'x@x', plan: 'pro', emailVerified: true,
      globalRole: 'user', roles: [], orgIds: [],
    });
    signJWT.mockRejectedValue(new Error('crypto broken'));
    const res = await call();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('sign failed');
  });
});
