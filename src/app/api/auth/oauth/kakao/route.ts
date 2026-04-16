import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

// GET /api/auth/oauth/kakao — redirect to Kakao OAuth
export async function GET(req: NextRequest) {
  const clientId = process.env.KAKAO_CLIENT_ID;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nexyfab.com';
  const redirectUri = `${siteUrl}/api/auth/oauth/kakao/callback`;
  const lang = req.nextUrl.searchParams.get('lang') ?? 'ko';

  if (!clientId) {
    return NextResponse.redirect(`${siteUrl}/${lang}/login?error=oauth_unavailable`);
  }

  // Generate CSRF state token
  const state = randomBytes(16).toString('hex');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'account_email profile_nickname',
    state: `${state}:${lang}`,
  });

  const res = NextResponse.redirect(`https://kauth.kakao.com/oauth/authorize?${params.toString()}`);
  // Store state in httpOnly cookie for CSRF verification in callback
  res.cookies.set('oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10, // 10 minutes
    path: '/api/auth/oauth',
  });
  return res;
}
