import { NextRequest, NextResponse } from 'next/server';
import { getPartnerAuth } from '@/lib/partner-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { createNotification } from '@/app/lib/notify';
import { logAudit } from '@/lib/audit';
import { checkOrigin } from '@/lib/csrf';
import { sendEmail, quoteReceivedHtml, quoteReceivedEmailSubject, nexyfabEmailLocaleFromLanguageTag, nexyfabAppLangPathFromEmailLocale } from '@/lib/nexyfab-email';
import { captureFxQuote, serializeFxQuote } from '@/lib/money';
import type { CurrencyCode } from '@/lib/country-pricing';
import { isIncoterm, isValidHsCode, normalizeHsCode } from '@/lib/shipping';
import { normPartnerEmail, partnerOwnsAssignedFactory } from '@/lib/partner-factory-access';

export const dynamic = 'force-dynamic';

interface QuoteRow {
  id: string;
  inquiry_id: string | null;
  project_name: string;
  factory_name: string;
  estimated_amount: number;
  amount: number | null;
  currency: string | null;
  fx_quote: string | null;
  fx_valid_until: number | null;
  hs_code: string | null;
  incoterm: string | null;
  estimated_days: number | null;
  partner_note: string | null;
  details: string;
  valid_until: string | null;
  partner_email: string | null;
  status: string;
  responded_at: number | null;
  responded_by: string | null;
  created_at: string;
  updated_at: string | null;
}

