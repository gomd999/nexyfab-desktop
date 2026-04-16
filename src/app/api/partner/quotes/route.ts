import { NextRequest, NextResponse } from 'next/server';
import { getPartnerAuth } from '@/lib/partner-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { createNotification } from '@/app/lib/notify';
import { logAudit } from '@/lib/audit';
import { checkOrigin } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

interface QuoteRow {
  id: string;
  inquiry_id: string | null;
  project_name: string;
  factory_name: string;
  estimated_amount: number;
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

  const conditions: string[] = ['partner_email = ?'];
  const vals: unknown[] = [partner.email];

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
    estimatedDays?: number | null;
    note?: string;
    validUntil?: string;
  };

  const { rfqId, estimatedAmount, estimatedDays, note, validUntil } = body;
  if (!rfqId || !estimatedAmount) {
    return NextResponse.json({ error: 'rfqId와 estimatedAmount는 필수입니다.' }, { status: 400 });
  }
  const amount = Number(estimatedAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: '유효한 금액을 입력해주세요.' }, { status: 400 });
  }

  const db = getDbAdapter();

  // RFQ 존재 및 이 파트너 팩토리에 배정됐는지 확인
  const rfq = await db.queryOne<{ id: string; shape_name: string; assigned_factory_id: string | null }>(
    'SELECT id, shape_name, assigned_factory_id FROM nf_rfqs WHERE id = ?',
    rfqId,
  );
  if (!rfq) return NextResponse.json({ error: 'RFQ를 찾을 수 없습니다.' }, { status: 404 });

  // 이미 이 파트너가 제출한 견적이 있는지 확인
  const existing = await db.queryOne<{ id: string }>(
    'SELECT id FROM nf_quotes WHERE inquiry_id = ? AND partner_email = ?',
    rfqId, partner.email,
  );
  if (existing) {
    return NextResponse.json({ error: '이미 견적을 제출하셨습니다.', quoteId: existing.id }, { status: 409 });
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const id = `QT-${now}-${Math.random().toString(36).slice(2, 6)}`;

  await db.execute(
    `INSERT INTO nf_quotes
      (id, inquiry_id, project_name, factory_name, estimated_amount, estimated_days,
       partner_note, valid_until, partner_email, status, responded_at, responded_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,'responded',?,?,?)`,
    id,
    rfqId,
    rfq.shape_name || rfqId,
    partner.company || '',
    amount,
    estimatedDays ?? null,
    note || null,
    validUntil ?? null,
    partner.email,
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

  logAudit({
    userId: `partner:${partner.email}`,
    action: 'quote.submit',
    resourceId: id,
    metadata: { rfqId, amount, company: partner.company },
  });

  const quote = await db.queryOne<QuoteRow>('SELECT * FROM nf_quotes WHERE id = ?', id);
  return NextResponse.json({ quote }, { status: 201 });
}
