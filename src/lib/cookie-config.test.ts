import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

afterEach(() => vi.unstubAllEnvs());

describe('authentication cookie policy', () => {
  it('pins access and refresh cookie security attributes in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { accessTokenCookie, refreshTokenCookie } = await import('./cookie-config');

    const access = accessTokenCookie('access');
    const refresh = refreshTokenCookie('refresh');
    expect(access.options).toMatchObject({ httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 900 });
    expect(refresh.options).toMatchObject({ httpOnly: true, secure: true, sameSite: 'strict', path: '/api/auth', maxAge: 2_592_000 });
  });

  it('expires user, refresh, elevation and legacy admin cookies together', async () => {
    const { clearAuthCookies } = await import('./cookie-config');
    const response = NextResponse.json({ ok: true });

    clearAuthCookies(response);

    const headers = response.headers.getSetCookie();
    for (const name of ['nf_access_token', 'nf_refresh_token', 'nf_admin_elev', 'nf_admin_token']) {
      const cookie = headers.find(value => value.startsWith(`${name}=`));
      expect(cookie, `${name} was not cleared`).toBeDefined();
      expect(cookie).toMatch(/Max-Age=0/i);
      expect(cookie).toMatch(/Expires=/i);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
    }
  });
});
