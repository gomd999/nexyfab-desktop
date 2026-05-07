import { NextRequest, NextResponse } from 'next/server';
import { getPartnerAuth } from '@/lib/partner-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { createNotification } from '@/app/lib/notify';
import { logAudit } from '@/lib/audit';
import { checkOrigin } from '@/lib/csrf';
import { sendEmail, quoteReceivedHtml } from '@/lib/nexyfab-email';
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
  const rfq = await db.queryOne<{ id: string; shape_name: string; assigned_factory_id: string | null }>(
    'SELECT id, shape_name, assigned_factory_id FROM nf_rfqs WHERE id = ?',
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
       status, responded_at, responded_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'responded',?,?,?)`,
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
    now,
    partner.company || partner.email,
    nowIso,
  );

  // 어드민 알림
  createNotification(
    'admin',
    'quote_responded',
    '파트너 새 견적 제출',
    `${partner.company || partner.email}이(가) "${rfq.shape_name || rfqId}"에 견적을 제출했습니다. (${amount.toLocaleString('ko-KR')}원)`,
    { quoteId: id },
  );

  // RFQ 상태를 'quoted'로 업데이트
  await db.execute(
    "UPDATE nf_rfqs SET status = 'quoted', updated_at = ? WHERE id = ? AND status = 'assigned'",
    now, rfqId,
  );

  // 고객에게 견적 도착 이메일 알림 (fire-and-forget)
  const rfqRow = await db.queryOne<{ user_email: string | null; shape_name: string }>(
    'SELECT user_email, shape_name FROM nf_rfqs WHERE id = ?', rfqId,
  ).catch(() => null);
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://nexyfab.com';
  if (rfqRow?.user_email) {
    sendEmail(
      rfqRow.user_email,
      `[NexyFab] 견적이 도착했습니다 — ${rfqRow.shape_name || rfqId}`,
      quoteReceivedHtml({
        userName: rfqRow.user_email.split('@')[0],
        rfqId,
        shapeName: rfqRow.shape_name || rfqId,
        factoryName: partner.company || partner.email,
        estimatedAmount: amount,
        validUntil: validUntil ?? undefined,
        rfqPageUrl: `${baseUrl}/ko/nexyfab/rfq`,
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
