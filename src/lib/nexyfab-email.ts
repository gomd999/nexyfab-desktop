import nodemailer from 'nodemailer';
import { escapeHtml } from './sanitize';
import { getDbAdapter } from './db-adapter';
import { formatDate, formatMoney, formatNumber } from './i18n/format';

// ─── DB-first template loader ─────────────────────────────────────────────────

/**
 * Look up a custom email template from nf_email_templates by id or name.
 * Returns null if not found or DB unavailable (callers fall back to hardcoded HTML).
 * Variables are interpolated via {{key}} → values[key].
 */
export async function getEmailTemplate(
  idOrName: string,
  variables: Record<string, string | number> = {},
): Promise<string | null> {
  try {
    const db = getDbAdapter();
    const row = await db.queryOne<{ content: string }>(
      `SELECT content FROM nf_email_templates WHERE id = ? OR name = ? LIMIT 1`,
      idOrName, idOrName,
    );
    if (!row) return null;
    // Interpolate {{variable}} placeholders
    let html = row.content;
    for (const [key, val] of Object.entries(variables)) {
      html = html.replaceAll(`{{${key}}}`, escapeHtml(String(val)));
    }
    return html;
  } catch {
    return null;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RFQEmailData {
  rfqId: string;
  shapeName: string;
  materialId: string;
  quantity: number;
  volume_cm3: number;
  dfmScore?: number;
  estimatedCost?: number;
  userEmail?: string;
  userName?: string;
  status?: string;
  quoteAmount?: number;
}

/** Email copy bucket aligned with public `[lang]` routes (`ko` content → URL segment `kr`). */
export type NexyfabEmailContentLocale = 'ko' | 'en' | 'ja' | 'cn' | 'es' | 'ar';

/** Map email locale to Next.js `[lang]` path segment used in links. */
export function nexyfabAppLangPathFromEmailLocale(locale: NexyfabEmailContentLocale): 'kr' | 'en' | 'ja' | 'cn' | 'es' | 'ar' {
  return locale === 'ko' ? 'kr' : locale;
}

/**
 * Normalize `nf_users.language`, signup `language`, or `Accept-Language` to an email locale.
 */
export function nexyfabEmailLocaleFromLanguageTag(raw: string | null | undefined): NexyfabEmailContentLocale {
  const head = (raw ?? '').split(',')[0]?.trim().toLowerCase() ?? '';
  if (!head) return 'en';
  const primary = head.split('-')[0] ?? head;
  if (primary === 'kr' || primary === 'ko') return 'ko';
  if (primary === 'ja') return 'ja';
  if (primary === 'zh' || primary === 'cn' || head.startsWith('zh-')) return 'cn';
  if (primary === 'es') return 'es';
  if (primary === 'ar') return 'ar';
  return 'en';
}

function formatEmailDate(raw: string | undefined, locale: NexyfabEmailContentLocale): string | undefined {
  if (!raw) return undefined;
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return raw;
  return formatDate(timestamp, locale) ?? '';
}

/** Shared copy family for the remaining Korean/English/Japanese/Chinese template branches. */
function nexyfabEmailCopyFamily(locale: NexyfabEmailContentLocale): 'ko' | 'en' | 'ja' | 'cn' {
  if (locale === 'ko') return 'ko';
  if (locale === 'ja') return 'ja';
  if (locale === 'cn') return 'cn';
  return 'en';
}

// ─── Transport factory ────────────────────────────────────────────────────────

function getTransporter() {
  // Resend 우선
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    return nodemailer.createTransport({
      host: 'smtp.resend.com',
      port: 465,
      secure: true,
      auth: { user: 'resend', pass: resendKey },
    });
  }
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

/** Default plain address used when no env override is set. Keep in sync with
 *  the marketing/legal pages that show this address to users. */
const DEFAULT_NEXYFAB_EMAIL = 'nexyfab@nexysys.com';

const FROM_EMAIL = `"NexyFab" <${DEFAULT_NEXYFAB_EMAIL}>`;

/**
 * Canonical plain address NexyFab sends mail *from*. Prefers explicit overrides
 * (NEXYFAB_FROM_EMAIL → SMTP_USER) and falls back to the marketing default.
 * Use this anywhere you need a bare `from:` address (no display-name wrapper).
 */
export function getNexyfabFromEmail(): string {
  return process.env.NEXYFAB_FROM_EMAIL || process.env.SMTP_USER || DEFAULT_NEXYFAB_EMAIL;
}

/**
 * Canonical plain address ops/admin notifications are *delivered to*. Some
 * call sites historically used ADMIN_EMAIL, others NEXYFAB_ADMIN_EMAIL — both
 * are honored here, with NEXYFAB_ADMIN_EMAIL taking precedence.
 */
export function getNexyfabAdminEmail(): string {
  return process.env.NEXYFAB_ADMIN_EMAIL || process.env.ADMIN_EMAIL || DEFAULT_NEXYFAB_EMAIL;
}

// ─── Core send function (fire-and-forget) ────────────────────────────────────

async function logEmail(to: string, subject: string, html: string, status: 'sent' | 'failed', error?: string) {
  try {
    const db = getDbAdapter();
    await db.execute(
      `INSERT OR IGNORE INTO nf_email_logs (id, to_email, subject, body, status, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      `el-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      to, subject, html, status, error ?? null, Date.now(),
    ).catch(() => {
      // Lazy-add body column if missing
      db.execute('ALTER TABLE nf_email_logs ADD COLUMN body TEXT').catch(() => {});
    });
  } catch {
    // Logging is non-critical
  }
}

export interface EmailAttachment {
  filename: string;
  content: string | Buffer;
  encoding?: 'base64' | 'utf8' | 'binary';
  contentType?: string;
}

export interface SendEmailOptions {
  attachments?: EmailAttachment[];
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  opts: SendEmailOptions = {},
): Promise<boolean> {
  const transporter = getTransporter();

  if (!transporter) {
    console.log('[NexyFab Email — Demo Mode]');
    console.log(`  To     : ${to}`);
    console.log(`  Subject: ${subject}`);
    return true;
  }

  const MAX_ATTEMPTS = 3;
  const t0 = Date.now();
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || FROM_EMAIL,
        to,
        subject,
        html,
        ...(opts.attachments?.length
          ? { attachments: opts.attachments.map(a => ({
              filename: a.filename,
              content: a.content,
              encoding: a.encoding,
              contentType: a.contentType,
            })) }
          : {}),
      });
      logEmail(to, subject, html, 'sent').catch(() => {});
      // Metering — only on final outcome (don't bias latency by retries).
      void (async () => {
        try {
          const { recordApiUsage } = await import('./api-meter');
          recordApiUsage({
            provider: 'resend',
            endpoint: 'mail.send',
            statusCode: 200,
            latencyMs: Date.now() - t0,
          });
        } catch { /* ignore */ }
      })();
      return true;
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[NexyFab Email] Failed after ${MAX_ATTEMPTS} attempts:`, errMsg);
        logEmail(to, subject, html, 'failed', errMsg).catch(() => {});
        void (async () => {
          try {
            const { recordApiUsage } = await import('./api-meter');
            recordApiUsage({
              provider: 'resend',
              endpoint: 'mail.send',
              statusCode: 0,
              latencyMs: Date.now() - t0,
              errorMessage: errMsg,
            });
          } catch { /* ignore */ }
        })();
        return false;
      }
      await new Promise(r => setTimeout(r, attempt * 1000));
    }
  }
  return false;
}

// ─── HTML wrapper ─────────────────────────────────────────────────────────────

const EMAIL_FOOTER: Record<NexyfabEmailContentLocale, string> = {
  ko: '\uC218\uC2E0 \uAC70\uBD80 / Unsubscribe',
  en: 'Unsubscribe',
  ja: '\u914D\u4FE1\u505C\u6B62',
  cn: '\u53D6\u6D88\u8BA2\u9605',
  es: 'Cancelar suscripción',
  ar: '\u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643',
};

function emailWrapper(content: string, unsubscribeUrl?: string, locale: NexyfabEmailContentLocale = 'en'): string {
  const baseUrl = process.env.NEXTAUTH_URL || 'https://nexyfab.com';
  const unsub = unsubscribeUrl || `${baseUrl}/unsubscribe`;
  return `<!DOCTYPE html>
<html lang="${locale === 'ko' ? 'ko' : locale}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:16px;background:#161b22;">
  <div style="background:#0d1117;color:#e6edf3;font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:32px;border-radius:12px;border:1px solid #30363d;">
    <h1 style="margin:0 0 24px;font-size:22px;font-weight:700;color:#388bfd;letter-spacing:-0.5px;">NexyFab</h1>
    ${content}
    <hr style="border:none;border-top:1px solid #21262d;margin:32px 0 16px;">
    <p style="color:#6e7681;font-size:11px;margin:0;line-height:1.6;">
      NexyFab &middot; <a href="${baseUrl}" style="color:#6e7681;">nexyfab.com</a>
      &middot; <a href="${unsub}" style="color:#6e7681;">${EMAIL_FOOTER[locale]}</a>
    </p>
  </div>
</body>
</html>`;
}

// ─── RFQ helpers ──────────────────────────────────────────────────────────────

function rfqDetailTable(rfq: RFQEmailData, locale: NexyfabEmailContentLocale = 'ko'): string {
  if (locale !== 'ko') {
    const copy: Record<Exclude<NexyfabEmailContentLocale, 'ko'>, { rfq: string; part: string; material: string; quantity: string; volume: string; cost: string; score: string }> = {
      en: { rfq: 'RFQ number', part: 'Part', material: 'Material', quantity: 'Quantity', volume: 'Volume', cost: 'Estimated cost', score: 'DFM score' },
      ja: { rfq: '\u898B\u7A4D\u3082\u308A\u756A\u53F7', part: '\u90E8\u54C1\u540D', material: '\u6750\u8CEA', quantity: '\u6570\u91CF', volume: '\u4F53\u7A4D', cost: '\u4E88\u60F3\u8CBB\u7528', score: 'DFM \u30B9\u30B3\u30A2' },
      cn: { rfq: 'RFQ \u7F16\u53F7', part: '\u96F6\u4EF6\u540D\u79F0', material: '\u6750\u6599', quantity: '\u6570\u91CF', volume: '\u4F53\u79EF', cost: '\u9884\u8BA1\u8D39\u7528', score: 'DFM \u8BC4\u5206' },
      es: { rfq: 'N\u00famero de RFQ', part: 'Pieza', material: 'Material', quantity: 'Cantidad', volume: 'Volumen', cost: 'Coste estimado', score: 'Puntuaci\u00f3n DFM' },
      ar: { rfq: '\u0631\u0642\u0645 RFQ', part: '\u0627\u0644\u0642\u0637\u0639\u0629', material: '\u0627\u0644\u0645\u0627\u062f\u0629', quantity: '\u0627\u0644\u0643\u0645\u064a\u0629', volume: '\u0627\u0644\u062d\u062c\u0645', cost: '\u0627\u0644\u062a\u0643\u0644\u0641\u0629 \u0627\u0644\u062a\u0642\u062f\u064a\u0631\u064a\u0629', score: '\u062f\u0631\u062c\u0629 DFM' },
    };
    const c = copy[locale as Exclude<NexyfabEmailContentLocale, 'ko'>];
    const quantity = formatNumber(rfq.quantity, locale) ?? String(rfq.quantity);
    return `<table style="width:100%;border-collapse:collapse;margin:16px 0;"><tr><td>${c.rfq}</td><td>${escapeHtml(rfq.rfqId.slice(0, 8).toUpperCase())}</td></tr><tr><td>${c.part}</td><td>${escapeHtml(rfq.shapeName)}</td></tr><tr><td>${c.material}</td><td>${escapeHtml(rfq.materialId)}</td></tr><tr><td>${c.quantity}</td><td>${quantity}</td></tr><tr><td>${c.volume}</td><td>${rfq.volume_cm3.toFixed(2)} cm³</td></tr>${rfq.dfmScore != null ? `<tr><td>${c.score}</td><td>${rfq.dfmScore}/100</td></tr>` : ''}${rfq.estimatedCost != null ? `<tr><td>${c.cost}</td><td>$${rfq.estimatedCost.toFixed(2)}</td></tr>` : ''}</table>`;
  }
  const costLine = rfq.estimatedCost != null
    ? `<tr><td style="padding:6px 0;color:#8b949e;font-size:13px;">예상 비용</td><td style="padding:6px 0;font-size:13px;text-align:right;color:#e6edf3;">$${rfq.estimatedCost.toFixed(2)}</td></tr>`
    : '';
  const dfmLine = rfq.dfmScore != null
    ? `<tr><td style="padding:6px 0;color:#8b949e;font-size:13px;">DFM 점수</td><td style="padding:6px 0;font-size:13px;text-align:right;color:#e6edf3;">${rfq.dfmScore}/100</td></tr>`
    : '';

  return `
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <tr style="border-bottom:1px solid #21262d;">
        <td style="padding:6px 0;color:#8b949e;font-size:13px;">RFQ 번호</td>
        <td style="padding:6px 0;font-size:13px;text-align:right;color:#e6edf3;font-family:monospace;">${escapeHtml(rfq.rfqId.slice(0, 8).toUpperCase())}</td>
      </tr>
      <tr style="border-bottom:1px solid #21262d;">
        <td style="padding:6px 0;color:#8b949e;font-size:13px;">부품명</td>
        <td style="padding:6px 0;font-size:13px;text-align:right;color:#e6edf3;">${escapeHtml(rfq.shapeName)}</td>
      </tr>
      <tr style="border-bottom:1px solid #21262d;">
        <td style="padding:6px 0;color:#8b949e;font-size:13px;">재질</td>
        <td style="padding:6px 0;font-size:13px;text-align:right;color:#e6edf3;">${escapeHtml(rfq.materialId)}</td>
      </tr>
      <tr style="border-bottom:1px solid #21262d;">
        <td style="padding:6px 0;color:#8b949e;font-size:13px;">수량</td>
        <td style="padding:6px 0;font-size:13px;text-align:right;color:#e6edf3;">${formatNumber(rfq.quantity, 'ko') ?? rfq.quantity} 개</td>
      </tr>
      <tr style="border-bottom:1px solid #21262d;">
        <td style="padding:6px 0;color:#8b949e;font-size:13px;">부피</td>
        <td style="padding:6px 0;font-size:13px;text-align:right;color:#e6edf3;">${rfq.volume_cm3.toFixed(2)} cm³</td>
      </tr>
      ${dfmLine}
      ${costLine}
    </table>`;
}

// ─── Template: RFQ 확인 (사용자용) ───────────────────────────────────────────

export function rfqConfirmationEmailSubject(locale: NexyfabEmailContentLocale): string {
  switch (locale) {
    case 'ko': return '[NexyFab] 견적 요청이 접수되었습니다';
    case 'ja': return '[NexyFab] 見積もり依頼を受け付けました';
    case 'cn': return '[NexyFab] 报价请求已提交';
    case 'es': return '[NexyFab] Solicitud de cotización recibida';
    case 'ar': return '[NexyFab] تم استلام طلب عرض السعر';
    default: return '[NexyFab] RFQ received';
  }
}

export function rfqConfirmationHtml(rfq: RFQEmailData, locale: NexyfabEmailContentLocale = 'ko'): string {
  const baseUrl = process.env.NEXTAUTH_URL || 'https://nexyfab.com';
  const langPath = nexyfabAppLangPathFromEmailLocale(locale);
  const rfqUrl = `${baseUrl}/${langPath}/nexyfab/rfq/${rfq.rfqId}`;

  const safeUserName = rfq.userName ? escapeHtml(rfq.userName) : '';
  if (locale === 'es' || locale === 'ar') {
    const es = locale === 'es';
    const title = es ? 'Solicitud de cotización recibida' : '\u062a\u0645 \u0627\u0633\u062a\u0644\u0627\u0645 \u0637\u0644\u0628 \u0627\u0644\u062a\u0633\u0639\u064a\u0631';
    const greeting = es ? `Hola${safeUserName ? ` ${safeUserName}` : ''}. Tu solicitud se ha enviado correctamente.` : `\u0645\u0631\u062d\u0628\u0627${safeUserName ? ` ${safeUserName}` : ''}. \u062a\u0645 \u0625\u0631\u0633\u0627\u0644 \u0637\u0644\u0628\u0643 \u0628\u0646\u062c\u0627\u062d.`;
    const cta = es ? 'Ver mi solicitud' : '\u0639\u0631\u0636 \u0637\u0644\u0628\u064a';
    const content = `<h2>${title}</h2><p>${greeting}<br>${es ? 'Nuestro equipo se pondrá en contacto contigo en 24–48 horas.' : '\u0633\u064a\u062a\u0648\u0627\u0635\u0644 \u0641\u0631\u064a\u0642\u0646\u0627 \u0645\u0639\u0643 \u062e\u0644\u0627\u0644 24–48 \u0633\u0627\u0639\u0629.'}</p>${rfqDetailTable(rfq, locale)}<a href="${rfqUrl}">${cta}</a>`;
    return emailWrapper(content, undefined, locale);
  }
  const fam = nexyfabEmailCopyFamily(locale);

  let title: string;
  let p1: string;
  let cta: string;
  switch (fam) {
    case 'ko':
      title = '견적 요청이 접수되었습니다';
      p1 = `안녕하세요${safeUserName ? ` ${safeUserName}님` : ''}! 견적 요청이 성공적으로 접수되었습니다.<br>
      <strong style="color:#e6edf3;">24–48시간</strong> 이내에 담당자가 연락드리겠습니다.`;
      cta = '견적 요청 확인하기';
      break;
    case 'ja':
      title = '見積もり依頼を受け付けました';
      p1 = `こんにちは${safeUserName ? `、${safeUserName} 様` : ''}。お見積もり依頼を正常に受け付けました。<br>
      <strong style="color:#e6edf3;">24〜48時間以内</strong>に担当者よりご連絡いたします。`;
      cta = '依頼内容を確認する';
      break;
    case 'cn':
      title = '报价请求已提交';
      p1 = `您好${safeUserName ? `，${safeUserName}` : ''}！我们已收到您的报价请求。<br>
      我们的团队将在<strong style="color:#e6edf3;">24–48 小时</strong>内与您联系。`;
      cta = '查看我的报价请求';
      break;
    default:
      title = 'Your RFQ has been received';
      p1 = `Hello${safeUserName ? ` ${safeUserName}` : ''}! Your quote request was successfully submitted.<br>
      Our team will get back to you within <strong style="color:#e6edf3;">24–48 hours</strong>.`;
      cta = 'View My RFQ';
  }

  const content = `
    <h2 style="font-size:18px;font-weight:600;margin:0 0 8px;color:#e6edf3;">${title}</h2>
    <p style="color:#8b949e;font-size:14px;margin:0 0 20px;line-height:1.6;">
      ${p1}
    </p>
    ${rfqDetailTable(rfq, locale)}
    <a href="${rfqUrl}"
       style="display:inline-block;margin-top:8px;padding:12px 24px;background:#388bfd;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
      ${cta}
    </a>
  `;

  return emailWrapper(content, undefined, locale);
}

/** Admin / ops transactional emails — default Korean unless `NEXYFAB_ADMIN_EMAIL_LOCALE` is set. */
export function nexyfabAdminEmailLocale(): NexyfabEmailContentLocale {
  const raw = process.env.NEXYFAB_ADMIN_EMAIL_LOCALE?.trim();
  return raw ? nexyfabEmailLocaleFromLanguageTag(raw) : 'ko';
}

export function rfqNotificationEmailSubject(
  locale: NexyfabEmailContentLocale,
  variant: 'new_rfq' | 'quote_accepted',
  opts: { shapeName: string; rfqIdPrefix: string },
): string {
  const p = opts.rfqIdPrefix.toUpperCase();
  switch (variant) {
    case 'quote_accepted':
      switch (locale) {
        case 'ko': return `[NexyFab] 견적 수락됨 — RFQ #${p}`;
        case 'ja': return `[NexyFab] 見積もり承認 — RFQ #${p}`;
        case 'cn': return `[NexyFab] 报价已接受 — RFQ #${p}`;
        case 'es': return `[NexyFab] Cotización aceptada — RFQ #${p}`;
        case 'ar': return `[NexyFab] تم قبول العرض — RFQ #${p}`;
        default: return `[NexyFab] Quote accepted — RFQ #${p}`;
      }
    default:
      switch (locale) {
        case 'ko': return `[NexyFab] 새 RFQ #${p} — ${opts.shapeName}`;
        case 'ja': return `[NexyFab] 新規 RFQ #${p} — ${opts.shapeName}`;
        case 'cn': return `[NexyFab] 新 RFQ #${p} — ${opts.shapeName}`;
        case 'es': return `[NexyFab] Nuevo RFQ #${p} — ${opts.shapeName}`;
        case 'ar': return `[NexyFab] طلب عرض جديد #${p} — ${opts.shapeName}`;
        default: return `[NexyFab] New RFQ #${p} — ${opts.shapeName}`;
      }
  }
}

