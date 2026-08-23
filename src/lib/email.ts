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
import { isSuppressed } from './email-suppression';

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

let _transporter: nodemailer.Transporter | null = null;

function fromIdentity(): string {
  const address = process.env.SMTP_FROM || process.env.MAIL_FROM || 'noreply@nexyfab.com';
  if (address.includes('<') && address.includes('>')) return address;
  return `"${process.env.SMTP_FROM_NAME || 'NexyFab'}" <${address}>`;
}

async function sendWithResendApi(
  apiKey: string,
  opts: SendEmailOptions,
): Promise<{ messageId?: string }> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromIdentity(),
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      text: opts.text ?? opts.html.replace(/<[^>]+>/g, ''),
      ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({})) as { id?: string; message?: string; name?: string };
  if (!response.ok) throw new Error(`resend_http_${response.status}:${body.message ?? body.name ?? 'request_failed'}`);
  return { messageId: body.id };
}

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
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return _transporter;
}

export async function sendEmail(
  opts: SendEmailOptions,
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const t0 = Date.now();
  let statusCode = 0;
  let errorMessage: string | undefined;
  try {
    // Never send to a suppressed address (hard bounce / spam complaint) — doing
    // so degrades sender reputation and can get the SES account suspended.
    if (await isSuppressed(opts.to)) {
      console.warn('[email] skipped suppressed recipient:', opts.to);
      return { ok: false, error: 'recipient_suppressed' };
    }
    const resendKey = process.env.RESEND_API_KEY?.trim();
    const info = resendKey
      ? await sendWithResendApi(resendKey, opts)
      : await getTransporter().sendMail({
        from: fromIdentity(),
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text ?? opts.html.replace(/<[^>]+>/g, ''),
        ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
      });

    if (!process.env.SMTP_HOST && !resendKey) {
      console.log('[email] DEV MODE - would send:', { to: opts.to, subject: opts.subject });
      const testUrl = nodemailer.getTestMessageUrl(info);
      if (testUrl) console.log('[email] Preview:', testUrl);
    }

    statusCode = 200;
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    errorMessage = error;
    console.error('[email] Send failed:', error);
    return { ok: false, error };
  } finally {
    void (async () => {
      try {
        const { recordApiUsage } = await import('./api-meter');
        recordApiUsage({
          provider: 'ses',
          endpoint: 'mail.send',
          statusCode,
          latencyMs: Date.now() - t0,
          errorMessage,
        });
      } catch { /* ignore */ }
    })();
  }
}
