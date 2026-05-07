import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { confirmPayment } from '@/lib/toss-client';
import { recordOrderCompletion } from '@/lib/stage-engine';

export const dynamic = 'force-dynamic';

// 결제 상태 컬럼 lazy 추가
async function ensurePaymentCols(db: ReturnType<typeof getDbAdapter>) {
  for (const col of ['payment_status TEXT', 'toss_order_id TEXT']) {
    await db.execute(`ALTER TABLE nf_orders ADD COLUMN ${col}`).catch(() => {});
  }
}

// POST /api/nexyfab/orders/[id]/payment
// Toss 결제 시작 — 클라이언트가 필요한 파라미터를 받아 SDK로 결제창 오픈
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: orderId } = await params;
  const db = getDbAdapter();
  await ensurePaymentCols(db);

  const order = await db.queryOne<{
    id: string; part_name: string; total_price_krw: number; payment_status: string | null; user_id: string;
  }>(
    'SELECT id, part_name, total_price_krw, payment_status, user_id FROM nf_orders WHERE id = ?',
    orderId,
  );
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  if (order.user_id !== authUser.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (order.payment_status === 'paid') return NextResponse.json({ error: '이미 결제된 주문입니다.' }, { status: 400 });

  // Toss용 고유 orderId (영문+숫자만, 6-64자)
  const tossOrderId = `NF-${orderId.replace(/[^A-Z0-9]/gi, '').slice(0, 20).toUpperCase()}-${Date.now()}`;

  await db.execute(
    'UPDATE nf_orders SET toss_order_id = ?, payment_status = ? WHERE id = ?',
    tossOrderId, 'pending', orderId,
  );

  const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? '';

  return NextResponse.json({
    tossOrderId,
    amount: Math.round(order.total_price_krw),
    orderName: order.part_name.slice(0, 100),
    clientKey,
  });
}

// PATCH /api/nexyfab/orders/[id]/payment
// Toss 결제 승인 확인 (successUrl redirect 후 프론트엔드가 호출)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: orderId } = await params;
  const body = await req.json() as { paymentKey: string; tossOrderId: string; amount: number };
  if (!body.paymentKey || !body.tossOrderId || !body.amount) {
    return NextResponse.json({ error: 'paymentKey, tossOrderId, amount required' }, { status: 400 });
  }

  const db = getDbAdapter();
  await ensurePaymentCols(db);

  const order = await db.queryOne<{ id: string; user_id: string; toss_order_id: string | null; payment_status: string | null; total_price_krw: number }>(
    'SELECT id, user_id, toss_order_id, payment_status, total_price_krw FROM nf_orders WHERE id = ?',
    orderId,
  );
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  if (order.user_id !== authUser.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (order.toss_order_id !== body.tossOrderId) return NextResponse.json({ error: '결제 정보가 일치하지 않습니다.' }, { status: 400 });

  // 이미 결제 완료된 경우 중복 처리 방지
  if (order.payment_status === 'paid') {
    return NextResponse.json({ ok: true, status: 'DONE' });
  }

  // 처리 중 상태로 먼저 락 — 동시 요청 중복 방지
  const locked = await db.execute(
    "UPDATE nf_orders SET payment_status = 'processing' WHERE id = ? AND payment_status = 'pending'",
    orderId,
  );
  if (locked.changes === 0) {
    return NextResponse.json({ error: '결제가 이미 처리 중입니다.' }, { status: 409 });
  }

  try {
    const payment = await confirmPayment(body.paymentKey, body.tossOrderId, body.amount);
    if (payment.status === 'DONE') {
      await db.execute(
        "UPDATE nf_orders SET payment_status = 'paid', status = 'production', updated_at = ? WHERE id = ?",
        Date.now(), orderId,
      );
      // Stage promotion: the 'pending' → 'processing' lock above is the
      // exactly-once gate, so we can safely bump cumulative metrics here.
      await recordOrderCompletion(order.user_id, Number(order.total_price_krw) || 0);
    } else {
      await db.execute(
        "UPDATE nf_orders SET payment_status = 'pending' WHERE id = ?",
        orderId,
      );
    }
    return NextResponse.json({ ok: payment.status === 'DONE', status: payment.status });
  } catch (err) {
    // Toss 실패 시 pending으로 복원 (재시도 가능하게)
    await db.execute(
      "UPDATE nf_orders SET payment_status = 'failed' WHERE id = ?",
      orderId,
    ).catch(() => {});
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: '결제 승인에 실패했습니다.', detail: errMsg }, { status: 502 });
  }
}
