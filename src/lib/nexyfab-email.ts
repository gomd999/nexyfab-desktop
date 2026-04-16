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

// ─── Transport factory ────────────────────────────────────────────────────────

function getTransporter() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT) || 587,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

// ─── Core send function (fire-and-forget) ────────────────────────────────────

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<boolean> {
  const transporter = getTransporter();

  if (!transporter) {
    console.log('[NexyFab Email — Demo Mode]');
    console.log(`  To     : ${to}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Body   : (HTML omitted in demo mode)`);
    return true;
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || '"NexyFab" <no-reply@nexyfab.com>',
      to,
      subject,
      html,
    });
    return true;
  } catch (err) {
    console.error('[NexyFab Email] Failed to send email:', err);
    return false;
  }
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

export function rfqConfirmationHtml(rfq: RFQEmailData, lang: 'ko' | 'en' = 'ko'): string {
  const baseUrl = process.env.NEXTAUTH_URL || 'https://nexyfab.com';
  const rfqUrl = `${baseUrl}/${lang}/nexyfab/rfq/${rfq.rfqId}`;

  const safeUserName = rfq.userName ? escapeHtml(rfq.userName) : '';
  const content = lang === 'ko' ? `
    <h2 style="font-size:18px;font-weight:600;margin:0 0 8px;color:#e6edf3;">견적 요청이 접수되었습니다</h2>
    <p style="color:#8b949e;font-size:14px;margin:0 0 20px;line-height:1.6;">
      안녕하세요${safeUserName ? ` ${safeUserName}님` : ''}! 견적 요청이 성공적으로 접수되었습니다.<br>
      <strong style="color:#e6edf3;">24–48시간</strong> 이내에 담당자가 연락드리겠습니다.
    </p>
    ${rfqDetailTable(rfq)}
    <a href="${rfqUrl}"
       style="display:inline-block;margin-top:8px;padding:12px 24px;background:#388bfd;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
      견적 요청 확인하기
    </a>
  ` : `
    <h2 style="font-size:18px;font-weight:600;margin:0 0 8px;color:#e6edf3;">Your RFQ has been received</h2>
    <p style="color:#8b949e;font-size:14px;margin:0 0 20px;line-height:1.6;">
      Hello${safeUserName ? ` ${safeUserName}` : ''}! Your quote request was successfully submitted.<br>
      Our team will get back to you within <strong style="color:#e6edf3;">24–48 hours</strong>.
    </p>
    ${rfqDetailTable(rfq)}
    <a href="${rfqUrl}"
       style="display:inline-block;margin-top:8px;padding:12px 24px;background:#388bfd;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
      View My RFQ
    </a>
  `;

  return emailWrapper(content);
}

// ─── Template: RFQ 알림 (관리자/제조사용) ────────────────────────────────────

export function rfqNotificationHtml(rfq: RFQEmailData): string {
  const baseUrl = process.env.NEXTAUTH_URL || 'https://nexyfab.com';
  const rfqUrl = `${baseUrl}/ko/nexyfab/rfq/${rfq.rfqId}`;

  const content = `
    <h2 style="font-size:18px;font-weight:600;margin:0 0 8px;color:#f0883e;">새 견적 요청 도착</h2>
    <p style="color:#8b949e;font-size:14px;margin:0 0 20px;line-height:1.6;">
      새로운 RFQ가 접수되었습니다. 아래 상세 내용을 확인하고 견적을 보내주세요.
    </p>
    ${rfqDetailTable(rfq)}
    ${rfq.userEmail ? `<p style="color:#8b949e;font-size:13px;margin:4px 0;">요청자 이메일: <span style="color:#e6edf3;">${escapeHtml(rfq.userEmail)}</span></p>` : ''}
    <a href="${rfqUrl}"
       style="display:inline-block;margin-top:16px;padding:12px 24px;background:#388bfd;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
      견적 보내기
    </a>
  `;

  return emailWrapper(content);
}

// ─── Template: 환영 이메일 ────────────────────────────────────────────────────

