/**
 * admin-guard.ts — **관리자 판정을 한 곳에서 한다** (260802).
 *
 * ## 왜 필요한가 — 실측
 * 관리자 API 63개, `super_admin` 을 검사하는 파일 28개인데 `requireAdmin` 이
 * **파일마다 복제**돼 있었다. 이 세션에서 반복해 나온 형태 그대로다 —
 * 규칙이 여러 벌이면 한 벌만 고쳐지고 나머지는 옛 동작을 유지한다.
 * step-up 인증을 붙이는 지금이 정확히 그 순간이다: **28곳에 따로 붙이면 반드시 빠뜨린다.**
 *
 * ## 두 단계를 **모두** 본다
 *  1. `globalRole === 'super_admin'` — 계정이 관리자인가
 *  2. 이 세션이 **이메일 OTP 로 상승**됐는가 (`ADMIN_OTP_REQUIRED !== 'false'` 일 때)
 *
 * 둘을 나눠 응답한다 — 403(권한 없음)과 **428(상승 필요)**은 클라이언트가 할 일이 다르다.
 * 상승이 필요한데 403 을 주면 화면은 「권한이 없다」고 잘못 안내한다.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getAuthUser, type AuthUser } from './auth-middleware';
import { readAccessToken, elevationRemainingMs, isAdminOtpRequired } from './admin-elevation';

export type AdminGuardResult =
  | { ok: true; user: AuthUser; elevationMs: number | null }
  | { ok: false; response: NextResponse };

/** 상승이 필요하다는 신호. 401(미인증)·403(권한없음)과 구별한다. */
export const ELEVATION_REQUIRED_STATUS = 428; // Precondition Required

/**
 * 관리자 API 앞에 세운다.
 *
 * @param req 요청
 * @param opts.allowUnelevated 상승 없이도 통과시킬지. **읽기 전용이라도 기본은 false** —
 *   「조회는 괜찮다」고 열어 두면 관리자 화면 대부분이 그 구멍으로 보인다.
 */
export async function requireAdmin(
  req: NextRequest,
  opts: { allowUnelevated?: boolean } = {},
): Promise<AdminGuardResult> {
  const user = await getAuthUser(req);
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const isAdmin = user.globalRole === 'super_admin'
    || (user.roles?.some((r) => r.role === ('org_admin' as string)) ?? false);
  if (!isAdmin) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  if (!isAdminOtpRequired() || opts.allowUnelevated) {
    return { ok: true, user, elevationMs: null };
  }

  /**
   * ⚠ `org_admin` 에는 step-up 을 요구하지 않는다 — 이메일 OTP 는 `super_admin`
   *   계정(전역 권한)을 겨냥한 보호다. org_admin 까지 묶으면 조직 관리자가
   *   자기 조직 화면을 못 보는데, 그건 이 변경이 노린 위험이 아니다.
   */
  if (user.globalRole !== 'super_admin') {
    return { ok: true, user, elevationMs: null };
  }

  const left = await elevationRemainingMs(user.userId, readAccessToken(req));
  if (left == null) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'Elevation required',
          // 화면이 무엇을 해야 하는지 **응답 자체가** 말한다 — 문서를 찾아보게 하지 않는다.
          action: 'POST /api/auth/admin-otp/request → 메일 코드 → POST /api/auth/admin-otp/verify',
        },
        { status: ELEVATION_REQUIRED_STATUS },
      ),
    };
  }
  return { ok: true, user, elevationMs: left };
}
