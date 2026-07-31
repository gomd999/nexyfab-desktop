/**
 * POST /api/auth/admin-otp/request — 관리자 step-up 코드 발송 (260802).
 *
 * ## 전제
 * **이미 로그인한 상태**에서만 부른다. 이 엔드포인트는 로그인을 대신하지 않고,
 * 관리자 권한을 **한 번 더** 확인한다(step-up). 그래서 열거(enumeration) 위험이 없어
 * 비관리자에게는 그냥 403 을 준다 — 숨길 것이 없다.
 *
 * ## ⚠ 실패를 성공처럼 말하지 않는다
 * 메일 발송이 실패하면 **200 을 주지 않는다.** 「코드를 보냈습니다」라고만 하고 못 보냈으면
 * 사용자는 오지 않는 메일을 기다린다 — 이 세션 내내 지킨 규약이다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { issueOtp, isAdminOtpRequired, OTP_TTL_MS, pruneExpired } from '@/lib/admin-elevation';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  if (user.globalRole !== 'super_admin') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }
  if (!isAdminOtpRequired()) {
    // 꺼져 있으면 코드를 만들지 않는다 — 만들어 두고 안 쓰면 그게 유출면이다.
    return NextResponse.json({ ok: true, required: false, message: '관리자 OTP 가 비활성화돼 있습니다.' });
  }

  /**
   * 사용자와 IP 양쪽으로 제한한다. 사용자만 걸면 한 IP 가 여러 계정을 두드릴 수 있고,
   * IP 만 걸면 한 계정을 여러 IP 에서 두드릴 수 있다.
   */
  const ip = getTrustedClientIp(req.headers);
  for (const [key, max] of [[`admin-otp:u:${user.userId}`, 5], [`admin-otp:ip:${ip}`, 10]] as const) {
    if (!rateLimit(key, max, 10 * 60_000).allowed) {
      return NextResponse.json({ ok: false, error: '요청이 많습니다 — 잠시 후 다시 시도하세요.' }, { status: 429 });
    }
  }

  try {
    await pruneExpired();
    const { code, expiresAt } = await issueOtp(user.userId);
    const mins = Math.round(OTP_TTL_MS / 60_000);
    const sent = await sendEmail({
      to: user.email,
      subject: `[NexyFab] 관리자 인증 코드 ${code}`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:520px">`
        + `<h2 style="margin:0 0 8px">관리자 인증 코드</h2>`
        + `<p style="color:#475569;margin:0 0 16px">관리자 콘솔에 접속하려면 아래 코드를 입력하세요.</p>`
        + `<div style="font-size:32px;font-weight:800;letter-spacing:.2em;padding:16px;background:#f1f5f9;border-radius:8px;text-align:center">${code}</div>`
        + `<p style="color:#64748b;font-size:13px;margin:16px 0 0">${mins}분 안에 입력해야 합니다. `
        + `본인이 요청하지 않았다면 <b>비밀번호가 노출됐을 수 있습니다</b> — 즉시 변경하세요.</p></div>`,
      text: `NexyFab 관리자 인증 코드: ${code} (${mins}분 유효)`,
    });
    if (!sent.ok) {
      // ⚠ 발송 실패는 실패다. 코드가 DB 에 남아 있어도 사용자는 받을 수 없다.
      console.error('[admin-otp] 발송 실패:', sent.error);
      return NextResponse.json(
        { ok: false, error: '인증 메일을 보내지 못했습니다 — 관리자에게 문의하세요.', reason: sent.error ?? 'send_failed' },
        { status: 502 },
      );
    }
    // ⚠ 코드는 절대 응답에 싣지 않는다(로그에도 남기지 않는다).
    return NextResponse.json({ ok: true, required: true, expiresAt, sentTo: maskEmail(user.email) });
  } catch (e) {
    console.error('[admin-otp] request 실패:', e);
    return NextResponse.json({ ok: false, error: '코드를 발급하지 못했습니다.' }, { status: 500 });
  }
}

/** `a***@example.com` — 어느 주소로 갔는지는 알려 주되 전체를 다시 노출하지 않는다. */
function maskEmail(email: string): string {
  const [id, domain] = String(email).split('@');
  if (!domain) return '***';
  const head = id.slice(0, 1);
  return `${head}${'*'.repeat(Math.max(1, id.length - 1))}@${domain}`;
}