// GET /api/partner/quotes
export async function GET(req: NextRequest) {
  const partner = await getPartnerAuth(req);
  if (!partner) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const db = getDbAdapter();
  const { searchParams } = req.nextUrl;
  const status = searchParams.get('status');
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(50, parseInt(searchParams.get('limit') || '20', 10));
  const offset = (page - 1) * limit;

  const conditions: string[] = ['partner_email IS NOT NULL AND LOWER(TRIM(partner_email)) = ?'];
  const vals: unknown[] = [normPartnerEmail(partner.email)];

  if (status) {
    conditions.push('status = ?');
    vals.push(status);
  }

  const where = conditions.join(' AND ');

  const countRow = await db.queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM nf_quotes WHERE ${where}`,
    ...vals,
  );
  const total = countRow?.cnt ?? 0;

  const quotes = await db.queryAll<QuoteRow>(
    `SELECT * FROM nf_quotes WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ...vals, limit, offset,
  );

  return NextResponse.json({
    quotes,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

// POST /api/partner/quotes — RFQ에 새 견적 제출
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const partner = await getPartnerAuth(req);
  if (!partner) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });

  const body = await req.json() as {
    rfqId?: string;
    estimatedAmount?: number;
    currency?: string;
    estimatedDays?: number | null;
    note?: string;
    validUntil?: string;
    hsCode?: string;
    incoterm?: string;
  };

  const { rfqId, estimatedAmount, estimatedDays, note, validUntil } = body;
  if (!rfqId || !estimatedAmount) {
    return NextResponse.json({ error: 'rfqId와 estimatedAmount는 필수입니다.' }, { status: 400 });
  }
  const amount = Number(estimatedAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: '유효한 금액을 입력해주세요.' }, { status: 400 });
  }
  const currency = (body.currency ?? 'KRW').toUpperCase() as CurrencyCode;

  const hsCode = body.hsCode ? normalizeHsCode(body.hsCode) : null;
  if (hsCode && !isValidHsCode(hsCode)) {
    return NextResponse.json({ error: 'hsCode must be 6, 8, or 10 digits.' }, { status: 400 });
  }
  const incoterm = body.incoterm && isIncoterm(body.incoterm) ? body.incoterm : null;
  if (body.incoterm && !incoterm) {
    return NextResponse.json({ error: 'incoterm must be one of EXW, DAP, DDP.' }, { status: 400 });
  }

  const db = getDbAdapter();

  // RFQ 존재 및 이 파트너 팩토리에 배정됐는지 확인
  const rfq = await db.queryOne<{
    id: string; shape_name: string; assigned_factory_id: string | null;
    lineage_id: string | null; artifact_id: string | null;
    artifact_sha256: string | null; document_version_id: string | null;
  }>(
    `SELECT id, shape_name, assigned_factory_id, lineage_id, artifact_id,
            artifact_sha256, document_version_id FROM nf_rfqs WHERE id = ?`,
    rfqId,
  );
  if (!rfq) return NextResponse.json({ error: 'RFQ를 찾을 수 없습니다.' }, { status: 404 });

  // 배정된 RFQ: 공장 ID는 nf_factories.id 이고, 파트너 JWT의 partnerId는 nf_users.id 이므로
  // 공장의 partner_email / contact_email(또는 레거시 partnerId === factory id)으로 검증한다.
  if (rfq.assigned_factory_id) {
    const allowed = await partnerOwnsAssignedFactory(rfq.assigned_factory_id, partner);
    if (!allowed) {
      return NextResponse.json({ error: '이 RFQ에 배정된 파트너가 아닙니다.' }, { status: 403 });
    }
  }

  // 이미 이 파트너가 제출한 견적이 있는지 확인
  const existing = await db.queryOne<{ id: string }>(
    `SELECT id FROM nf_quotes
     WHERE inquiry_id = ?
       AND partner_email IS NOT NULL
       AND LOWER(TRIM(partner_email)) = ?`,
    rfqId,
    normPartnerEmail(partner.email),
  );
  if (existing) {
    return NextResponse.json({ error: '이미 견적을 제출하셨습니다.', quoteId: existing.id }, { status: 409 });
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const id = `QT-${now}-${Math.random().toString(36).slice(2, 6)}`;

  // Lock in an FX snapshot so the quoted price is honored if the customer
  // accepts within the validity window. Default 7 days mirrors typical B2B
  // quote norms; partner-supplied `validUntil` overrides only the human
  // expiry, not the FX freshness.
  const fxQuote = await captureFxQuote('USD', 7).catch(() => null);

  await db.execute(
    `INSERT INTO nf_quotes
      (id, inquiry_id, project_name, factory_name, estimated_amount,
       amount, currency, fx_quote, fx_valid_until,
       hs_code, incoterm,
       estimated_days, partner_note, valid_until, partner_email,
       lineage_id, artifact_id, artifact_sha256, document_version_id,
       status, responded_at, responded_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'responded',?,?,?)`,
    id,
    rfqId,
    rfq.shape_name || rfqId,
    partner.company || '',
    amount,
    amount,
    currency,
    fxQuote ? serializeFxQuote(fxQuote) : null,
    fxQuote?.validUntil ?? null,
    hsCode,
    incoterm,
    estimatedDays ?? null,
    note || null,
    validUntil ?? null,
    normPartnerEmail(partner.email),
    rfq.lineage_id,
    rfq.artifact_id,
    rfq.artifact_sha256,
    rfq.document_version_id,
    now,
    partner.company || partner.email,
    nowIso,
  );

  // 어드민 알림 (in-app + email)
  createNotification(
    'admin',
    'quote_responded',
    '파트너 새 견적 제출',
    `${partner.company || partner.email}이(가) "${rfq.shape_name || rfqId}"에 견적을 제출했습니다. (${amount.toLocaleString('ko-KR')}원)`,
    { quoteId: id },
  );
  try {
    const adminEmail = process.env.NEXYFAB_ADMIN_EMAIL;
    if (adminEmail) {
      const { esc } = await import('@/lib/html-escape');
      void sendEmail(
        adminEmail,
        `[NexyFab Ops] 새 견적 제출 — ${rfq.shape_name || rfqId}`,
        `<p><b>${esc(partner.company || partner.email)}</b> 이(가) <code>${esc(rfqId)}</code> 에 견적 제출.<br/>금액: ${esc(amount.toLocaleString('ko-KR'))}원, 납기: ${esc(String(estimatedDays ?? '-'))}일</p><p><a href="https://nexyfab.com/admin/concierge">→ Concierge 콘솔</a></p>`,
      );
    }
  } catch { /* non-blocking */ }

  // RFQ 상태를 'quoted'로 업데이트
  await db.execute(
    "UPDATE nf_rfqs SET status = 'quoted', updated_at = ? WHERE id = ? AND status = 'assigned'",
    now, rfqId,
  );

  // Grant Pro tooling for the duration of the deal — partners need to view
  // the buyer's STEP/STL and run DFM/cost checks while the quote is live.
  // Idempotent extension: subsequent quote submissions only push the window
  // out, never shrink it.
  //
  // Abuse guards: only grant grace if (a) operator-driven concierge entry
  // exists for this partner's factory on this RFQ — prevents random partners
  // spamming junk quotes for free Pro — and (b) the quote amount is in a
  // sane range (filters obvious penny-quote farming).
  try {
    const MIN_QUOTE_KRW = 10_000;
    const MAX_QUOTE_KRW = 100_000_000_000;
    const amountSane = amount >= MIN_QUOTE_KRW && amount <= MAX_QUOTE_KRW;
    let conciergeOk = false;
    if (amountSane) {
      const conciergeRow = await db.queryOne<{ id: string }>(
        `SELECT cs.id FROM nf_concierge_status cs
           JOIN nf_factories f ON f.id = cs.factory_id
          WHERE cs.rfq_id = ?
            AND (LOWER(TRIM(f.partner_email)) = ? OR LOWER(TRIM(f.contact_email)) = ?)
            AND cs.status IN ('recommended', 'contacted', 'responded', 'quote_drafting')
          LIMIT 1`,
        rfqId, normPartnerEmail(partner.email), normPartnerEmail(partner.email),
      ).catch(() => null);
      conciergeOk = !!conciergeRow;
    }
    if (conciergeOk) {
      const { extendPartnerProGrace } = await import('@/lib/partner-pro-grace');
      await extendPartnerProGrace(partner.userId, 'quote_submitted', now);
    }
  } catch { /* non-blocking */ }

  // 고객에게 견적 도착 이메일 알림 (fire-and-forget)
  const rfqRow = await db.queryOne<{
    user_email: string | null;
    shape_name: string;
    user_id: string | null;
    language: string | null;
  }>(
    `SELECT r.user_email, r.shape_name, r.user_id, u.language
     FROM nf_rfqs r
     LEFT JOIN nf_users u ON r.user_id = u.id
     WHERE r.id = ?`,
    rfqId,
  ).catch(() => null);
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://nexyfab.com';
  if (rfqRow?.user_email) {
    const locale = nexyfabEmailLocaleFromLanguageTag(rfqRow.language);
    const langPath = nexyfabAppLangPathFromEmailLocale(locale);
    const shape = rfqRow.shape_name || rfqId;
    sendEmail(
      rfqRow.user_email,
      quoteReceivedEmailSubject(locale, shape),
      quoteReceivedHtml({
        userName: rfqRow.user_email.split('@')[0],
        lang: rfqRow.language ?? undefined,
        rfqId,
        shapeName: shape,
        factoryName: partner.company || partner.email,
        estimatedAmount: amount,
        currency,
        validUntil: validUntil ?? undefined,
        rfqPageUrl: `${baseUrl}/${langPath}/nexyfab/rfq/${rfqId}`,
      }),
    ).catch(err => console.error('[partner/quotes] quote notification email failed:', err));
  }

  logAudit({
    userId: `partner:${normPartnerEmail(partner.email)}`,
    action: 'quote.submit',
    resourceId: id,
    metadata: { rfqId, amount, company: partner.company },
  });

  const quote = await db.queryOne<QuoteRow>('SELECT * FROM nf_quotes WHERE id = ?', id);
  return NextResponse.json({ quote }, { status: 201 });
}
