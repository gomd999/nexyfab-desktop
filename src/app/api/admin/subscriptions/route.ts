/**
 * GET    /api/admin/subscriptions  — 구독 목록 (필터: status, product, plan, q)
 * PUT    /api/admin/subscriptions  — 플랜 변경 { subscriptionId, plan }
 * DELETE /api/admin/subscriptions  — 구독 취소 { subscriptionId }
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { updateSubscriptionPlan, cancelSubscription } from '@/lib/airwallex-client';

export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) return unauthorized();

  const sp      = req.nextUrl.searchParams;
  const status  = sp.get('status') ?? '';
  const product = sp.get('product') ?? '';
  const plan    = sp.get('plan') ?? '';
  const q       = sp.get('q') ?? '';
  const page    = Math.max(1, parseInt(sp.get('page') ?? '1'));
  const limit   = 50;
  const offset  = (page - 1) * limit;

  const db = getDbAdapter();

  const conditions: string[] = [];
  const params: unknown[]    = [];

  if (status)  { conditions.push("sub.status = ?");  params.push(status); }
  if (product) { conditions.push("sub.product = ?"); params.push(product); }
  if (plan)    { conditions.push("sub.plan = ?");    params.push(plan); }
  if (q) {
    conditions.push("(u.email LIKE ? OR u.name LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [subscriptions, countRow, summary] = await Promise.all([
    db.queryAll<{
      id: string; user_id: string; email: string; name: string;
      product: string; plan: string; status: string;
      country: string; currency: string;
      current_period_start: number; current_period_end: number;
      aw_subscription_id: string; created_at: number; cancelled_at: number | null;
    }>(
      `SELECT sub.id, sub.user_id, u.email, u.name,
              sub.product, sub.plan, sub.status,
              sub.country, sub.currency,
              sub.current_period_start, sub.current_period_end,
              sub.aw_subscription_id, sub.created_at, sub.cancelled_at
       FROM nf_aw_subscriptions sub
       LEFT JOIN nf_users u ON u.id = sub.user_id
       ${where}
       ORDER BY sub.created_at DESC
       LIMIT ? OFFSET ?`,
      ...params, limit, offset,
    ),
    db.queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total
       FROM nf_aw_subscriptions sub
       LEFT JOIN nf_users u ON u.id = sub.user_id
       ${where}`,
      ...params,
    ),
    // Summary stats
    db.queryAll<{ status: string; plan: string; count: number }>(
      `SELECT status, plan, COUNT(*) AS count
       FROM nf_aw_subscriptions
       GROUP BY status, plan`,
    ),
  ]);

  return NextResponse.json({
    subscriptions,
    total:  countRow?.total ?? 0,
    page,
    limit,
    summary,
  });
}

export async function PUT(req: NextRequest) {
  if (!(await verifyAdmin(req))) return unauthorized();

  const { subscriptionId, plan } = await req.json() as {
    subscriptionId?: string;
    plan?: string;
  };

  if (!subscriptionId || !plan) {
    return NextResponse.json({ error: 'subscriptionId and plan required' }, { status: 400 });
  }

  const validPlans = ['free', 'pro', 'team', 'enterprise'];
  if (!validPlans.includes(plan)) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
  }

  const db = getDbAdapter();
  const sub = await db.queryOne<{ aw_subscription_id: string; user_id: string }>(
    'SELECT aw_subscription_id, user_id FROM nf_aw_subscriptions WHERE id = ?',
    subscriptionId,
  );
  if (!sub) return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });

  // Get Airwallex plan ID from env
  const product = (await db.queryOne<{ product: string }>(
    'SELECT product FROM nf_aw_subscriptions WHERE id = ?',
    subscriptionId,
  ))?.product ?? 'nexyfab';
  const awPlanId = process.env[`AIRWALLEX_PLAN_${product.toUpperCase()}_${plan.toUpperCase()}`];

  if (awPlanId && sub.aw_subscription_id) {
    await updateSubscriptionPlan(sub.aw_subscription_id, awPlanId);
  }

  await db.execute(
    'UPDATE nf_aw_subscriptions SET plan = ?, updated_at = ? WHERE id = ?',
    plan, Date.now(), subscriptionId,
  );
  await db.execute(
    "UPDATE nf_users SET plan = ? WHERE id = ?",
    plan, sub.user_id,
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!(await verifyAdmin(req))) return unauthorized();

  const { subscriptionId } = await req.json() as { subscriptionId?: string };
  if (!subscriptionId) return NextResponse.json({ error: 'subscriptionId required' }, { status: 400 });

  const db = getDbAdapter();
  const sub = await db.queryOne<{ aw_subscription_id: string; user_id: string }>(
    'SELECT aw_subscription_id, user_id FROM nf_aw_subscriptions WHERE id = ?',
    subscriptionId,
  );
  if (!sub) return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });

  if (sub.aw_subscription_id) {
    await cancelSubscription(sub.aw_subscription_id).catch(() => {});
  }

  const now = Date.now();
  await db.execute(
    "UPDATE nf_aw_subscriptions SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?",
    now, now, subscriptionId,
  );
  await db.execute(
    "UPDATE nf_users SET plan = 'free' WHERE id = ?",
    sub.user_id,
  );

  return NextResponse.json({ ok: true });
}
