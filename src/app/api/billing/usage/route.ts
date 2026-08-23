/**
 * GET  /api/billing/usage  — current cycle usage + overage costs
 * POST /api/billing/usage  — record a usage event (internal/server-side use)
 */
import { NextRequest, NextResponse } from 'next/server';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
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
import { resolveRequestOrgContext } from '@/lib/org-context';

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const product = (req.nextUrl.searchParams.get('product') ?? 'nexyfab') as Product;
  const context = resolveRequestOrgContext(authUser);
  if (!context.ok) return NextResponse.json({ error: 'Select a valid billing context', code: context.code }, { status: 409 });
  const db = getDbAdapter();
  await db.execute('ALTER TABLE nf_usage_events ADD COLUMN org_id TEXT').catch(() => {});
  const plan = (authUser.plan ?? 'free') as Plan;
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

  const usageItems = await calculateCycleUsage(authUser.userId, product, plan, context.orgId);

  // Raw daily breakdown for charts
  const daily = await db.queryAll<{ day: string; metric: string; quantity: number }>(
    `SELECT
       strftime('%Y-%m-%d', datetime(created_at/1000, 'unixepoch')) as day,
       metric,
       SUM(quantity) as quantity
     FROM nf_usage_events
     WHERE ${context.orgId ? 'org_id = ?' : 'user_id = ? AND org_id IS NULL'} AND product = ? AND cycle_start = ?
     GROUP BY day, metric
     ORDER BY day, metric`,
    context.orgId ?? authUser.userId, product, cycleStart,
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

const BILLING_USAGE_JSON_BYTES = 256 * 1024;

async function readUsageBody<T>(req: NextRequest): Promise<T | NextResponse> {
  try { return await readBoundedJson<T>(req, BILLING_USAGE_JSON_BYTES); }
  catch (error) {
    const bodyError = boundedJsonError(error);
    return NextResponse.json(
      { error: bodyError?.code === 'PAYLOAD_TOO_LARGE' ? 'Request body too large' : 'Invalid JSON' },
      { status: bodyError?.status ?? 400 },
    );
  }
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Internal service-to-service calls use x-internal-secret header
  const internalSecret = req.headers.get('x-internal-secret');
  const expectedSecret = process.env.INTERNAL_SERVICE_SECRET;

  let userId: string;
  if (internalSecret && expectedSecret && internalSecret === expectedSecret) {
    const body = await readUsageBody<{ userId: string; orgId?: string | null; product: Product; metric: string; quantity?: number; metadata?: string }>(req);
    if (body instanceof NextResponse) return body;
    userId = body.userId;
    await recordUsage({
      userId:   body.userId,
      orgId:    body.orgId ?? null,
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
  const context = resolveRequestOrgContext(authUser);
  if (!context.ok) return NextResponse.json({ error: 'Select a valid billing context', code: context.code }, { status: 409 });
  userId = authUser.userId;

  const body = await readUsageBody<{ product: Product; metric: string; quantity?: number; metadata?: string }>(req);
  if (body instanceof NextResponse) return body;
  await recordUsage({
    userId,
    orgId:    context.orgId,
    product:  body.product,
    metric:   body.metric,
    quantity: body.quantity,
    metadata: body.metadata,
  });

  return NextResponse.json({ recorded: true });
}
