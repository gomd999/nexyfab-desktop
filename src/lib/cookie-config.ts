import { COOKIE_DOMAIN } from './service-config';
import type { NextResponse } from 'next/server';

type SameSite = 'strict' | 'lax' | 'none';

export const BROWSER_SESSION_COOKIE = 'nf_browser_session';

/** Session-only marker that distinguishes current sessions from legacy persistent cookies. */
export function browserSessionCookie(sameSite: SameSite = 'strict') {
  return {
    name: BROWSER_SESSION_COOKIE,
    value: 'v1',
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite,
      path: '/',
      ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
    },
  } as const;
}

/**
 * Browser-session access token cookie (httpOnly).
 */
export function accessTokenCookie(token: string, sameSite: SameSite = 'strict') {
  return {
    name: 'nf_access_token',
    value: token,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite,
      path: '/',
      ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
    },
  } as const;
}

/**
 * Browser-session refresh token cookie (httpOnly); server-side expiry still applies.
 */
export function refreshTokenCookie(token: string, sameSite: SameSite = 'strict') {
  return {
    name: 'nf_refresh_token',
    value: token,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite,
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
    response.cookies.set(BROWSER_SESSION_COOKIE, '', { ...options, path: '/' });
    response.cookies.set('nf_admin_elev', '', { ...options, path: '/' });
    response.cookies.set('nf_admin_token', '', { ...options, path: '/' });
  };

  clearSet({ ...base, ...domainOptions });
  if (COOKIE_DOMAIN) clearSet(base);
}
