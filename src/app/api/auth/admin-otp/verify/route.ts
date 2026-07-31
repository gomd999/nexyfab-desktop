/**
 * POST /api/auth/admin-otp/verify — 코드 확인 후 **이 세션에** 관리자 상승을 준다 (260802).
 *
 * ## 상승은 액세스 토큰에 묶인다
 * 별도 쿠키를 하나 더 두지 않고 `sha256(accessToken)` 을 키로 쓴다 —
 * 로그아웃·재로그인·토큰 회전에서 **상승이 자동으로 죽는다.**
 *
 * ## ⚠ 실패 사유를 어디까지 말하나
 * 「틀렸다 / 만료됐다 / 시도 초과」는 사용자가 할 일이 다르므로 구별해 알린다.
 * 이 엔드포인트는 **이미 인증된 관리자 본인**만 부를 수 있으므로 이 구별이
 * 공격자에게 주는 이득이 없다(계정을 모르는 사람은 여기까지 오지 못한다).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { readAccessToken, verifyOtpAndElevate, isAdminOtpRequired } from '@/lib/admin-elevation';

export const dynamic = 'force-dynamic';

const REASON_KO: Record<string, string> = {
  no_code: '발급된 코드가 없습니다 — 코드를 먼저 요청하세요.',
  expired: '코드가 만료됐습니다 — 새 코드를 요청하세요.',
  too_many_attempts: '시도 횟수를 넘겼습니다 — 새 코드를 요청하세요.',
  mismatch: '코드가 일치하지 않습니다.',
};

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  if (user.globalRole !== 'super_admin') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }
  if (!isAdminOtpRequired()) {
    return NextResponse.json({ ok: true, required: false, message: '관리자 OTP 가 비활성화돼 있습니다.' });
  }

  // 코드 대입 시도 자체를 제한한다 — DB 의 attempts 상한과 **이중으로** 막는다.
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`admin-otp-verify:${user.userId}:${ip}`, 10, 10 * 60_000).allowed) {
    return NextResponse.json({ ok: false, error: '요청이 많습니다 — 잠시 후 다시 시도하세요.' }, { status: 429 });
  }

  let body: { code?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 }); }
  const code = String(body.code ?? '').trim();
  // 형식 검사는 **길이만** 본다 — 여기서 문자를 걸러도 보안이 늘지 않고 오답만 늘린다.
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ ok: false, error: '6자리 숫자 코드를 입력하세요.' }, { status: 400 });
  }

  const token = readAccessToken(req);
  if (!token) {
    // 여기 오면 getAuthUser 는 통과했는데 토큰을 못 읽은 것이다 — 상승을 묶을 곳이 없다.
    return NextResponse.json({ ok: false, error: '세션 토큰을 확인할 수 없습니다.' }, { status: 401 });
  }

  try {
    const r = await verifyOtpAndElevate(user.userId, token, code);
    if (!r.ok) {
      return NextResponse.json({ ok: false, error: REASON_KO[r.reason] ?? '확인에 실패했습니다.', reason: r.reason }, { status: 401 });
    }
    return NextResponse.json({ ok: true, elevatedUntil: r.expiresAt });
  } catch (e) {
    console.error('[admin-otp] verify 실패:', e);
    return NextResponse.json({ ok: false, error: '확인 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