export function rfqNotificationHtml(
  rfq: RFQEmailData,
  locale: NexyfabEmailContentLocale = 'ko',
  variant: 'new_rfq' | 'quote_accepted' = 'new_rfq',
  opts?: { afterIntroHtml?: string },
): string {
  const baseUrl = process.env.NEXTAUTH_URL || 'https://nexyfab.com';
  const langPath = nexyfabAppLangPathFromEmailLocale(locale);
  const rfqUrl = `${baseUrl}/${langPath}/nexyfab/rfq/${rfq.rfqId}`;
  const extra = opts?.afterIntroHtml ?? '';
  if (locale === 'es' || locale === 'ar') {
    const es = locale === 'es';
    const accepted = variant === 'quote_accepted';
    const title = es ? (accepted ? 'Cotización aceptada ✓' : 'Nueva solicitud de cotización') : (accepted ? '\u062a\u0645 \u0642\u0628\u0648\u0644 \u0627\u0644\u0639\u0631\u0636 ✓' : '\u0637\u0644\u0628 \u062a\u0633\u0639\u064a\u0631 \u062c\u062f\u064a\u062f');
    const intro = es ? (accepted ? 'El cliente ha aceptado la cotización. Confirma la planificación de producción.' : 'Has recibido una nueva RFQ. Revisa los detalles y envía tu oferta.') : (accepted ? '\u0642\u0628\u0644 \u0627\u0644\u0639\u0645\u064a\u0644 \u0627\u0644\u0639\u0631\u0636. \u064a\u0631\u062c\u0649 \u062a\u0623\u0643\u064a\u062f \u062c\u062f\u0648\u0644 \u0627\u0644\u0625\u0646\u062a\u0627\u062c.' : '\u0648\u0635\u0644 \u0637\u0644\u0628 RFQ \u062c\u062f\u064a\u062f. \u0631\u0627\u062c\u0639 \u0627\u0644\u062a\u0641\u0627\u0635\u064a\u0644 \u0648\u0642\u062f\u0645 \u0639\u0631\u0636\u0643.');
    const cta = es ? (accepted ? 'Abrir RFQ' : 'Enviar cotización') : (accepted ? '\u0641\u062a\u062d RFQ' : '\u062a\u0642\u062f\u064a\u0645 \u0627\u0644\u0639\u0631\u0636');
    const reqLabel = es ? 'Correo del solicitante' : '\u0628\u0631\u064a\u062f \u0635\u0627\u062d\u0628 \u0627\u0644\u0637\u0644\u0628';
    const content = `<h2>${title}</h2><p>${intro}</p>${extra}${rfqDetailTable(rfq, locale)}${rfq.userEmail ? `<p>${reqLabel}: ${escapeHtml(rfq.userEmail)}</p>` : ''}<a href="${rfqUrl}">${cta}</a>`;
    return emailWrapper(content, undefined, locale);
  }
  const fam = nexyfabEmailCopyFamily(locale);

  let title: string;
  let intro: string;
  let cta: string;
  let reqLabel: string;

  if (variant === 'quote_accepted') {
    switch (fam) {
      case 'ko':
        title = '견적이 수락되었습니다 ✓';
        intro = '고객이 견적을 수락했습니다. 생산 일정을 확인하고 연락해 주세요.';
        cta = 'RFQ 열기';
        reqLabel = '요청자 이메일';
        break;
      case 'ja':
        title = '見積もりが承認されました ✓';
        intro = 'お客様が見積もりを承認しました。生産スケジュールを確認し、ご連絡ください。';
        cta = 'RFQ を開く';
        reqLabel = '依頼者メール';
        break;
      case 'cn':
        title = '报价已被接受 ✓';
        intro = '客户已接受报价。请确认生产安排并及时联系。';
        cta = '打开 RFQ';
        reqLabel = '请求者邮箱';
        break;
      default:
        title = 'Quote accepted ✓';
        intro = 'The customer accepted a quote. Please confirm production scheduling and follow up.';
        cta = 'Open RFQ';
        reqLabel = 'Requester email';
    }
  } else {
    switch (fam) {
      case 'ko':
        title = '새 견적 요청 도착';
        intro = '새로운 RFQ가 접수되었습니다. 아래 상세 내용을 확인하고 견적을 보내주세요.';
        cta = '견적 보내기';
        reqLabel = '요청자 이메일';
        break;
      case 'ja':
        title = '新規見積もり依頼';
        intro = '新しい RFQ が届きました。詳細を確認のうえ、見積もりをご提出ください。';
        cta = '見積もりを送る';
        reqLabel = '依頼者メール';
        break;
      case 'cn':
        title = '新的报价请求';
        intro = '收到新的 RFQ。请查看详情并提交报价。';
        cta = '提交报价';
        reqLabel = '请求者邮箱';
        break;
      default:
        title = 'New RFQ received';
        intro = 'A new RFQ has arrived. Review the details below and submit your quote.';
        cta = 'Send quote';
        reqLabel = 'Requester email';
    }
  }

  const content = `
    <h2 style="font-size:18px;font-weight:600;margin:0 0 8px;color:#f0883e;">${title}</h2>
    <p style="color:#8b949e;font-size:14px;margin:0 0 20px;line-height:1.6;">
      ${intro}
    </p>
    ${extra}
    ${rfqDetailTable(rfq, locale)}
    ${rfq.userEmail ? `<p style="color:#8b949e;font-size:13px;margin:4px 0;">${reqLabel}: <span style="color:#e6edf3;">${escapeHtml(rfq.userEmail)}</span></p>` : ''}
    <a href="${rfqUrl}"
       style="display:inline-block;margin-top:16px;padding:12px 24px;background:#388bfd;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
      ${cta}
    </a>
  `;

  return emailWrapper(content, undefined, locale);
}

