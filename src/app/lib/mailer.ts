/**
 * mailer.ts — 이메일 알림 발송 helper
 * 환경변수(SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM)가 없으면
 * console.log로 fallback (개발 모드).
 */

import nodemailer from 'nodemailer';

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export async function sendNotificationEmail(
  to: string,
  subject: string,
  body: string
): Promise<void> {
  const from = process.env.MAIL_FROM || 'no-reply@nexyfab.com';
  const transporter = createTransporter();

  if (!transporter) {
    // 개발 모드 fallback
    console.log('[mailer] SMTP 미설정 — 이메일 발송 생략 (fallback log)');
    console.log(`[mailer] To: ${to}`);
    console.log(`[mailer] Subject: ${subject}`);
    console.log(`[mailer] Body:\n${body}`);
    return;
  }

  try {
    await transporter.sendMail({
      from: `"NexyFab" <${from}>`,
      to,
      subject,
      html: body,
    });
    console.log(`[mailer] 발송 완료 → ${to} | ${subject}`);
  } catch (err) {
    console.error('[mailer] 발송 실패:', err);
  }
}
