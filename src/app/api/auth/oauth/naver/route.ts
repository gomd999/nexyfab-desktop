import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const clientId = process.env.NAVER_CLIENT_ID;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nexyfab.com';
  const redirectUri = `${siteUrl}/api/auth/oauth/naver/callback`;
  const lang = req.nextUrl.searchParams.get('lang') ?? 'ko';

  if (!clientId) {
    return NextResponse.redirect(`${siteUrl}/${lang}/login?error=oauth_unavailable`);
  }

  const state = randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state: `${state}:${lang}`,
  });

  const res = NextResponse.redirect(`https://nid.naver.com/oauth2.0/authorize?${params.toString()}`);
  // Store state in httpOnly cookie for CSRF verification in callback
  res.cookies.set('oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10,
    path: '/api/auth/oauth',
  });
  return res;
}