// ─── Template: 환영 이메일 ────────────────────────────────────────────────────

export function welcomeEmailSubject(locale: NexyfabEmailContentLocale): string {
  switch (locale) {
    case 'ko': return '[NexyFab] 가입을 환영합니다! 🎉';
    case 'ja': return '[NexyFab] ご登録ありがとうございます';
    case 'cn': return '[NexyFab] 欢迎加入';
    case 'es': return '[NexyFab] ¡Bienvenido/a!';
    case 'ar': return '[NexyFab] مرحبًا بك';
    default: return '[NexyFab] Welcome aboard!';
  }
}

export function welcomeHtml(name: string, locale: NexyfabEmailContentLocale = 'ko'): string {
  const baseUrl = process.env.NEXTAUTH_URL || 'https://nexyfab.com';
  const langPath = nexyfabAppLangPathFromEmailLocale(locale);
  const ctaUrl = `${baseUrl}/${langPath}/shape-generator`;
  const safeName = escapeHtml(name);
  if (locale === 'es' || locale === 'ar') {
    const es = locale === 'es';
    const title = es ? '¡Te damos la bienvenida a NexyFab! 🎉' : '\u0645\u0631\u062d\u0628\u0627 \u0628\u0643 \u0641\u064a NexyFab! 🎉';
    const para = es ? `Hola <strong style="color:#e6edf3;">${safeName}</strong>. Gracias por unirte a NexyFab.<br>Descubre una fabricación más inteligente con nuestra plataforma impulsada por IA.` : `\u0645\u0631\u062d\u0628\u0627 <strong style="color:#e6edf3;">${safeName}</strong>. \u0634\u0643\u0631\u0627\u064b \u0644\u0627\u0646\u0636\u0645\u0627\u0645\u0643 \u0625\u0644\u064a\u0646\u0627.<br>\u0627\u062e\u062a\u0628\u0631 \u062a\u0635\u0646\u064a\u0639\u0627\u064b \u0623\u0630\u0643\u0649 \u0645\u0639 \u0645\u0646\u0635\u062a\u0646\u0627 \u0627\u0644\u0645\u062f\u0639\u0648\u0645\u0629 \u0628\u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064a.`;
    const features = es ? ['Carga de diseños 3D — análisis de archivos STL/STEP', 'Análisis DFM — revisión de fabricabilidad con IA', 'Cotización automática — costes y plazos por proceso', 'Conexión con fabricantes — red global de socios'] : ['\u062a\u062d\u0645\u064a\u0644 \u062a\u0635\u0627\u0645\u064a\u0645 3D — \u062a\u062d\u0644\u064a\u0644 \u0645\u0644\u0641\u0627\u062a STL/STEP', '\u062a\u062d\u0644\u064a\u0644 DFM — \u0645\u0631\u0627\u062c\u0639\u0629 \u0627\u0644\u062a\u0635\u0646\u064a\u0639 \u0628\u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064a', '\u062a\u0633\u0639\u064a\u0631 \u062a\u0644\u0642\u0627\u0626\u064a — \u062a\u0642\u062f\u064a\u0631 \u0627\u0644\u062a\u0643\u0644\u0641\u0629 \u0648\u0627\u0644\u0645\u0647\u0644\u0629', '\u0627\u0644\u062a\u0648\u0627\u0635\u0644 \u0645\u0639 \u0627\u0644\u0645\u0635\u0646\u0639\u064a\u0646 — \u0634\u0628\u0643\u0629 \u0634\u0631\u0643\u0627\u0621 \u0639\u0627\u0644\u0645\u064a\u0629'];
    const content = `<h2>${title}</h2><p>${para}</p><p> ${es ? 'Funciones principales' : '\u0627\u0644\u0645\u064a\u0632\u0627\u062a \u0627\u0644\u0631\u0626\u064a\u0633\u064a\u0629'}</p><ul>${features.map(f => `<li>${f}</li>`).join('')}</ul><a href="${ctaUrl}">${es ? 'Empezar ahora' : '\u0627\u0628\u062f\u0623 \u0627\u0644\u0622\u0646'}</a>`;
    return emailWrapper(content, undefined, locale);
  }
  const fam = nexyfabEmailCopyFamily(locale);

  let title: string;
  let para: string;
  let featTitle: string;
  let f1: string;
  let f2: string;
  let f3: string;
  let f4: string;
  let cta: string;
  switch (fam) {
    case 'ko':
      title = 'NexyFab에 오신 것을 환영합니다! 🎉';
      para = `안녕하세요 <strong style="color:#e6edf3;">${safeName}</strong>님! NexyFab에 가입해 주셔서 감사합니다.<br>AI 기반 제조 플랫폼으로 더 스마트한 제조를 경험해 보세요.`;
      featTitle = '주요 기능';
      f1 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">3D 설계 업로드</strong> — STL/STEP 파일 분석</li>';
      f2 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">DFM 분석</strong> — AI 기반 제조 가능성 검토</li>';
      f3 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">자동 견적</strong> — 공정별 비용 및 납기 추정</li>';
      f4 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">제조사 연결</strong> — 글로벌 제조 파트너 매칭</li>';
      cta = '지금 시작하기';
      break;
    case 'ja':
      title = 'NexyFab へようこそ！🎉';
      para = `<strong style="color:#e6edf3;">${safeName}</strong> 様、ご登録ありがとうございます。<br>AI を活用した製造プラットフォームで、よりスマートなものづくりを体験してください。`;
      featTitle = '主な機能';
      f1 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">3D 設計アップロード</strong> — STL/STEP 解析</li>';
      f2 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">DFM 解析</strong> — AI による製造性レビュー</li>';
      f3 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">自動見積もり</strong> — 工程別コスト・納期の推定</li>';
      f4 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">製造パートナー紹介</strong> — グローバルネットワーク</li>';
      cta = 'はじめる';
      break;
    case 'cn':
      title = '欢迎加入 NexyFab！🎉';
      para = `您好 <strong style="color:#e6edf3;">${safeName}</strong>，感谢注册 NexyFab。<br>体验由 AI 驱动的智能制造平台。`;
      featTitle = '核心功能';
      f1 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">3D 设计上载</strong> — STL/STEP 分析</li>';
      f2 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">DFM 分析</strong> — AI 可制造性评估</li>';
      f3 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">自动报价</strong> — 按工艺估算成本与交期</li>';
      f4 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">制造商对接</strong> — 全球伙伴网络</li>';
      cta = '立即开始';
      break;
    default:
      title = 'Welcome to NexyFab! 🎉';
      para = `Hi <strong style="color:#e6edf3;">${safeName}</strong>! Thanks for joining NexyFab.<br>Experience smarter manufacturing with our AI-powered platform.`;
      featTitle = 'Key Features';
      f1 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">3D Design Upload</strong> — STL/STEP file analysis</li>';
      f2 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">DFM Analysis</strong> — AI-powered manufacturability review</li>';
      f3 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">Auto Quoting</strong> — Cost and lead-time estimation per process</li>';
      f4 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">Manufacturer Matching</strong> — Global manufacturing partner network</li>';
      cta = 'Get Started';
  }

  const content = `
    <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;color:#e6edf3;">${title}</h2>
    <p style="color:#8b949e;font-size:14px;margin:0 0 20px;line-height:1.6;">
      ${para}
    </p>
    <div style="background:#161b22;border-radius:8px;padding:20px;margin:0 0 24px;">
      <p style="color:#e6edf3;font-size:14px;font-weight:600;margin:0 0 12px;">${featTitle}</p>
      <ul style="color:#8b949e;font-size:13px;margin:0;padding-left:20px;line-height:2;">
        ${f1}
        ${f2}
        ${f3}
        ${f4}
      </ul>
    </div>
    <a href="${ctaUrl}"
       style="display:inline-block;padding:12px 28px;background:#388bfd;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
      ${cta}
    </a>
  `;

  return emailWrapper(content, undefined, locale);
}

// ─── Template: 인증 코드 ──────────────────────────────────────────────────────

export function verificationHtml(code: string, locale: NexyfabEmailContentLocale = 'ko'): string {
  let title: string;
  let p1: string;
  let foot: string;
  switch (locale) {
    case 'ko':
      title = '이메일 인증 코드';
      p1 = '아래 인증 코드를 입력해 이메일 주소를 확인해 주세요. 코드는 10분 후 만료됩니다.';
      foot = '본인이 요청하지 않은 경우 이 이메일을 무시하세요.';
      break;
    case 'ja':
      title = 'メール認証コード';
      p1 = '以下の認証コードを入力してメールアドレスを確認してください。コードの有効期限は10分です。';
      foot = '心当たりがない場合はこのメールを破棄してください。';
      break;
    case 'cn':
      title = '邮箱验证码';
      p1 = '请输入以下验证码以确认邮箱。验证码 10 分钟后失效。';
      foot = '如非本人操作，请忽略此邮件。';
      break;
    case 'es':
      title = 'Código de verificación';
      p1 = 'Introduce el código siguiente para verificar tu correo. Caduca en 10 minutos.';
      foot = 'Si no solicitaste esto, ignora este mensaje.';
      break;
    case 'ar':
      title = 'رمز التحقق';
      p1 = 'أدخل الرمز أدناه لتأكيد بريدك. ينتهي خلال 10 دقائق.';
      foot = 'إذا لم تطلب هذا، يمكنك تجاهل الرسالة.';
      break;
    default:
      title = 'Email Verification Code';
      p1 = 'Enter the code below to verify your email address. The code expires in 10 minutes.';
      foot = 'If you did not request this, please ignore this email.';
  }

  const content = `
    <h2 style="font-size:18px;font-weight:600;margin:0 0 8px;color:#e6edf3;">${title}</h2>
    <p style="color:#8b949e;font-size:14px;margin:0 0 20px;line-height:1.6;">
      ${p1}
    </p>
    <div style="background:#161b22;border-radius:8px;padding:24px;text-align:center;margin:0 0 20px;border:1px solid #388bfd;">
      <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#388bfd;font-family:monospace;">${code}</span>
    </div>
    <p style="color:#6e7681;font-size:12px;margin:0;">${foot}</p>
  `;

  return emailWrapper(content, undefined, locale);
}

