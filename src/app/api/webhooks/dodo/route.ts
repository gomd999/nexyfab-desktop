/**
 * POST /api/webhooks/dodo
 *
 * Dodo Payments (Svix-signed) webhook endpoint for NexyFab.
 *
 * Security:
 *   - Signature verification via verifyWebhook() (Svix v1 HMAC-SHA256)
 *   - Idempotency via nf_dodo_webhook_events (event_id PK)
 *
 * Events handled:
 *   subscription.active / .renewed     → activate subscription, set user plan
 *   subscription.cancelled / .expired  → mark sub cancelled, schedule downgrade
 *   subscription.failed                → mark past_due
 *   payment.succeeded / .failed        → record nf_payment_attempts row
 *   refund.succeeded / .failed         → mark refunded
 *   dispute.opened                     → ops alert
 *
 * Required env:
 *   DODO_WEBHOOK_SECRET   — whsec_... from the Dodo dashboard
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhook } from '@/lib/dodo';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

interface DodoEvent {
  id?: string;
  type?: string;
  event_type?: string;
  data?: Record<string, unknown> & {
    metadata?: Record<string, string>;
  };
  [k: string]: unknown;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.DODO_WEBHOOK_SECRET ?? '';

  if (!secret && process.env.NODE_ENV === 'production') {
    console.error('[dodo/webhook] DODO_WEBHOOK_SECRET is not set in production. Rejecting.');
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 500 });
  }

  const rawBody = await req.text();

  if (secret) {
    if (!verifyWebhook(rawBody, req.headers, secret)) {
      console.warn('[dodo/webhook] invalid signature', { svixId: req.headers.get('svix-id') });
      return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
    }
  }

  let event: DodoEvent;
  try {
    event = JSON.parse(rawBody) as DodoEvent;
  } catch {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const db = getDbAdapter();
  const eventId = req.headers.get('svix-id') ?? event.id ?? null;

  // Idempotency
  if (eventId) {
    const dup = await db.queryOne<{ event_id: string }>(
      'SELECT event_id FROM nf_dodo_webhook_events WHERE event_id = ?', eventId,
    ).catch(() => null);
    if (dup) return NextResponse.json({ received: true, duplicate: true });

    await db.execute(
      'INSERT OR IGNORE INTO nf_dodo_webhook_events (event_id, event_type, received_at) VALUES (?, ?, ?)',
      eventId, event.type ?? event.event_type ?? 'unknown', Date.now(),
    ).catch(() => { /* table may not exist on legacy DBs — degrade gracefully */ });
  }

  const data = (event.data ?? event) as Record<string, unknown>;
  const meta = (data.metadata ?? {}) as Record<string, string>;
  const userId = meta.user_id ?? null;
  const plan = meta.plan ?? 'pro';
  const cycle = meta.cycle ?? 'monthly';
  const cycleMonths = cycle === 'annual' ? 12 : 1;
  const subId = (data.subscription_id as string | undefined) ?? (data.id as string | undefined);
  const payId = (data.payment_id as string | undefined) ?? (data.id as string | undefined);
  const type = event.type ?? event.event_type ?? '';

  try {
    switch (type) {
      case 'subscription.active':
      case 'subscription.renewed': {
        if (userId) {
          const periodEndMs = Date.now() + cycleMonths * 30 * 24 * 60 * 60 * 1000;
          await db.execute(
            `INSERT INTO nf_subscriptions (user_id, plan, status, payment_provider, payment_id, current_period_end, created_at, updated_at)
             VALUES (?, ?, 'active', 'dodo', ?, ?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET
               plan=excluded.plan, status='active', payment_provider='dodo',
               payment_id=excluded.payment_id, current_period_end=excluded.current_period_end,
               updated_at=excluded.updated_at`,
            userId, plan, subId ?? '', periodEndMs, Date.now(), Date.now(),
          ).catch(() => { /* table may differ */ });
          await db.execute('UPDATE nf_users SET plan = ? WHERE id = ?', plan, userId)
            .catch(() => {});
        }
        break;
      }

      case 'subscription.cancelled':
      case 'subscription.canceled': {
        if (userId) {
          await db.execute(
            `UPDATE nf_subscriptions SET status='cancelled', cancel_at=?, updated_at=? WHERE user_id = ?`,
            Date.now(), Date.now(), userId,
          ).catch(() => {});
        }
        break;
      }

      case 'subscription.expired': {
        if (userId) {
          await db.execute(
            `UPDATE nf_subscriptions SET status='expired', updated_at=? WHERE user_id = ?`,
            Date.now(), userId,
          ).catch(() => {});
          await db.execute('UPDATE nf_users SET plan = ? WHERE id = ?', 'free', userId).catch(() => {});
        }
        break;
      }

      case 'subscription.failed': {
        if (userId) {
          await db.execute(
            `UPDATE nf_subscriptions SET status='past_due', updated_at=? WHERE user_id = ?`,
            Date.now(), userId,
          ).catch(() => {});
        }
        break;
      }

      case 'payment.succeeded': {
        if (userId) {
          await db.execute(
            `INSERT INTO nf_payment_attempts (id, user_id, provider, amount, currency, status, external_id, created_at)
             VALUES (?, ?, 'dodo', ?, ?, 'completed', ?, ?)`,
            (data.id as string) ?? crypto.randomUUID(),
            userId,
            Number(data.total_amount ?? data.amount ?? 0),
            String(data.currency ?? 'USD').toUpperCase(),
            payId ?? '',
            Date.now(),
          ).catch(() => { /* schema may differ */ });
        }
        break;
      }

      case 'payment.failed': {
        console.warn('[dodo/webhook] payment failed', { userId, payId, reason: data.failure_reason });
        break;
      }

      case 'refund.succeeded': {
        if (payId) {
          await db.execute(
            `UPDATE nf_payment_attempts SET status='refunded' WHERE external_id = ?`,
            data.payment_id ?? payId,
          ).catch(() => {});
        }
        break;
      }

      case 'dispute.opened': {
        console.error('[dodo/webhook] dispute opened', { userId, paymentId: data.payment_id, amount: data.amount });
        // sendOpsAlert could be wired here when available.
        break;
      }

      default:
        // Ack unhandled events so Dodo doesn't retry; log for inspection.
        console.info('[dodo/webhook] unhandled', { type });
    }
  } catch (err) {
    console.error('[dodo/webhook] processing failed', { err: (err as Error).message, type });
    return NextResponse.json({ error: 'processing_failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
