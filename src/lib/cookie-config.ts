import { COOKIE_DOMAIN } from './service-config';

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