export function welcomeHtml(name: string, lang: 'ko' | 'en' = 'ko'): string {
  const baseUrl = process.env.NEXTAUTH_URL || 'https://nexyfab.com';
  const ctaUrl = `${baseUrl}/${lang}/nexyfab/shape-generator`;
  const safeName = escapeHtml(name);

  const content = lang === 'ko' ? `
    <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;color:#e6edf3;">NexyFab에 오신 것을 환영합니다! 🎉</h2>
    <p style="color:#8b949e;font-size:14px;margin:0 0 20px;line-height:1.6;">
      안녕하세요 <strong style="color:#e6edf3;">${safeName}</strong>님! NexyFab에 가입해 주셔서 감사합니다.<br>
      AI 기반 제조 플랫폼으로 더 스마트한 제조를 경험해 보세요.
    </p>
    <div style="background:#161b22;border-radius:8px;padding:20px;margin:0 0 24px;">
      <p style="color:#e6edf3;font-size:14px;font-weight:600;margin:0 0 12px;">주요 기능</p>
      <ul style="color:#8b949e;font-size:13px;margin:0;padding-left:20px;line-height:2;">
        <li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">3D 설계 업로드</strong> — STL/STEP 파일 분석</li>
        <li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">DFM 분석</strong> — AI 기반 제조 가능성 검토</li>
        <li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">자동 견적</strong> — 공정별 비용 및 납기 추정</li>
        <li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">제조사 연결</strong> — 글로벌 제조 파트너 매칭</li>
      </ul>
    </div>
    <a href="${ctaUrl}"
       style="display:inline-block;padding:12px 28px;background:#388bfd;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
      지금 시작하기
    </a>
  ` : `
    <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;color:#e6edf3;">Welcome to NexyFab! 🎉</h2>
    <p style="color:#8b949e;font-size:14px;margin:0 0 20px;line-height:1.6;">
      Hi <strong style="color:#e6edf3;">${safeName}</strong>! Thanks for joining NexyFab.<br>
      Experience smarter manufacturing with our AI-powered platform.
    </p>
    <div style="background:#161b22;border-radius:8px;padding:20px;margin:0 0 24px;">
      <p style="color:#e6edf3;font-size:14px;font-weight:600;margin:0 0 12px;">Key Features</p>
      <ul style="color:#8b949e;font-size:13px;margin:0;padding-left:20px;line-height:2;">
        <li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">3D Design Upload</strong> — STL/STEP file analysis</li>
        <li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">DFM Analysis</strong> — AI-powered manufacturability review</li>
        <li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">Auto Quoting</strong> — Cost and lead-time estimation per process</li>
        <li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">Manufacturer Matching</strong> — Global manufacturing partner network</li>
      </ul>
    </div>
    <a href="${ctaUrl}"
       style="display:inline-block;padding:12px 28px;background:#388bfd;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
      Get Started
    </a>
  `;

  return emailWrapper(content);
}

// ─── Template: 인증 코드 ──────────────────────────────────────────────────────

export function verificationHtml(code: string, lang: 'ko' | 'en' = 'ko'): string {
  const content = lang === 'ko' ? `
    <h2 style="font-size:18px;font-weight:600;margin:0 0 8px;color:#e6edf3;">이메일 인증 코드</h2>
    <p style="color:#8b949e;font-size:14px;margin:0 0 20px;line-height:1.6;">
      아래 인증 코드를 입력해 이메일 주소를 확인해 주세요. 코드는 10분 후 만료됩니다.
    </p>
    <div style="background:#161b22;border-radius:8px;padding:24px;text-align:center;margin:0 0 20px;border:1px solid #388bfd;">
      <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#388bfd;font-family:monospace;">${code}</span>
    </div>
    <p style="color:#6e7681;font-size:12px;margin:0;">본인이 요청하지 않은 경우 이 이메일을 무시하세요.</p>
  ` : `
    <h2 style="font-size:18px;font-weight:600;margin:0 0 8px;color:#e6edf3;">Email Verification Code</h2>
    <p style="color:#8b949e;font-size:14px;margin:0 0 20px;line-height:1.6;">
      Enter the code below to verify your email address. The code expires in 10 minutes.
    </p>
    <div style="background:#161b22;border-radius:8px;padding:24px;text-align:center;margin:0 0 20px;border:1px solid #388bfd;">
      <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#388bfd;font-family:monospace;">${code}</span>
    </div>
    <p style="color:#6e7681;font-size:12px;margin:0;">If you did not request this, please ignore this email.</p>
  `;

  return emailWrapper(content);
}

// ─── Template: 드립 D+1 — 핵심 기능 소개 ──────────────────────────────────────

