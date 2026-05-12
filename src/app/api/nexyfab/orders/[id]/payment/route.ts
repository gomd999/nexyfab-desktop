import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
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

// Idempotency table — created lazily on first use so deploys without the
// migration applied still recover on next request. Schema mirrors v82 in
// db-postgres-migrations.sql.
let attemptTableEnsured = false;
async function ensureAttemptTable(db: ReturnType<typeof getDbAdapter>) {
  if (attemptTableEnsured) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_payment_attempts (
      id            TEXT PRIMARY KEY,
      order_id      TEXT NOT NULL,
      toss_order_id TEXT NOT NULL,
      payment_key   TEXT NOT NULL,
      amount_krw    BIGINT NOT NULL,
      status        TEXT NOT NULL,
      user_id       TEXT NOT NULL,
      raw_response  TEXT,
      created_at    BIGINT NOT NULL
    )
  `).catch(() => {});
  await db.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_attempt_pair ON nf_payment_attempts(toss_order_id, payment_key)',
  ).catch(() => {});
  attemptTableEnsured = true;
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
  await ensureAttemptTable(db);

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

  // Application-level idempotency — INSERT into nf_payment_attempts with
  // a UNIQUE(toss_order_id, payment_key) constraint. If two concurrent
  // confirmers race past the row-level UPDATE lock, the second one's
  // INSERT will fail and we abort before re-charging Toss.
  const attemptId = `pa_${randomUUID()}`;
  const insertResult = await db.execute(
    `INSERT INTO nf_payment_attempts
       (id, order_id, toss_order_id, payment_key, amount_krw, status, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    attemptId, orderId, body.tossOrderId, body.paymentKey, body.amount, authUser.userId, Date.now(),
  ).catch(err => {
    // UNIQUE violation = same (tossOrderId, paymentKey) was already attempted.
    // Different errors should bubble up as 500 so we know.
    const msg = (err as Error).message ?? '';
    if (msg.includes('UNIQUE') || msg.includes('duplicate') || msg.includes('unique constraint')) {
      return null;
    }
    throw err;
  });
  if (insertResult === null) {
    return NextResponse.json({
      error: '동일한 결제 요청이 이미 처리되고 있습니다. 잠시 후 결제 상태를 확인해주세요.',
      code: 'DUPLICATE_ATTEMPT',
    }, { status: 409 });
  }

  // 처리 중 상태로 먼저 락 — 동시 요청 중복 방지 (row-level)
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

      // Auto-create escrow ledger row + mark received in one shot. Toss
      // has already collected the funds — escrow is just the platform-side
      // record of what's owed to the partner. Without this auto-trigger,
      // escrow would sit in 'pending' forever until ops manually clicked.
      try {
        const { createEscrowForOrder, markEscrowReceived } = await import('@/lib/escrow-helpers');
        const result = await createEscrowForOrder(db, orderId);
        if (result) {
          await markEscrowReceived(db, orderId);
          // Funnel signal so /admin/funnel can plot payment→escrow latency.
          try {
            const { logFunnelEvent } = await import('@/lib/funnel-logger');
            await logFunnelEvent(authUser.userId, {
              eventType: 'escrow_created',
              contextType: 'order', contextId: orderId,
              metadata: { source: 'toss_webhook', netKrw: result.netKrw },
            });
          } catch { /* non-blocking */ }
        }
      } catch (err) {
        console.warn('[payment PATCH] escrow auto-create failed:', err);
        // Non-blocking: payment is already confirmed; ops can manually
        // create the escrow row from /admin/escrow if this path fails.
      }

      // Send buyer receipt — without this, the buyer has no proof of
      // payment outside our dashboard. Tax purposes alone make this
      // mandatory; trust-building is the secondary motivation.
      try {
        const { sendEmail } = await import('@/lib/email');
        const { esc } = await import('@/lib/html-escape');
        const buyer = await db.queryOne<{ email: string; name: string | null }>(
          'SELECT email, name FROM nf_users WHERE id = ?', order.user_id,
        );
        if (buyer?.email) {
          const amount = body.amount.toLocaleString('ko-KR');
          const paidBeta = process.env.NEXT_PUBLIC_PAID_BETA === '1';
          const orderShort = orderId.slice(0, 12).toUpperCase();
          await sendEmail({
            to: buyer.email,
            subject: paidBeta
              ? `[NexyFab] 주문이 정상적으로 접수되었습니다. (주문번호: #${orderShort})`
              : `[NexyFab] 결제 영수증 — 주문 ${orderId.slice(0, 12)}`,
            html: `
              <div style="font-family: system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1f2937;">
                <div style="font-size: 18px; font-weight: 700; margin-bottom: 12px;">✓ 결제가 완료되었습니다</div>
                <p style="line-height: 1.6;">
                  ${esc(buyer.name ?? buyer.email)} 님,<br />
                  ${paidBeta
                    ? '안녕하세요, NexyFab입니다. 요청하신 RFQ에 대한 결제가 완료되었습니다.'
                    : '주문 결제가 정상 처리되었습니다.'}
                </p>
                ${paidBeta ? `<p style="line-height: 1.65; font-size: 14px; background: #fff7ed; border-left: 4px solid #f97316; padding: 12px 14px; border-radius: 6px; color: #431407;">
                  현재 <strong>유료 베타</strong> 기간으로, 담당 매니저가 영업일 기준 <strong>1~2일 내</strong>에 제조 파트너 배정 상태를 업데이트해 드릴 예정입니다.
                </p>` : ''}
                <table style="width: 100%; margin: 16px 0; border-collapse: collapse; font-size: 14px;">
                  <tr><td style="padding: 6px 0; color: #6b7280;">주문 번호</td><td style="padding: 6px 0;"><code>${esc(orderId)}</code></td></tr>
                  <tr><td style="padding: 6px 0; color: #6b7280;">Toss 거래</td><td style="padding: 6px 0;"><code>${esc(body.tossOrderId)}</code></td></tr>
                  <tr><td style="padding: 6px 0; color: #6b7280;">결제 금액</td><td style="padding: 6px 0;"><b>${esc(amount)}원</b></td></tr>
                  <tr><td style="padding: 6px 0; color: #6b7280;">결제 일시</td><td style="padding: 6px 0;">${esc(new Date().toLocaleString('ko-KR'))}</td></tr>
                </table>
                <p style="line-height: 1.6; font-size: 13px; color: #6b7280;">
                  결제 금액은 NexyFab 에스크로에 보관되며, 납품 완료 + 검수 후 공장에 정산됩니다.
                </p>
                <div style="margin-top: 24px;">
                  <a href="https://nexyfab.com/ko/nexyfab/orders"
                     style="display: inline-block; padding: 10px 20px; background: #3b82f6; color: white; border-radius: 8px; text-decoration: none; font-weight: 700;">
                    주문 진행 상황 보기 →
                  </a>
                </div>
              </div>
            `,
          });
        }
      } catch (err) {
        console.warn('[payment PATCH] receipt email failed:', err);
        // Non-blocking — payment confirmed regardless.
      }

      // Notify admin (in-app + email) so ops can track deal lifecycle.
      try {
        const { createNotification } = await import('@/app/lib/notify');
        const { sendEmail } = await import('@/lib/email');
        const { esc } = await import('@/lib/html-escape');
        const amount = body.amount.toLocaleString('ko-KR');
        void createNotification(
          'admin',
          'payment_confirmed',
          '결제 완료 — 에스크로 진입',
          `주문 ${orderId.slice(0, 12)}: ${amount}원 결제 완료. 에스크로 received 상태.`,
        );
        const adminEmail = process.env.NEXYFAB_ADMIN_EMAIL;
        if (adminEmail) {
          void sendEmail({
            to: adminEmail,
            subject: `[NexyFab Ops] 결제 완료 — ${orderId.slice(0, 12)}`,
            html: `<p>주문 <code>${esc(orderId)}</code> 결제 완료.<br/>금액: ${esc(amount)}원<br/>Toss: <code>${esc(body.tossOrderId)}</code></p><p>에스크로 자동 'received'. 운영자는 납품 모니터링 후 release 시점 결정.</p>`,
          });
        }
      } catch { /* non-blocking */ }
    } else {
      await db.execute(
        "UPDATE nf_orders SET payment_status = 'pending' WHERE id = ?",
        orderId,
      );
    }
    // Stamp the attempt with final status so the dedup lookup also tells
    // us whether this exact (tossOrderId, paymentKey) succeeded later.
    await db.execute(
      "UPDATE nf_payment_attempts SET status = ?, raw_response = ? WHERE id = ?",
      payment.status === 'DONE' ? 'succeeded' : 'failed',
      JSON.stringify({ status: payment.status }),
      attemptId,
    ).catch(() => {});
    return NextResponse.json({ ok: payment.status === 'DONE', status: payment.status });
  } catch (err) {
    // Toss 실패 시 pending으로 복원 (재시도 가능하게)
    await db.execute(
      "UPDATE nf_orders SET payment_status = 'failed' WHERE id = ?",
      orderId,
    ).catch(() => {});
    await db.execute(
      "UPDATE nf_payment_attempts SET status = 'failed', raw_response = ? WHERE id = ?",
      JSON.stringify({ error: (err as Error).message }), attemptId,
    ).catch(() => {});
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: '결제 승인에 실패했습니다.', detail: errMsg }, { status: 502 });
  }
}
