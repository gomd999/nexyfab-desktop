import nodemailer from 'nodemailer';
import { escapeHtml } from './sanitize';
import { getDbAdapter } from './db-adapter';

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
  if (primary === 'zh' || head.startsWith('zh-')) return 'cn';
  if (primary === 'es') return 'es';
  if (primary === 'ar') return 'ar';
  return 'en';
}

/** HTML copy family when a locale reuses another template (`es` / `ar` → English body). */
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

function emailWrapper(content: string, unsubscribeUrl?: string): string {
  const baseUrl = process.env.NEXTAUTH_URL || 'https://nexyfab.com';
  const unsub = unsubscribeUrl || `${baseUrl}/unsubscribe`;
  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:16px;background:#161b22;">
  <div style="background:#0d1117;color:#e6edf3;font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:32px;border-radius:12px;border:1px solid #30363d;">
    <h1 style="margin:0 0 24px;font-size:22px;font-weight:700;color:#388bfd;letter-spacing:-0.5px;">NexyFab</h1>
    ${content}
    <hr style="border:none;border-top:1px solid #21262d;margin:32px 0 16px;">
    <p style="color:#6e7681;font-size:11px;margin:0;line-height:1.6;">
      NexyFab &middot; <a href="${baseUrl}" style="color:#6e7681;">nexyfab.com</a>
      &middot; <a href="${unsub}" style="color:#6e7681;">수신 거부 / Unsubscribe</a>
    </p>
  </div>
</body>
</html>`;
}

// ─── RFQ helpers ──────────────────────────────────────────────────────────────

function rfqDetailTable(rfq: RFQEmailData): string {
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
        <td style="padding:6px 0;font-size:13px;text-align:right;color:#e6edf3;">${rfq.quantity.toLocaleString()} 개</td>
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
    ${rfqDetailTable(rfq)}
    <a href="${rfqUrl}"
       style="display:inline-block;margin-top:8px;padding:12px 24px;background:#388bfd;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
      ${cta}
    </a>
  `;

  return emailWrapper(content);
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
  const fam = nexyfabEmailCopyFamily(locale);
  const extra = opts?.afterIntroHtml ?? '';

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
    ${rfqDetailTable(rfq)}
    ${rfq.userEmail ? `<p style="color:#8b949e;font-size:13px;margin:4px 0;">${reqLabel}: <span style="color:#e6edf3;">${escapeHtml(rfq.userEmail)}</span></p>` : ''}
    <a href="${rfqUrl}"
       style="display:inline-block;margin-top:16px;padding:12px 24px;background:#388bfd;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
      ${cta}
    </a>
  `;

  return emailWrapper(content);
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

  return emailWrapper(content);
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

  return emailWrapper(content);
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
      d3 = '30만+ 공장 DB 기반으로 프로젝트에 맞는 최적의 제조 파트너를 AI가 추천합니다.'; a3 = '매칭 요청하기 →';
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
      d3 = '30万件超の工場データから、プロジェクトに最適なパートナーをAIが推薦します。'; a3 = 'マッチングを依頼 →';
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
      d3 = 'AI recommends the best manufacturing partners from our 300,000+ factory database.'; a3 = 'Request matching →';
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

  return emailWrapper(content, unsubscribeUrl);
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
      b3 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">RFQ 자동 발송</strong> — 30만+ 제조사 직접 연결</li>';
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
      b3 = '<li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">RFQ 自動送信</strong> — 30万件超の工場へ直接</li>';
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

  return emailWrapper(content, unsubscribeUrl);
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
  adminDashboardUrl?: string;
}): string {
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
        <tr><td style="color:#8b949e;padding:6px 0;">수량</td><td style="color:#e6edf3;">${opts.quantity.toLocaleString()}개</td></tr>
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
  return emailWrapper(content);
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
  switch (nexyfabEmailCopyFamily(locale)) {
    case 'ko': return `견적 도착: ${projectName}`;
    case 'ja': return `見積もり到着: ${projectName}`;
    case 'cn': return `报价已送达: ${projectName}`;
    default: return `Quote received: ${projectName}`;
  }
}

/** In-app notification body line (copy family). */
export function quoteReceivedInAppBody(locale: NexyfabEmailContentLocale, factoryLabel: string): string {
  const fam = nexyfabEmailCopyFamily(locale);
  const fn = factoryLabel || (fam === 'ko' ? '제조사' : 'Manufacturer');
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
  const numLocale = fam === 'ko' ? 'ko-KR' : fam === 'ja' ? 'ja-JP' : fam === 'cn' ? 'zh-CN' : 'en-US';
  const amount = opts.estimatedAmount.toLocaleString(numLocale);
  const safeName = escapeHtml(opts.userName || '');

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
  return emailWrapper(content);
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
  const lang = opts.lang?.startsWith('ko') ? 'ko' : 'en';
  const dashUrl = opts.dashboardUrl || (
    opts.recipientType === 'factory'
      ? `${base}/partner/projects`
      : `${base}/${lang === 'ko' ? 'kr' : 'en'}/nexyfab/orders`
  );
  const currency = opts.currency || 'KRW';
  const amount = opts.contractAmount.toLocaleString('ko-KR');
  const safeName = escapeHtml(opts.recipientName || '');

  const content = lang === 'ko' ? `
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
        <tr><td style="color:#8b949e;padding:6px 0;">계약 금액</td><td style="color:#3fb950;font-weight:800;font-size:16px;">${amount} ${currency}</td></tr>
        ${opts.deadline ? `<tr><td style="color:#8b949e;padding:6px 0;">납기일</td><td style="color:#e6edf3;">${escapeHtml(opts.deadline)}</td></tr>` : ''}
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
        ${opts.deadline ? `<tr><td style="color:#8b949e;padding:6px 0;">Deadline</td><td style="color:#e6edf3;">${escapeHtml(opts.deadline)}</td></tr>` : ''}
      </table>
    </div>
    <a href="${dashUrl}"
       style="display:inline-block;padding:12px 28px;background:#3fb950;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;">
      ${opts.recipientType === 'customer' ? 'View Order Status' : 'Manage Project'}
    </a>
  `;
  return emailWrapper(content);
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
}): string {
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
          <td style="padding:6px 0;font-size:13px;text-align:right;color:#e6edf3;">${opts.quantity.toLocaleString()}개</td>
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
  return emailWrapper(content);
}
