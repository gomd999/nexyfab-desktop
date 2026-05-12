/**
 * POST /api/nexyfab/orders/[id]/refund-request
 * User-initiated refund request for manufacturing orders.
 * Creates a request record for admin review — does not auto-process payment.
 * Refund *request* is accepted when payment_status = 'paid' and the order is
 * still before QC (`placed` or `production`). Ops reviews actual refundability.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { sendEmail } from '@/lib/nexyfab-email';
import { esc } from '@/lib/html-escape';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

async function ensureRefundCols(db: ReturnType<typeof getDbAdapter>) {
  for (const col of ['refund_requested_at INTEGER', 'refund_reason TEXT']) {
    await db.execute(`ALTER TABLE nf_orders ADD COLUMN ${col}`).catch(() => {});
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!rateLimit(`refund-req:${authUser.userId}`, 5, 3_600_000).allowed) {
    return NextResponse.json({ error: '요청이 너무 많습니다.' }, { status: 429 });
  }

  const { id: orderId } = await params;
  const body = await req.json() as { reason?: string };
  const reason = (body.reason ?? '').trim().slice(0, 500);

  const db = getDbAdapter();
  await ensureRefundCols(db);

  const order = await db.queryOne<{
    id: string; user_id: string; part_name: string;
    status: string; payment_status: string | null;
    refund_requested_at: number | null;
    total_price_krw: number;
  }>(
    'SELECT id, user_id, part_name, status, payment_status, refund_requested_at, total_price_krw FROM nf_orders WHERE id = ?',
    orderId,
  );

  if (!order) return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 });
  if (order.user_id !== authUser.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (order.payment_status !== 'paid') {
    return NextResponse.json({ error: '결제 완료된 주문만 환불 요청이 가능합니다.' }, { status: 400 });
  }
  if (!['placed', 'production'].includes(order.status)) {
    return NextResponse.json(
      { error: '품질 검수 이후 단계에서는 환불 요청을 접수할 수 없습니다. 문의가 필요하면 지원 채널을 이용해 주세요.' },
      { status: 400 },
    );
  }
  if (order.refund_requested_at) {
    return NextResponse.json({ error: '이미 환불 요청이 접수되었습니다.' }, { status: 409 });
  }

  const now = Date.now();
  await db.execute(
    'UPDATE nf_orders SET refund_requested_at = ?, refund_reason = ? WHERE id = ?',
    now, reason || null, orderId,
  );

  // Notify admin
  const adminEmail = process.env.ADMIN_EMAIL ?? 'nexyfab@nexysys.com';
  sendEmail(
    adminEmail,
    `[NexyFab] 환불 요청: ${orderId}`,
    `<p>주문 <b>${orderId}</b> (${order.part_name})에 대한 환불 요청이 접수되었습니다.</p>
     <p>금액: ${order.total_price_krw.toLocaleString()}원</p>
     <p>사유: ${reason || '(미입력)'}</p>
     <p>관리자 콘솔에서 처리해 주세요.</p>`,
  ).catch(() => {});

  const buyerEmail = authUser.email?.trim();
  if (buyerEmail) {
    sendEmail(
      buyerEmail,
      '[NexyFab] 환불 요청이 접수되었습니다',
      `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f2937;line-height:1.6;">
        <p>안녕하세요, NexyFab입니다.</p>
        <p>접수하신 환불 요청이 관리자 큐에 등록되었습니다. 제조 공정 진행 여부를 확인한 후 승인 처리가 진행되며,
        영업일 기준 <strong>3~5일 내</strong>에 결제 수단으로 환불되는 것을 목표로 합니다(결제사·카드사 처리 기간은 별도일 수 있습니다).</p>
        <p>주문 번호: <code>${esc(orderId)}</code> · 부품: ${esc(order.part_name)}</p>
        ${process.env.NEXT_PUBLIC_PAID_BETA === '1'
        ? '<p style="font-size:13px;color:#92400e;">유료 베타 기간 중에는 검토가 다소 지연될 수 있으니 양해 부탁드립니다.</p>'
        : ''}
      </div>`,
    ).catch(() => {});
  }

  return NextResponse.json({ ok: true, requestedAt: now });
}
