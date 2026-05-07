/**
 * POST /api/nexyfab/orders/[id]/shipping-webhook
 *
 * Carrier-side webhook that posts shipment tracking events. Advances the order
 * status along the placed → production → qc → shipped → delivered chain when
 * corresponding tracking events arrive (e.g. event='delivered' flips the order
 * from 'shipped' to 'delivered'). Also persists the latest tracking number /
 * carrier / event label on the row so the UI can render a concise status line
 * without hitting the carrier API on every page load.
 *
 * Security: HMAC-SHA256 signature over raw body via `X-Shipping-Signature`
 * header (format `sha256=<hex>`), verified against `SHIPPING_WEBHOOK_SECRET`.
 * In non-production without a secret configured the handler still accepts
 * posts so that local dev / smoke tests work; in production the secret is
 * mandatory and requests without a valid signature are rejected.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getDbAdapter } from '@/lib/db-adapter';
import type { NexyfabOrderStatus } from '@/types/nexyfab-orders';

export const dynamic = 'force-dynamic';

type ShippingEvent = 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception';
const VALID_EVENTS = new Set<string>(['in_transit', 'out_for_delivery', 'delivered', 'exception']);
const VALID_CARRIERS = new Set<string>(['cj', 'fedex', 'dhl', 'ems', 'hanjin', 'lotte', 'logen']);

interface WebhookBody {
  trackingNumber?: unknown;
  carrier?: unknown;
  event?: unknown;
  timestamp?: unknown;
  location?: unknown;
  description?: unknown;
}

async function ensureTrackingCols(db: ReturnType<typeof getDbAdapter>) {
  for (const col of [
    'tracking_number TEXT',
    'tracking_carrier TEXT',
    'tracking_last_event TEXT',
    'tracking_updated_at INTEGER',
  ]) {
    await db.execute(`ALTER TABLE nf_orders ADD COLUMN ${col}`).catch(() => {});
  }
}

/** Verify `X-Shipping-Signature: sha256=<hex>` against the raw request body. */
function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const [algo, hex] = header.split('=');
  if (algo !== 'sha256' || !hex) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  if (expected.length !== hex.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(hex, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Given the current order status and an incoming carrier event, return the
 * next status to transition to (forward-only). Null means no transition.
 */
function nextStatusFor(current: NexyfabOrderStatus, event: ShippingEvent): NexyfabOrderStatus | null {
  if (event === 'delivered' && current === 'shipped') return 'delivered';
  // Carrier picked up the package → order is out the door. Fast-forward
  // from production or qc into 'shipped' so the customer sees it moving.
  if ((event === 'in_transit' || event === 'out_for_delivery') && (current === 'production' || current === 'qc')) {
    return 'shipped';
  }
  return null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const secret = process.env.SHIPPING_WEBHOOK_SECRET ?? '';
  const rawBody = await req.text();

  if (secret) {
    const sig = req.headers.get('x-shipping-signature');
    if (!verifySignature(rawBody, sig, secret)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === 'production') {
    console.error('[shipping-webhook] SHIPPING_WEBHOOK_SECRET is not set in production');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  let body: WebhookBody;
  try {
    body = JSON.parse(rawBody) as WebhookBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const trackingNumber = typeof body.trackingNumber === 'string' ? body.trackingNumber.trim() : '';
  const carrierRaw = typeof body.carrier === 'string' ? body.carrier.toLowerCase().trim() : '';
  const eventRaw = typeof body.event === 'string' ? body.event.toLowerCase().trim() : '';
  const timestampRaw = typeof body.timestamp === 'string' ? body.timestamp : null;

  if (!trackingNumber || !carrierRaw || !eventRaw) {
    return NextResponse.json({ error: 'Missing trackingNumber / carrier / event' }, { status: 400 });
  }
  if (!VALID_EVENTS.has(eventRaw)) {
    return NextResponse.json({ error: `Invalid event '${eventRaw}'` }, { status: 400 });
  }
  if (!VALID_CARRIERS.has(carrierRaw)) {
    return NextResponse.json({ error: `Unknown carrier '${carrierRaw}'` }, { status: 400 });
  }

  const event = eventRaw as ShippingEvent;
  const carrier = carrierRaw;
  const eventTs = timestampRaw ? Date.parse(timestampRaw) : Date.now();
  if (Number.isNaN(eventTs)) {
    return NextResponse.json({ error: 'Invalid timestamp' }, { status: 400 });
  }

  const { id: orderId } = await params;
  const db = getDbAdapter();
  await ensureTrackingCols(db);

  const order = await db.queryOne<{
    id: string;
    status: string;
    tracking_number: string | null;
    tracking_updated_at: number | null;
  }>(
    'SELECT id, status, tracking_number, tracking_updated_at FROM nf_orders WHERE id = ?',
    orderId,
  );

  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

  // Idempotency — carriers retry on non-2xx. If an event with the same or
  // earlier timestamp has already been processed for this tracking number,
  // acknowledge without re-applying.
  if (
    order.tracking_number === trackingNumber
    && order.tracking_updated_at != null
    && eventTs <= order.tracking_updated_at
  ) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  const current = order.status as NexyfabOrderStatus;
  const next = nextStatusFor(current, event);
  const now = Date.now();

  if (next) {
    await db.execute(
      `UPDATE nf_orders
         SET status = ?, updated_at = ?,
             tracking_number = ?, tracking_carrier = ?,
             tracking_last_event = ?, tracking_updated_at = ?
       WHERE id = ?`,
      next, now, trackingNumber, carrier, event, eventTs, orderId,
    );
  } else {
    await db.execute(
      `UPDATE nf_orders
         SET tracking_number = ?, tracking_carrier = ?,
             tracking_last_event = ?, tracking_updated_at = ?
       WHERE id = ?`,
      trackingNumber, carrier, event, eventTs, orderId,
    );
  }

  return NextResponse.json({
    received: true,
    statusBefore: current,
    statusAfter: next ?? current,
    trackingNumber,
    carrier,
    event,
  });
}
