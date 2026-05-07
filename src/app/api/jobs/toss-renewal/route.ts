export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { chargeWithBillingKey } from '@/lib/toss-client';
import { recordBillingAnalytics, PLAN_PRICE_KRW, type Plan } from '@/lib/billing-engine';

/**
 * POST /api/jobs/toss-renewal
 * Toss 빌링키 자동 갱신 cron job
 *
 * 매일 실행: 만료 임박(24시간 이내) 한국 구독을 자동 충전
 * Schedule: "0 6 * * *" (매일 오전 6시)
 * Auth: CRON_SECRET header OR admin session
 */
export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret');
  const expected = process.env.CRON_SECRET;
  const isAdmin = await verifyAdmin(req);
  const isCron = !!expected && cronSecret === expected;

  if (!isAdmin && !isCron) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDbAdapter();
  const now = Date.now();
  const oneDayFromNow = now + 24 * 60 * 60 * 1000;

  // Find active KR subscriptions expiring within 24 hours that have a Toss billing key
  const expiring = await db.queryAll<{
    sub_id: string;
    user_id: string;
    plan: string;
    product: string;
    billing_period: string;
    current_period_end: number;
    billing_key: string;
    customer_key: string;
    email: string;
    name: string;
  }>(
    `SELECT
       s.id as sub_id, s.user_id, s.plan, s.product, s.billing_period,
       s.current_period_end,
       t.billing_key, t.customer_key,
       u.email, u.name
     FROM nf_aw_subscriptions s
     JOIN nf_toss_billing_keys t ON t.user_id = s.user_id
     JOIN nf_users u ON u.id = s.user_id
     WHERE s.status = 'active'
       AND s.country = 'KR'
       AND s.current_period_end <= ?
       AND s.current_period_end > ?`,
    oneDayFromNow, now - 7 * 24 * 60 * 60 * 1000, // 7일 이상 지난 건 무시
  );

  let renewed = 0;
  let failed = 0;
  const errors: { userId: string; error: string }[] = [];

  for (const sub of expiring) {
    const plan = sub.plan as Plan;
    const isAnnual = sub.billing_period === 'annual';
    const basePrice = PLAN_PRICE_KRW[plan] ?? 0;
    if (basePrice === 0) continue; // free plan, skip

    const amount = isAnnual
      ? Math.round(basePrice * 12 * 0.8) // 20% annual discount
      : basePrice;

    const periodLabel = isAnnual ? '연간' : '월간';
    const orderId = `nf-${sub.product}-${plan}-renew-${sub.user_id.slice(-6)}-${Date.now()}`;
    const orderName = `NexyFab ${plan.charAt(0).toUpperCase() + plan.slice(1)} ${periodLabel} 자동 갱신`;

    try {
      const payment = await chargeWithBillingKey({
        billingKey: sub.billing_key,
        customerKey: sub.customer_key,
        orderId,
        orderName,
        amount,
        customerEmail: sub.email,
        customerName: sub.name,
      });

      if (payment.status === 'DONE') {
        // Extend subscription period
        const newStart = sub.current_period_end;
        const newEnd = isAnnual
          ? newStart + 365 * 86_400_000
          : newStart + 30 * 86_400_000;

        await db.execute(
          `UPDATE nf_aw_subscriptions
           SET current_period_start = ?, current_period_end = ?, updated_at = ?
           WHERE id = ?`,
          newStart, newEnd, now, sub.sub_id,
        );

        // Create invoice record
        const invoiceId = `awiv-${crypto.randomUUID()}`;
        await db.execute(
          `INSERT INTO nf_aw_invoices
             (id, user_id, product, aw_invoice_id, aw_customer_id, plan,
              base_amount_krw, usage_amount_krw, total_amount_krw, currency,
              status, description, country, display_currency, display_amount, paid_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          invoiceId, sub.user_id, sub.product, orderId, '', plan,
          amount, 0, amount, 'KRW',
          'paid', orderName, 'KR', 'KRW', amount, now, now,
        );

        await recordBillingAnalytics({
          eventType: 'toss.renewal.succeeded',
          userId: sub.user_id,
          product: sub.product as 'nexyfab' | 'nexyflow' | 'nexywise',
          invoiceId,
          payload: { plan, period: sub.billing_period, amount, paymentKey: payment.paymentKey },
        });

        renewed++;
      } else {
        throw new Error(`Payment status: ${payment.status}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[toss-renewal] Failed for user ${sub.user_id}:`, msg);
      errors.push({ userId: sub.user_id, error: msg });

      await recordBillingAnalytics({
        eventType: 'toss.renewal.failed',
        userId: sub.user_id,
        product: sub.product as 'nexyfab' | 'nexyflow' | 'nexywise',
        payload: { plan, error: msg },
      });

      failed++;
    }
  }

  console.log(`[toss-renewal] ${expiring.length} candidates, ${renewed} renewed, ${failed} failed`);

  return NextResponse.json({
    ok: true,
    summary: { candidates: expiring.length, renewed, failed, errors },
    processedAt: new Date().toISOString(),
  });
}
