import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { onContractCreated } from '@/lib/nexyflow-triggers';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { rateLimit } from '@/lib/rate-limit';
import { recordUsage } from '@/lib/billing-engine';
import type { NexyfabOrder, NexyfabOrderStep } from '@/types/nexyfab-orders';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NexyfabOrderRow {
  id: string;
  rfq_id: string | null;
  user_id: string;
  part_name: string;
  manufacturer_name: string;
  quantity: number;
  total_price_krw: number;
  status: string;
  steps: string; // JSON
  created_at: number;
  estimated_delivery_at: number;
}

function rowToOrder(row: NexyfabOrderRow): NexyfabOrder {
  return {
    id: row.id,
    rfqId: row.rfq_id ?? undefined,
    userId: row.user_id,
    partName: row.part_name,
    manufacturerName: row.manufacturer_name,
    quantity: row.quantity,
    totalPriceKRW: row.total_price_krw,
    status: row.status as NexyfabOrder['status'],
    steps: JSON.parse(row.steps) as NexyfabOrderStep[],
    createdAt: row.created_at,
    estimatedDeliveryAt: row.estimated_delivery_at,
  };
}

const DAY = 86_400_000;

// ─── GET /api/nexyfab/orders ───────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDbAdapter();
  // 자신의 주문 + 같은 조직 멤버의 주문도 조회 (org 소속 시)
  const hasOrg = authUser.orgIds.length > 0;
  let rows: NexyfabOrderRow[];

  if (hasOrg) {
    rows = await db.queryAll<NexyfabOrderRow>(
      `SELECT DISTINCT o.* FROM nf_orders o
       WHERE o.user_id = ?
          OR o.user_id IN (
            SELECT om2.user_id FROM nf_org_members om1
            JOIN nf_org_members om2 ON om2.org_id = om1.org_id
            WHERE om1.user_id = ?
          )
       ORDER BY o.created_at DESC`,
      authUser.userId, authUser.userId,
    );
  } else {
    rows = await db.queryAll<NexyfabOrderRow>(
      'SELECT * FROM nf_orders WHERE user_id = ? ORDER BY created_at DESC',
      authUser.userId,
    );
  }

  return NextResponse.json({ orders: rows.map(rowToOrder) });
}

// ─── POST /api/nexyfab/orders ─────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { checkOrigin } = await import('@/lib/csrf');
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!rateLimit(`orders-post:${authUser.userId}`, 10, 60_000).allowed) {
    return NextResponse.json({ error: '요청이 너무 많습니다.' }, { status: 429 });
  }

  const body = await req.json() as {
    rfqId?: string;
    userId?: string;
    partName: string;
    manufacturerName: string;
    quantity: number;
    totalPriceKRW: number;
    estimatedLeadDays?: number;
  };

  if (!body.partName || !body.manufacturerName || !body.quantity || !body.totalPriceKRW) {
    return NextResponse.json(
      { error: 'partName, manufacturerName, quantity, totalPriceKRW are required' },
      { status: 400 },
    );
  }

  const leadDays = body.estimatedLeadDays ?? 14;
  const now = Date.now();

  const steps: NexyfabOrderStep[] = [
    { label: 'Order Placed',  labelKo: '주문 완료',  completedAt: now },
    { label: 'In Production', labelKo: '생산 중',    estimatedAt: now + 2 * DAY },
    { label: 'QC',            labelKo: '품질 검사',  estimatedAt: now + (leadDays - 4) * DAY },
    { label: 'Shipped',       labelKo: '배송 시작',  estimatedAt: now + (leadDays - 2) * DAY },
    { label: 'Delivered',     labelKo: '배송 완료',  estimatedAt: now + leadDays * DAY },
  ];

  const id = `ORD-${new Date().getFullYear()}-${randomBytes(3).toString('hex').toUpperCase()}`;
  // Always use authenticated user's ID — never trust userId from request body
  const userId = authUser.userId;
  const estimatedDeliveryAt = now + leadDays * DAY;

  const db = getDbAdapter();
  await db.execute(
    `INSERT INTO nf_orders
      (id, rfq_id, user_id, part_name, manufacturer_name, quantity, total_price_krw, status, steps, created_at, estimated_delivery_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    body.rfqId ?? null,
    userId,
    body.partName,
    body.manufacturerName,
    body.quantity,
    body.totalPriceKRW,
    'placed',
    JSON.stringify(steps),
    now,
    estimatedDeliveryAt,
  );

  // Usage recording (fire-and-forget)
  recordUsage({ userId, product: 'nexyfab', metric: 'order_place', metadata: JSON.stringify({ orderId: id }) }).catch(() => {});

  // NexyFlow 연동: 결재 자동 생성 (fire-and-forget)
  onContractCreated({
    userId,
    contractId: id,
    partName: body.partName,
    manufacturerName: body.manufacturerName,
    totalPriceKrw: body.totalPriceKRW,
    quantity: body.quantity,
  }).catch(() => {});

  const order: NexyfabOrder = {
    id,
    rfqId: body.rfqId,
    userId,
    partName: body.partName,
    manufacturerName: body.manufacturerName,
    quantity: body.quantity,
    totalPriceKRW: body.totalPriceKRW,
    status: 'placed',
    steps,
    createdAt: now,
    estimatedDeliveryAt,
  };

  return NextResponse.json({ order }, { status: 201 });
}
