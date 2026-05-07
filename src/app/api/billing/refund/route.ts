export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { createRefund } from '@/lib/airwallex-client';
import { cancelPayment } from '@/lib/toss-client';
import { recordBillingAnalytics } from '@/lib/billing-engine';
import { z } from 'zod';

/**
 * POST /api/billing/refund
 * Admin-only: 환불 처리 (Airwallex or Toss)
 *
 * Body:
 *   invoiceId:  string   — nf_aw_invoices.id
 *   amount?:    number   — 부분 환불 (미입력 시 전액 환불)
 *   reason?:    string   — 환불 사유
 */

const refundSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.number().positive().optional(),
  reason: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  }
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const body = await req.json();
  const parsed = refundSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  const { invoiceId, amount, reason } = parsed.data;
  const db = getDbAdapter();

  // Look up invoice
  const invoice = await db.queryOne<{
    id: string;
    user_id: string;
    product: string;
    aw_invoice_id: string;
    total_amount_krw: number;
    currency: string;
    country: string;
    status: string;
  }>(
    'SELECT id, user_id, product, aw_invoice_id, total_amount_krw, currency, country, status FROM nf_aw_invoices WHERE id = ?',
    invoiceId,
  );

  if (!invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }
  if (invoice.status !== 'paid') {
    return NextResponse.json({ error: `Cannot refund invoice with status: ${invoice.status}` }, { status: 400 });
  }

  const refundAmount = amount ?? invoice.total_amount_krw;
  const isPartial = amount != null && amount < invoice.total_amount_krw;
  const isKorea = invoice.country === 'KR';

  try {
    let refundResult: { id: string; status: string };

    if (isKorea && invoice.aw_invoice_id.startsWith('nf-')) {
      // Toss payment — aw_invoice_id is the orderId, need to find paymentKey
      // Toss cancelPayment needs paymentKey; we stored orderId as aw_invoice_id
      // Look up payment by orderId via Toss API
      const fetch = globalThis.fetch;
      const sk = process.env.TOSS_SECRET_KEY ?? '';
      const authHeader = 'Basic ' + Buffer.from(sk + ':').toString('base64');

      const lookupRes = await fetch(`https://api.tosspayments.com/v1/payments/orders/${invoice.aw_invoice_id}`, {
        headers: { Authorization: authHeader },
      });

      if (!lookupRes.ok) {
        throw new Error(`Toss payment lookup failed: ${lookupRes.status}`);
      }

      const tossPayment = await lookupRes.json() as { paymentKey: string };
      const cancelled = await cancelPayment(
        tossPayment.paymentKey,
        reason ?? '관리자 환불 처리',
        isPartial ? refundAmount : undefined,
      );
      refundResult = { id: tossPayment.paymentKey, status: cancelled.status };
    } else {
      // Airwallex refund — aw_invoice_id is the payment intent ID
      const refund = await createRefund({
        paymentIntentId: invoice.aw_invoice_id,
        amount: isPartial ? refundAmount : undefined,
        reason: reason ?? 'requested_by_customer',
      });
      refundResult = { id: refund.id, status: refund.status };
    }

    // Update invoice status
    const newStatus = isPartial ? 'partial_refund' : 'refunded';
    await db.execute(
      'UPDATE nf_aw_invoices SET status = ? WHERE id = ?',
      newStatus, invoiceId,
    );

    // If full refund, downgrade user to free
    if (!isPartial) {
      await db.execute(
        "UPDATE nf_aw_subscriptions SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE user_id = ? AND product = ? AND status = 'active'",
        Date.now(), Date.now(), invoice.user_id, invoice.product,
      );
      await db.execute(
        "UPDATE nf_users SET plan = 'free' WHERE id = ?",
        invoice.user_id,
      );
    }

    await recordBillingAnalytics({
      eventType: isPartial ? 'refund.partial' : 'refund.full',
      userId: invoice.user_id,
      product: invoice.product as 'nexyfab' | 'nexyflow' | 'nexywise',
      invoiceId,
      payload: { refundId: refundResult.id, amount: refundAmount, reason, provider: isKorea ? 'toss' : 'airwallex' },
    });

    return NextResponse.json({
      ok: true,
      refund: {
        id: refundResult.id,
        status: refundResult.status,
        amount: refundAmount,
        partial: isPartial,
        provider: isKorea ? 'toss' : 'airwallex',
      },
    });
  } catch (err) {
    console.error('[billing/refund] Error:', err);
    return NextResponse.json({
      error: `Refund failed: ${err instanceof Error ? err.message : String(err)}`,
    }, { status: 500 });
  }
}
