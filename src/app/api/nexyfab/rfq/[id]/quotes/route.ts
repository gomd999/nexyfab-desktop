import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { createNotification } from '@/app/lib/notify';
import { sendEmail } from '@/lib/nexyfab-email';
import { randomBytes } from 'crypto';
import { normPartnerEmail } from '@/lib/partner-factory-access';

const DAY = 86_400_000;

export const dynamic = 'force-dynamic';

export interface QuoteForRFQ {
  id: string;
  factoryName: string;
  partnerEmail: string | null;
  estimatedAmount: number;
  estimatedDays: number | null;
  note: string | null;
  status: string;
  validUntil: string | null;
  createdAt: string;
}

// GET /api/nexyfab/rfq/[id]/quotes
// Returns all quotes submitted by manufacturers for the given RFQ (user-owned)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const db = getDbAdapter();

  // Verify the RFQ belongs to this user
  const rfq = await db.queryOne<{ id: string }>(
    'SELECT id FROM nf_rfqs WHERE id = ? AND user_id = ?',
    id, authUser.userId,
  );
  if (!rfq) return NextResponse.json({ error: 'RFQ not found' }, { status: 404 });

  type QuoteRow = {
    id: string;
    factory_name: string;
    partner_email: string | null;
    estimated_amount: number;
    estimated_days: number | null;
    note: string | null;
    status: string;
    valid_until: string | null;
    created_at: string;
  };

  const rows = await db.queryAll<QuoteRow>(
    `SELECT q.id, q.factory_name, q.partner_email, q.estimated_amount,
            q.estimated_days, q.note, q.status, q.valid_until, q.created_at
     FROM nf_quotes q
     WHERE q.inquiry_id = ?
     ORDER BY
       CASE q.status
         WHEN 'submitted' THEN 0
         WHEN 'accepted'  THEN 1
         WHEN 'pending'   THEN 2
         WHEN 'rejected'  THEN 3
         ELSE 4
       END,
       q.estimated_amount ASC`,
    id,
  ).catch((): QuoteRow[] => []);

  const quotes: QuoteForRFQ[] = rows.map((r: QuoteRow) => ({
    id: r.id,
    factoryName: r.factory_name,
    partnerEmail: r.partner_email,
    estimatedAmount: r.estimated_amount,
    estimatedDays: r.estimated_days,
    note: r.note,
    status: r.status,
    validUntil: r.valid_until,
    createdAt: r.created_at,
  }));

  return NextResponse.json({ quotes });
}