export function dripD1Html(name: string, lang: 'ko' | 'en' = 'ko', unsubscribeUrl?: string): string {
  const baseUrl = process.env.NEXTAUTH_URL || 'https://nexyfab.com';
  const safeName = escapeHtml(name || '');
  const langPath = lang === 'ko' ? 'kr' : 'en';

  const content = lang === 'ko' ? `
    <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;color:#e6edf3;">오늘 꼭 써보세요 — 3가지 핵심 기능</h2>
    <p style="color:#8b949e;font-size:14px;margin:0 0 20px;line-height:1.6;">
      안녕하세요 <strong style="color:#e6edf3;">${safeName}</strong>님! 가입 이후 처음 사용해 보셨나요?<br>
      NexyFab의 핵심 기능 3가지를 소개드릴게요. 각각 5분 안에 결과를 확인할 수 있습니다.
    </p>
    <div style="background:#161b22;border-radius:8px;padding:20px;margin:0 0 16px;border-left:3px solid #388bfd;">
      <p style="color:#388bfd;font-size:12px;font-weight:700;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px;">기능 1</p>
      <p style="color:#e6edf3;font-size:15px;font-weight:600;margin:0 0 4px;">3D Shape Generator</p>
      <p style="color:#8b949e;font-size:13px;margin:0 0 12px;line-height:1.6;">파라메트릭 3D 형상 16종을 브라우저에서 바로 설계하세요. STEP/IGES 파일 임포트도 지원합니다.</p>
      <a href="${baseUrl}/${langPath}/shape-generator" style="font-size:13px;color:#388bfd;text-decoration:none;">3D 설계 시작하기 →</a>
    </div>
    <div style="background:#161b22;border-radius:8px;padding:20px;margin:0 0 16px;border-left:3px solid #3fb950;">
      <p style="color:#3fb950;font-size:12px;font-weight:700;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px;">기능 2</p>
      <p style="color:#e6edf3;font-size:15px;font-weight:600;margin:0 0 4px;">AI 빠른 견적</p>
      <p style="color:#8b949e;font-size:13px;margin:0 0 12px;line-height:1.6;">STEP 파일을 업로드하면 AI가 재질별·공정별 제조 원가를 즉시 분석합니다.</p>
      <a href="${baseUrl}/${langPath}/quick-quote" style="font-size:13px;color:#3fb950;text-decoration:none;">견적 받기 →</a>
    </div>
    <div style="background:#161b22;border-radius:8px;padding:20px;margin:0 0 24px;border-left:3px solid #f0883e;">
      <p style="color:#f0883e;font-size:12px;font-weight:700;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px;">기능 3</p>
      <p style="color:#e6edf3;font-size:15px;font-weight:600;margin:0 0 4px;">제조사 매칭</p>
      <p style="color:#8b949e;font-size:13px;margin:0 0 12px;line-height:1.6;">30만+ 공장 DB 기반으로 프로젝트에 맞는 최적의 제조 파트너를 AI가 추천합니다.</p>
      <a href="${baseUrl}/${langPath}/project-inquiry" style="font-size:13px;color:#f0883e;text-decoration:none;">매칭 요청하기 →</a>
    </div>
    <a href="${baseUrl}/${langPath}/nexyfab"
       style="display:inline-block;padding:12px 28px;background:#388bfd;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
      NexyFab 워크벤치 열기
    </a>
  ` : `
    <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;color:#e6edf3;">Try These 3 Features Today</h2>
    <p style="color:#8b949e;font-size:14px;margin:0 0 20px;line-height:1.6;">
      Hi <strong style="color:#e6edf3;">${safeName}</strong>! Have you tried NexyFab yet?<br>
      Here are 3 key features — each delivers results in under 5 minutes.
    </p>
    <div style="background:#161b22;border-radius:8px;padding:20px;margin:0 0 16px;border-left:3px solid #388bfd;">
      <p style="color:#388bfd;font-size:12px;font-weight:700;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px;">Feature 1</p>
      <p style="color:#e6edf3;font-size:15px;font-weight:600;margin:0 0 4px;">3D Shape Generator</p>
      <p style="color:#8b949e;font-size:13px;margin:0 0 12px;line-height:1.6;">Design 16 parametric 3D shapes right in your browser. STEP/IGES import also supported.</p>
      <a href="${baseUrl}/${langPath}/shape-generator" style="font-size:13px;color:#388bfd;text-decoration:none;">Start designing →</a>
    </div>
    <div style="background:#161b22;border-radius:8px;padding:20px;margin:0 0 16px;border-left:3px solid #3fb950;">
      <p style="color:#3fb950;font-size:12px;font-weight:700;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px;">Feature 2</p>
      <p style="color:#e6edf3;font-size:15px;font-weight:600;margin:0 0 4px;">AI Quick Quote</p>
      <p style="color:#8b949e;font-size:13px;margin:0 0 12px;line-height:1.6;">Upload a STEP file and get instant AI-powered manufacturing cost analysis by material and process.</p>
      <a href="${baseUrl}/${langPath}/quick-quote" style="font-size:13px;color:#3fb950;text-decoration:none;">Get a quote →</a>
    </div>
    <div style="background:#161b22;border-radius:8px;padding:20px;margin:0 0 24px;border-left:3px solid #f0883e;">
      <p style="color:#f0883e;font-size:12px;font-weight:700;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px;">Feature 3</p>
      <p style="color:#e6edf3;font-size:15px;font-weight:600;margin:0 0 4px;">Manufacturer Matching</p>
      <p style="color:#8b949e;font-size:13px;margin:0 0 12px;line-height:1.6;">AI recommends the best manufacturing partners from our 300,000+ factory database.</p>
      <a href="${baseUrl}/${langPath}/project-inquiry" style="font-size:13px;color:#f0883e;text-decoration:none;">Request matching →</a>
    </div>
    <a href="${baseUrl}/${langPath}/nexyfab"
       style="display:inline-block;padding:12px 28px;background:#388bfd;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
      Open NexyFab Workbench
    </a>
  `;

  return emailWrapper(content);
}