// ─── Template: 드립 D+1 — 핵심 기능 소개 ──────────────────────────────────────

export function dripD1EmailSubject(locale: NexyfabEmailContentLocale): string {
  switch (locale) {
    case 'ko': return '[NexyFab] 오늘 꼭 써보세요 — 핵심 기능 3가지';
    case 'ja': return '[NexyFab] 今日試したい3つの機能';
    case 'cn': return '[NexyFab] 今天试试这三项功能';
    case 'es': return '[NexyFab] 3 funciones para probar hoy';
    case 'ar': return '[NexyFab] 3 ميزات لتجربتها اليوم';
    default: return '[NexyFab] 3 Features to Try Today';
  }
}

export function dripD1Html(name: string, locale: NexyfabEmailContentLocale = 'ko', unsubscribeUrl?: string): string {
  const baseUrl = process.env.NEXTAUTH_URL || 'https://nexyfab.com';
  const safeName = escapeHtml(name || '');
  const langPath = nexyfabAppLangPathFromEmailLocale(locale);
  if (locale === 'es' || locale === 'ar') {
    const es = locale === 'es';
    const items = es
      ? ['Diseño 3D en el navegador — importa STEP/IGES', 'Cotización rápida con IA — analiza costes por material y proceso', 'Matching de fabricantes — socios recomendados por IA']
      : ['\u062a\u0635\u0645\u064a\u0645 3D \u0641\u064a \u0627\u0644\u0645\u062a\u0635\u0641\u062d — \u0627\u0633\u062a\u064a\u0631\u0627\u062f STEP/IGES', '\u062a\u0633\u0639\u064a\u0631 \u0633\u0631\u064a\u0639 \u0628\u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064a — \u062a\u062d\u0644\u064a\u0644 \u0627\u0644\u062a\u0643\u0644\u0641\u0629', '\u0645\u0637\u0627\u0628\u0642\u0629 \u0627\u0644\u0645\u0635\u0646\u0639\u064a\u0646 — \u0634\u0631\u0643\u0627\u0621 \u0645\u0648\u0635\u0649 \u0628\u0647\u0645'];
    const content = `<h2>${es ? 'Tres funciones para probar hoy' : '\u062b\u0644\u0627\u062b \u0645\u064a\u0632\u0627\u062a \u0644\u062a\u062c\u0631\u0628\u062a\u0647\u0627 \u0627\u0644\u064a\u0648\u0645'}</h2><p>${es ? `Hola <strong>${safeName}</strong>. Descubre las funciones principales de NexyFab; cada una ofrece resultados en unos minutos.` : `\u0645\u0631\u062d\u0628\u0627 <strong>${safeName}</strong>. \u0627\u0643\u062a\u0634\u0641 \u0627\u0644\u0645\u064a\u0632\u0627\u062a \u0627\u0644\u0623\u0633\u0627\u0633\u064a\u0629 \u0641\u064a NexyFab.`}</p><ul>${items.map(item => `<li>${item}</li>`).join('')}</ul><a href="${baseUrl}/${langPath}/nexyfab">${es ? 'Abrir NexyFab' : '\u0641\u062a\u062d NexyFab'}</a>`;
    return emailWrapper(content, unsubscribeUrl, locale);
  }
  const fam = nexyfabEmailCopyFamily(locale);

  let h2: string;
  let intro: string;
  let t1: string; let n1: string; let d1: string; let a1: string;
  let t2: string; let n2: string; let d2: string; let a2: string;
  let t3: string; let n3: string; let d3: string; let a3: string;
  let cta: string;

  switch (fam) {
    case 'ko':
      h2 = '오늘 꼭 써보세요 — 3가지 핵심 기능';
      intro = `안녕하세요 <strong style="color:#e6edf3;">${safeName}</strong>님! 가입 이후 처음 사용해 보셨나요?<br>NexyFab의 핵심 기능 3가지를 소개드릴게요. 각각 5분 안에 결과를 확인할 수 있습니다.`;
      t1 = '기능 1'; n1 = '3D Shape Generator';
      d1 = '파라메트릭 3D 형상 16종을 브라우저에서 바로 설계하세요. STEP/IGES 파일 임포트도 지원합니다.'; a1 = '3D 설계 시작하기 →';
      t2 = '기능 2'; n2 = 'AI 빠른 견적';
      d2 = 'STEP 파일을 업로드하면 AI가 재질별·공정별 제조 원가를 즉시 분석합니다.'; a2 = '견적 받기 →';
      t3 = '기능 3'; n3 = '제조사 매칭';
      d3 = '28만+ 공장 DB 기반으로 프로젝트에 맞는 최적의 제조 파트너를 AI가 추천합니다.'; a3 = '매칭 요청하기 →';
      cta = 'NexyFab 워크벤치 열기';
      break;
    case 'ja':
      h2 = '今日試したい — 3つのコア機能';
      intro = `<strong style="color:#e6edf3;">${safeName}</strong> 様、NexyFab はお試しになりましたか？<br>主要機能を3つご紹介します。どれも約5分で結果を確認できます。`;
      t1 = '機能 1'; n1 = '3D Shape Generator';
      d1 = 'ブラウザで16種類のパラメトリック3D形状を設計。STEP/IGES インポートにも対応。'; a1 = '設計を始める →';
      t2 = '機能 2'; n2 = 'AIクイック見積もり';
      d2 = 'STEPをアップロードすると、材料・工程別の概算コストをAIが即時分析します。'; a2 = '見積もりを取る →';
      t3 = '機能 3'; n3 = '製造パートナーマッチング';
      d3 = '28万件超の工場データから、プロジェクトに最適なパートナーをAIが推薦します。'; a3 = 'マッチングを依頼 →';
      cta = 'NexyFab を開く';
      break;
    case 'cn':
      h2 = '今天试试 — 三项核心功能';
      intro = `您好 <strong style="color:#e6edf3;">${safeName}</strong>，是否已经体验过 NexyFab？<br>以下三项功能每项约 5 分钟即可看到结果。`;
      t1 = '功能 1'; n1 = '3D Shape Generator';
      d1 = '在浏览器中设计 16 种参数化 3D 形状，支持 STEP/IGES 导入。'; a1 = '开始设计 →';
      t2 = '功能 2'; n2 = 'AI 快速报价';
      d2 = '上传 STEP，AI 按材料与工艺即时分析制造成本。'; a2 = '获取报价 →';
      t3 = '功能 3'; n3 = '制造商匹配';
      d3 = '基于 30 万+ 工厂数据，AI 推荐最适合您项目的制造伙伴。'; a3 = '发起匹配 →';
      cta = '打开 NexyFab 工作台';
      break;
    default:
      h2 = 'Try These 3 Features Today';
      intro = `Hi <strong style="color:#e6edf3;">${safeName}</strong>! Have you tried NexyFab yet?<br>Here are 3 key features — each delivers results in under 5 minutes.`;
      t1 = 'Feature 1'; n1 = '3D Shape Generator';
      d1 = 'Design 16 parametric 3D shapes right in your browser. STEP/IGES import also supported.'; a1 = 'Start designing →';
      t2 = 'Feature 2'; n2 = 'AI Quick Quote';
      d2 = 'Upload a STEP file and get instant AI-powered manufacturing cost analysis by material and process.'; a2 = 'Get a quote →';
      t3 = 'Feature 3'; n3 = 'Manufacturer Matching';
      d3 = 'AI recommends the best manufacturing partners from our 286,000+ factory database.'; a3 = 'Request matching →';
      cta = 'Open NexyFab Workbench';
      break;
  }

  const content = `
    <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;color:#e6edf3;">${h2}</h2>
    <p style="color:#8b949e;font-size:14px;margin:0 0 20px;line-height:1.6;">
      ${intro}
    </p>
    <div style="background:#161b22;border-radius:8px;padding:20px;margin:0 0 16px;border-left:3px solid #388bfd;">
      <p style="color:#388bfd;font-size:12px;font-weight:700;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px;">${t1}</p>
      <p style="color:#e6edf3;font-size:15px;font-weight:600;margin:0 0 4px;">${n1}</p>
      <p style="color:#8b949e;font-size:13px;margin:0 0 12px;line-height:1.6;">${d1}</p>
      <a href="${baseUrl}/${langPath}/shape-generator" style="font-size:13px;color:#388bfd;text-decoration:none;">${a1}</a>
    </div>
    <div style="background:#161b22;border-radius:8px;padding:20px;margin:0 0 16px;border-left:3px solid #3fb950;">
      <p style="color:#3fb950;font-size:12px;font-weight:700;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px;">${t2}</p>
      <p style="color:#e6edf3;font-size:15px;font-weight:600;margin:0 0 4px;">${n2}</p>
      <p style="color:#8b949e;font-size:13px;margin:0 0 12px;line-height:1.6;">${d2}</p>
      <a href="${baseUrl}/${langPath}/quick-quote" style="font-size:13px;color:#3fb950;text-decoration:none;">${a2}</a>
    </div>
    <div style="background:#161b22;border-radius:8px;padding:20px;margin:0 0 24px;border-left:3px solid #f0883e;">
      <p style="color:#f0883e;font-size:12px;font-weight:700;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px;">${t3}</p>
      <p style="color:#e6edf3;font-size:15px;font-weight:600;margin:0 0 4px;">${n3}</p>
      <p style="color:#8b949e;font-size:13px;margin:0 0 12px;line-height:1.6;">${d3}</p>
      <a href="${baseUrl}/${langPath}/project-inquiry" style="font-size:13px;color:#f0883e;text-decoration:none;">${a3}</a>
    </div>
    <a href="${baseUrl}/${langPath}/nexyfab"
       style="display:inline-block;padding:12px 28px;background:#388bfd;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
      ${cta}
    </a>
  `;

  return emailWrapper(content, unsubscribeUrl, locale);
}

// ─── Template: 드립 D+7 — Pro 업그레이드 제안 ──────────────────────────────────

export function dripD7EmailSubject(locale: NexyfabEmailContentLocale): string {
  switch (locale) {
    case 'ko': return '[NexyFab] Pro로 업그레이드하고 더 많이 만드세요';
    case 'ja': return '[NexyFab] Pro にアップグレード';
    case 'cn': return '[NexyFab] 升级 Pro，释放更多产能';
    case 'es': return '[NexyFab] Pásate a Pro y crea más';
    case 'ar': return '[NexyFab] ترقية إلى Pro';
    default: return '[NexyFab] Upgrade to Pro and build more';
  }
}

