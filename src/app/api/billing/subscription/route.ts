/**
 * GET  /api/billing/subscription  — current subscription info
 * POST /api/billing/subscription  — create or upgrade subscription
 * DELETE /api/billing/subscription — cancel subscription
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import {
  ensureAwCustomer,
  PLAN_PRICE_KRW,
  getAwPlanId,
  type Product,
  type Plan,
  recordBillingAnalytics,
} from '@/lib/billing-engine';
import {
  createSubscription,
  cancelSubscription,
  updateSubscriptionPlan,
} from '@/lib/airwallex-client';

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDbAdapter();
  const product = (req.nextUrl.searchParams.get('product') ?? 'nexyfab') as Product;
  const orgId = authUser.orgIds[0] ?? null;

  const [sub, user, invoices] = await Promise.all([
    db.queryOne<{
      id: string; plan: string; status: string;
      current_period_start: number; current_period_end: number;
      aw_subscription_id: string;
    }>(
      orgId
        ? "SELECT * FROM nf_aw_subscriptions WHERE product = ? AND (user_id = ? OR org_id = ?) AND status != 'cancelled' ORDER BY created_at DESC LIMIT 1"
        : "SELECT * FROM nf_aw_subscriptions WHERE user_id = ? AND product = ? AND org_id IS NULL AND status != 'cancelled' ORDER BY created_at DESC LIMIT 1",
      ...(orgId ? [product, authUser.userId, orgId] : [authUser.userId, product]),
    ),
    db.queryOne<{ plan: string; email: string; name: string }>(
      'SELECT plan, email, name FROM nf_users WHERE id = ?',
      authUser.userId,
    ),
    db.queryAll<{ id: string; total_amount_krw: number; status: string; created_at: number }>(
      orgId
        ? 'SELECT id, total_amount_krw, status, created_at FROM nf_aw_invoices WHERE product = ? AND (user_id = ? OR org_id = ?) ORDER BY created_at DESC LIMIT 6'
        : 'SELECT id, total_amount_krw, status, created_at FROM nf_aw_invoices WHERE user_id = ? AND product = ? AND org_id IS NULL ORDER BY created_at DESC LIMIT 6',
      ...(orgId ? [product, authUser.userId, orgId] : [authUser.userId, product]),
    ),
  ]);

  const currentPlan = (user?.plan ?? 'free') as Plan;
  const planPrice   = PLAN_PRICE_KRW[currentPlan];

  // Current cycle usage summary
  const cycleStart = (() => {
    const d = new Date(); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  })();
  const usageSummary = await db.queryAll<{ metric: string; total: number }>(
    'SELECT metric, SUM(quantity) as total FROM nf_usage_events WHERE user_id = ? AND product = ? AND cycle_start = ? GROUP BY metric',
    authUser.userId, product, cycleStart,
  );

  return NextResponse.json({
    subscription: sub ?? null,
    currentPlan,
    planPriceKrw: planPrice,
    usageSummary,
    recentInvoices: invoices,
    availablePlans: Object.entries(PLAN_PRICE_KRW).map(([plan, priceKrw]) => ({
      plan,
      priceKrw,
      isCurrent: plan === currentPlan,
    })),
  });
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as { plan: Plan; product?: Product; trialDays?: number };
  const { plan, product = 'nexyfab', trialDays } = body;

  if (!['pro', 'team', 'enterprise'].includes(plan)) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
  }

  const planId = getAwPlanId(product, plan);
  if (!planId) {
    // No Airwallex plan configured yet — update plan directly (for dev/staging)
    const db = getDbAdapter();
    await db.execute('UPDATE nf_users SET plan = ? WHERE id = ?', plan, authUser.userId);
    return NextResponse.json({ plan, message: 'Plan updated (no payment gateway configured)' });
  }

  const db = getDbAdapter();
  const awCustomerId = await ensureAwCustomer(authUser.userId);

  // Check for existing active subscription to upgrade
  const orgId = authUser.orgIds[0] ?? null;
  const existingSub = await db.queryOne<{ id: string; aw_subscription_id: string }>(
    orgId
      ? "SELECT id, aw_subscription_id FROM nf_aw_subscriptions WHERE product = ? AND (user_id = ? OR org_id = ?) AND status = 'active' ORDER BY created_at DESC LIMIT 1"
      : "SELECT id, aw_subscription_id FROM nf_aw_subscriptions WHERE user_id = ? AND product = ? AND org_id IS NULL AND status = 'active' ORDER BY created_at DESC LIMIT 1",
    ...(orgId ? [product, authUser.userId, orgId] : [authUser.userId, product]),
  );

  const now = Date.now();
  let awSub;

  if (existingSub) {
    // Upgrade/downgrade existing subscription
    awSub = await updateSubscriptionPlan(existingSub.aw_subscription_id, planId);
    await db.execute(
      'UPDATE nf_aw_subscriptions SET plan = ?, aw_subscription_id = ?, updated_at = ? WHERE id = ?',
      plan, awSub.id, now, existingSub.id,
    );
  } else {
    awSub = await createSubscription({
      customerId: awCustomerId,
      planId,
      trialDays,
      metadata: { nexysys_user_id: authUser.userId, product },
    });

    const periodStart = new Date(awSub.current_period_start).getTime();
    const periodEnd   = new Date(awSub.current_period_end).getTime();

    await db.execute(
      `INSERT INTO nf_aw_subscriptions
         (id, user_id, org_id, product, aw_subscription_id, aw_customer_id, plan, status,
          current_period_start, current_period_end, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      `awsub-${crypto.randomUUID()}`,
      authUser.userId, orgId, product, awSub.id, awCustomerId, plan,
      awSub.status, periodStart, periodEnd, now, now,
    );
  }

  // Update user plan (and org plan if applicable)
  await db.execute('UPDATE nf_users SET plan = ? WHERE id = ?', plan, authUser.userId);
  if (orgId) {
    await db.execute('UPDATE nf_orgs SET plan = ? WHERE id = ?', plan, orgId);
  }

  await recordBillingAnalytics({
    eventType: existingSub ? 'subscription.upgraded' : 'subscription.created',
    userId:  authUser.userId,
    product,
    payload: awSub,
  });

  return NextResponse.json({ subscription: awSub, plan }, { status: existingSub ? 200 : 201 });
}

export async function DELETE(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const product = ((await req.json() as { product?: string }).product ?? 'nexyfab') as Product;
  const db = getDbAdapter();
  const orgId = authUser.orgIds[0] ?? null;

  const sub = await db.queryOne<{ id: string; aw_subscription_id: string }>(
    orgId
      ? "SELECT id, aw_subscription_id FROM nf_aw_subscriptions WHERE product = ? AND (user_id = ? OR org_id = ?) AND status = 'active' ORDER BY created_at DESC LIMIT 1"
      : "SELECT id, aw_subscription_id FROM nf_aw_subscriptions WHERE user_id = ? AND product = ? AND org_id IS NULL AND status = 'active' ORDER BY created_at DESC LIMIT 1",
    ...(orgId ? [product, authUser.userId, orgId] : [authUser.userId, product]),
  );
  if (!sub) return NextResponse.json({ error: 'No active subscription' }, { status: 404 });

  const awSub = await cancelSubscription(sub.aw_subscription_id);
  const now   = Date.now();

  await db.execute(
    "UPDATE nf_aw_subscriptions SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?",
    now, now, sub.id,
  );
  await db.execute("UPDATE nf_users SET plan = 'free' WHERE id = ?", authUser.userId);

  await recordBillingAnalytics({
    eventType: 'subscription.cancelled',
    userId: authUser.userId, product,
    payload: awSub,
  });

  return NextResponse.json({ cancelled: true });
}
