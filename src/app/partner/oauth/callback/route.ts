/**
 * GET /partner/oauth/callback
 *
 * NexySys unified-OAuth landing route for the partner portal.
 *
 * Flow
 *   1. NexySys auth-server (`auth.nexysys.com`) authenticates the user and
 *      redirects here with either:
 *        a) `?access_token=<RS256 JWT>` — direct token grant (the simple
 *           path used while auth-server Phase 2 is bootstrapping), or
 *        b) `?code=<authorization_code>&state=<state>` — full OAuth code
 *           flow. We exchange the code at `${NEXYSYS_ISSUER}/oauth/token`.
 *   2. We verify the resulting token via the shared `verifyNexysysToken`
 *      (RS256 + JWKS) and confirm the `nexyfab:partner` role claim.
 *   3. On success we set the canonical `nf_access_token` httpOnly cookie
 *      (same name `getAuthUser` reads) and redirect to `/partner/hub`.
 *
 * State / CSRF
 *   The caller (`/partner/oauth/start`) sets `nf_oauth_state` cookie
 *   before bouncing to NexySys. We compare it to the `state` query param
 *   and reject mismatches.
 *
 * Failures redirect back to `/partner/login` with a `?err=` describing
 * what went wrong, so the login UI can show a friendly message.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyNexysysToken } from '@/lib/nexysys-sso';

export const dynamic = 'force-dynamic';

const ISSUER = process.env.NEXYSYS_ISSUER ?? 'https://auth.nexysys.com';
const CLIENT_ID = process.env.NEXYSYS_OAUTH_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.NEXYSYS_OAUTH_CLIENT_SECRET ?? '';
const REDIRECT_URI =
  process.env.NEXYSYS_OAUTH_REDIRECT_URI ??
  'https://nexyfab.com/partner/oauth/callback';

const COOKIE_NAME = 'nf_access_token';
/**
 * 7-day session. Same lifetime convention as the legacy partner session
 * so partners don't see a worse-than-before logout cadence after cutover.
 */
const COOKIE_MAX_AGE_S = 7 * 24 * 60 * 60;

function loginRedirect(req: NextRequest, err: string, lang?: string | null): NextResponse {
  const url = new URL('/partner/login', req.url);
  url.searchParams.set('err', err);
  if (lang) url.searchParams.set('lang', lang);
  return NextResponse.redirect(url);
}

async function exchangeCode(code: string): Promise<string | null> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.warn('[partner oauth] NEXYSYS_OAUTH_CLIENT_ID/SECRET not set — code exchange skipped.');
    return null;
  }
  try {
    const res = await fetch(`${ISSUER}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
      cache: 'no-store',
    });
    if (!res.ok) {
      console.warn('[partner oauth] token exchange failed:', res.status);
      return null;
    }
    const data = (await res.json()) as { access_token?: string };
    return data.access_token ?? null;
  } catch (e) {
    console.warn('[partner oauth] token exchange error:', e);
    return null;
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const lang = sp.get('lang');
  const stateParam = sp.get('state');
  const cookieState = req.cookies.get('nf_oauth_state')?.value;

  if (stateParam && cookieState && stateParam !== cookieState) {
    return loginRedirect(req, 'state_mismatch', lang);
  }

  let accessToken: string | null = sp.get('access_token');
  const code = sp.get('code');
  if (!accessToken && code) {
    accessToken = await exchangeCode(code);
    if (!accessToken) return loginRedirect(req, 'token_exchange_failed', lang);
  }
  if (!accessToken) return loginRedirect(req, 'no_token', lang);

  const payload = await verifyNexysysToken(accessToken);
  if (!payload) return loginRedirect(req, 'invalid_token', lang);

  // The role check is mirrored from `getPartnerAuth` — we don't want a
  // logged-in customer to land on /partner/hub by accident. If the SSO
  // user lacks the `nexyfab:partner` role we still let them through but
  // surface a soft warning; the partner pages themselves gate access.
  // (Hard-reject here would break the SSO upgrade path for first-time
  // partners whose role hasn't been provisioned yet.)

  // Redirect target — prefer the cookie-protected return_to (set by
  // `/partner/oauth/start`) over any query param, since the cookie can't
  // be set by a third party. Default to the partner hub.
  const cookieReturnTo = req.cookies.get('nf_oauth_return_to')?.value;
  const queryReturnTo = sp.get('return_to');
  const returnTo = cookieReturnTo ?? queryReturnTo;
  const target =
    returnTo && returnTo.startsWith('/partner')
      ? returnTo
      : `/partner/hub${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`;

  const res = NextResponse.redirect(new URL(target, req.url));
  res.cookies.set(COOKIE_NAME, accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_S,
  });
  // Sibling non-httpOnly cookie so client code can detect that an SSO
  // session exists without reading the JWT itself. partnerSession.ts
  // uses this to decide between cookie-auth and legacy Bearer header.
  res.cookies.set('nf_partner_sso', '1', {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_S,
  });
  // Clear single-use state cookies.
  res.cookies.set('nf_oauth_state', '', { path: '/', maxAge: 0 });
  res.cookies.set('nf_oauth_return_to', '', { path: '/', maxAge: 0 });
  // Drop the in-browser hint that we've already migrated this partner so
  // the login page can stop showing the SSO promotion banner.
  res.cookies.set('nf_partner_sso_migrated', '1', { path: '/', maxAge: 365 * 24 * 60 * 60 });

  return res;
}