export function dripD7Html(name: string, locale: NexyfabEmailContentLocale = 'ko', unsubscribeUrl?: string): string {
  const baseUrl = process.env.NEXTAUTH_URL || 'https://nexyfab.com';
  const safeName = escapeHtml(name || '');
  const langPath = nexyfabAppLangPathFromEmailLocale(locale);
  const fam = nexyfabEmailCopyFamily(locale);
  const pricingUrl = `${baseUrl}/${langPath}/nexyfab/pricing`;
  if (locale === 'es' || locale === 'ar') {
    const es = locale === 'es';
    const benefits = es ? ['Proyectos 3D ilimitados — guarda y comparte', 'DFM avanzado con IA — incluye análisis FEA', 'Envío automático de RFQ — conexión directa con fábricas', 'Colaboración de equipo — invita a miembros y co-diseña', 'Soporte prioritario'] : ['\u0645\u0634\u0627\u0631\u064a\u0639 3D \u063a\u064a\u0631 \u0645\u062d\u062f\u0648\u062f\u0629', 'DFM \u0645\u062a\u0642\u062f\u0645 \u0628\u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064a', '\u0625\u0631\u0633\u0627\u0644 RFQ \u062a\u0644\u0642\u0627\u0626\u064a\u060c \u0648\u0635\u0644 \u0645\u0628\u0627\u0634\u0631 \u0628\u0627\u0644\u0645\u0635\u0627\u0646\u0639', '\u062a\u0639\u0627\u0648\u0646 \u0627\u0644\u0641\u0631\u064a\u0642', '\u062f\u0639\u0645 \u0645\u0648\u0644\u0649'];
    const content = `<h2>${es ? 'Crea más con NexyFab Pro' : '\u0627\u0646\u062c\u0632 \u0627\u0644\u0645\u0632\u064a\u062f \u0645\u0639 NexyFab Pro'}</h2><p>${es ? `Hola <strong>${safeName}</strong>. Lleva tu fabricación al siguiente nivel con proyectos ilimitados y herramientas avanzadas.` : `\u0645\u0631\u062d\u0628\u0627 <strong>${safeName}</strong>. \u0627\u0631\u062a\u0642 \u0628\u062a\u0635\u0646\u064a\u0639\u0643 \u0645\u0639 \u0627\u0644\u0645\u0634\u0627\u0631\u064a\u0639 \u0648\u0627\u0644\u0623\u062f\u0648\u0627\u062a \u0627\u0644\u0645\u062a\u0642\u062f\u0645\u0629.`}</p><ul>${benefits.map(item => `<li>${item}</li>`).join('')}</ul><a href="${pricingUrl}">${es ? 'Empezar Pro' : '\u0627\u0628\u062f\u0623 Pro'}</a> <a href="${baseUrl}/${langPath}/nexyfab">${es ? 'Continuar gratis' : '\u0627\u0644\u0645\u062a\u0627\u0628\u0639\u0629 \u0645\u062c\u0627\u0646\u0627\u064b'}</a>`;
    return emailWrapper(content, unsubscribeUrl, locale);
  }

  let h2: string;
  let intro: string;
  let benTitle: string;
  let b1: string;
  let b2: string;
  let b3: string;
  let b4: string;
  let b5: string;
  let ctaPro: string;
  let ctaFree: string;

  switch (fam) {
    case 'ko':
      h2 = 'NexyFab Pro로 더 많이 만드세요';
      intro = `안녕하세요 <strong style="color:#e6edf3;">${safeName}</strong>님! NexyFab을 사용한 지 일주일이 지났네요.<br>무료 플랜에서 경험하셨나요? Pro로 업그레이드하면 제한 없이 제조 프로젝트를 관리할 수 있습니다.`;
      benTitle = 'Pro 플랜 혜택';
      b1 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">무제한 3D 프로젝트</strong> 저장 및 공유</li>';
      b2 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">AI 어드밴스드 DFM 분석</strong> — FEA 구조해석 포함</li>';
      b3 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">RFQ 자동 발송</strong> — 28만+ 제조사 직접 연결</li>';
      b4 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">팀 협업</strong> — 멤버 초대 및 공동 설계</li>';
      b5 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">우선 고객 지원</strong></li>';
      ctaPro = 'Pro 시작하기';
      ctaFree = '무료로 계속 사용';
      break;
    case 'ja':
      h2 = 'NexyFab Pro でさらに制作';
      intro = `<strong style="color:#e6edf3;">${safeName}</strong> 様、NexyFab をご利用いただき1週間が経ちました。<br>無料プランをお試しですか？Pro にアップグレードすると、製造プロジェクトを制限なく管理できます。`;
      benTitle = 'Pro の主な特典';
      b1 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">無制限の3Dプロジェクト</strong> — 保存と共有</li>';
      b2 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">高度なAI DFM</strong> — FEA 構造解析を含む</li>';
      b3 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">RFQ 自動送信</strong> — 28万件超の工場へ直接</li>';
      b4 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">チームコラボ</strong> — メンバー招待・共同設計</li>';
      b5 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">優先サポート</strong></li>';
      ctaPro = 'Pro を始める';
      ctaFree = '無料のまま続ける';
      break;
    case 'cn':
      h2 = '用 NexyFab Pro 做得更多';
      intro = `您好 <strong style="color:#e6edf3;">${safeName}</strong>，您使用 NexyFab 已满一周。<br>升级 Pro 可无限制管理制造项目。`;
      benTitle = 'Pro 权益';
      b1 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">无限 3D 项目</strong> — 保存与分享</li>';
      b2 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">高级 AI DFM</strong> — 含 FEA 结构分析</li>';
      b3 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">自动 RFQ</strong> — 直连 30 万+ 工厂</li>';
      b4 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">团队协作</strong> — 邀请成员、共同设计</li>';
      b5 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">优先支持</strong></li>';
      ctaPro = '开通 Pro';
      ctaFree = '继续免费使用';
      break;
    default:
      h2 = 'Build More with NexyFab Pro';
      intro = `Hi <strong style="color:#e6edf3;">${safeName}</strong>! You've been with NexyFab for a week now.<br>Upgrade to Pro and unlock unlimited manufacturing project management.`;
      benTitle = 'Pro Plan Benefits';
      b1 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">Unlimited 3D projects</strong> — save and share</li>';
      b2 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">Advanced AI DFM</strong> — includes FEA structural analysis</li>';
      b3 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">Auto RFQ sending</strong> — direct connection to 300K+ factories</li>';
      b4 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">Team collaboration</strong> — invite members, co-design</li>';
      b5 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">Priority support</strong></li>';
      ctaPro = 'Start Pro';
      ctaFree = 'Continue Free';
      break;
  }

  const content = `
    <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;color:#e6edf3;">${h2}</h2>
    <p style="color:#8b949e;font-size:14px;margin:0 0 20px;line-height:1.6;">
      ${intro}
    </p>
    <div style="background:#161b22;border-radius:8px;padding:20px;margin:0 0 24px;">
      <p style="color:#f0883e;font-size:13px;font-weight:700;margin:0 0 12px;">${benTitle}</p>
      <ul style="color:#8b949e;font-size:13px;margin:0;padding-left:20px;line-height:2.2;">
        ${b1}
        ${b2}
        ${b3}
        ${b4}
        ${b5}
      </ul>
    </div>
    <div>
      <a href="${pricingUrl}"
         style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#388bfd,#8b9cf4);color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;margin-right:12px;">
        ${ctaPro}
      </a>
      <a href="${baseUrl}/${langPath}/nexyfab"
         style="display:inline-block;padding:12px 28px;background:#21262d;color:#e6edf3;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;border:1px solid #30363d;">
        ${ctaFree}
      </a>
    </div>
  `;

  return emailWrapper(content, unsubscribeUrl, locale);
}

// ─── Transactional: RFQ assigned to factory ──────────────────────────────────

/**
 * 관리자가 RFQ를 제조사에 배정할 때 제조사에게 발송
 */
export function rfqAssignedToFactoryHtml(opts: {
  factoryName: string;
  rfqId: string;
  shapeName: string;
  materialId: string;
  quantity: number;
  note?: string;
  lang?: string;
  adminDashboardUrl?: string;
}): string {
  const locale = nexyfabEmailLocaleFromLanguageTag(opts.lang);
  if (locale !== 'ko') {
    const copy: Record<Exclude<NexyfabEmailContentLocale, 'ko'>, { title: string; intro: string; part: string; material: string; quantity: string; note: string; cta: string; footer: string }> = {
      en: { title: 'New quote request', intro: 'A new quote request has been assigned to your factory. Review the details and submit your quote.', part: 'Part', material: 'Material', quantity: 'Quantity', note: 'Note', cta: 'Submit quote', footer: 'Please respond within 48 hours.' },
      ja: { title: '\u65b0\u3057\u3044\u898B\u7A4D\u3082\u308A\u4F9D\u983C', intro: '\u65B0\u3057\u3044\u898B\u7A4D\u3082\u308A\u4F9D\u983C\u304C\u5FA1\u793E\u306B\u5272\u308A\u5F53\u3066\u3089\u308C\u307E\u3057\u305F\u3002\u8A73\u7D30\u3092\u78BA\u8A8D\u3057\u3001\u898B\u7A4D\u3082\u308A\u3092\u63D0\u51FA\u3057\u3066\u304F\u3060\u3055\u3044\u3002', part: '\u90E8\u54C1', material: '\u6750\u8CEA', quantity: '\u6570\u91CF', note: '\u30E1\u30E2', cta: '\u898B\u7A4D\u3082\u308A\u3092\u63D0\u51FA', footer: '48\u6642\u9593\u4EE5\u5185\u306B\u3054\u56DE\u7B54\u304F\u3060\u3055\u3044\u3002' },
      cn: { title: '\u65B0\u62A5\u4EF7\u8BF7\u6C42', intro: '\u65B0\u7684\u62A5\u4EF7\u8BF7\u6C42\u5DF2\u5206\u914D\u7ED9\u60A8\u7684\u5DE5\u5382\u3002\u8BF7\u67E5\u770B\u8BE6\u60C5\u5E76\u63D0\u4EA4\u62A5\u4EF7\u3002', part: '\u96F6\u4EF6', material: '\u6750\u6599', quantity: '\u6570\u91CF', note: '\u5907\u6CE8', cta: '\u63D0\u4EA4\u62A5\u4EF7', footer: '\u8BF7\u5728 48 \u5C0F\u65F6\u5185\u56DE\u590D\u3002' },
      es: { title: 'Nueva solicitud de cotizaci\u00f3n', intro: 'Se ha asignado una nueva solicitud de cotizaci\u00f3n a tu f\u00e1brica. Revisa los datos y env\u00eda tu oferta.', part: 'Pieza', material: 'Material', quantity: 'Cantidad', note: 'Nota', cta: 'Enviar cotizaci\u00f3n', footer: 'Responde en un plazo de 48 horas.' },
      ar: { title: '\u0637\u0644\u0628 \u062a\u0633\u0639\u064a\u0631 \u062c\u062f\u064a\u062f', intro: '\u062a\u0645 \u062a\u0639\u064a\u064a\u0646 \u0637\u0644\u0628 \u062a\u0633\u0639\u064a\u0631 \u062c\u062f\u064a\u062f \u0644\u0645\u0635\u0646\u0639\u0643. \u0631\u0627\u062c\u0639 \u0627\u0644\u062a\u0641\u0627\u0635\u064a\u0644 \u0648\u0642\u062f\u0645 \u0639\u0631\u0636\u0643.', part: '\u0627\u0644\u0642\u0637\u0639\u0629', material: '\u0627\u0644\u0645\u0627\u062f\u0629', quantity: '\u0627\u0644\u0643\u0645\u064a\u0629', note: '\u0645\u0644\u0627\u062d\u0638\u0629', cta: '\u062a\u0642\u062f\u064a\u0645 \u0627\u0644\u0639\u0631\u0636', footer: '\u064a\u0631\u062c\u0649 \u0627\u0644\u0631\u062f \u062e\u0644\u0627\u0644 48 \u0633\u0627\u0639\u0629.' },
    };
    const c = copy[locale];
    const quantity = formatNumber(opts.quantity, locale) ?? String(opts.quantity);
    const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://nexyfab.com';
    const dashUrl = opts.adminDashboardUrl || `${base}/partner/quotes`;
    const content = `<h2>${c.title}</h2><p>${c.intro}</p><table><tr><td>RFQ ID</td><td>${escapeHtml(opts.rfqId)}</td></tr><tr><td>${c.part}</td><td>${escapeHtml(opts.shapeName)}</td></tr><tr><td>${c.material}</td><td>${escapeHtml(opts.materialId)}</td></tr><tr><td>${c.quantity}</td><td>${quantity}</td></tr>${opts.note ? `<tr><td>${c.note}</td><td>${escapeHtml(opts.note)}</td></tr>` : ''}</table><a href="${dashUrl}">${c.cta}</a><p>${c.footer}</p>`;
    return emailWrapper(content, undefined, locale);
  }
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://nexyfab.com';
  const dashUrl = opts.adminDashboardUrl || `${base}/partner/quotes`;

  const content = `
    <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;color:#e6edf3;">새 견적 요청이 도착했습니다</h2>
    <p style="color:#8b949e;font-size:14px;margin:0 0 20px;line-height:1.6;">
      안녕하세요 <strong style="color:#e6edf3;">${escapeHtml(opts.factoryName)}</strong>님,<br>
      NexyFab을 통해 새로운 견적 요청이 배정되었습니다. 아래 내용을 확인하고 견적을 제출해 주세요.
    </p>
    <div style="background:#161b22;border-radius:8px;padding:20px;margin:0 0 24px;border:1px solid #30363d;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr><td style="color:#8b949e;padding:6px 0;width:120px;">RFQ ID</td><td style="color:#e6edf3;font-weight:600;">${escapeHtml(opts.rfqId)}</td></tr>
        <tr><td style="color:#8b949e;padding:6px 0;">부품명</td><td style="color:#e6edf3;font-weight:600;">${escapeHtml(opts.shapeName)}</td></tr>
        <tr><td style="color:#8b949e;padding:6px 0;">소재</td><td style="color:#e6edf3;">${escapeHtml(opts.materialId)}</td></tr>
        <tr><td style="color:#8b949e;padding:6px 0;">수량</td><td style="color:#e6edf3;">${formatNumber(opts.quantity, 'ko') ?? opts.quantity}개</td></tr>
        ${opts.note ? `<tr><td style="color:#8b949e;padding:6px 0;">메모</td><td style="color:#e6edf3;">${escapeHtml(opts.note)}</td></tr>` : ''}
      </table>
    </div>
    <a href="${dashUrl}"
       style="display:inline-block;padding:12px 28px;background:#388bfd;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;">
      견적 제출하기
    </a>
    <p style="color:#6e7681;font-size:12px;margin-top:20px;">
      48시간 내에 응답해 주시면 감사하겠습니다.
    </p>
  `;
  return emailWrapper(content, undefined, locale);
}

