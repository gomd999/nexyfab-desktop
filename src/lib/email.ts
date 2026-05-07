/**
 * Email sender — wraps nodemailer with SMTP config from env vars.
 * Falls back to console.log in development when SMTP_HOST is not set.
 *
 * Required env vars:
 *   SMTP_HOST      e.g. smtp.gmail.com / email-smtp.ap-northeast-2.amazonaws.com
 *   SMTP_PORT      e.g. 587 (TLS) or 465 (SSL)
 *   SMTP_USER      SMTP username / AWS access key ID
 *   SMTP_PASS      SMTP password / AWS secret access key
 *   SMTP_FROM      e.g. noreply@nexyfab.com
 *   SMTP_FROM_NAME e.g. NexyFab (optional, defaults to 'NexyFab')
 */
import nodemailer from 'nodemailer';

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

let _transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (_transporter) return _transporter;

  const host = process.env.SMTP_HOST;
  if (!host) {
    // Dev/test mode: use jsonTransport (logs only, no network)
    _transporter = nodemailer.createTransport({ jsonTransport: true });
    return _transporter;
  }

  _transporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return _transporter;
}

export async function sendEmail(
  opts: SendEmailOptions,
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  try {
    const fromAddress = process.env.SMTP_FROM || process.env.MAIL_FROM || 'noreply@nexyfab.com';
    const fromName = process.env.SMTP_FROM_NAME || 'NexyFab';
    const from = `"${fromName}" <${fromAddress}>`;
    const transporter = getTransporter();

    const info = await transporter.sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text ?? opts.html.replace(/<[^>]+>/g, ''),
      ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
    });

    if (!process.env.SMTP_HOST) {
      console.log('[email] DEV MODE - would send:', { to: opts.to, subject: opts.subject });
      const testUrl = nodemailer.getTestMessageUrl(info);
      if (testUrl) console.log('[email] Preview:', testUrl);
    }

    return { ok: true, messageId: info.messageId };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[email] Send failed:', error);
    return { ok: false, error };
  }
}
