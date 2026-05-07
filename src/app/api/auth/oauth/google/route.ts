import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

// GET /api/auth/oauth/google — redirect to Google OAuth
export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nexyfab.com';
  const redirectUri = `${siteUrl}/api/auth/oauth/google/callback`;
  const lang = req.nextUrl.searchParams.get('lang') ?? 'ko';

  if (!clientId) {
    return NextResponse.redirect(`${siteUrl}/${lang}/login?error=oauth_unavailable`);
  }

  const state = randomBytes(16).toString('hex');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    state: `${state}:${lang}`,
    prompt: 'consent',
  });

  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  res.cookies.set('oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10,
    path: '/api/auth/oauth',
  });
  return res;
}