// ─── Transactional: Quote received by customer ───────────────────────────────

export function quoteReceivedEmailSubject(locale: NexyfabEmailContentLocale, projectName: string): string {
  switch (locale) {
    case 'ko': return `[NexyFab] 견적이 도착했습니다 — ${projectName}`;
    case 'ja': return `[NexyFab] 見積もりが届きました — ${projectName}`;
    case 'cn': return `[NexyFab] 报价已送达 — ${projectName}`;
    case 'es': return `[NexyFab] Recibió una cotización — ${projectName}`;
    case 'ar': return `[NexyFab] وصل عرض سعر — ${projectName}`;
    default: return `[NexyFab] You received a quote — ${projectName}`;
  }
}

/** In-app `nf_notifications` title for quote received (copy family, not per es/ar string). */
export function quoteReceivedInAppTitle(locale: NexyfabEmailContentLocale, projectName: string): string {
  if (locale === 'es') return `Cotización recibida: ${projectName}`;
  if (locale === 'ar') return `\u062a\u0645 \u0627\u0633\u062a\u0644\u0627\u0645 \u0627\u0644\u0639\u0631\u0636: ${projectName}`;
  switch (nexyfabEmailCopyFamily(locale)) {
    case 'ko': return `견적 도착: ${projectName}`;
    case 'ja': return `見積もり到着: ${projectName}`;
    case 'cn': return `报价已送达: ${projectName}`;
    default: return `Quote received: ${projectName}`;
  }
}

/** In-app notification body line (copy family). */
export function quoteReceivedInAppBody(locale: NexyfabEmailContentLocale, factoryLabel: string): string {
  if (locale === 'es') return `${factoryLabel || 'Fabricante'} ha enviado una cotización.`;
  if (locale === 'ar') return `${factoryLabel || '\u0627\u0644\u0645\u0635\u0646\u0639'} \u0642\u062f\u0645 \u0639\u0631\u0636\u0627\u064b.`;
  const fam = nexyfabEmailCopyFamily(locale);
  const fn = factoryLabel || ({ ko: '제조사', en: 'Manufacturer', ja: 'メーカー', cn: '制造商' } as const)[fam];
  switch (fam) {
    case 'ko': return `${fn}에서 견적을 제출했습니다.`;
    case 'ja': return `${fn}が見積もりを提出しました。`;
    case 'cn': return `${fn}已提交报价。`;
    default: return `${fn} submitted a quote.`;
  }
}

/**
 * 제조사가 견적을 제출했을 때 고객에게 발송
 */
export function quoteReceivedHtml(opts: {
  userName: string;
  lang?: string;
  rfqId: string;
  shapeName: string;
  factoryName: string;
  estimatedAmount: number;
  currency?: string;
  validUntil?: string;
  rfqPageUrl?: string;
}): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://nexyfab.com';
  const locale = nexyfabEmailLocaleFromLanguageTag(opts.lang);
  const langPath = nexyfabAppLangPathFromEmailLocale(locale);
  const rfqUrl = opts.rfqPageUrl || `${base}/${langPath}/nexyfab/rfq/${opts.rfqId}`;
  const currency = opts.currency || 'KRW';
  const fam = nexyfabEmailCopyFamily(locale);
  const amount = formatNumber(opts.estimatedAmount, locale) ?? String(opts.estimatedAmount);
  const safeName = escapeHtml(opts.userName || '');
  if (locale === 'es' || locale === 'ar') {
    const es = locale === 'es';
    const labels = es ? { title: '¡Has recibido una cotización! 💬', greeting: `Hola <strong>${safeName}</strong>,`, intro: 'ha enviado una cotización para tu solicitud.', part: 'Pieza', manufacturer: 'Fabricante', amount: 'Importe de la cotización', valid: 'Válida hasta', cta: 'Revisar y aceptar', footer: 'Acepta dentro del periodo de validez.' } : { title: '\u0648\u0635\u0644 \u0639\u0631\u0636 \u0633\u0639\u0631 💬', greeting: `\u0645\u0631\u062d\u0628\u0627 <strong>${safeName}</strong}`, intro: '\u0642\u062f\u0645 \u0639\u0631\u0636\u0627\u064b \u0644\u0637\u0644\u0628\u0643.', part: '\u0627\u0644\u0642\u0637\u0639\u0629', manufacturer: '\u0627\u0644\u0645\u0635\u0646\u0639', amount: '\u0642\u064a\u0645\u0629 \u0627\u0644\u0639\u0631\u0636', valid: '\u0635\u0627\u0644\u062d \u062d\u062a\u0649', cta: '\u0645\u0631\u0627\u062c\u0639\u0629 \u0648\u0642\u0628\u0648\u0644', footer: '\u064a\u0631\u062c\u0649 \u0627\u0644\u0642\u0628\u0648\u0644 \u062e\u0644\u0627\u0644 \u0645\u062f\u0629 \u0627\u0644\u0635\u0644\u0627\u062d\u064a\u0629.' };
    const content = `<h2>${labels.title}</h2><p>${labels.greeting},<br><strong>${escapeHtml(opts.factoryName)}</strong> ${labels.intro}</p><table><tr><td>${labels.part}</td><td>${escapeHtml(opts.shapeName)}</td></tr><tr><td>${labels.manufacturer}</td><td>${escapeHtml(opts.factoryName)}</td></tr><tr><td>${labels.amount}</td><td>${amount} ${escapeHtml(currency)}</td></tr>${opts.validUntil ? `<tr><td>${labels.valid}</td><td>${escapeHtml(opts.validUntil)}</td></tr>` : ''}</table><a href="${rfqUrl}">${labels.cta}</a><p>${labels.footer}</p>`;
    return emailWrapper(content, undefined, locale);
  }

  let title: string;
  let p1: string;
  let colPart: string;
  let colMfr: string;
  let colAmt: string;
  let colValid: string;
  let cta: string;
  let footer: string;

  switch (fam) {
    case 'ko':
      title = '견적이 도착했습니다! 💬';
      p1 = `안녕하세요 <strong style="color:#e6edf3;">${safeName}</strong>님,<br>
      <strong style="color:#3fb950;">${escapeHtml(opts.factoryName)}</strong>에서 견적을 제출했습니다.`;
      colPart = '부품명';
      colMfr = '제조사';
      colAmt = '견적 금액';
      colValid = '유효 기간';
      cta = '견적 확인 및 수락하기';
      footer = '견적 유효 기간 내에 수락해 주세요. 기간이 지나면 재견적이 필요할 수 있습니다.';
      break;
    case 'ja':
      title = '見積もりが届きました 💬';
      p1 = `<strong style="color:#e6edf3;">${safeName}</strong> 様、こんにちは。<br>
      <strong style="color:#3fb950;">${escapeHtml(opts.factoryName)}</strong> よりお見積もりが提出されました。`;
      colPart = '部品名';
      colMfr = '製造元';
      colAmt = '見積金額';
      colValid = '有効期限';
      cta = '見積もりを確認して承認';
      footer = '有効期限内にご承認ください。期限後は再見積もりが必要になる場合があります。';
      break;
    case 'cn':
      title = '您收到了报价 💬';
      p1 = `您好 <strong style="color:#e6edf3;">${safeName}</strong>，<br>
      <strong style="color:#3fb950;">${escapeHtml(opts.factoryName)}</strong> 已提交报价。`;
      colPart = '零件名称';
      colMfr = '制造商';
      colAmt = '报价金额';
      colValid = '有效期至';
      cta = '查看并接受报价';
      footer = '请在有效期内接受报价。过期后可能需要重新报价。';
      break;
    default:
      title = 'You received a quote! 💬';
      p1 = `Hi <strong style="color:#e6edf3;">${safeName}</strong>,<br>
      <strong style="color:#3fb950;">${escapeHtml(opts.factoryName)}</strong> has submitted a quote for your request.`;
      colPart = 'Part';
      colMfr = 'Manufacturer';
      colAmt = 'Quoted amount';
      colValid = 'Valid until';
      cta = 'Review & accept quote';
      footer = 'Please accept within the validity period. After expiry, re-quoting may be needed.';
  }

  const content = `
    <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;color:#e6edf3;">${title}</h2>
    <p style="color:#8b949e;font-size:14px;margin:0 0 20px;line-height:1.6;">
      ${p1}
    </p>
    <div style="background:#161b22;border-radius:8px;padding:20px;margin:0 0 24px;border:1px solid #30363d;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr><td style="color:#8b949e;padding:6px 0;width:120px;">${colPart}</td><td style="color:#e6edf3;font-weight:600;">${escapeHtml(opts.shapeName)}</td></tr>
        <tr><td style="color:#8b949e;padding:6px 0;">${colMfr}</td><td style="color:#e6edf3;">${escapeHtml(opts.factoryName)}</td></tr>
        <tr><td style="color:#8b949e;padding:6px 0;">${colAmt}</td><td style="color:#f0883e;font-weight:800;font-size:16px;">${amount} ${escapeHtml(currency)}</td></tr>
        ${opts.validUntil ? `<tr><td style="color:#8b949e;padding:6px 0;">${colValid}</td><td style="color:#e6edf3;">${escapeHtml(opts.validUntil)}</td></tr>` : ''}
      </table>
    </div>
    <a href="${rfqUrl}"
       style="display:inline-block;padding:12px 28px;background:#388bfd;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;">
      ${cta}
    </a>
    <p style="color:#6e7681;font-size:12px;margin-top:20px;">
      ${footer}
    </p>
  `;
  return emailWrapper(content, undefined, locale);
}

// ─── Transactional: Contract signed ──────────────────────────────────────────

/**
 * 계약 체결 시 고객과 제조사 양측에 발송
 */
