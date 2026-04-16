import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { trackShipment, detectCarrier, type Carrier } from '@/lib/shipping-tracker';
import { z } from 'zod';
import { triggerWebhooks } from '@/lib/webhook-delivery';

export const dynamic = 'force-dynamic';

// Lazy-create shipments table
async function ensureTable() {
  const db = getDbAdapter();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_shipments (
      id               TEXT PRIMARY KEY,
      contract_id      TEXT NOT NULL,
      user_id          TEXT NOT NULL,
      carrier          TEXT NOT NULL DEFAULT 'unknown',
      tracking_number  TEXT NOT NULL,
      label            TEXT,
      status           TEXT NOT NULL DEFAULT 'pending',
      last_status_text TEXT,
      events           TEXT NOT NULL DEFAULT '[]',
      estimated_delivery TEXT,
      delivered_at     INTEGER,
      last_checked_at  INTEGER,
      created_at       INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_shipments_contract ON nf_shipments(contract_id);
  `).catch(() => {});
}

// GET /api/contracts/[id]/shipments
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: contractId } = await params;

  await ensureTable();
  const db = getDbAdapter();
  const rows = await db.queryAll<{
    id: string; carrier: string; tracking_number: string; label: string | null;
    status: string; last_status_text: string | null; events: string;
    estimated_delivery: string | null; delivered_at: number | null;
    last_checked_at: number | null; created_at: number;
  }>(
    'SELECT * FROM nf_shipments WHERE contract_id = ? AND user_id = ? ORDER BY created_at DESC',
    contractId, authUser.userId,
  );

  return NextResponse.json({
    shipments: rows.map(r => ({
      id: r.id,
      contractId,
      carrier: r.carrier,
      trackingNumber: r.tracking_number,
      label: r.label,
      status: r.status,
      lastStatusText: r.last_status_text,
      events: JSON.parse(r.events ?? '[]'),
      estimatedDelivery: r.estimated_delivery,
      deliveredAt: r.delivered_at ? new Date(r.delivered_at).toISOString() : null,
      lastCheckedAt: r.last_checked_at ? new Date(r.last_checked_at).toISOString() : null,
      createdAt: new Date(r.created_at).toISOString(),
    })),
  });
}

// POST — register tracking number
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: contractId } = await params;

  const schema = z.object({
    trackingNumber: z.string().min(4).max(50),
    carrier: z.enum(['cj', 'fedex', 'dhl', 'ems', 'unknown']).optional(),
    label: z.string().max(100).optional(),
  });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  const carrier: Carrier = parsed.data.carrier ?? detectCarrier(parsed.data.trackingNumber);

  await ensureTable();
  const db = getDbAdapter();
  const id = `shp-${crypto.randomUUID()}`;
  const now = Date.now();

  // Immediately fetch initial tracking status
  const tracking = await trackShipment(parsed.data.trackingNumber, carrier);

  await db.execute(
    `INSERT INTO nf_shipments
     (id, contract_id, user_id, carrier, tracking_number, label, status, last_status_text, events, estimated_delivery, last_checked_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, contractId, authUser.userId, carrier,
    parsed.data.trackingNumber, parsed.data.label ?? null,
    tracking.status, tracking.rawStatus ?? null,
    JSON.stringify(tracking.events),
    tracking.estimatedDelivery ?? null, now, now,
  );

  // If already delivered, record timestamp
  if (tracking.status === 'delivered') {
    await db.execute('UPDATE nf_shipments SET delivered_at = ? WHERE id = ?', now, id).catch(() => {});
  }

  return NextResponse.json({
    shipment: { id, contractId, carrier, trackingNumber: parsed.data.trackingNumber, status: tracking.status },
  }, { status: 201 });
}

// PATCH — refresh tracking status for a shipment
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: contractId } = await params;

  const { shipmentId } = await req.json().catch(() => ({})) as { shipmentId?: string };
  if (!shipmentId) return NextResponse.json({ error: 'shipmentId required' }, { status: 400 });

  await ensureTable();
  const db = getDbAdapter();
  const row = await db.queryOne<{ id: string; carrier: string; tracking_number: string; status: string }>(
    'SELECT id, carrier, tracking_number, status FROM nf_shipments WHERE id = ? AND contract_id = ? AND user_id = ?',
    shipmentId, contractId, authUser.userId,
  );
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const tracking = await trackShipment(row.tracking_number, row.carrier as Carrier);
  const now = Date.now();
  const wasDelivered = row.status !== 'delivered' && tracking.status === 'delivered';

  await db.execute(
    `UPDATE nf_shipments SET status = ?, last_status_text = ?, events = ?,
     estimated_delivery = ?, last_checked_at = ?
     ${wasDelivered ? ', delivered_at = ?' : ''}
     WHERE id = ?`,
    tracking.status, tracking.rawStatus ?? null,
    JSON.stringify(tracking.events),
    tracking.estimatedDelivery ?? null, now,
    ...(wasDelivered ? [now, shipmentId] : [shipmentId]),
  );

  // Auto-trigger webhook + milestone update when delivered
  if (wasDelivered) {
    triggerWebhooks(authUser.userId, 'milestone.completed', {
      contractId, shipmentId, trackingNumber: row.tracking_number, carrier: row.carrier,
    }).catch(() => {});
  }

  return NextResponse.json({ status: tracking.status, events: tracking.events, lastCheckedAt: new Date(now).toISOString() });
}
