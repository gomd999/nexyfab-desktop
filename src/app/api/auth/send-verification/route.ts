import { NextRequest, NextResponse } from 'next/server';
import { rateLimitAsync } from '@/lib/rate-limit';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { sendEmail } from '@/lib/nexyfab-email';
import { resolveServerLocale } from '@/lib/i18n/serverLocale';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_SEND_VERIFICATION_BODY_BYTES = 8 * 1024;

const SEND_MESSAGES = {
  kr: { forbidden: '요청이 허용되지 않습니다.', unauthorized: '로그인이 필요합니다.', rate: '요청이 너무 많습니다. 15분 후 다시 시도하세요.', failed: '이메일을 보내지 못했습니다.' },
  en: { forbidden: 'Request not allowed.', unauthorized: 'Please sign in.', rate: 'Too many requests. Try again in 15 minutes.', failed: 'Failed to send the email.' },
  ja: { forbidden: 'リクエストは許可されていません。', unauthorized: 'ログインしてください。', rate: 'リクエストが多すぎます。15分後に再試行してください。', failed: 'メールを送信できませんでした。' },
  cn: { forbidden: '请求不被允许。', unauthorized: '请先登录。', rate: '请求过多，请在 15 分钟后重试。', failed: '邮件发送失败。' },
  es: { forbidden: 'Solicitud no permitida.', unauthorized: 'Inicia sesión.', rate: 'Demasiadas solicitudes. Inténtalo de nuevo en 15 minutos.', failed: 'No se pudo enviar el correo.' },
  ar: { forbidden: 'الطلب غير مسموح به.', unauthorized: 'يرجى تسجيل الدخول.', rate: 'طلبات كثيرة جداً. حاول مجدداً بعد 15 دقيقة.', failed: 'تعذر إرسال البريد الإلكتروني.' },
} as const;

export async function POST(req: NextRequest) {
  let requestBody: { lang?: string } = {};
  try { requestBody = await readBoundedJson(req, MAX_SEND_VERIFICATION_BODY_BYTES); }
  catch (error) { if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Request too large', code: 'PAYLOAD_TOO_LARGE' }, { status: 413 }); }
  const locale = resolveServerLocale(req, requestBody.lang);
  const messages = SEND_MESSAGES[locale.route];
  if (!checkOrigin(req)) return NextResponse.json({ error: messages.forbidden }, { status: 403 });

  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: messages.unauthorized }, { status: 401 });

  // userId와 email은 인증된 사용자 정보에서 가져옴 (클라이언트 제공값 무시)
  const userId = authUser.userId;
  const email = authUser.email;

  // Rate limit: 3 requests per 15 minutes per userId
  if (!(await rateLimitAsync(`send-verification:${userId}`, 3, 15 * 60_000)).allowed) {
    return NextResponse.json({ error: messages.rate }, { status: 429 });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + 15 * 60 * 1000;

  const db = getDbAdapter();
  // Remove any existing code for this user then insert fresh
  await db.execute('DELETE FROM nf_verification_codes WHERE user_id = ?', userId);
  await db.execute(
    `INSERT INTO nf_verification_codes (code, user_id, email, expires_at)
     VALUES (?, ?, ?, ?)`,
    code, userId, email, expiresAt,
  );

  const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 0;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:12px;border:1px solid #2a2a2a;overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:32px 40px;text-align:center;">
          <span style="font-size:24px;font-weight:700;color:#60a5fa;">NexyFab</span>
          <span style="font-size:24px;font-weight:300;color:#94a3b8;"> — 이메일 인증</span>
        </td></tr>
        <tr><td style="padding:40px;">
          <p style="color:#e2e8f0;font-size:16px;line-height:1.6;margin:0 0 24px;">안녕하세요! 아래 코드를 입력해 이메일을 인증하세요.</p>
          <div style="background:#0f172a;border:1px solid #334155;border-radius:10px;padding:28px;text-align:center;margin:0 0 24px;">
            <p style="color:#64748b;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 12px;">인증 코드</p>
            <span style="font-size:42px;font-weight:700;letter-spacing:12px;color:#60a5fa;">${code}</span>
          </div>
          <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0;">유효시간 <strong style="color:#94a3b8;">15분</strong>. 요청하지 않으셨다면 무시하세요.</p>
        </td></tr>
        <tr><td style="padding:24px 40px;border-top:1px solid #2a2a2a;text-align:center;">
          <p style="color:#475569;font-size:12px;margin:0;">© ${new Date().getFullYear()} NexyFab — Nexysys Inc.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  // Demo mode (no email configured) — log code for development convenience
  if (!process.env.SMTP_HOST && !process.env.RESEND_API_KEY) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[NexyFab:dev] Verification code for ${email}: ${code}`);
    }
    return NextResponse.json({ sent: true, demo: true });
  }

  try {
    await sendEmail(email, '[NexyFab] 이메일 인증 코드', html);
    return NextResponse.json({ sent: true });
  } catch (err) {
    console.error('[send-verification] Email send failed:', err);
    return NextResponse.json({ error: messages.failed }, { status: 500 });
  }
}
