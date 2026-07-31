/**
 * POST /api/auth/logout — **세 층을 다 끊는다** (260802 전면 수정).
 *
 * ## 종전에 무엇이 안 됐나 — 실측
 * ```
 * ① 라우트가 refreshToken 을 **본문에서만** 읽었다. 그런데 그건 httpOnly 쿠키라
 *    클라이언트가 읽을 수도, 보낼 수도 없다 → 언제나 `!rawToken` 분기
 * ② `!rawToken` 이면 **쿠키를 하나도 안 지우고** `{ok:true}` 를 돌려줬다 —
 *    성공으로 보이지만 아무 일도 하지 않는다
 * ③ 유일한 호출부가 **본문 없이** POST 해서 `req.json()` 이 던지고 500 이 났다
 * ④ 쿠키를 지울 때 `domain` 을 주지 않았다. 로그인은 `COOKIE_DOMAIN` 으로 굽는데
 *    삭제는 도메인 없이 해서, 서브도메인 공유 설정에서는 **삭제가 안 된다**
 * ```
 * 결과: 로그아웃을 눌러도 쿠키가 남고 **30일짜리 리프레시 토큰이 살아 있었다.**
 *
 * ## 규약
 * 1. **본문이 없어도 항상 쿠키를 지운다.** 로그아웃은 「지울 게 있으면 지운다」가 아니라
 *    **「끝났음을 보장한다」**이다. 입력이 이상해도 결과 상태는 로그아웃이어야 한다.
 * 2. 리프레시 토큰은 **쿠키에서 읽는다**(본문도 하위호환으로 받는다).
 * 3. 쿠키 삭제는 **구울 때와 같은 속성**으로 한다 — `domain`·`path` 가 다르면 안 지워진다.
 * 4. ⚠ **액세스 토큰은 stateless(15분)라 서버가 폐기할 수 없다.** 그래서 리프레시를
 *    폐기하는 것이 실질적 차단이고, 최대 15분의 잔여가 남는다. 그 사실을 응답에 적는다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { createHash } from 'crypto';
import { COOKIE_DOMAIN } from '@/lib/service-config';
import { getAuthUser } from '@/lib/auth-middleware';
import { logAudit } from '@/lib/audit';
import { getTrustedClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';

/** 액세스 토큰 만료(초) — 폐기 불가 구간의 길이. 응답에 실어 정직하게 알린다. */
const ACCESS_TOKEN_TTL_SEC = 15 * 60;

/**
 * 쿠키를 **구울 때와 같은 속성**으로 만료시킨다.
 *
 * ⚠ `domain`·`path` 가 다르면 브라우저는 **다른 쿠키로 보고 지우지 않는다.**
 *   종전 코드가 여기서 틀렸다(로그인은 domain 사용, 로그아웃은 미사용).
 */
function clearAuthCookies(res: NextResponse): void {
  const secure = process.env.NODE_ENV === 'production';
  const base = { httpOnly: true, secure, sameSite: 'strict' as const, maxAge: 0, expires: new Date(0) };
  const withDomain = { ...base, ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}) };

  res.cookies.set('nf_access_token', '', { ...withDomain, path: '/' });
  res.cookies.set('nf_refresh_token', '', { ...withDomain, path: '/api/auth' });
  // 관리자 상승도 함께 끊는다 — 세션이 끝났는데 상승만 남으면 안 된다.
  res.cookies.set('nf_admin_elev', '', { ...withDomain, path: '/' });

  /**
   * ⚠ 도메인 없이 구워진 **과거 쿠키**도 지운다. `COOKIE_DOMAIN` 을 나중에 켰다면
   *   두 벌이 공존할 수 있고, 하나만 지우면 남은 하나로 계속 로그인 상태가 된다.
   */
  if (COOKIE_DOMAIN) {
    res.cookies.set('nf_access_token', '', { ...base, path: '/' });
    res.cookies.set('nf_refresh_token', '', { ...base, path: '/api/auth' });
    res.cookies.set('nf_admin_elev', '', { ...base, path: '/' });
  }
}

export async function POST(req: NextRequest) {
  // 감사·전체 폐기용으로 먼저 읽는다(쿠키를 지우기 전이라 아직 유효하다).
  const who = await getAuthUser(req).catch(() => null);

  /**
   * ⚠ 본문 파싱 실패를 **로그아웃 실패로 만들지 않는다.** 종전엔 여기서 던져 500 이 났고,
   *   그 결과 쿠키가 그대로 남았다 — 「로그아웃했는데 로그인 상태」의 직접 원인이다.
   */
  let bodyToken: string | undefined;
  try {
    const body = (await req.json()) as { refreshToken?: string } | null;
    bodyToken = body?.refreshToken;
  } catch { bodyToken = undefined; }

  // 쿠키 우선 — httpOnly 라 클라이언트는 못 보낸다. 본문은 하위호환.
  const rawToken = req.cookies.get('nf_refresh_token')?.value || bodyToken;

  let revoked: number | 'all' = 0;
  try {
    const db = getDbAdapter();
    if (rawToken) {
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      await db.execute('UPDATE nf_refresh_tokens SET revoked = TRUE WHERE token_hash = ?', tokenHash);
      revoked = 1;
    } else if (who?.userId) {
      /**
       * 토큰을 못 찾았지만 **누구인지는 안다** — 그 사용자의 활성 리프레시를 모두 폐기한다.
       * ⚠ 이게 없으면 쿠키만 지워지고 30일짜리 리프레시가 살아남는다.
       *   로그아웃은 「이 브라우저에서 나간다」가 아니라 **「이 세션을 끝낸다」**여야 한다.
       */
      await db.execute(
        'UPDATE nf_refresh_tokens SET revoked = TRUE WHERE user_id = ? AND revoked = FALSE',
        who.userId,
      );
      revoked = 'all';
    }
    // 관리자 상승도 서버 측에서 끊는다(쿠키만 지우면 DB 레코드가 남는다).
    if (who?.userId) {
      await db.execute('DELETE FROM nf_admin_elevation WHERE user_id = ?', who.userId).catch(() => {});
    }
  } catch (e) {
    /**
     * ⚠ DB 가 실패해도 **쿠키는 지운다.** 여기서 500 을 주면 사용자는 로그인 상태로 남는다 —
     *   「끊지 못했다」를 「아무것도 안 한다」로 처리하면 안 된다.
     */
    console.error('[logout] 토큰 폐기 실패(쿠키는 지운다):', e);
  }

  const res = NextResponse.json({
    ok: true,
    revokedRefreshTokens: revoked,
    /**
     * ⚠ 정직 고지: 액세스 토큰은 stateless 라 **서버가 즉시 폐기할 수 없다.**
     *   이미 발급된 토큰은 최대 15분간 유효하다 — 숨기지 않는다.
     */
    accessTokenResidualSec: ACCESS_TOKEN_TTL_SEC,
    note: '리프레시 토큰을 폐기했습니다. 이미 발급된 액세스 토큰은 최대 15분간 유효합니다(stateless).',
  });
  clearAuthCookies(res);

  if (who?.userId) {
    logAudit({
      userId: who.userId, action: 'auth.logout', resourceId: who.userId,
      metadata: { revoked }, ip: getTrustedClientIp(req.headers),
    });
  }
  return res;
}
