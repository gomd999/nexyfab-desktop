import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { signJWT } from '@/lib/jwt';
import { getStorage } from '@/lib/storage';
import { recordLoginAndCheck } from '@/lib/login-security';
import { randomBytes, createHash } from 'crypto';
import { SERVICE_NAME } from '@/lib/service-config';
import { accessTokenCookie, refreshTokenCookie } from '@/lib/cookie-config';
import { getTrustedClientIp } from '@/lib/client-ip';
import { parseUserStageColumn } from '@/lib/stage-engine';

export const dynamic = 'force-dynamic';

const ALLOWED_LANGS = new Set(['ko', 'en', 'ja', 'zh']);

export async function GET(req: NextRequest) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nexyfab.com';
  const code = req.nextUrl.searchParams.get('code');
  const stateParam = req.nextUrl.searchParams.get('state') ?? '';
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = `${siteUrl}/api/auth/oauth/google/callback`;

  const [returnedState, rawLang] = stateParam.split(':');
  const lang = ALLOWED_LANGS.has(rawLang ?? '') ? rawLang : 'ko';

  // Verify CSRF state
  const storedState = req.cookies.get('oauth_state')?.value;
  if (!storedState || storedState !== returnedState) {
    return NextResponse.redirect(`${siteUrl}/${lang}/login?error=oauth_csrf`);
  }

  if (!code || !clientId || !clientSecret) {
    return NextResponse.redirect(`${siteUrl}/${lang}/login?error=oauth_failed`);
  }

  try {
    // 1. Exchange code for token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenRes.ok) throw new Error('Token exchange failed');
    const tokenData = await tokenRes.json() as { access_token: string; id_token?: string };

    // 2. Get user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!userRes.ok) throw new Error('User info failed');
    const userData = await userRes.json() as {
      id: string;
      email?: string;
      name?: string;
      picture?: string;
      verified_email?: boolean;
      locale?: string;
    };

    const email = userData.email;
    const name = userData.name ?? 'Google User';

    if (!email) {
      return NextResponse.redirect(`${siteUrl}/${lang}/login?error=email_required`);
    }

    // Google locale → language/country (e.g. "ko" or "en-US")
    const googleLocale = userData.locale ?? '';
    const detectedLang = ALLOWED_LANGS.has(lang!) ? lang : (ALLOWED_LANGS.has(googleLocale.slice(0, 2)) ? googleLocale.slice(0, 2) : 'en');
    const detectedCountry = googleLocale.includes('-') ? googleLocale.split('-')[1]?.toUpperCase() : '';

    // 3. Upsert user
    const db = getDbAdapter();
    const ip = getTrustedClientIp(req.headers);
    let user = await db.queryOne<{ id: string; email: string; plan: string; name: string }>(
      'SELECT id, email, plan, name FROM nf_users WHERE email = ?', email,
    );
    const loginNow = Date.now();

    if (!user) {
      const userId = `u-${crypto.randomUUID()}`;
      await db.execute(
        `INSERT INTO nf_users (id, email, name, plan, email_verified, created_at, signup_source, language, country,
          last_login_at, login_count, signup_ip, last_login_ip,
          services, signup_service, ${SERVICE_NAME}_plan, oauth_provider, oauth_id, updated_at)
         VALUES (?, ?, ?, 'free', 1, ?, 'google', ?, ?,
          ?, 1, ?, ?,
          ?, ?, 'free', 'google', ?, ?)`,
        userId, email, name, loginNow, detectedLang, detectedCountry || null,
        loginNow, ip, ip,
        JSON.stringify([SERVICE_NAME]), SERVICE_NAME, userData.id ?? null, loginNow,
      );
      user = { id: userId, email, plan: 'free', name };
    } else {
      // 서비스 태그 + 로그인 추적 업데이트
      const currentServices: string[] = JSON.parse(
        (await db.queryOne<{ services: string }>('SELECT services FROM nf_users WHERE id = ?', user.id))?.services || '[]',
      );
      if (!currentServices.includes(SERVICE_NAME)) currentServices.push(SERVICE_NAME);
      await db.execute(
        `UPDATE nf_users SET last_login_at = ?, login_count = COALESCE(login_count, 0) + 1, last_login_ip = ?,
          services = ?, oauth_provider = COALESCE(oauth_provider, 'google'),
          ${SERVICE_NAME}_plan = COALESCE(${SERVICE_NAME}_plan, 'free'), updated_at = ? WHERE id = ?`,
        loginNow, ip, JSON.stringify(currentServices), loginNow, user.id,
      );
    }

    // 3-b. 프로필 사진 R2 업로드
    if (userData.picture) {
      try {
        const imgRes = await fetch(userData.picture, { signal: AbortSignal.timeout(5_000) });
        if (imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          const ext = imgRes.headers.get('content-type')?.includes('png') ? 'png' : 'jpg';
          const storage = getStorage();
          const { url } = await storage.upload(buf, `avatar.${ext}`, `avatars/${user.id}`);
          await db.execute('UPDATE nf_users SET avatar_url = ? WHERE id = ?', url, user.id);
        }
      } catch {
        // 프로필 사진 실패해도 로그인은 정상 진행
      }
    }

    // 4. 보안 검사
    const { blocked } = await recordLoginAndCheck(
      { userId: user.id, ip, country: detectedCountry || null, userAgent: req.headers.get('user-agent'), method: 'google', success: true },
      req.headers,
    );
    if (blocked) {
      return NextResponse.redirect(`${siteUrl}/${lang}/login?error=account_locked`);
    }

    // 5. Issue JWT + refresh token (동시 접속 방지: 기존 세션 revoke)
    const stageRow = await db.queryOne<{ stage: string | null }>(
      'SELECT stage FROM nf_users WHERE id = ?',
      user.id,
    );
    const accessToken = await signJWT(
      {
        sub: user.id,
        email: user.email,
        plan: user.plan,
        emailVerified: true,
        service: SERVICE_NAME,
        nexyfabStage: parseUserStageColumn(stageRow?.stage),
      },
      15 * 60,
    );
    const rawRefresh = randomBytes(40).toString('hex');
    const refreshHash = createHash('sha256').update(rawRefresh).digest('hex');
    const now = Date.now();

    await db.execute(
      "UPDATE nf_refresh_tokens SET revoked = 1 WHERE user_id = ? AND revoked = 0",
      user.id,
    );
    await db.execute(
      `INSERT INTO nf_refresh_tokens (id, user_id, token_hash, expires_at, revoked, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`,
      `rt-${crypto.randomUUID()}`, user.id, refreshHash, now + 30 * 24 * 3600_000, now,
    );

    const response = NextResponse.redirect(`${siteUrl}/${lang}/nexyfab/dashboard`);
    response.cookies.set('oauth_state', '', { maxAge: 0, path: '/api/auth/oauth' });
    const ac = accessTokenCookie(accessToken, 'lax');
    response.cookies.set(ac.name, ac.value, ac.options);
    const rc = refreshTokenCookie(rawRefresh, 'lax');
    response.cookies.set(rc.name, rc.value, rc.options);
    return response;
  } catch (err) {
    console.error('[google/callback]', err);
    return NextResponse.redirect(`${siteUrl}/${lang}/login?error=oauth_failed`);
  }
}
