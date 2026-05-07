import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { onContractCreated } from '@/lib/nexyflow-triggers';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { rateLimit } from '@/lib/rate-limit';
import { recordUsage } from '@/lib/billing-engine';
import type { NexyfabOrder, NexyfabOrderStep } from '@/types/nexyfab-orders';
import { isIncoterm, isValidHsCode, normalizeHsCode } from '@/lib/shipping';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NexyfabOrderRow {
  id: string;
  rfq_id: string | null;
  user_id: string;
  part_name: string;
  manufacturer_name: string;
  quantity: number;
  total_price_krw: number;
  total_price: number | null;
  currency: string | null;
  buyer_country: string | null;
  hs_code: string | null;
  incoterm: string | null;
  ship_from_country: string | null;
  ship_to_country: string | null;
  status: string;
  steps: string; // JSON
  created_at: number;
  estimated_delivery_at: number;
  payment_status: string | null;
  partner_email: string | null;
  tracking_number: string | null;
  tracking_carrier: string | null;
  tracking_last_event: string | null;
  tracking_updated_at: number | null;
}

function rowToOrder(row: NexyfabOrderRow): NexyfabOrder {
  const currency = row.currency ?? 'KRW';
  const totalPrice = row.total_price ?? row.total_price_krw;
  return {
    id: row.id,
    rfqId: row.rfq_id ?? undefined,
    userId: row.user_id,
    partName: row.part_name,
    manufacturerName: row.manufacturer_name,
    quantity: row.quantity,
    totalPriceKRW: row.total_price_krw,
    totalPrice,
    currency,
    buyerCountry: row.buyer_country ?? null,
    hsCode: row.hs_code ?? null,
    incoterm: (row.incoterm as NexyfabOrder['incoterm']) ?? null,
    shipFromCountry: row.ship_from_country ?? null,
    shipToCountry: row.ship_to_country ?? null,
    status: row.status as NexyfabOrder['status'],
    steps: JSON.parse(row.steps) as NexyfabOrderStep[],
    createdAt: row.created_at,
    estimatedDeliveryAt: row.estimated_delivery_at,
    paymentStatus: row.payment_status ?? null,
    partnerEmail: row.partner_email ?? null,
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

const DAY = 86_400_000;

// ─── GET /api/nexyfab/orders ───────────────────────────────────────────────────

const VALID_STATUSES = new Set(['placed', 'production', 'qc', 'shipped', 'delivered']);

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const status = sp.get('status') ?? '';
  const page   = Math.max(1, parseInt(sp.get('page')  ?? '1',  10));
  const limit  = Math.min(100, Math.max(1, parseInt(sp.get('limit') ?? '20', 10)));
  const offset = (page - 1) * limit;

  const statusFilter = status && VALID_STATUSES.has(status) ? status : null;

  const db = getDbAdapter();
  const hasOrg = authUser.orgIds.length > 0;

  // Base WHERE clause
  const userWhere = hasOrg
    ? `(o.user_id = ? OR o.user_id IN (
         SELECT om2.user_id FROM nf_org_members om1
         JOIN nf_org_members om2 ON om2.org_id = om1.org_id
         WHERE om1.user_id = ?))`
    : 'o.user_id = ?';

  const statusClause = statusFilter ? ` AND o.status = ?` : '';
  const baseArgs = hasOrg
    ? [authUser.userId, authUser.userId]
    : [authUser.userId];
  const filterArgs = statusFilter ? [...baseArgs, statusFilter] : baseArgs;

  const [rows, countRow] = await Promise.all([
    db.queryAll<NexyfabOrderRow>(
      `SELECT DISTINCT o.* FROM nf_orders o WHERE ${userWhere}${statusClause} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
      ...filterArgs, limit, offset,
    ),
    db.queryOne<{ total: number }>(
      `SELECT COUNT(DISTINCT o.id) AS total FROM nf_orders o WHERE ${userWhere}${statusClause}`,
      ...filterArgs,
    ),
  ]);

  // 리뷰·이슈 제기 현황 배치 조회 — 배지 과잉 노출 방지 (Phase 7-5c/d)
  const orderIds = rows.map(r => r.id);
  let reviewedSet = new Set<string>();
  let defectSet = new Set<string>();
  if (orderIds.length > 0) {
    const placeholders = orderIds.map(() => '?').join(', ');
    const [reviewRows, defectRows] = await Promise.all([
      db.queryAll<{ contract_id: string }>(
        `SELECT contract_id FROM nf_reviews WHERE contract_id IN (${placeholders})`,
        ...orderIds,
      ).catch((): { contract_id: string }[] => []),
      db.queryAll<{ order_id: string }>(
        `SELECT DISTINCT order_id FROM nf_defects WHERE order_id IN (${placeholders})`,
        ...orderIds,
      ).catch((): { order_id: string }[] => []),
    ]);
    reviewedSet = new Set(reviewRows.map(r => r.contract_id));
    defectSet = new Set(defectRows.map(r => r.order_id));
  }

  return NextResponse.json({
    orders: rows.map(r => ({
      ...rowToOrder(r),
      hasReview: reviewedSet.has(r.id),
      hasDefect: defectSet.has(r.id),
    })),
    total: countRow?.total ?? 0,
    page,
    limit,
  });
}

// ─── POST /api/nexyfab/orders ─────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { checkOrigin } = await import('@/lib/csrf');
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!authUser.emailVerified) {
    return NextResponse.json({ error: '이메일 인증 후 주문이 가능합니다.', code: 'EMAIL_UNVERIFIED' }, { status: 403 });
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
    totalPriceKRW?: number;
    totalPrice?: number;
    currency?: string;
    buyerCountry?: string;
    hsCode?: string;
    incoterm?: string;
    shipFromCountry?: string;
    shipToCountry?: string;
    estimatedLeadDays?: number;
  };

  const currency = (body.currency ?? 'KRW').toUpperCase();
  const totalPrice = body.totalPrice ?? body.totalPriceKRW ?? 0;
  if (!body.partName || !body.manufacturerName || !body.quantity || totalPrice <= 0) {
    return NextResponse.json(
      { error: 'partName, manufacturerName, quantity, totalPrice (or totalPriceKRW) are required' },
      { status: 400 },
    );
  }

  // Backward-compat: keep total_price_krw populated. For non-KRW orders we
  // still store the customer-presented amount in `total_price` and leave KRW
  // as a best-effort snapshot — the canonical source is total_price+currency.
  const totalPriceKRW = body.totalPriceKRW ?? (currency === 'KRW' ? totalPrice : 0);

  // International shipping: validate shape, reject malformed HS codes up front
  // so we don't put garbage on a customs invoice.
  const hsCode = body.hsCode ? normalizeHsCode(body.hsCode) : null;
  if (hsCode && !isValidHsCode(hsCode)) {
    return NextResponse.json({ error: 'hsCode must be 6, 8, or 10 digits.' }, { status: 400 });
  }
  const incoterm = body.incoterm && isIncoterm(body.incoterm) ? body.incoterm : null;
  if (body.incoterm && !incoterm) {
    return NextResponse.json({ error: 'incoterm must be one of EXW, DAP, DDP.' }, { status: 400 });
  }
  const shipFromCountry = body.shipFromCountry?.toUpperCase() ?? null;
  const shipToCountry = body.shipToCountry?.toUpperCase() ?? body.buyerCountry?.toUpperCase() ?? null;

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
      (id, rfq_id, user_id, part_name, manufacturer_name, quantity,
       total_price_krw, total_price, currency, buyer_country,
       hs_code, incoterm, ship_from_country, ship_to_country,
       status, steps, created_at, estimated_delivery_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    body.rfqId ?? null,
    userId,
    body.partName,
    body.manufacturerName,
    body.quantity,
    totalPriceKRW,
    totalPrice,
    currency,
    body.buyerCountry ?? null,
    hsCode,
    incoterm,
    shipFromCountry,
    shipToCountry,
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
    totalPriceKrw: totalPriceKRW,
    quantity: body.quantity,
  }).catch(() => {});

  const order: NexyfabOrder = {
    id,
    rfqId: body.rfqId,
    userId,
    partName: body.partName,
    manufacturerName: body.manufacturerName,
    quantity: body.quantity,
    totalPriceKRW,
    totalPrice,
    currency,
    buyerCountry: body.buyerCountry ?? null,
    hsCode,
    incoterm,
    shipFromCountry,
    shipToCountry,
    status: 'placed',
    steps,
    createdAt: now,
    estimatedDeliveryAt,
  };

  return NextResponse.json({ order }, { status: 201 });
}
