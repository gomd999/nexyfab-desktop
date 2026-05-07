import { NextRequest, NextResponse } from 'next/server';
import { getPartnerAuth } from '@/lib/partner-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { sendEmail } from '@/lib/nexyfab-email';
import { createNotification } from '@/app/lib/notify';
import { recordMetric } from '@/lib/partner-metrics';
import { recordOrderEvent } from '@/lib/order-events';
import { normPartnerEmail } from '@/lib/partner-factory-access';

export const dynamic = 'force-dynamic';

const ALLOWED_PARTNER_STATUSES = ['production', 'qc', 'shipped', 'delivered'] as const;
type PartnerStatus = typeof ALLOWED_PARTNER_STATUSES[number];

interface OrderRow {
  id: string;
  rfq_id: string | null;
  user_id: string;
  part_name: string;
  manufacturer_name: string;
  quantity: number;
  total_price_krw: number;
  status: string;
  steps: string;
  created_at: number;
  estimated_delivery_at: number;
  partner_email: string | null;
  payment_status: string | null;
}

// GET /api/partner/orders  — 파트너 담당 주문 목록
export async function GET(req: NextRequest) {
  const partner = await getPartnerAuth(req);
  if (!partner) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDbAdapter();
  await db.execute('ALTER TABLE nf_orders ADD COLUMN partner_email TEXT').catch(() => {});
  await db.execute('ALTER TABLE nf_orders ADD COLUMN payment_status TEXT').catch(() => {});

  const page  = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10)));
  const offset = (page - 1) * limit;
  const statusFilter = req.nextUrl.searchParams.get('status') ?? '';

  const statusClause = statusFilter ? ' AND status = ?' : '';
  const pe = normPartnerEmail(partner.email);
  const co = (partner.company ?? '').trim().toLowerCase();
  const baseArgs: unknown[] = statusFilter ? [pe, co, co, statusFilter] : [pe, co, co];

  const totalRow = await db.queryOne<{ c: number }>(
    `SELECT COUNT(*) as c FROM nf_orders WHERE (
       (partner_email IS NOT NULL AND LOWER(TRIM(partner_email)) = ?)
       OR (? != '' AND LOWER(TRIM(manufacturer_name)) = ?)
     )${statusClause}`,
    ...baseArgs,
  );

  const rows = await db.queryAll<OrderRow>(
    `SELECT * FROM nf_orders WHERE (
       (partner_email IS NOT NULL AND LOWER(TRIM(partner_email)) = ?)
       OR (? != '' AND LOWER(TRIM(manufacturer_name)) = ?)
     )${statusClause}
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ...baseArgs, limit, offset,
  );

  const orders = rows.map(r => ({
    id: r.id,
    rfqId: r.rfq_id,
    userId: r.user_id,
    partName: r.part_name,
    manufacturerName: r.manufacturer_name,
    quantity: r.quantity,
    totalPriceKRW: r.total_price_krw,
    status: r.status,
    steps: JSON.parse(r.steps ?? '[]'),
    createdAt: r.created_at,
    estimatedDeliveryAt: r.estimated_delivery_at,
    partnerEmail: r.partner_email,
    paymentStatus: r.payment_status,
  }));

  return NextResponse.json({
    orders,
    pagination: {
      page, limit,
      total: totalRow?.c ?? 0,
      totalPages: Math.ceil((totalRow?.c ?? 0) / limit),
    },
  });
}

// PATCH /api/partner/orders  — 주문 상태 업데이트 (파트너 권한)
export async function PATCH(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const partner = await getPartnerAuth(req);
  if (!partner) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as { orderId: string; status: string };
  if (!body.orderId || !body.status) {
    return NextResponse.json({ error: 'orderId and status required' }, { status: 400 });
  }
  if (!ALLOWED_PARTNER_STATUSES.includes(body.status as PartnerStatus)) {
    return NextResponse.json(
      { error: `status must be one of: ${ALLOWED_PARTNER_STATUSES.join(', ')}` },
      { status: 400 },
    );
  }

  const db = getDbAdapter();
  const order = await db.queryOne<{
    id: string; partner_email: string | null; manufacturer_name: string;
    steps: string; part_name: string; user_email: string | null; quantity: number;
    user_id: string; status: string; created_at: number; estimated_delivery_at: number;
  }>(
    `SELECT id, partner_email, manufacturer_name, steps, part_name, user_email, quantity,
            user_id, status, created_at, estimated_delivery_at
       FROM nf_orders WHERE id = ?`,
    body.orderId,
  );
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

  // 파트너 소유 검증
  const coPatch = (partner.company ?? '').trim().toLowerCase();
  const isOwner =
    normPartnerEmail(order.partner_email) === normPartnerEmail(partner.email)
    || (coPatch.length > 0 && order.manufacturer_name.trim().toLowerCase() === coPatch);
  if (!isOwner) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const now = Date.now();

  // steps 배열에서 현재 단계 completedAt 업데이트
  const STATUS_STEP: Record<string, number> = {
    production: 1, qc: 2, shipped: 3, delivered: 4,
  };
  const stepIdx = STATUS_STEP[body.status] ?? -1;
  let steps: any[] = [];
  try { steps = JSON.parse(order.steps); } catch { steps = []; }
  if (stepIdx >= 0 && steps[stepIdx]) {
    steps[stepIdx] = { ...steps[stepIdx], completedAt: now, estimatedAt: undefined };
  }

  await db.execute(
    'UPDATE nf_orders SET status = ?, steps = ?, updated_at = ? WHERE id = ?',
    body.status, JSON.stringify(steps), now, body.orderId,
  ).catch(async () => {
    // updated_at 컬럼 없을 수 있음 — 컬럼 추가 후 재시도
    await db.execute('ALTER TABLE nf_orders ADD COLUMN updated_at INTEGER').catch(() => {});
    await db.execute(
      'UPDATE nf_orders SET status = ?, steps = ? WHERE id = ?',
      body.status, JSON.stringify(steps), body.orderId,
    );
  });

  // ── Append-only timeline event for the customer-visible tracking page ─────
  recordOrderEvent({
    orderId: body.orderId,
    kind: 'status_change',
    authorEmail: partner.email,
    authorRole: 'partner',
    fromStatus: order.status,
    toStatus: body.status,
  }).catch(() => {});

  // ── Multi-dimensional metric collection ───────────────────────────────────
  if (body.status === 'delivered') {
    const onTime = now <= order.estimated_delivery_at;
    const daysLate = (now - order.estimated_delivery_at) / 86_400_000;
    const leadTimeDays = (now - order.created_at) / 86_400_000;
    recordMetric({
      partnerEmail: partner.email,
      kind: onTime ? 'order_delivered_on_time' : 'order_delivered_late',
      orderId: body.orderId,
      daysLate: Math.round(daysLate * 10) / 10,
      leadTimeDays: Math.round(leadTimeDays * 10) / 10,
    }).catch(() => {});
  }

  // ── In-app notification to the customer ───────────────────────────────────
  if (order.user_id) {
    const STATUS_TITLE: Record<string, string> = {
      production: '🏭 생산이 시작되었습니다',
      qc: '🔍 품질 검사 단계입니다',
      shipped: '🚚 배송이 시작되었습니다',
      delivered: '✅ 납품이 완료되었습니다',
    };
    createNotification(
      order.user_id,
      'order_status',
      STATUS_TITLE[body.status] ?? '주문 상태가 업데이트되었습니다',
      `${order.part_name} (${order.quantity.toLocaleString()}개) - ${order.manufacturer_name}`,
      { contractId: body.orderId },
    );
  }

  // 고객에게 상태 변경 이메일 (fire-and-forget)
  const STATUS_LABEL_KO: Record<string, string> = {
    production: '생산 중',
    qc: '품질 검사',
    shipped: '배송 중',
    delivered: '납품 완료',
  };
  if (order.user_email) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nexyfab.com';
    const statusLabel = STATUS_LABEL_KO[body.status] ?? body.status;
    sendEmail(
      order.user_email,
      `[NexyFab] 주문 상태 업데이트 — ${statusLabel}`,
      `<!DOCTYPE html><html lang="ko"><body style="font-family:system-ui;background:#f3f4f6;padding:24px">
      <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px #00000018">
        <div style="background:linear-gradient(135deg,#1e3a5f,#2563eb);color:#fff;padding:28px 32px">
          <div style="font-size:22px;font-weight:900">NexyFab</div>
          <div style="font-size:13px;opacity:0.8;margin-top:4px">주문 알림</div>
        </div>
        <div style="padding:28px 32px">
          <h2 style="margin:0 0 12px;font-size:18px;color:#111">📦 주문 상태가 변경되었습니다</h2>
          <p style="color:#4b5563;font-size:14px;line-height:1.7">
            주문하신 부품의 진행 상황이 업데이트되었습니다.
          </p>
          <div style="background:#f0f4ff;border:1px solid #c7d7fe;border-radius:10px;padding:16px;margin:16px 0;font-size:13px">
            <div style="margin-bottom:6px"><strong>부품명:</strong> ${order.part_name}</div>
            <div style="margin-bottom:6px"><strong>수량:</strong> ${order.quantity.toLocaleString()}개</div>
            <div style="margin-bottom:6px"><strong>제조사:</strong> ${order.manufacturer_name}</div>
            <div style="font-size:15px;font-weight:700;color:#2563eb;margin-top:8px">현재 상태: ${statusLabel}</div>
          </div>
          ${body.status === 'delivered' ? '<p style="color:#16a34a;font-weight:700;font-size:14px">✅ 납품이 완료되었습니다. 감사합니다!</p>' : ''}
          <a href="${baseUrl}/ko/nexyfab/orders"
             style="display:block;text-align:center;padding:13px;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">
            주문 현황 확인
          </a>
        </div>
      </div>
      </body></html>`,
    ).catch(() => {});
  }

  return NextResponse.json({ ok: true, status: body.status });
}
