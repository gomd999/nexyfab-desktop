import { COOKIE_DOMAIN } from './service-config';
import type { NextResponse } from 'next/server';

type SameSite = 'strict' | 'lax' | 'none';

/**
 * Standard cookie options for access token (httpOnly, 15min)
 */
export function accessTokenCookie(token: string, sameSite: SameSite = 'strict') {
  return {
    name: 'nf_access_token',
    value: token,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite,
      maxAge: 15 * 60,
      path: '/',
      ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
    },
  } as const;
}

/**
 * Standard cookie options for refresh token (httpOnly, 30days)
 */
export function refreshTokenCookie(token: string, sameSite: SameSite = 'strict') {
  return {
    name: 'nf_refresh_token',
    value: token,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite,
      maxAge: 30 * 24 * 3600,
      path: '/api/auth',
      ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
    },
  } as const;
}

/** Expire every authentication/step-up cookie, including host-only legacy copies. */
export function clearAuthCookies(response: NextResponse): void {
  const base = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    maxAge: 0,
    expires: new Date(0),
  };
  const domainOptions = COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {};

  const clearSet = (options: typeof base & { domain?: string }) => {
    response.cookies.set('nf_access_token', '', { ...options, path: '/' });
    response.cookies.set('nf_refresh_token', '', { ...options, path: '/api/auth' });
    response.cookies.set('nf_admin_elev', '', { ...options, path: '/' });
    response.cookies.set('nf_admin_token', '', { ...options, path: '/' });
  };

  clearSet({ ...base, ...domainOptions });
  if (COOKIE_DOMAIN) clearSet(base);
}
