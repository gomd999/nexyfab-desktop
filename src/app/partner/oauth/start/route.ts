/**
 * GET /partner/oauth/start
 *
 * SSO launchpad — generates a CSRF state, stores it in a short-lived
 * cookie, then 302s to `auth.nexysys.com/oauth/authorize` so the user
 * can sign in (or sign up) on the unified NexySys account.
 *
 * After auth-server completes the flow it will redirect back to
 * `/partner/oauth/callback` which validates the state and sets the
 * partner session cookie.
 *
 * Configurable env:
 *   NEXYSYS_ISSUER                 base URL of auth-server (default https://auth.nexysys.com)
 *   NEXYSYS_OAUTH_CLIENT_ID        OAuth client ID provisioned for partner portal
 *   NEXYSYS_OAUTH_REDIRECT_URI     full callback URL (must match what's
 *                                  registered in auth-server)
 *
 * If the OAuth env vars are absent (Phase 2 not yet provisioned for
 * this deploy), we redirect to `/partner/login?err=sso_unconfigured`
 * so the legacy access-code flow remains usable.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

const ISSUER = process.env.NEXYSYS_ISSUER ?? 'https://auth.nexysys.com';
const CLIENT_ID = process.env.NEXYSYS_OAUTH_CLIENT_ID ?? '';
const REDIRECT_URI =
  process.env.NEXYSYS_OAUTH_REDIRECT_URI ??
  'https://nexyfab.com/partner/oauth/callback';

export function GET(req: NextRequest) {
  const lang = req.nextUrl.searchParams.get('lang');
  const returnTo = req.nextUrl.searchParams.get('return_to');

  if (!CLIENT_ID) {
    const url = new URL('/partner/login', req.url);
    url.searchParams.set('err', 'sso_unconfigured');
    if (lang) url.searchParams.set('lang', lang);
    return NextResponse.redirect(url);
  }

  const state = randomBytes(16).toString('base64url');
  const authorizeUrl = new URL(`${ISSUER}/oauth/authorize`);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authorizeUrl.searchParams.set('scope', 'openid email profile nexyfab:partner');
  authorizeUrl.searchParams.set('state', state);
  if (lang) authorizeUrl.searchParams.set('ui_lang', lang);

  // Smuggle the desired post-login path through state so the callback
  // can read it back without trusting any other query param.
  const redirect = new URL(authorizeUrl);
  if (returnTo && returnTo.startsWith('/partner')) {
    redirect.searchParams.set('return_to', returnTo);
  }

  const res = NextResponse.redirect(redirect);
  res.cookies.set('nf_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60, // 10 minutes — generous for slow SSO confirmations
  });
  if (returnTo && returnTo.startsWith('/partner')) {
    res.cookies.set('nf_oauth_return_to', returnTo, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 10 * 60,
    });
  }
  return res;
}
