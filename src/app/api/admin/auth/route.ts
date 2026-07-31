import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { rateLimit } from '@/lib/rate-limit';
import { checkOrigin } from '@/lib/csrf';
import { createAdminSession, verifyAdmin } from '@/lib/admin-auth';
import { getTrustedClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';

/** Session check for the AdminAuthGate — returns whether the caller already
 *  holds a valid admin session (the nf_admin_token cookie is scoped to
 *  /api/admin, so the gate must ask the server rather than read it). */
export async function GET(req: NextRequest) {
  return NextResponse.json({ authed: await verifyAdmin(req) });
}

export async function POST(req: NextRequest) {
  // CSRF check
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Rate limit: 5 attempts per minute per IP
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`admin-auth:${ip}`, 5, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }, { status: 429 });
  }

  const { password } = await req.json() as { password?: string };

  const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;
  const adminPasswordPlain = process.env.ADMIN_PASSWORD;

  if (!adminPasswordHash && !adminPasswordPlain) {
    console.error('[admin/auth] ADMIN_PASSWORD_HASH 또는 ADMIN_PASSWORD 환경변수가 설정되지 않았습니다.');
    return NextResponse.json({ error: '서버 설정 오류' }, { status: 500 });
  }

  if (!password) {
    return NextResponse.json({ error: '비밀번호가 올바르지 않습니다.' }, { status: 401 });
  }

  let valid = false;
  if (adminPasswordHash) {
    valid = await bcrypt.compare(password, adminPasswordHash);
  } else if (adminPasswordPlain) {
    // 프로덕션에서는 평문 비밀번호 허용 안 함 — ADMIN_PASSWORD_HASH 설정 필요
    if (process.env.NODE_ENV === 'production') {
      console.error('[admin/auth] Production requires ADMIN_PASSWORD_HASH (bcrypt). Plain ADMIN_PASSWORD rejected.');
      return NextResponse.json({ error: '서버 설정 오류' }, { status: 500 });
    }
    valid = password === adminPasswordPlain;
  }

  if (!valid) {
    return NextResponse.json({ error: '비밀번호가 올바르지 않습니다.' }, { status: 401 });
  }

  /**
   * ★ 2단계 (260802) — **비밀번호 하나로 40페이지 콘솔이 열리던 것**을 막는다.
   *
   * `/admin` 은 계정이 아니라 공유 비밀번호로 들어오므로 개인 주소가 없다.
   * `OPS_ALERT_EMAIL`(운영 알림 주소)로 코드를 보낸다 — 「누구인지」가 아니라
   * **「그 메일함에 접근할 수 있는가」**를 확인하는 것이다.
   * 개인 계정 OTP 보다 약하지만 **비밀번호 하나보다는 확실히 강하다.**
   *
   * ⚠ 설정이 없으면(`unconfigured`) **조용히 통과시키지 않고 그 사실을 응답에 적는다.**
   *   조용히 열면 「2단계를 켰다」고 믿는 상태로 열려 있게 된다.
   */
  const { consoleOtpMode, issueConsoleOtp, verifyConsoleOtp, opsRecipients } = await import('@/lib/admin-console-otp');
  const mode = consoleOtpMode();
  const otp = (await req.clone().json().catch(() => ({}))) as { otp?: string };

  if (mode === 'enforced') {
    if (!otp.otp) {
      // 1단계 통과 → 코드 발송. **아직 세션을 주지 않는다.**
      const { code } = await issueConsoleOtp();
      const { sendEmail } = await import('@/lib/email');
      const to = opsRecipients();
      const sent = await sendEmail({
        to: to.join(','),
        subject: `[NexyFab] 관리자 콘솔 인증 코드 ${code}`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:520px">`
          + `<h2>관리자 콘솔 인증 코드</h2>`
          + `<div style="font-size:32px;font-weight:800;letter-spacing:.2em;padding:16px;background:#f1f5f9;border-radius:8px;text-align:center">${code}</div>`
          + `<p style="color:#64748b;font-size:13px">5분 안에 입력해야 합니다. IP ${ip}.`
          + ` <b>본인이 시도하지 않았다면 ADMIN_PASSWORD 가 노출된 것입니다 — 즉시 교체하세요.</b></p></div>`,
        text: `관리자 콘솔 인증 코드: ${code} (5분 유효, IP ${ip})`,
      });
      if (!sent.ok) {
        // ⚠ 못 보냈으면 **성공이라 하지 않는다.** 오지 않는 메일을 기다리게 된다.
        console.error('[admin/auth] OTP 발송 실패:', sent.error);
        return NextResponse.json({ error: '인증 메일을 보내지 못했습니다 — 운영자에게 문의하세요.' }, { status: 502 });
      }
      return NextResponse.json({ requiresOtp: true, message: '운영 이메일로 인증 코드를 보냈습니다.' });
    }
    const v = await verifyConsoleOtp(String(otp.otp));
    if (!v.ok) {
      return NextResponse.json({ error: '인증 코드가 올바르지 않습니다.', reason: v.reason }, { status: 401 });
    }
  }

  const adminToken = createAdminSession();
  const response = NextResponse.json({
    ok: true,
    /** ⚠ 2단계가 실제로 적용됐는지 **응답에 적는다** — 「켰다」는 믿음과 실제를 가른다. */
    twoFactor: mode,
    ...(mode === 'unconfigured'
      ? { warning: 'OPS_ALERT_EMAIL 이 설정되지 않아 2단계 인증이 적용되지 않았습니다 — 비밀번호만으로 접근 중입니다.' }
      : {}),
  });
  response.cookies.set('nf_admin_token', adminToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 30 * 60,
    // Was '/api/admin' — but the server-side admin layout must read this cookie
    // on /admin/* page requests to gate rendering, so it has to be sent there too.
    path: '/',
  });
  return response;
}
