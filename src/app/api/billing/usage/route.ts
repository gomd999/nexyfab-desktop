/**
 * GET  /api/billing/usage  — current cycle usage + overage costs
 * POST /api/billing/usage  — record a usage event (internal/server-side use)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import {
  recordUsage,
  calculateCycleUsage,
  PLAN_LIMITS,
  USAGE_UNIT_PRICE_KRW,
  type Product,
  type Plan,
} from '@/lib/billing-engine';
import { getDbAdapter } from '@/lib/db-adapter';

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const product = (req.nextUrl.searchParams.get('product') ?? 'nexyfab') as Product;
  const db = getDbAdapter();

  const user = await db.queryOne<{ plan: string }>(
    'SELECT plan FROM nf_users WHERE id = ?', authUser.userId,
  );
  const plan = (user?.plan ?? 'free') as Plan;
  const limits = PLAN_LIMITS[plan];

  // Current cycle date range
  const cycleStart = (() => {
    const d = new Date(); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  })();
  const cycleEnd = (() => {
    const d = new Date(); d.setUTCMonth(d.getUTCMonth() + 1, 1); d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  })();

  const usageItems = await calculateCycleUsage(authUser.userId, product, plan);

  // Raw daily breakdown for charts
  const daily = await db.queryAll<{ day: string; metric: string; quantity: number }>(
    `SELECT
       strftime('%Y-%m-%d', datetime(created_at/1000, 'unixepoch')) as day,
       metric,
       SUM(quantity) as quantity
     FROM nf_usage_events
     WHERE user_id = ? AND product = ? AND cycle_start = ?
     GROUP BY day, metric
     ORDER BY day, metric`,
    authUser.userId, product, cycleStart,
  );

  const totalOverageKrw = usageItems.reduce((sum, i) => sum + i.chargeKrw, 0);

  return NextResponse.json({
    plan,
    product,
    cycleStart,
    cycleEnd,
    usageItems: usageItems.map(item => ({
      ...item,
      limitValue:  limits[item.metric] ?? 0,
      unitPriceKrw: USAGE_UNIT_PRICE_KRW[item.metric] ?? 0,
      usagePct:    limits[item.metric] ? Math.min(100, Math.round((item.used / limits[item.metric]) * 100)) : 0,
    })),
    totalOverageKrw,
    daily,
  });
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Internal service-to-service calls use x-internal-secret header
  const internalSecret = req.headers.get('x-internal-secret');
  const expectedSecret = process.env.INTERNAL_SERVICE_SECRET;

  let userId: string;
  if (internalSecret && expectedSecret && internalSecret === expectedSecret) {
    const body = await req.json() as { userId: string; product: Product; metric: string; quantity?: number; metadata?: string };
    userId = body.userId;
    await recordUsage({
      userId:   body.userId,
      product:  body.product,
      metric:   body.metric,
      quantity: body.quantity,
      metadata: body.metadata,
    });
    return NextResponse.json({ recorded: true });
  }

  // Otherwise require auth
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  userId = authUser.userId;

  const body = await req.json() as { product: Product; metric: string; quantity?: number; metadata?: string };
  await recordUsage({
    userId,
    product:  body.product,
    metric:   body.metric,
    quantity: body.quantity,
    metadata: body.metadata,
  });

  return NextResponse.json({ recorded: true });
}