export function contractSignedHtml(opts: {
  recipientName: string;
  recipientType: 'customer' | 'factory';
  lang?: string;
  contractId: string;
  projectName: string;
  factoryName: string;
  contractAmount: number;
  currency?: string;
  deadline?: string;
  dashboardUrl?: string;
}): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://nexyfab.com';
  const locale = nexyfabEmailLocaleFromLanguageTag(opts.lang);
  const dashUrl = opts.dashboardUrl || (
    opts.recipientType === 'factory'
      ? `${base}/partner/projects`
      : `${base}/${nexyfabAppLangPathFromEmailLocale(locale)}/nexyfab/orders`
  );
  const currency = opts.currency || 'KRW';
  const amount = formatMoney(opts.contractAmount, locale, currency, { currencyDisplay: 'code' }) ?? `${opts.contractAmount} ${currency}`;
  const safeName = escapeHtml(opts.recipientName || '');
  const deadline = formatEmailDate(opts.deadline, locale);

  if (['en', 'ja', 'cn', 'es', 'ar'].includes(locale)) {
    const copy: Record<Exclude<NexyfabEmailContentLocale, 'ko'>, { title: string; greeting: string; customer: string; factory: string; id: string; project: string; manufacturer: string; amountLabel: string; deadline: string; customerCta: string; factoryCta: string }> = {
      en: { title: 'Contract signed! 🎉', greeting: 'Hi', customer: `Your contract with <strong style="color:#3fb950;">${escapeHtml(opts.factoryName)}</strong> has been confirmed.`, factory: `The contract for <strong style="color:#3fb950;">${escapeHtml(opts.projectName)}</strong> has been signed.`, id: 'Contract ID', project: 'Project', manufacturer: 'Manufacturer', amountLabel: 'Contract amount', deadline: 'Deadline', customerCta: 'View order status', factoryCta: 'Manage project' },
      ja: { title: '\u5951\u7D04\u304C\u7DE0\u7D50\u3055\u308C\u307E\u3057\u305F! 🎉', greeting: '\u3053\u3093\u306B\u3061\u306F', customer: `<strong style="color:#3fb950;">${escapeHtml(opts.factoryName)}</strong>\u3068\u306E\u5951\u7D04\u304C\u78BA\u5B9A\u3057\u307E\u3057\u305F\u3002`, factory: `<strong style="color:#3fb950;">${escapeHtml(opts.projectName)}</strong>\u306E\u5951\u7D04\u304C\u7DE0\u7D50\u3055\u308C\u307E\u3057\u305F\u3002`, id: '\u5951\u7D04ID', project: '\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8', manufacturer: '\u88FD\u9020\u5143', amountLabel: '\u5951\u7D04\u91D1\u984D', deadline: '\u7D0D\u671F', customerCta: '\u6CE8\u6587\u72B6\u6CC1\u3092\u898B\u308B', factoryCta: '\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u7BA1\u7406' },
      cn: { title: '\u5408\u540C\u5DF2\u7B7E\u7F72! 🎉', greeting: '\u60A8\u597D', customer: `您与 <strong style="color:#3fb950;">${escapeHtml(opts.factoryName)}</strong> 的合同已确认。`, factory: `<strong style="color:#3fb950;">${escapeHtml(opts.projectName)}</strong> 的合同已签署。`, id: '\u5408\u540CID', project: '\u9879\u76EE', manufacturer: '\u5236\u9020\u5546', amountLabel: '\u5408\u540C\u91D1\u989D', deadline: '\u4EA4\u4ED8\u65E5\u671F', customerCta: '\u67E5\u770B\u8BA2\u5355\u72B6\u6001', factoryCta: '\u7BA1\u7406\u9879\u76EE' },
      es: { title: '¡Contrato firmado! 🎉', greeting: 'Hola', customer: `Tu contrato con <strong style="color:#3fb950;">${escapeHtml(opts.factoryName)}</strong> ha sido confirmado.`, factory: `Se ha firmado el contrato del proyecto <strong style="color:#3fb950;">${escapeHtml(opts.projectName)}</strong>.`, id: 'ID del contrato', project: 'Proyecto', manufacturer: 'Fabricante', amountLabel: 'Importe del contrato', deadline: 'Fecha límite', customerCta: 'Ver estado del pedido', factoryCta: 'Gestionar proyecto' },
      ar: { title: '\u062A\u0645 \u062A\u0648\u0642\u064A\u0639 \u0627\u0644\u0639\u0642\u062F! 🎉', greeting: '\u0645\u0631\u062D\u0628\u0627', customer: `تم تأكيد عقدك مع <strong style="color:#3fb950;">${escapeHtml(opts.factoryName)}</strong>.`, factory: `تم توقيع عقد مشروع <strong style="color:#3fb950;">${escapeHtml(opts.projectName)}</strong>.`, id: '\u0645\u0639\u0631\u0641 \u0627\u0644\u0639\u0642\u062F', project: '\u0627\u0644\u0645\u0634\u0631\u0648\u0639', manufacturer: '\u0627\u0644\u0645\u0635\u0646\u0639', amountLabel: '\u0642\u064A\u0645\u0629 \u0627\u0644\u0639\u0642\u062F', deadline: '\u0627\u0644\u0645\u0648\u0639\u062F \u0627\u0644\u0646\u0647\u0627\u0626\u064A', customerCta: '\u0639\u0631\u0636 \u062D\u0627\u0644\u0629 \u0627\u0644\u0637\u0644\u0628', factoryCta: '\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u0634\u0631\u0648\u0639' },
    };
    const c = copy[locale as Exclude<NexyfabEmailContentLocale, 'ko'>];
    const content = `<h2 style="font-size:20px;font-weight:700;margin:0 0 8px;color:#e6edf3;">${c.title}</h2><p style="color:#8b949e;font-size:14px;line-height:1.6;">${c.greeting} <strong style="color:#e6edf3;">${safeName}</strong>,<br>${opts.recipientType === 'customer' ? c.customer : c.factory}</p><table style="width:100%;border-collapse:collapse;font-size:13px;"><tr><td>${c.id}</td><td>${escapeHtml(opts.contractId)}</td></tr><tr><td>${c.project}</td><td>${escapeHtml(opts.projectName)}</td></tr><tr><td>${c.manufacturer}</td><td>${escapeHtml(opts.factoryName)}</td></tr><tr><td>${c.amountLabel}</td><td>${amount}</td></tr>${deadline ? `<tr><td>${c.deadline}</td><td>${escapeHtml(deadline)}</td></tr>` : ''}</table><a href="${dashUrl}">${opts.recipientType === 'customer' ? c.customerCta : c.factoryCta}</a>`;
    return emailWrapper(content, undefined, locale);
  }

  const content = ['ko'].includes(locale) ? `
    <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;color:#e6edf3;">계약이 체결됐습니다! 🎉</h2>
    <p style="color:#8b949e;font-size:14px;margin:0 0 20px;line-height:1.6;">
      안녕하세요 <strong style="color:#e6edf3;">${safeName}</strong>님,<br>
      ${opts.recipientType === 'customer'
        ? `<strong style="color:#3fb950;">${escapeHtml(opts.factoryName)}</strong>와의 계약이 성공적으로 체결됐습니다.`
        : `<strong style="color:#3fb950;">${escapeHtml(opts.projectName)}</strong> 프로젝트 계약이 체결됐습니다.`}
    </p>
    <div style="background:#161b22;border-radius:8px;padding:20px;margin:0 0 24px;border:1px solid #30363d;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr><td style="color:#8b949e;padding:6px 0;width:120px;">계약 ID</td><td style="color:#e6edf3;font-weight:600;">${escapeHtml(opts.contractId)}</td></tr>
        <tr><td style="color:#8b949e;padding:6px 0;">프로젝트명</td><td style="color:#e6edf3;">${escapeHtml(opts.projectName)}</td></tr>
        <tr><td style="color:#8b949e;padding:6px 0;">제조사</td><td style="color:#e6edf3;">${escapeHtml(opts.factoryName)}</td></tr>
        <tr><td style="color:#8b949e;padding:6px 0;">계약 금액</td><td style="color:#3fb950;font-weight:800;font-size:16px;">${amount}</td></tr>
        ${deadline ? `<tr><td style="color:#8b949e;padding:6px 0;">납기일</td><td style="color:#e6edf3;">${escapeHtml(deadline)}</td></tr>` : ''}
      </table>
    </div>
    <a href="${dashUrl}"
       style="display:inline-block;padding:12px 28px;background:#3fb950;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;">
      ${opts.recipientType === 'customer' ? '주문 현황 확인' : '프로젝트 관리'}
    </a>
  ` : `
    <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;color:#e6edf3;">Contract Signed! 🎉</h2>
    <p style="color:#8b949e;font-size:14px;margin:0 0 20px;line-height:1.6;">
      Hi <strong style="color:#e6edf3;">${safeName}</strong>,<br>
      ${opts.recipientType === 'customer'
        ? `Your contract with <strong style="color:#3fb950;">${escapeHtml(opts.factoryName)}</strong> has been confirmed.`
        : `The contract for <strong style="color:#3fb950;">${escapeHtml(opts.projectName)}</strong> has been signed.`}
    </p>
    <div style="background:#161b22;border-radius:8px;padding:20px;margin:0 0 24px;border:1px solid #30363d;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr><td style="color:#8b949e;padding:6px 0;width:120px;">Contract ID</td><td style="color:#e6edf3;font-weight:600;">${escapeHtml(opts.contractId)}</td></tr>
        <tr><td style="color:#8b949e;padding:6px 0;">Project</td><td style="color:#e6edf3;">${escapeHtml(opts.projectName)}</td></tr>
        <tr><td style="color:#8b949e;padding:6px 0;">Manufacturer</td><td style="color:#e6edf3;">${escapeHtml(opts.factoryName)}</td></tr>
        <tr><td style="color:#8b949e;padding:6px 0;">Contract Amount</td><td style="color:#3fb950;font-weight:800;font-size:16px;">${amount} ${currency}</td></tr>
        ${deadline ? `<tr><td style="color:#8b949e;padding:6px 0;">Deadline</td><td style="color:#e6edf3;">${escapeHtml(deadline)}</td></tr>` : ''}
      </table>
    </div>
    <a href="${dashUrl}"
       style="display:inline-block;padding:12px 28px;background:#3fb950;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;">
      ${opts.recipientType === 'customer' ? 'View Order Status' : 'Manage Project'}
    </a>
  `;
  return emailWrapper(content, undefined, locale);
}

// ─── Partner RFQ notification ─────────────────────────────────────────────────