// ─── Template: 드립 D+7 — Pro 업그레이드 제안 ──────────────────────────────────

export function dripD7Html(name: string, lang: 'ko' | 'en' = 'ko', unsubscribeUrl?: string): string {
  const baseUrl = process.env.NEXTAUTH_URL || 'https://nexyfab.com';
  const safeName = escapeHtml(name || '');
  const langPath = lang === 'ko' ? 'kr' : 'en';
  const pricingUrl = `${baseUrl}/${langPath}/nexyfab/pricing`;

  const content = lang === 'ko' ? `
    <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;color:#e6edf3;">NexyFab Pro로 더 많이 만드세요</h2>
    <p style="color:#8b949e;font-size:14px;margin:0 0 20px;line-height:1.6;">
      안녕하세요 <strong style="color:#e6edf3;">${safeName}</strong>님! NexyFab을 사용한 지 일주일이 지났네요.<br>
      무료 플랜에서 경험하셨나요? Pro로 업그레이드하면 제한 없이 제조 프로젝트를 관리할 수 있습니다.
    </p>
    <div style="background:#161b22;border-radius:8px;padding:20px;margin:0 0 24px;">
      <p style="color:#f0883e;font-size:13px;font-weight:700;margin:0 0 12px;">Pro 플랜 혜택</p>
      <ul style="color:#8b949e;font-size:13px;margin:0;padding-left:20px;line-height:2.2;">
        <li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">무제한 3D 프로젝트</strong> 저장 및 공유</li>
        <li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">AI 어드밴스드 DFM 분석</strong> — FEA 구조해석 포함</li>
        <li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">RFQ 자동 발송</strong> — 30만+ 제조사 직접 연결</li>
        <li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">팀 협업</strong> — 멤버 초대 및 공동 설계</li>
        <li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">우선 고객 지원</strong></li>
      </ul>
    </div>
    <div>
      <a href="${pricingUrl}"
         style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#388bfd,#8b9cf4);color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;margin-right:12px;">
        Pro 시작하기
      </a>
      <a href="${baseUrl}/${langPath}/nexyfab"
         style="display:inline-block;padding:12px 28px;background:#21262d;color:#e6edf3;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;border:1px solid #30363d;">
        무료로 계속 사용
      </a>
    </div>
  ` : `
    <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;color:#e6edf3;">Build More with NexyFab Pro</h2>
    <p style="color:#8b949e;font-size:14px;margin:0 0 20px;line-height:1.6;">
      Hi <strong style="color:#e6edf3;">${safeName}</strong>! You've been with NexyFab for a week now.<br>
      Upgrade to Pro and unlock unlimited manufacturing project management.
    </p>
    <div style="background:#161b22;border-radius:8px;padding:20px;margin:0 0 24px;">
      <p style="color:#f0883e;font-size:13px;font-weight:700;margin:0 0 12px;">Pro Plan Benefits</p>
      <ul style="color:#8b949e;font-size:13px;margin:0;padding-left:20px;line-height:2.2;">
        <li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">Unlimited 3D projects</strong> — save and share</li>
        <li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">Advanced AI DFM</strong> — includes FEA structural analysis</li>
        <li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">Auto RFQ sending</strong> — direct connection to 300K+ factories</li>
        <li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">Team collaboration</strong> — invite members, co-design</li>
        <li><span style="color:#3fb950;">✓</span> <strong style="color:#e6edf3;">Priority support</strong></li>
      </ul>
    </div>
    <div>
      <a href="${pricingUrl}"
         style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#388bfd,#8b9cf4);color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;margin-right:12px;">
        Start Pro
      </a>
      <a href="${baseUrl}/${langPath}/nexyfab"
         style="display:inline-block;padding:12px 28px;background:#21262d;color:#e6edf3;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;border:1px solid #30363d;">
        Continue Free
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
  const lang = opts.lang?.startsWith('ko') ? 'ko' : 'en';
  const rfqUrl = opts.rfqPageUrl || `${base}/${lang === 'ko' ? 'kr' : 'en'}/nexyfab/rfq`;
  const currency = opts.currency || 'KRW';
  const amount = opts.estimatedAmount.toLocaleString('ko-KR');
  const safeName = escapeHtml(opts.userName || '');

  const content = lang === 'ko' ? `
    <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;color:#e6edf3;">견적이 도착했습니다! 💬</h2>
    <p style="color:#8b949e;font-size:14px;margin:0 0 20px;line-height:1.6;">
      안녕하세요 <strong style="color:#e6edf3;">${safeName}</strong>님,<br>
      <strong style="color:#3fb950;">${escapeHtml(opts.factoryName)}</strong>에서 견적을 제출했습니다.
    </p>
    <div style="background:#161b22;border-radius:8px;padding:20px;margin:0 0 24px;border:1px solid #30363d;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr><td style="color:#8b949e;padding:6px 0;width:120px;">부품명</td><td style="color:#e6edf3;font-weight:600;">${escapeHtml(opts.shapeName)}</td></tr>
        <tr><td style="color:#8b949e;padding:6px 0;">제조사</td><td style="color:#e6edf3;">${escapeHtml(opts.factoryName)}</td></tr>
        <tr><td style="color:#8b949e;padding:6px 0;">견적 금액</td><td style="color:#f0883e;font-weight:800;font-size:16px;">${amount} ${currency}</td></tr>
        ${opts.validUntil ? `<tr><td style="color:#8b949e;padding:6px 0;">유효 기간</td><td style="color:#e6edf3;">${escapeHtml(opts.validUntil)}</td></tr>` : ''}
      </table>
    </div>
    <a href="${rfqUrl}"
       style="display:inline-block;padding:12px 28px;background:#388bfd;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;">
      견적 확인 및 수락하기
    </a>
    <p style="color:#6e7681;font-size:12px;margin-top:20px;">
      견적 유효 기간 내에 수락해 주세요. 기간이 지나면 재견적이 필요할 수 있습니다.
    </p>
  ` : `
    <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;color:#e6edf3;">You received a quote! 💬</h2>
    <p style="color:#8b949e;font-size:14px;margin:0 0 20px;line-height:1.6;">
      Hi <strong style="color:#e6edf3;">${safeName}</strong>,<br>
      <strong style="color:#3fb950;">${escapeHtml(opts.factoryName)}</strong> has submitted a quote for your request.
    </p>
    <div style="background:#161b22;border-radius:8px;padding:20px;margin:0 0 24px;border:1px solid #30363d;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr><td style="color:#8b949e;padding:6px 0;width:120px;">Part</td><td style="color:#e6edf3;font-weight:600;">${escapeHtml(opts.shapeName)}</td></tr>
        <tr><td style="color:#8b949e;padding:6px 0;">Manufacturer</td><td style="color:#e6edf3;">${escapeHtml(opts.factoryName)}</td></tr>
        <tr><td style="color:#8b949e;padding:6px 0;">Quoted Amount</td><td style="color:#f0883e;font-weight:800;font-size:16px;">${amount} ${currency}</td></tr>
        ${opts.validUntil ? `<tr><td style="color:#8b949e;padding:6px 0;">Valid Until</td><td style="color:#e6edf3;">${escapeHtml(opts.validUntil)}</td></tr>` : ''}
      </table>
    </div>
    <a href="${rfqUrl}"
       style="display:inline-block;padding:12px 28px;background:#388bfd;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;">
      Review & Accept Quote
    </a>
    <p style="color:#6e7681;font-size:12px;margin-top:20px;">
      Please accept within the validity period. After expiry, re-quoting may be needed.
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
