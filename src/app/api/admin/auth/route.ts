import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { checkOrigin } from '@/lib/csrf';
import { sendEmail } from '@/lib/email';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimitAsync, rateLimitHeaders } from '@/lib/rate-limit';
import { recordAdminAudit } from '@/lib/admin-audit';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import {
  ADMIN_EMAIL_CODE_TTL_MS,
  adminRequestIpHash,
  createAdminEmailSession,
  issueAdminEmailLoginCode,
  isAllowedAdminEmail,
  maskAdminEmail,
  normalizeAdminEmail,
  revokeAdminEmailSession,
  verifyAdminEmailLoginCode,
  verifyAdminEmailTokenLive,
} from '@/lib/admin-email-auth';

export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = { 'Cache-Control': 'no-store, private' };

function emailRateKey(email: string): string {
  return createHash('sha256').update(email).digest('hex').slice(0, 24);
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    maxAge,
    path: '/',
    priority: 'high' as const,
  };
}

export async function GET(req: NextRequest) {
  const session = await verifyAdminEmailTokenLive(req.cookies.get('nf_admin_token')?.value).catch(() => null);
  return NextResponse.json(
    { authed: Boolean(session), email: session?.email ?? null },
    { headers: PRIVATE_HEADERS },
  );
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req) || req.headers.get('sec-fetch-site') === 'cross-site') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: PRIVATE_HEADERS });
  }

  let body: {
    action?: unknown;
    email?: unknown;
    code?: unknown;
  };
  try { body = await readBoundedJson(req, 64 * 1024); }
  catch (error) {
    if (boundedJsonError(error)?.status === 413) return NextResponse.json({ error: 'Payload too large' }, { status: 413, headers: PRIVATE_HEADERS });
    body = {};
  }
  const action = body.action === 'verify' ? 'verify' : 'request';
  const email = normalizeAdminEmail(body.email);
  if (!email) {
    return NextResponse.json({ error: '올바른 이메일 주소를 입력해 주세요.' }, { status: 400, headers: PRIVATE_HEADERS });
  }

  const ip = getTrustedClientIp(req.headers);
  const ipHash = adminRequestIpHash(ip);

  if (action === 'request') {
    const [ipLimit, emailLimit] = await Promise.all([
      rateLimitAsync(`admin-email-request:ip:${ipHash}`, 5, 60 * 60 * 1000, { failClosed: process.env.NODE_ENV === 'production' }),
      rateLimitAsync(`admin-email-request:email:${emailRateKey(email)}`, 5, 60 * 60 * 1000, { failClosed: process.env.NODE_ENV === 'production' }),
    ]);
    const limited = !ipLimit.allowed ? ipLimit : !emailLimit.allowed ? emailLimit : null;
    if (limited) {
      return NextResponse.json(
        { error: '인증 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.', retryAfter: Math.max(1, Math.ceil((limited.resetAt - Date.now()) / 1000)) },
        { status: 429, headers: { ...PRIVATE_HEADERS, ...rateLimitHeaders(limited, 5) } },
      );
    }

    // Do not reveal whether the submitted address is on the allowlist.
    if (await isAllowedAdminEmail(email)) {
      const issued = await issueAdminEmailLoginCode(email, ipHash);
      const sent = await sendEmail({
        to: email,
        subject: `[NexyFab] 관리자 로그인 인증 코드 ${issued.code}`,
        text: `NexyFab 관리자 로그인 인증 코드: ${issued.code}\n${Math.floor(ADMIN_EMAIL_CODE_TTL_MS / 60000)}분 동안 유효하며 한 번만 사용할 수 있습니다.\n본인이 요청하지 않았다면 이 메일을 무시하세요.`,
        html: `<!doctype html><html lang="ko"><body style="margin:0;padding:32px;background:#f3f6fb;font-family:system-ui,sans-serif">
          <div style="max-width:460px;margin:0 auto;background:#fff;border:1px solid #dbe3ef;border-radius:18px;padding:30px">
            <p style="margin:0 0 5px;color:#2563eb;font-size:12px;font-weight:800;letter-spacing:.08em">NEXYFAB ADMIN</p>
            <h1 style="margin:0 0 20px;color:#111827;font-size:20px">관리자 로그인 인증 코드</h1>
            <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:14px;padding:20px;text-align:center">
              <span style="color:#1d4ed8;font-size:34px;font-weight:900;letter-spacing:.28em;font-family:ui-monospace,monospace">${issued.code}</span>
            </div>
            <p style="margin:20px 0 0;color:#4b5563;font-size:13px;line-height:1.7">${Math.floor(ADMIN_EMAIL_CODE_TTL_MS / 60000)}분 후 만료되며 한 번만 사용할 수 있습니다.<br>본인이 요청하지 않았다면 이 메일을 무시하세요.</p>
          </div></body></html>`,
      });
      if (!sent.ok) console.error('[admin-email-auth] verification email failed:', sent.error);
    }

    return NextResponse.json({
      ok: true,
      requiresCode: true,
      to: maskAdminEmail(email),
      message: '허용된 관리자 이메일이면 인증 코드를 발송했습니다.',
    }, { headers: PRIVATE_HEADERS });
  }

  const verifyLimit = await rateLimitAsync(
    `admin-email-verify:${ipHash}`,
    20,
    60 * 60 * 1000,
    { failClosed: process.env.NODE_ENV === 'production' },
  );
  if (!verifyLimit.allowed) {
    return NextResponse.json(
      { error: '인증 시도 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 429, headers: { ...PRIVATE_HEADERS, ...rateLimitHeaders(verifyLimit, 20) } },
    );
  }

  const code = typeof body.code === 'string' ? body.code.replace(/\D/g, '') : '';
  const result = await verifyAdminEmailLoginCode(email, code, ipHash);
  if (!result.ok) {
    const status = result.reason === 'too_many_attempts' ? 429 : 401;
    return NextResponse.json({
      error: result.reason === 'expired'
        ? '인증 코드가 만료되었습니다. 새 코드를 요청해 주세요.'
        : result.reason === 'too_many_attempts'
          ? '인증 시도 횟수를 초과했습니다. 새 코드를 요청해 주세요.'
          : '인증 코드가 올바르지 않습니다.',
      reason: result.reason,
      attemptsLeft: result.attemptsLeft,
    }, { status, headers: PRIVATE_HEADERS });
  }

  const session = await createAdminEmailSession(email, ipHash, req.headers.get('user-agent') ?? '');
  const response = NextResponse.json({ ok: true, email: session.email }, { headers: PRIVATE_HEADERS });
  response.cookies.set('nf_admin_token', session.token, cookieOptions(session.maxAge));
  void recordAdminAudit(req, {
    adminUserId: session.email,
    action: 'admin.email_login',
    target: session.email,
  });
  return response;
}

export async function DELETE(req: NextRequest) {
  if (!checkOrigin(req) || req.headers.get('sec-fetch-site') === 'cross-site') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: PRIVATE_HEADERS });
  }
  const token = req.cookies.get('nf_admin_token')?.value;
  await revokeAdminEmailSession(token).catch(() => undefined);
  const response = NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS });
  response.cookies.set('nf_admin_token', '', cookieOptions(0));
  return response;
}