// PATCH /api/nexyfab/rfq/[id]/quotes
// 특정 quote를 수락하거나 거절. rfq 전체 상태도 동시 업데이트.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: rfqId } = await params;
  const db = getDbAdapter();

  const rfq = await db.queryOne<{ id: string; shape_name: string; quantity: number; material_id: string; user_id: string; user_email: string | null }>(
    'SELECT id, shape_name, quantity, material_id, user_id, user_email FROM nf_rfqs WHERE id = ? AND user_id = ?',
    rfqId, authUser.userId,
  );
  if (!rfq) return NextResponse.json({ error: 'RFQ not found' }, { status: 404 });

  const body = await req.json() as {
    quoteId: string;
    action: 'accept' | 'reject';
  };
  if (!body.quoteId || !['accept', 'reject'].includes(body.action)) {
    return NextResponse.json({ error: 'quoteId and action (accept|reject) required' }, { status: 400 });
  }

  const quote = await db.queryOne<{ id: string; estimated_amount: number; estimated_days: number | null; factory_name: string; partner_email: string | null }>(
    'SELECT id, estimated_amount, estimated_days, factory_name, partner_email FROM nf_quotes WHERE id = ? AND inquiry_id = ?',
    body.quoteId, rfqId,
  );
  if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 });

  const now = Date.now();
  const newQuoteStatus = body.action === 'accept' ? 'accepted' : 'rejected';
  const newRfqStatus = body.action === 'accept' ? 'accepted' : 'quoted';
  let orderId: string | undefined;

  await db.execute(
    'UPDATE nf_quotes SET status = ?, updated_at = ? WHERE id = ?',
    newQuoteStatus, now, body.quoteId,
  );

  if (body.action === 'accept') {
    // 수락 시 RFQ 상태 및 금액 업데이트. 나머지 견적은 rejected 처리.
    await db.execute(
      'UPDATE nf_rfqs SET status = ?, quote_amount = ?, manufacturer_note = ?, updated_at = ? WHERE id = ?',
      'accepted', quote.estimated_amount, quote.factory_name, now, rfqId,
    );
    await db.execute(
      "UPDATE nf_quotes SET status = 'rejected', updated_at = ? WHERE inquiry_id = ? AND id != ?",
      now, rfqId, body.quoteId,
    );
    // 파트너에게 수락 알림 (인앱 + 이메일)
    if (quote.partner_email) {
      createNotification(
        `partner:${normPartnerEmail(quote.partner_email)}`,
        'quote_accepted',
        '견적 수락됨',
        `고객이 "${rfq.shape_name || rfqId}" 견적을 수락했습니다. 생산을 진행해 주세요.`,
        { quoteId: body.quoteId },
      );
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nexyfab.com';
      sendEmail(
        quote.partner_email,
        `[NexyFab] 견적이 수락되었습니다 — ${rfq.shape_name || rfqId}`,
        `<!DOCTYPE html><html lang="ko"><body style="font-family:system-ui;background:#f3f4f6;padding:24px">
        <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px #00000018">
          <div style="background:linear-gradient(135deg,#1e3a5f,#2563eb);color:#fff;padding:28px 32px">
            <div style="font-size:22px;font-weight:900">NexyFab</div>
            <div style="font-size:13px;opacity:0.8;margin-top:4px">파트너 알림</div>
          </div>
          <div style="padding:28px 32px">
            <h2 style="margin:0 0 12px;font-size:18px;color:#111">🎉 견적이 수락되었습니다!</h2>
            <p style="color:#4b5563;font-size:14px;line-height:1.7">
              고객이 귀사의 견적을 수락했습니다. 아래 주문 내용을 확인하고 생산을 시작해 주세요.
            </p>
            <div style="background:#f0f4ff;border:1px solid #c7d7fe;border-radius:10px;padding:16px;margin:16px 0;font-size:13px">
              <div style="margin-bottom:6px"><strong>부품명:</strong> ${rfq.shape_name || rfqId}</div>
              <div style="margin-bottom:6px"><strong>수량:</strong> ${rfq.quantity.toLocaleString()}개</div>
              <div style="margin-bottom:6px"><strong>금액:</strong> ₩${quote.estimated_amount.toLocaleString('ko-KR')}</div>
              <div><strong>납기:</strong> ${quote.estimated_days ?? 14}일 이내</div>
            </div>
            <a href="${baseUrl}/partner/quotes"
               style="display:block;text-align:center;padding:13px;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">
              파트너 대시보드 확인
            </a>
          </div>
        </div>
        </body></html>`,
      ).catch(() => {});
    }

    // 수락된 견적으로 주문 자동 생성
    const leadDays = quote.estimated_days ?? 14;
    const steps = JSON.stringify([
      { label: 'Order Placed',  labelKo: '주문 완료',  completedAt: now },
      { label: 'In Production', labelKo: '생산 중',    estimatedAt: now + 2 * DAY },
      { label: 'QC',            labelKo: '품질 검사',  estimatedAt: now + (leadDays - 4) * DAY },
      { label: 'Shipped',       labelKo: '배송 시작',  estimatedAt: now + (leadDays - 2) * DAY },
      { label: 'Delivered',     labelKo: '배송 완료',  estimatedAt: now + leadDays * DAY },
    ]);
    orderId = `ORD-${new Date().getFullYear()}-${randomBytes(3).toString('hex').toUpperCase()}`;
    // partner_email 컬럼 lazy 추가
    await db.execute('ALTER TABLE nf_orders ADD COLUMN partner_email TEXT').catch(() => {});
    await db.execute(
      `INSERT OR IGNORE INTO nf_orders
         (id, rfq_id, user_id, part_name, manufacturer_name, quantity, total_price_krw,
          status, steps, created_at, estimated_delivery_at, partner_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'placed', ?, ?, ?, ?)`,
      orderId,
      rfqId,
      rfq.user_id,
      rfq.shape_name || rfqId,
      quote.factory_name,
      rfq.quantity,
      quote.estimated_amount,
      steps,
      now,
      now + leadDays * DAY,
      quote.partner_email ?? null,
    );
  } else {
    // 단일 거절 — rfq는 'quoted' 유지 (다른 견적 여전히 가능)
    await db.execute(
      'UPDATE nf_rfqs SET updated_at = ? WHERE id = ?',
      now, rfqId,
    );
  }

  return NextResponse.json({ ok: true, rfqStatus: newRfqStatus, quoteStatus: newQuoteStatus, orderId });
}