export function partnerRfqNotificationHtml(opts: {
  rfqId: string;
  shapeName?: string;
  materialId: string;
  quantity: number;
  dfmProcess?: string;
  note?: string;
  partnerDashUrl?: string;
  lang?: string;
}): string {
  const locale = nexyfabEmailLocaleFromLanguageTag(opts.lang);
  if (locale !== 'ko') {
    const copy: Record<Exclude<NexyfabEmailContentLocale, 'ko'>, { title: string; intro: string; process: string; note: string; quantity: string; cta: string; footer: string }> = {
      en: { title: 'New quote request', intro: 'A new RFQ matching your capabilities is available. Submit a quote to win the project.', process: 'Process', note: 'Note', quantity: 'Quantity', cta: 'Submit quote', footer: 'Review this RFQ in your partner dashboard.' },
      ja: { title: '\u65b0\u3057\u3044\u898B\u7A4D\u3082\u308A\u4F9D\u983C', intro: '\u5BFE\u5FDC\u53EF\u80FD\u306A\u65B0\u3057\u3044 RFQ \u304C\u5C4A\u3044\u3066\u3044\u307E\u3059\u3002\u898B\u7A4D\u3082\u308A\u3092\u63D0\u51FA\u3057\u3066\u53D7\u6CE8\u6A5F\u4F1A\u3092\u7372\u5F97\u3057\u307E\u3057\u3087\u3046\u3002', process: '\u5DE5\u7A0B', note: '\u30E1\u30E2', quantity: '\u6570\u91CF', cta: '\u898B\u7A4D\u3082\u308A\u3092\u63D0\u51FA', footer: '\u30D1\u30FC\u30C8\u30CA\u30FC\u30C0\u30C3\u30B7\u30E5\u30DC\u30FC\u30C9\u3067 RFQ \u3092\u3054\u78BA\u8A8D\u304F\u3060\u3055\u3044\u3002' },
      cn: { title: '\u65B0\u62A5\u4EF7\u8BF7\u6C42', intro: '\u6709\u4E00\u4E2A\u7B26\u5408\u60A8\u80FD\u529B\u7684\u65B0 RFQ\u3002\u8BF7\u63D0\u4EA4\u62A5\u4EF7\u4EE5\u83B7\u5F97\u9879\u76EE\u3002', process: '\u5DE5\u827A', note: '\u5907\u6CE8', quantity: '\u6570\u91CF', cta: '\u63D0\u4EA4\u62A5\u4EF7', footer: '\u8BF7\u5728\u5408\u4F5C\u4F19\u4F34\u4EEA\u8868\u677F\u4E2D\u67E5\u770B RFQ\u3002' },
      es: { title: 'Nueva solicitud de cotizaci\u00f3n', intro: 'Hay una nueva RFQ que coincide con tus capacidades. Env\u00eda una oferta para optar al proyecto.', process: 'Proceso', note: 'Nota', quantity: 'Cantidad', cta: 'Enviar cotizaci\u00f3n', footer: 'Revisa esta RFQ en tu panel de socio.' },
      ar: { title: '\u0637\u0644\u0628 \u062a\u0633\u0639\u064a\u0631 \u062c\u062f\u064a\u062f', intro: '\u0647\u0646\u0627\u0643 RFQ \u062c\u062f\u064a\u062f \u064a\u0646\u0627\u0633\u0628 \u0642\u062f\u0631\u0627\u062a\u0643. \u0642\u062f\u0645 \u0639\u0631\u0636\u0627\u064b \u0644\u0644\u0641\u0648\u0632 \u0628\u0627\u0644\u0645\u0634\u0631\u0648\u0639.', process: '\u0627\u0644\u0639\u0645\u0644\u064a\u0629', note: '\u0645\u0644\u0627\u062d\u0638\u0629', quantity: '\u0627\u0644\u0643\u0645\u064a\u0629', cta: '\u062a\u0642\u062f\u064a\u0645 \u0627\u0644\u0639\u0631\u0636', footer: '\u0631\u0627\u062c\u0639 RFQ \u0641\u064a \u0644\u0648\u062d\u0629 \u0627\u0644\u0634\u0631\u064a\u0643.' },
    };
    const c = copy[locale];
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://nexyfab.com';
    const dashUrl = opts.partnerDashUrl || `${baseUrl}/partner/quotes`;
    const rfqShort = opts.rfqId.slice(0, 8).toUpperCase();
    const content = `<h2>${c.title}</h2><p>${c.intro}</p><table><tr><td>RFQ ID</td><td>${rfqShort}</td></tr><tr><td>Part</td><td>${escapeHtml(opts.shapeName || rfqShort)}</td></tr><tr><td>Material</td><td>${escapeHtml(opts.materialId)}</td></tr><tr><td>${c.quantity}</td><td>${formatNumber(opts.quantity, locale) ?? opts.quantity}</td></tr>${opts.dfmProcess ? `<tr><td>${c.process}</td><td>${escapeHtml(opts.dfmProcess)}</td></tr>` : ''}${opts.note ? `<tr><td>${c.note}</td><td>${escapeHtml(opts.note.slice(0, 200))}</td></tr>` : ''}</table><a href="${dashUrl}">${c.cta}</a><p>${c.footer}</p>`;
    return emailWrapper(content, undefined, locale);
  }
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://nexyfab.com';
  const dashUrl = opts.partnerDashUrl || `${baseUrl}/partner/quotes`;
  const rfqShort = opts.rfqId.slice(0, 8).toUpperCase();
  const partName = escapeHtml(opts.shapeName || rfqShort);
  const material = escapeHtml(opts.materialId);
  const processLine = opts.dfmProcess ? `<tr><td style="padding:6px 0;color:#8b949e;font-size:13px;">공정</td><td style="padding:6px 0;font-size:13px;text-align:right;color:#e6edf3;">${escapeHtml(opts.dfmProcess)}</td></tr>` : '';
  const noteLine = opts.note ? `<tr><td style="padding:6px 0;color:#8b949e;font-size:13px;">비고</td><td style="padding:6px 0;font-size:13px;text-align:right;color:#8b949e;">${escapeHtml(opts.note.slice(0, 200))}</td></tr>` : '';

  const content = `
    <h2 style="font-size:18px;font-weight:700;margin:0 0 8px;color:#e6edf3;">새 견적 요청이 도착했습니다 📋</h2>
    <p style="color:#8b949e;font-size:13px;margin:0 0 20px;line-height:1.6;">
      귀사가 처리 가능한 공정의 새 RFQ가 등록되었습니다. 빠른 견적 제출로 수주 기회를 잡으세요.
    </p>
    <div style="background:#161b22;border-radius:8px;padding:20px;margin:0 0 24px;border:1px solid #30363d;">
      <table style="width:100%;border-collapse:collapse;">
        <tr style="border-bottom:1px solid #21262d;">
          <td style="padding:6px 0;color:#8b949e;font-size:13px;">RFQ 번호</td>
          <td style="padding:6px 0;font-size:13px;text-align:right;color:#e6edf3;font-family:monospace;">${rfqShort}</td>
        </tr>
        <tr style="border-bottom:1px solid #21262d;">
          <td style="padding:6px 0;color:#8b949e;font-size:13px;">부품명</td>
          <td style="padding:6px 0;font-size:13px;text-align:right;color:#e6edf3;">${partName}</td>
        </tr>
        <tr style="border-bottom:1px solid #21262d;">
          <td style="padding:6px 0;color:#8b949e;font-size:13px;">소재</td>
          <td style="padding:6px 0;font-size:13px;text-align:right;color:#e6edf3;">${material}</td>
        </tr>
        <tr style="border-bottom:1px solid #21262d;">
          <td style="padding:6px 0;color:#8b949e;font-size:13px;">수량</td>
          <td style="padding:6px 0;font-size:13px;text-align:right;color:#e6edf3;">${formatNumber(opts.quantity, 'ko') ?? opts.quantity}개</td>
        </tr>
        ${processLine}
        ${noteLine}
      </table>
    </div>
    <a href="${dashUrl}"
       style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#388bfd,#8b5cf6);color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;">
      견적 제출하기
    </a>
    <p style="color:#484f58;font-size:11px;margin:20px 0 0;line-height:1.6;">
      파트너 대시보드에서 이 RFQ를 확인하고 견적을 제출해 주세요. 빠른 응답이 수주 확률을 높입니다.
    </p>
  `;
  return emailWrapper(content, undefined, locale);
}

export function contractSignedEmailSubject(locale: NexyfabEmailContentLocale, projectName: string): string {
  const subject = {
    ko: '\uACC4\uC57D\uC774 \uCCB4\uACB0\uB410\uC2B5\uB2C8\uB2E4',
    en: 'Contract signed',
    ja: '\u5951\u7D04\u304C\u7DE0\u7D50\u3055\u308C\u307E\u3057\u305F',
    cn: '\u5408\u540C\u5DF2\u7B7E\u7F72',
    es: 'Contrato firmado',
    ar: '\u062A\u0645 \u062A\u0648\u0642\u064A\u0639 \u0627\u0644\u0639\u0642\u062F',
  } satisfies Record<NexyfabEmailContentLocale, string>;
  return `[NexyFab] ${subject[locale]} \u2014 ${projectName}`;
}

export function contractSignedInAppCopy(locale: NexyfabEmailContentLocale, projectName: string, factoryName: string): { title: string; body: string } {
  const copy = {
    ko: { title: '\uACC4\uC57D \uCCB4\uACB0', body: `${factoryName}\uC640\uC758 \uACC4\uC57D\uC774 \uC131\uACF5\uC801\uC73C\uB85C \uCCB4\uACB0\uB410\uC2B5\uB2C8\uB2E4.` },
    en: { title: 'Contract signed', body: `Your contract with ${factoryName} has been confirmed.` },
    ja: { title: '\u5951\u7D04\u7DE0\u7D50', body: `${factoryName}\u3068\u306E\u5951\u7D04\u304C\u78BA\u5B9A\u3057\u307E\u3057\u305F\u3002` },
    cn: { title: '\u5408\u540C\u5DF2\u7B7E\u7F72', body: `\u60A8\u4E0E${factoryName}\u7684\u5408\u540C\u5DF2\u786E\u8BA4\u3002` },
    es: { title: 'Contrato firmado', body: `Tu contrato con ${factoryName} ha sido confirmado.` },
    ar: { title: '\u062A\u0645 \u062A\u0648\u0642\u064A\u0639 \u0627\u0644\u0639\u0642\u062F', body: `\u062A\u0645 \u062A\u0623\u0643\u064A\u062F \u0639\u0642\u062F\u0643 \u0645\u0639 ${factoryName}.` },
  } satisfies Record<NexyfabEmailContentLocale, { title: string; body: string }>;
  return { title: `${copy[locale].title}: ${projectName}`, body: copy[locale].body };
}

export function contractAdminSummaryEmail(locale: NexyfabEmailContentLocale, opts: { contractId: string; projectName: string; factoryName?: string; contractAmount: number; feeRate: number; finalCharge: number; isFirstContract: boolean }): { subject: string; html: string } {
  const copy = {
    ko: { subject: '새 계약 생성', title: '새 계약이 생성되었습니다', id: '계약 ID', project: '프로젝트명', partner: '파트너사', amount: '계약금액', fee: '수수료율', first: '최초 계약', yes: '예', no: '아니오', note: 'NexyFab 어드민 자동 알림' },
    en: { subject: 'New contract created', title: 'A new contract was created', id: 'Contract ID', project: 'Project', partner: 'Partner', amount: 'Contract amount', fee: 'Fee rate', first: 'First contract', yes: 'Yes', no: 'No', note: 'NexyFab admin notification' },
    ja: { subject: '\u65B0\u3057\u3044\u5951\u7D04\u304C\u4F5C\u6210\u3055\u308C\u307E\u3057\u305F', title: '\u65B0\u3057\u3044\u5951\u7D04\u304C\u4F5C\u6210\u3055\u308C\u307E\u3057\u305F', id: '\u5951\u7D04 ID', project: '\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8', partner: '\u30D1\u30FC\u30C8\u30CA\u30FC', amount: '\u5951\u7D04\u91D1\u984D', fee: '\u624B\u6570\u6599\u7387', first: '\u521D\u56DE\u5951\u7D04', yes: '\u306F\u3044', no: '\u3044\u3044\u3048', note: 'NexyFab \u7BA1\u7406\u901A\u77E5' },
    cn: { subject: '\u65B0\u5408\u540C\u5DF2\u521B\u5EFA', title: '\u65B0\u5408\u540C\u5DF2\u521B\u5EFA', id: '合\u540C ID', project: '\u9879\u76EE', partner: '\u5408\u4F5C\u4F19\u4F34', amount: '\u5408\u540C\u91D1\u989D', fee: '\u8D39\u7387', first: '\u9996\u6B21\u5408\u540C', yes: '\u662F', no: '\u5426', note: 'NexyFab \u7BA1\u7406\u901A\u77E5' },
    es: { subject: 'Nuevo contrato creado', title: 'Se ha creado un nuevo contrato', id: 'ID del contrato', project: 'Proyecto', partner: 'Socio', amount: 'Importe del contrato', fee: 'Tasa de comisión', first: 'Primer contrato', yes: 'Sí', no: 'No', note: 'Notificación de administración de NexyFab' },
    ar: { subject: '\u062a\u0645 \u0625\u0646\u0634\u0627\u0621 \u0639\u0642\u062f \u062c\u062f\u064a\u062f', title: '\u062a\u0645 \u0625\u0646\u0634\u0627\u0621 \u0639\u0642\u062f \u062c\u062f\u064a\u062f', id: '\u0645\u0639\u0631\u0641 \u0627\u0644\u0639\u0642\u062f', project: '\u0627\u0644\u0645\u0634\u0631\u0648\u0639', partner: '\u0627\u0644\u0634\u0631\u064a\u0643', amount: '\u0642\u064a\u0645\u0629 \u0627\u0644\u0639\u0642\u062f', fee: '\u0645\u0639\u062f\u0644 \u0627\u0644\u0631\u0633\u0648\u0645', first: '\u0627\u0644\u0639\u0642\u062f \u0627\u0644\u0623\u0648\u0644', yes: '\u0646\u0639\u0645', no: '\u0644\u0627', note: '\u0625\u0634\u0639\u0627\u0631 \u0625\u062f\u0627\u0631\u0629 NexyFab' },
  } satisfies Record<NexyfabEmailContentLocale, Record<string, string>>;
  const c = copy[locale];
  const amount = formatMoney(opts.contractAmount, locale, 'KRW', { currencyDisplay: 'code' }) ?? `${opts.contractAmount} KRW`;
  const feeAmount = formatMoney(opts.finalCharge, locale, 'KRW', { currencyDisplay: 'code' }) ?? `${opts.finalCharge} KRW`;
  const fee = `${opts.feeRate}% (${feeAmount})`;
  const unassigned = { ko: '미배정', en: 'Unassigned', ja: '未割り当て', cn: '未分配', es: 'Sin asignar', ar: 'غير مخصص' }[locale];
  const html = `<h2 style="color:#1a56db">${c.title}</h2><table><tr><td>${c.id}</td><td>${escapeHtml(opts.contractId)}</td></tr><tr><td>${c.project}</td><td>${escapeHtml(opts.projectName)}</td></tr><tr><td>${c.partner}</td><td>${escapeHtml(opts.factoryName || unassigned)}</td></tr><tr><td>${c.amount}</td><td>${amount}</td></tr><tr><td>${c.fee}</td><td>${fee}</td></tr><tr><td>${c.first}</td><td>${opts.isFirstContract ? c.yes : c.no}</td></tr></table><p>${c.note}</p>`;
  return { subject: `[NexyFab] ${c.subject} - ${opts.projectName}`, html };
}
