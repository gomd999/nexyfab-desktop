/**
 * POST /partner/oauth/logout
 *
 * Clears the partner-side session cookies (`nf_access_token` + the OAuth
 * state cookies) and returns 200. Client also clears the legacy
 * `localStorage.partnerSession` / `partnerInfo` keys.
 *
 * The NexySys auth-server itself keeps its session — partners who want a
 * full logout from auth.nexysys.com follow that link from the
 * NexySys account settings. Mirrors how customer-side logout works.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set('nf_access_token', '', { path: '/', maxAge: 0 });
  res.cookies.set('nf_partner_sso', '', { path: '/', maxAge: 0 });
  res.cookies.set('nf_oauth_state', '', { path: '/', maxAge: 0 });
  res.cookies.set('nf_oauth_return_to', '', { path: '/', maxAge: 0 });
  return res;
}
