/**
 * POST /api/stripe/webhook
 *
 * Stripe webhook handler — hardened for production.
 *
 * Security:
 *   - Signature verification via stripe.webhooks.constructEvent()
 *   - Idempotency via nf_webhook_events table (stripe_event_id unique index)
 *
 * Events handled:
 *   checkout.session.completed    → activate subscription after checkout
 *   customer.subscription.deleted → downgrade user plan to 'free'
 *   invoice.payment_failed        → send email notification (via job queue)
 *
 * Returns 200 immediately; heavy work is enqueued to nf_job_queue.
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY       — sk_live_... or sk_test_...
 *   STRIPE_WEBHOOK_SECRET   — whsec_... from Stripe Dashboard → Webhooks
 */
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getDbAdapter } from '@/lib/db-adapter';
import { enqueueJob } from '@/lib/job-queue';

// Disable body parsing so we can read raw bytes for signature verification
export const dynamic = 'force-dynamic';

// ─── Stripe client ───────────────────────────────────────────────────────────

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  return new Stripe(key, { apiVersion: '2025-02-24.acacia' });
}

// ─── Webhook POST handler ────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? '';

  // In production, webhook secret is mandatory
  if (!webhookSecret && process.env.NODE_ENV === 'production') {
    console.error('[stripe/webhook] STRIPE_WEBHOOK_SECRET is not set in production. Rejecting.');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const rawBody = await req.text();
  const stripeSignature = req.headers.get('stripe-signature') ?? '';

  // ── 1. Signature verification ────────────────────────────────────────────
  let event: Stripe.Event;
  try {
    if (webhookSecret) {
      if (!stripeSignature) {
        return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 401 });
      }
      const stripe = getStripe();
      event = stripe.webhooks.constructEvent(rawBody, stripeSignature, webhookSecret);
    } else {
      // Dev mode without a secret — parse JSON directly (never reached in prod)
      event = JSON.parse(rawBody) as Stripe.Event;
    }
  } catch (err) {
    console.error('[stripe/webhook] Signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const db = getDbAdapter();

  // ── 2. Idempotency: skip already-processed events ────────────────────────
  const existing = await db.queryOne<{ id: string }>(
    'SELECT id FROM nf_webhook_events WHERE stripe_event_id = ?',
    event.id,
  ).catch(() => null);

  if (existing) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  // Record event before processing (idempotency anchor + audit trail)
  await db.execute(
    `INSERT OR IGNORE INTO nf_webhook_events
       (id, stripe_event_id, event_type, processed_at, payload)
     VALUES (?, ?, ?, ?, ?)`,
    `strwh-${crypto.randomUUID()}`,
    event.id,
    event.type,
    Date.now(),
    rawBody,
  ).catch((err: unknown) => {
    console.warn('[stripe/webhook] Could not record event to DB:', err);
  });

  // ── 3. Handle event (heavy work is enqueued, not done inline) ────────────
  try {
    await handleStripeEvent(db, event);
  } catch (err) {
    console.error(`[stripe/webhook] Error handling ${event.type}:`, err);
    // Return 200 so Stripe doesn't retry for code bugs;
    // raw payload is in nf_webhook_events for manual reprocessing.
    return NextResponse.json({
      received: true,
      error: 'Processing error — event stored for retry',
    });
  }

  return NextResponse.json({ received: true });
}

// ─── Event router ────────────────────────────────────────────────────────────

async function handleStripeEvent(
  db: ReturnType<typeof getDbAdapter>,
  event: Stripe.Event,
): Promise<void> {
  switch (event.type) {

    // ── checkout.session.completed ──────────────────────────────────────────
    // Fired when Checkout Session finishes — activate subscription plan.
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerId =
        typeof session.customer === 'string' ? session.customer : session.customer?.id;
      const subscriptionId =
        typeof session.subscription === 'string'
          ? session.subscription
          : (session.subscription as Stripe.Subscription | null)?.id;
      const metadata = session.metadata ?? {};
      const plan = metadata.plan ?? 'pro';
      const userId = metadata.user_id ?? '';

      if (!customerId) break;

      // Link Stripe customer ID to user and set plan
      await db.execute(
        `UPDATE nf_users
            SET plan = ?, stripe_customer_id = ?, updated_at = ?
          WHERE stripe_customer_id = ?
             OR id = ?`,
        plan,
        customerId,
        Date.now(),
        customerId,
        userId,
      );

      // Upsert a subscription record for tracking
      if (subscriptionId) {
        const now = Date.now();
        await db.execute(
          `INSERT OR IGNORE INTO nf_aw_subscriptions
             (id, user_id, aw_subscription_id, status, plan,
              current_period_start, current_period_end, created_at, updated_at)
           VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
          `stripe-sub-${crypto.randomUUID()}`,
          userId,
          subscriptionId,
          plan,
          now,
          now + 30 * 86_400_000,
          now,
          now,
        ).catch((err: unknown) =>
          console.error('[stripe/webhook] checkout sub upsert error:', err),
        );
      }

      console.info(
        `[stripe/webhook] checkout.session.completed — customer=${customerId} plan=${plan}`,
      );
      break;
    }

    // ── customer.subscription.deleted ──────────────────────────────────────
    // Fired when subscription is cancelled or expires — downgrade to free.
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const customerId =
        typeof sub.customer === 'string' ? sub.customer : (sub.customer as Stripe.Customer).id;

      await db.execute(
        `UPDATE nf_users
            SET plan = 'free', updated_at = ?
          WHERE stripe_customer_id = ?`,
        Date.now(),
        customerId,
      );

      await db.execute(
        `UPDATE nf_aw_subscriptions
            SET status = 'cancelled', updated_at = ?
          WHERE aw_subscription_id = ?`,
        Date.now(),
        sub.id,
      ).catch(() => {});

      console.info(
        `[stripe/webhook] customer.subscription.deleted — customer=${customerId} sub=${sub.id}`,
      );
      break;
    }

    // ── invoice.payment_failed ──────────────────────────────────────────────
    // Fired when an invoice charge fails — notify user via async email job.
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId =
        typeof invoice.customer === 'string'
          ? invoice.customer
          : (invoice.customer as Stripe.Customer | null)?.id;

      if (!customerId) break;

      const user = await db.queryOne<{ email: string; name: string | null }>(
        'SELECT email, name FROM nf_users WHERE stripe_customer_id = ?',
        customerId,
      ).catch(() => undefined);

      if (!user?.email) {
        console.warn(
          `[stripe/webhook] invoice.payment_failed — no user for customer=${customerId}`,
        );
        break;
      }

      const displayName = user.name ?? user.email;
      const amount =
        invoice.amount_due != null
          ? `${(invoice.amount_due / 100).toFixed(2)} ${(invoice.currency ?? 'usd').toUpperCase()}`
          : '–';

      // Enqueue email — do NOT await inline so we return 200 to Stripe fast
      await enqueueJob(
        'send_email',
        {
          to: user.email,
          subject: '[NexyFab] 결제에 실패했습니다 — Payment Failed',
          html: `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
  <h2 style="color:#111;margin-bottom:8px">결제 실패 안내 / Payment Failed</h2>
  <p>안녕하세요, ${displayName}님.</p>
  <p>
    NexyFab 구독 결제(<strong>${amount}</strong>)가 실패했습니다.<br/>
    결제 수단을 확인하시고 아래 버튼을 클릭해 업데이트해 주세요.
  </p>
  <a href="https://nexyfab.com/kr/billing"
     style="display:inline-block;margin:20px 0;padding:12px 28px;
            background:#0056ff;color:#fff;border-radius:6px;
            text-decoration:none;font-weight:700;font-size:15px">
    결제 수단 업데이트 →
  </a>
  <p style="color:#555;font-size:14px">
    Hi ${displayName},<br/>
    Your NexyFab subscription payment of <strong>${amount}</strong> failed.<br/>
    Please update your payment method using the button above.
  </p>
  <hr style="margin:24px 0;border:none;border-top:1px solid #eee"/>
  <p style="font-size:12px;color:#aaa">
    Questions? <a href="mailto:support@nexyfab.com" style="color:#0056ff">support@nexyfab.com</a>
  </p>
</div>
          `.trim(),
        },
        { maxAttempts: 3 },
      );

      console.info(`[stripe/webhook] invoice.payment_failed — email queued for ${user.email}`);
      break;
    }

    default:
      console.debug(`[stripe/webhook] Unhandled event type: ${event.type}`);
      break;
  }
}
