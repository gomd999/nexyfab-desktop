import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  queryOne: vi.fn(),
}));

vi.mock('@/lib/auth-middleware', () => ({
  getAuthUser: mocks.getAuthUser,
}));

vi.mock('@/lib/db-adapter', () => ({
  getDbAdapter: () => ({ queryOne: mocks.queryOne }),
  toBool: (value: number | boolean) => value === true || value === 1,
}));

import { GET } from './route';

function request(cookie?: string): NextRequest {
  return new NextRequest('https://nexyfab.com/api/auth/session', {
    headers: cookie ? { cookie } : undefined,
  });
}

describe('GET /api/auth/session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('represents a genuine guest as a non-cacheable anonymous state', async () => {
    mocks.getAuthUser.mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      authenticated: false,
      user: null,
      refreshable: false,
    });
    expect(mocks.queryOne).not.toHaveBeenCalled();
  });

  it('reports an opaque refresh-cookie hint without exposing its value', async () => {
    mocks.getAuthUser.mockResolvedValue(null);

    const response = await GET(request('nf_refresh_token=secret-refresh-token; nf_browser_session=v1'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ authenticated: false, user: null, refreshable: true });
    expect(JSON.stringify(payload)).not.toContain('secret-refresh-token');
  });

  it('clears legacy persistent auth cookies without a browser-session marker', async () => {
    const response = await GET(request('nf_access_token=legacy; nf_refresh_token=legacy-refresh'));

    await expect(response.json()).resolves.toMatchObject({ authenticated: false, user: null });
    expect(response.headers.getSetCookie().some(cookie => cookie.startsWith('nf_access_token=') && /Max-Age=0/i.test(cookie))).toBe(true);
    expect(mocks.getAuthUser).not.toHaveBeenCalled();
  });

  it('returns the authenticated user while keeping the response non-cacheable', async () => {
    mocks.getAuthUser.mockResolvedValue({ userId: 'user-1' });
    mocks.queryOne.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
      plan: 'pro',
      email_verified: 1,
      project_count: 3,
      avatar_url: null,
      stage: 'B',
      role: 'user',
    });

    const response = await GET(request('nf_access_token=access-token; nf_browser_session=v1'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(payload.authenticated).toBe(true);
    expect(payload.user).toMatchObject({
      id: 'user-1',
      email: 'user@example.com',
      plan: 'pro',
      projectCount: 3,
      emailVerified: true,
      nexyfabStage: 'B',
    });
  });

  it('treats an account removed during reconciliation as authoritative anonymous', async () => {
    mocks.getAuthUser.mockResolvedValue({ userId: 'deleted-user' });
    mocks.queryOne.mockResolvedValue(null);

    const response = await GET(request('nf_access_token=stale-access-token; nf_browser_session=v1'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authenticated: false,
      user: null,
      refreshable: false,
    });
  });
});
