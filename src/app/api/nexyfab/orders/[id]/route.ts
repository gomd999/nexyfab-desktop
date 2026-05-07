import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import type { NexyfabOrderStatus } from '@/types/nexyfab-orders';
import { evaluateStage } from '@/lib/stage-engine';

export const dynamic = 'force-dynamic';

// ─── Types ────────────────────────────────────────────────────────────────────

type OrderStatus = NexyfabOrderStatus;

interface NexyfabOrderRow {
  id: string;
  rfq_id: string | null;
  user_id: string;
  manufacturer_id: string | null;
  part_name: string;
  manufacturer_name: string;
  quantity: number;
  total_price_krw: number;
  status: string;
  steps: string;
  created_at: number;
  estimated_delivery_at: number;
  tracking_number: string | null;
  tracking_carrier: string | null;
  tracking_last_event: string | null;
  tracking_updated_at: number | null;
}

function rowToOrder(row: NexyfabOrderRow) {
  return {
    id: row.id,
    rfqId: row.rfq_id ?? undefined,
    userId: row.user_id,
    manufacturerId: row.manufacturer_id ?? undefined,
    partName: row.part_name,
    manufacturerName: row.manufacturer_name,
    quantity: row.quantity,
    totalPriceKRW: row.total_price_krw,
    status: row.status as OrderStatus,
    steps: JSON.parse(row.steps) as unknown[],
    createdAt: row.created_at,
    estimatedDeliveryAt: row.estimated_delivery_at,
    tracking: row.tracking_number && row.tracking_carrier
      ? {
          number: row.tracking_number,
          carrier: row.tracking_carrier,
          lastEvent: row.tracking_last_event,
          updatedAt: row.tracking_updated_at,
        }
      : null,
  };
}

// Forward-only status transitions
const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus | null> = {
  placed:     'production',
  production: 'qc',
  qc:         'shipped',
  shipped:    'delivered',
  delivered:  null,
};

const ALL_STATUSES = new Set<string>(['placed', 'production', 'qc', 'shipped', 'delivered']);

// ─── GET /api/nexyfab/orders/[id] ─────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const db = getDbAdapter();

  const row = await db.queryOne<NexyfabOrderRow>(
    'SELECT * FROM nf_orders WHERE id = ?',
    id,
  );

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Allow access to order owner or manufacturer
  if (row.user_id !== authUser.userId && row.manufacturer_id !== authUser.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({ order: rowToOrder(row) });
}

// ─── PATCH /api/nexyfab/orders/[id] ──────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { status?: string };

  // Validate status value
  if (!body.status || !ALL_STATUSES.has(body.status)) {
    return NextResponse.json(
      { error: 'Invalid status. Must be one of: production, qc, shipped, delivered' },
      { status: 400 },
    );
  }

  const newStatus = body.status as OrderStatus;
  const db = getDbAdapter();

  const row = await db.queryOne<NexyfabOrderRow>(
    'SELECT * FROM nf_orders WHERE id = ?',
    id,
  );

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Auth check: only the manufacturer or admin can update
  const isAdmin = authUser.roles?.some(r => r.role === 'super_admin' || r.role === 'org_admin');
  if (row.manufacturer_id !== authUser.userId && !isAdmin) {
    // Also allow the order owner to confirm delivery (shipped → delivered)
    if (!(row.user_id === authUser.userId && row.status === 'shipped' && newStatus === 'delivered')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  // Forward-only check
  const currentStatus = row.status as OrderStatus;
  const allowedNext = VALID_TRANSITIONS[currentStatus];

  if (newStatus !== allowedNext) {
    return NextResponse.json(
      {
        error: `Invalid transition: ${currentStatus} → ${newStatus}. Expected next: ${allowedNext ?? 'none (already terminal)'}`,
      },
      { status: 400 },
    );
  }

  const now = Date.now();
  await db.execute(
    'UPDATE nf_orders SET status = ?, updated_at = ? WHERE id = ?',
    newStatus, now, id,
  );

  // Delivery is the operational close-out, not the cash event — metrics
  // were already bumped at payment. Re-evaluate stage as a safety net so
  // any silently-failed payment-time evaluation gets a second chance.
  if (newStatus === 'delivered' && row.user_id) {
    await evaluateStage(row.user_id, 'cumulative_krw').catch(() => {});
  }

  const updated = await db.queryOne<NexyfabOrderRow>(
    'SELECT * FROM nf_orders WHERE id = ?',
    id,
  );

  return NextResponse.json({ order: updated ? rowToOrder(updated) : null });
}
