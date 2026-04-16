import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { rateLimit } from '@/lib/rate-limit';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // userId와 email은 인증된 사용자 정보에서 가져옴 (클라이언트 제공값 무시)
  const userId = authUser.userId;
  const email = authUser.email;

  // Rate limit: 3 requests per 15 minutes per userId
  if (!rateLimit(`send-verification:${userId}`, 3, 15 * 60_000).allowed) {
    return NextResponse.json({ error: '요청이 너무 많습니다. 15분 후 다시 시도하세요.' }, { status: 429 });
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

  // Demo mode (no SMTP_HOST) — log server-side only, never expose code in response
  if (!process.env.SMTP_HOST) {
    console.log(`[NexyFab] Email verification code for ${email}: ${code}`);
    return NextResponse.json({ sent: true, demo: true });
  }

  // Production: send email via nodemailer
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const html = `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NexyFab 이메일 인증</title>
</head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:12px;border:1px solid #2a2a2a;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:32px 40px;text-align:center;">
              <span style="font-size:24px;font-weight:700;color:#60a5fa;letter-spacing:-0.5px;">NexyFab</span>
              <span style="font-size:24px;font-weight:300;color:#94a3b8;"> — 이메일 인증</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <p style="color:#e2e8f0;font-size:16px;line-height:1.6;margin:0 0 24px;">
                안녕하세요! NexyFab 계정의 이메일 주소를 인증하려면 아래 코드를 입력하세요.
              </p>
              <!-- Code Box -->
              <div style="background:#0f172a;border:1px solid #334155;border-radius:10px;padding:28px;text-align:center;margin:0 0 24px;">
                <p style="color:#64748b;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 12px;">인증 코드</p>
                <span style="font-size:42px;font-weight:700;letter-spacing:12px;color:#60a5fa;font-variant-numeric:tabular-nums;">${code}</span>
              </div>
              <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0;">
                이 코드는 <strong style="color:#94a3b8;">15분</strong> 동안 유효합니다.<br/>
                이 이메일을 요청하지 않으셨다면 무시하셔도 됩니다.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #2a2a2a;text-align:center;">
              <p style="color:#475569;font-size:12px;margin:0;">
                © ${new Date().getFullYear()} NexyFab — Nexysys Inc. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    await transporter.sendMail({
      from: `"NexyFab" <${process.env.SMTP_USER}>`,
      to: email,
      subject: '[NexyFab] 이메일 인증 코드',
      html,
    });

    return NextResponse.json({ sent: true });
  } catch (err) {
    console.error('[NexyFab] Email send failed:', err);
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
  }
}
