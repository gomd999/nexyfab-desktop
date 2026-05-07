/**
 * Shared billing webhook event handler — used by both the Airwallex
 * webhook endpoint (live events) and the admin reprocess endpoint.
 */
import { getDbAdapter } from './db-adapter';
import { recordBillingAnalytics, type Product } from './billing-engine';
import { logAudit } from './audit';
import { recordOrderCompletion } from './stage-engine';

export interface AwWebhookEvent {
  id:         string;
  type:       string;
  created_at: string;
  data: {
    object: Record<string, unknown>;
  };
}

/**
 * Process an Airwallex billing event. Idempotent — safe to call multiple times
 * with the same event (won't double-update if already processed).
 *
 * Returns the event type that was handled, or 'unknown' if not recognised.
 */
export async function handleBillingEvent(event: AwWebhookEvent): Promise<string> {
  const db = getDbAdapter();
  const obj  = event.data.object;
  const meta = (obj.metadata as Record<string, string> | undefined) ?? {};
  const userId  = meta.nexysys_user_id ?? '';
  const product = (meta.product as Product) ?? 'nexyfab';

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const invoiceId = meta.invoice_id;
      if (invoiceId) {
        await db.execute(
          "UPDATE nf_aw_invoices SET status = 'paid', paid_at = ? WHERE id = ? AND status != 'paid'",
          Date.now(), invoiceId,
        );
      }
      // NexyFab order payment (non-KRW Airwallex path). Mirrors what the
      // Toss PATCH handler does locally: flip status to production and
      // mark the order as paid.
      const orderId = meta.nexyfab_order_id;
      if (orderId) {
        const flip = await db.execute(
          `UPDATE nf_orders
              SET payment_status = 'paid',
                  status = CASE WHEN status = 'placed' THEN 'production' ELSE status END,
                  updated_at = ?
            WHERE id = ? AND payment_status != 'paid'`,
          Date.now(), orderId,
        );
        // Stage promotion only on the first paid-flip — guards against
        // duplicate webhook deliveries double-counting cumulative_order_krw.
        if ((flip.changes ?? 0) > 0) {
          const ord = await db.queryOne<{ user_id: string; total_price_krw: number }>(
            'SELECT user_id, total_price_krw FROM nf_orders WHERE id = ?',
            orderId,
          ).catch(() => null);
          if (ord?.user_id) {
            await recordOrderCompletion(ord.user_id, Number(ord.total_price_krw) || 0);
          }
        }
      }
      break;
    }

    case 'payment_intent.failed': {
      const invoiceId = meta.invoice_id;
      if (invoiceId) {
        await db.execute(
          "UPDATE nf_aw_invoices SET status = 'past_due' WHERE id = ? AND status = 'open'",
          invoiceId,
        );
      }
      const orderId = meta.nexyfab_order_id;
      if (orderId) {
        await db.execute(
          "UPDATE nf_orders SET payment_status = 'failed' WHERE id = ?",
          orderId,
        );
      }
      break;
    }

    case 'subscription.updated':
    case 'subscription.created': {
      const awSubId = obj.id as string;
      const status  = obj.status as string;
      const plan    = meta.plan ?? '';
      const periodStart = obj.current_period_start
        ? new Date(obj.current_period_start as string).getTime()
        : Date.now();
      const periodEnd = obj.current_period_end
        ? new Date(obj.current_period_end as string).getTime()
        : Date.now() + 30 * 86_400_000;

      await db.execute(
        `UPDATE nf_aw_subscriptions
         SET status = ?, current_period_start = ?, current_period_end = ?, updated_at = ?
         WHERE aw_subscription_id = ?`,
        status, periodStart, periodEnd, Date.now(), awSubId,
      );
      if (plan && userId) {
        await db.execute('UPDATE nf_users SET plan = ? WHERE id = ?', plan, userId);
      }
      break;
    }

    case 'subscription.cancelled': {
      const awSubId = obj.id as string;
      await db.execute(
        "UPDATE nf_aw_subscriptions SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE aw_subscription_id = ?",
        Date.now(), Date.now(), awSubId,
      );
      if (userId) {
        await db.execute("UPDATE nf_users SET plan = 'free' WHERE id = ?", userId);
      }
      break;
    }

    case 'invoice.paid': {
      const awInvId = obj.id as string;
      await db.execute(
        "UPDATE nf_aw_invoices SET status = 'paid', paid_at = ? WHERE aw_invoice_id = ? AND status != 'paid'",
        Date.now(), awInvId,
      );
      break;
    }

    case 'invoice.payment_failed': {
      const awInvId = obj.id as string;
      await db.execute(
        "UPDATE nf_aw_invoices SET status = 'past_due' WHERE aw_invoice_id = ?",
        awInvId,
      );
      break;
    }

    default:
      return 'unknown';
  }

  await recordBillingAnalytics({
    eventType: `webhook.${event.type}`,
    userId:    userId || 'system',
    product,
    payload:   event,
  }).catch(() => {});

  if (userId) {
    logAudit({ userId, action: `billing.webhook.${event.type}`, resourceId: event.id });
  }

  return event.type;
}
