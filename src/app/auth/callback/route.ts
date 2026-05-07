import { NextRequest, NextResponse } from 'next/server';

/**
 * NexySys SSO — OAuth2 Authorization Code + PKCE callback.
 *
 * Pairs with /api/auth/nexysys/start. The redirect_uri sent to /oauth/token
 * must byte-for-byte match what was sent to /oauth/authorize, which is why
 * we rebuild it from req.nextUrl.origin here.
 */

const ISSUER = process.env.NEXYSYS_ISSUER ?? 'https://auth.nexysys.com';
const CLIENT_ID = 'nexyfab-web';

function fail(req: NextRequest, reason: string) {
  const url = new URL('/login', req.nextUrl.origin);
  url.searchParams.set('sso_error', reason);
  return NextResponse.redirect(url.toString(), 302);
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  if (!code) return fail(req, 'missing_code');

  const verifier = req.cookies.get('nf_pkce_verifier')?.value;
  const savedState = req.cookies.get('nf_sso_state')?.value;
  const returnTo = req.cookies.get('nf_sso_return_to')?.value ?? '/account';
  if (!verifier) return fail(req, 'missing_verifier');
  if (!savedState || savedState !== state) return fail(req, 'state_mismatch');

  const redirectUri = `${req.nextUrl.origin}/auth/callback`;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
  });

  let tokenRes: Response;
  try {
    tokenRes = await fetch(`${ISSUER}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch {
    return fail(req, 'network_error');
  }

  if (!tokenRes.ok) {
    const text = await tokenRes.text().catch(() => '');
    console.error('[SSO] token exchange failed:', tokenRes.status, text);
    return fail(req, 'token_exchange_failed');
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!tokens.access_token) return fail(req, 'no_access_token');

  const safeReturn = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/account';
  const res = NextResponse.redirect(`${req.nextUrl.origin}${safeReturn}`, 302);

  const secure = process.env.NODE_ENV === 'production';
  res.cookies.set('nf_access_token', tokens.access_token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: tokens.expires_in ?? 15 * 60,
  });
  if (tokens.refresh_token) {
    res.cookies.set('nf_refresh_token', tokens.refresh_token, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 3600,
    });
  }

  // Clean up PKCE scratch cookies.
  res.cookies.delete('nf_pkce_verifier');
  res.cookies.delete('nf_sso_state');
  res.cookies.delete('nf_sso_return_to');

  return res;
}
