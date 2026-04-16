import { NextRequest, NextResponse } from 'next/server';
import { randomBytes, createHash } from 'crypto';

/**
 * NexySys SSO — PKCE initiator.
 *
 * Generates an S256 verifier + state, stashes them in short-lived httpOnly
 * cookies, and 302s the browser to auth.nexysys.com/oauth/authorize. The
 * matching /auth/callback handler exchanges the code at /oauth/token.
 *
 * The redirect_uri here MUST match one of the entries seeded in
 * auth-server migrations/0002_seed_clients.sql for client_id=nexyfab-web.
 */

const ISSUER = process.env.NEXYSYS_ISSUER ?? 'https://auth.nexysys.com';
const CLIENT_ID = 'nexyfab-web';

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function GET(req: NextRequest) {
  const returnTo = req.nextUrl.searchParams.get('return_to') ?? '/account';

  // RFC 7636: verifier = 43-128 chars unreserved base64url
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const state = base64url(randomBytes(16));

  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/auth/callback`;

  const authorizeUrl = new URL(`${ISSUER}/oauth/authorize`);
  authorizeUrl.searchParams.set('client_id', CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('scope', 'openid profile email orgs');
  authorizeUrl.searchParams.set('state', state);

  const res = NextResponse.redirect(authorizeUrl.toString(), 302);

  const cookieBase = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 10 * 60,
  };
  res.cookies.set('nf_pkce_verifier', verifier, cookieBase);
  res.cookies.set('nf_sso_state', state, cookieBase);
  // Only accept internal paths to avoid open-redirect.
  const safeReturn = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/account';
  res.cookies.set('nf_sso_return_to', safeReturn, cookieBase);

  return res;
}
