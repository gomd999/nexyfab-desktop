/**
 * POST /api/billing/webhook
 * Airwallex webhook endpoint
 *
 * Event types handled:
 * - payment_intent.succeeded
 * - payment_intent.failed
 * - subscription.created
 * - subscription.updated
 * - subscription.cancelled
 * - invoice.paid
 * - invoice.payment_failed
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature } from '@/lib/airwallex-client';
import { getDbAdapter } from '@/lib/db-adapter';
import { handleBillingEvent } from '@/lib/billing-webhook-handler';

// Raw body needed for signature verification — disable body parsing
export const dynamic = 'force-dynamic';

interface AwWebhookEvent {
  id:         string;
  type:       string;
  created_at: string;
  data: {
    object: Record<string, unknown>;
  };
}

export async function POST(req: NextRequest) {
  const rawBody  = await req.text();
  const timestamp = req.headers.get('x-timestamp') ?? '';
  const signature = req.headers.get('x-signature') ?? '';
  const webhookSecret = process.env.AIRWALLEX_WEBHOOK_SECRET ?? '';

  // Production: AIRWALLEX_WEBHOOK_SECRET is mandatory
  if (!webhookSecret && process.env.NODE_ENV === 'production') {
    console.error('[billing/webhook] AIRWALLEX_WEBHOOK_SECRET is not set in production. Rejecting request.');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  // Verify signature whenever a secret is configured
  if (webhookSecret) {
    if (!timestamp || !signature) {
      return NextResponse.json({ error: 'Missing signature headers' }, { status: 401 });
    }
    const valid = await verifyWebhookSignature(rawBody, timestamp, signature, webhookSecret);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  }

  let event: AwWebhookEvent;
  try {
    event = JSON.parse(rawBody) as AwWebhookEvent;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const db = getDbAdapter();

  // Idempotency: check if already processed
  const existing = await db.queryOne<{ id: string }>(
    'SELECT id FROM nf_webhook_events WHERE stripe_event_id = ?',
    event.id,
  ).catch(() => null);

  if (existing) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  // Record in webhook events log — store full payload for reprocessing
  await db.execute(
    `INSERT OR IGNORE INTO nf_webhook_events (id, stripe_event_id, event_type, processed_at, payload)
     VALUES (?, ?, ?, ?, ?)`,
    `wh-${crypto.randomUUID()}`, event.id, event.type, Date.now(), rawBody,
  ).catch(() => {});

  try {
    await handleBillingEvent(event);
  } catch (err) {
    console.error(`[billing/webhook] Error processing ${event.type}:`, err);
    return NextResponse.json({ error: 'Processing error' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
