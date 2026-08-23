// Metered billing cron — runs at the end of each user's billing cycle to
// charge for overage (rfq_submission / render_3d / api_call_1k / etc.).
// Builds + charges the cycle invoice automatically so manual triggers
// are no longer required.

import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { generateCycleInvoice, chargeInvoice, type Product, type Plan } from '@/lib/billing-engine';
import { emailInvoicePdf } from '@/lib/invoice-pdf';
import { denyIfPaymentCollectionDisabled } from '@/lib/payment-gate';

export async function POST(req: NextRequest) {
  const paymentDenied = denyIfPaymentCollectionDisabled();
  if (paymentDenied) return paymentDenied;
  const cronSecret = req.headers.get('x-cron-secret');
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDbAdapter();
  const now = Date.now();

  // Find subscriptions whose current_period_end falls in the next 12 hours
  // — bill them now so renewal + invoice are aligned with the period flip.
  const due = await db.queryAll<{ id: string; user_id: string; plan: string; product: string; aw_customer_id: string }>(
    `SELECT s.id, s.user_id, s.plan, s.product, c.id as aw_customer_id
       FROM nf_aw_subscriptions s
       LEFT JOIN nf_aw_customers c ON c.user_id = s.user_id
      WHERE s.status = 'active'
        AND s.current_period_end >= ?
        AND s.current_period_end < ?`,
    now, now + 12 * 60 * 60 * 1000,
  ).catch(() => []);

  const results: { userId: string; invoiceId?: string; status: string; error?: string }[] = [];

  for (const sub of due) {
    try {
      const result = await generateCycleInvoice(
        sub.user_id,
        sub.product as Product,
        sub.plan as Plan,
      );
      if (result.skipped || !result.invoiceId) {
        results.push({ userId: sub.user_id, status: 'skipped' });
        continue;
      }
      // Pull the user's default payment method (set by /api/billing/
      // payment-methods PUT). Falls back to the env default for legacy users.
      const pm = await db.queryOne<{ default_payment_method_id: string }>(
        'SELECT default_payment_method_id FROM nf_aw_customers WHERE user_id = ?',
        sub.user_id,
      ).catch(() => null);
      const paymentMethodId = pm?.default_payment_method_id ?? process.env.AIRWALLEX_DEFAULT_PM ?? '';
      if (!paymentMethodId) {
        results.push({ userId: sub.user_id, invoiceId: result.invoiceId, status: 'no-payment-method' });
        continue;
      }
      const charge = await chargeInvoice(result.invoiceId, paymentMethodId).catch((err: unknown) => {
        return { error: err instanceof Error ? err.message : String(err) };
      });
      const ok = !('error' in (charge as object));
      if (ok) {
        // Fire-and-forget — receipt with PDF attached.
        void emailInvoicePdf(result.invoiceId);
        results.push({ userId: sub.user_id, invoiceId: result.invoiceId, status: 'charged' });
      } else {
        results.push({
          userId: sub.user_id,
          invoiceId: result.invoiceId,
          status: 'charge-failed',
          error: (charge as { error?: string }).error,
        });
      }
    } catch (err) {
      results.push({
        userId: sub.user_id,
        status: 'invoice-failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ ok: true, processed: due.length, results });
}
