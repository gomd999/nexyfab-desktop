/**
 * POST /api/nexyfab/orders/[id]/airwallex-intent
 *
 * Creates (or returns the existing) Airwallex PaymentIntent for a non-KRW
 * order. KRW domestic orders still go through /payment (Toss). The split
 * is intentional: Toss gives better KRW economics (카카오/네이버/토스페이)
 * and Airwallex gives the global PM menu (card, Alipay, WeChat, SEPA…).
 *
 * Confirmation is async: the client loads Airwallex Drop-In with the
 * returned `clientSecret`, and the `payment_intent.succeeded` webhook
 * (see /api/billing/webhook) flips the order to `paid` + `production`.
 *
 * Idempotency:
 *   If an intent already exists for this order we return the same
 *   `clientSecret` rather than creating a duplicate charge surface.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { createPaymentIntent, getPaymentIntent, toAirwallexAmount } from '@/lib/airwallex-client';
import { detectCountryFromRequest } from '@/lib/country-pricing';

export const dynamic = 'force-dynamic';

async function ensureCols(db: ReturnType<typeof getDbAdapter>) {
  for (const col of [
    'payment_status TEXT',
    'toss_order_id TEXT',
    'aw_intent_id TEXT',
    'aw_client_secret TEXT',
  ]) {
    await db.execute(`ALTER TABLE nf_orders ADD COLUMN ${col}`).catch(() => {});
  }
}

interface OrderRow {
  id: string;
  user_id: string;
  part_name: string;
  total_price: number | null;
  total_price_krw: number;
  currency: string | null;
  buyer_country: string | null;
  payment_status: string | null;
  aw_intent_id: string | null;
  aw_client_secret: string | null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: orderId } = await params;
  const db = getDbAdapter();
  await ensureCols(db);

  const order = await db.queryOne<OrderRow>(
    `SELECT id, user_id, part_name, total_price, total_price_krw, currency, buyer_country,
            payment_status, aw_intent_id, aw_client_secret
       FROM nf_orders WHERE id = ?`,
    orderId,
  );
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  if (order.user_id !== authUser.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (order.payment_status === 'paid') return NextResponse.json({ error: '이미 결제된 주문입니다.' }, { status: 400 });

  const currency = (order.currency ?? 'KRW').toUpperCase();
  const amount   = order.total_price ?? order.total_price_krw;
  if (!amount || amount <= 0) {
    return NextResponse.json({ error: '주문 금액이 유효하지 않습니다.' }, { status: 400 });
  }

  // Reuse existing intent when possible (idempotent retry on refresh).
  if (order.aw_intent_id && order.aw_client_secret) {
    try {
      const existing = await getPaymentIntent(order.aw_intent_id);
      const done = ['SUCCEEDED', 'CAPTURED'].includes(existing.status);
      if (done) {
        // Webhook hasn't caught up yet — mark locally so the UI unsticks.
        await db.execute(
          "UPDATE nf_orders SET payment_status = 'paid' WHERE id = ? AND payment_status != 'paid'",
          orderId,
        );
        return NextResponse.json({ alreadyPaid: true, status: existing.status });
      }
      return NextResponse.json({
        intentId:     existing.id,
        clientSecret: order.aw_client_secret,
        amount:       existing.amount,
        currency:     existing.currency,
        status:       existing.status,
        reused:       true,
      });
    } catch (err) {
      console.warn(`[airwallex-intent] reuse failed for ${orderId}, creating fresh:`, err);
    }
  }

  const country = order.buyer_country ?? detectCountryFromRequest(req.headers);
  const minorUnits = toAirwallexAmount(amount, currency);

  try {
    const intent = await createPaymentIntent({
      amount:      minorUnits,
      currency,
      customerId:  undefined,
      description: order.part_name.slice(0, 128),
      countryCode: country,
      metadata: {
        product:           'nexyfab',
        nexyfab_order_id:  orderId,
        nexysys_user_id:   order.user_id,
      },
    });

    await db.execute(
      "UPDATE nf_orders SET aw_intent_id = ?, aw_client_secret = ?, payment_status = 'pending' WHERE id = ?",
      intent.id, intent.client_secret, orderId,
    );

    return NextResponse.json({
      intentId:     intent.id,
      clientSecret: intent.client_secret,
      amount:       intent.amount,
      currency:     intent.currency,
      status:       intent.status,
      reused:       false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[airwallex-intent] create failed for ${orderId}:`, msg);
    return NextResponse.json({ error: '결제 인텐트 생성에 실패했습니다.', detail: msg }, { status: 502 });
  }
}
