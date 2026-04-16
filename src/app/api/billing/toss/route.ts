/**
 * POST /api/billing/toss/confirm   — 결제 승인 (카드/간편결제)
 * POST /api/billing/toss/billing-key — 빌링키 발급 (자동결제)
 * POST /api/billing/toss/webhook   — 토스 웹훅
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import {
  confirmPayment,
  issueBillingKey,
  chargeWithBillingKey,
  verifyTossWebhook,
} from '@/lib/toss-client';
import { recordBillingAnalytics } from '@/lib/billing-engine';
import { z } from 'zod';

const confirmSchema = z.object({
  action:     z.literal('confirm'),
  paymentKey: z.string().min(1),
  orderId:    z.string().min(1),
  amount:     z.number().int().positive(),
  invoiceId:  z.string().optional(),
});

const billingKeySchema = z.object({
  action:      z.literal('billing-key'),
  authKey:     z.string().min(1),
  customerKey: z.string().min(1),
});

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as Record<string, unknown>;
  const db   = getDbAdapter();

  // ── 결제 승인 ────────────────────────────────────────────────────────────
  if (body.action === 'confirm') {
    const parsed = confirmSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

    const payment = await confirmPayment(
      parsed.data.paymentKey,
      parsed.data.orderId,
      parsed.data.amount,
    );

    if (payment.status === 'DONE' && parsed.data.invoiceId) {
      await db.execute(
        "UPDATE nf_aw_invoices SET status = 'paid', paid_at = ? WHERE id = ?",
        Date.now(), parsed.data.invoiceId,
      );
    }

    await recordBillingAnalytics({
      eventType: `toss.payment.${payment.status.toLowerCase()}`,
      userId: authUser.userId, product: 'nexyfab',
      invoiceId: parsed.data.invoiceId,
      payload: payment,
    });

    return NextResponse.json({ payment });
  }

  // ── 빌링키 발급 ──────────────────────────────────────────────────────────
  if (body.action === 'billing-key') {
    const parsed = billingKeySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

    const billingKey = await issueBillingKey(parsed.data.authKey, parsed.data.customerKey);

    // Save billing key for auto-renewal
    const now = Date.now();
    await db.execute(
      `INSERT INTO nf_toss_billing_keys
         (id, user_id, billing_key, customer_key, method, card_info, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE
         SET billing_key = excluded.billing_key,
             customer_key = excluded.customer_key,
             method = excluded.method,
             card_info = excluded.card_info,
             created_at = excluded.created_at`,
      `tbk-${crypto.randomUUID()}`,
      authUser.userId,
      billingKey.billingKey,
      billingKey.customerKey,
      billingKey.method,
      billingKey.card ? JSON.stringify(billingKey.card) : null,
      now,
    ).catch(() => {
      // Table may not exist yet — ignore, will be created by migration
    });

    await recordBillingAnalytics({
      eventType: 'toss.billing_key.issued',
      userId: authUser.userId, product: 'nexyfab',
      payload: { method: billingKey.method, authenticatedAt: billingKey.authenticatedAt },
    });

    return NextResponse.json({ success: true, method: billingKey.method });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}

// ── 토스 웹훅 ────────────────────────────────────────────────────────────────
export async function PUT(req: NextRequest) {
  const rawBody   = await req.text();
  const signature = req.headers.get('x-signature') ?? '';
  const secret    = process.env.TOSS_WEBHOOK_SECRET ?? '';

  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }
  const valid = await verifyTossWebhook(rawBody, signature, secret);
  if (!valid) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });

  let event: { eventType: string; data: { paymentKey?: string; orderId?: string; status?: string } };
  try {
    event = JSON.parse(rawBody) as typeof event;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const db = getDbAdapter();

  // Only mark paid when status is explicitly DONE
  if (
    event.eventType === 'PAYMENT_STATUS_CHANGED' &&
    event.data.status === 'DONE' &&
    event.data.orderId
  ) {
    await db.execute(
      "UPDATE nf_aw_invoices SET status = 'paid', paid_at = ? WHERE aw_invoice_id = ?",
      Date.now(), event.data.orderId,
    ).catch(() => {});
  }

  return NextResponse.json({ received: true });
}
