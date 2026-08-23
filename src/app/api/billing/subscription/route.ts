/**
 * GET  /api/billing/subscription  — current subscription info
 * POST /api/billing/subscription  — create or upgrade subscription
 * DELETE /api/billing/subscription — cancel subscription
 */
import { NextRequest, NextResponse } from 'next/server';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
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
import { resolveRequestOrgContext } from '@/lib/org-context';
import { denyIfPaymentCollectionDisabled } from '@/lib/payment-gate';

function orgContextError(code: 'ORG_CONTEXT_REQUIRED' | 'ORG_CONTEXT_INVALID') {
  return NextResponse.json({ error: 'Select a valid billing context', code }, { status: 409 });
}

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDbAdapter();
  const product = (req.nextUrl.searchParams.get('product') ?? 'nexyfab') as Product;
  const context = resolveRequestOrgContext(authUser);
  if (!context.ok) return orgContextError(context.code);
  const orgId = context.orgId;

  const [sub, user, invoices] = await Promise.all([
    db.queryOne<{
      id: string; plan: string; status: string;
      current_period_start: number; current_period_end: number;
      aw_subscription_id: string;
    }>(
      orgId
        ? "SELECT * FROM nf_aw_subscriptions WHERE product = ? AND org_id = ? AND status != 'cancelled' ORDER BY created_at DESC LIMIT 1"
        : "SELECT * FROM nf_aw_subscriptions WHERE user_id = ? AND product = ? AND org_id IS NULL AND status != 'cancelled' ORDER BY created_at DESC LIMIT 1",
      ...(orgId ? [product, orgId] : [authUser.userId, product]),
    ),
    db.queryOne<{ plan: string; email: string; name: string }>(
      'SELECT plan, email, name FROM nf_users WHERE id = ?',
      authUser.userId,
    ),
    db.queryAll<{ id: string; total_amount_krw: number; status: string; created_at: number }>(
      orgId
        ? 'SELECT id, total_amount_krw, status, created_at FROM nf_aw_invoices WHERE product = ? AND org_id = ? ORDER BY created_at DESC LIMIT 6'
        : 'SELECT id, total_amount_krw, status, created_at FROM nf_aw_invoices WHERE user_id = ? AND product = ? AND org_id IS NULL ORDER BY created_at DESC LIMIT 6',
      ...(orgId ? [product, orgId] : [authUser.userId, product]),
    ),
  ]);

  const currentPlan = (authUser.plan ?? user?.plan ?? 'free') as Plan;
  const planPrice   = PLAN_PRICE_KRW[currentPlan];

  // Current cycle usage summary
  const cycleStart = (() => {
    const d = new Date(); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  })();
  await db.execute('ALTER TABLE nf_usage_events ADD COLUMN org_id TEXT').catch(() => {});
  const usageSummary = await db.queryAll<{ metric: string; total: number }>(
    `SELECT metric, SUM(quantity) as total FROM nf_usage_events WHERE ${orgId ? 'org_id = ?' : 'user_id = ? AND org_id IS NULL'} AND product = ? AND cycle_start = ? GROUP BY metric`,
    orgId ?? authUser.userId, product, cycleStart,
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

const SUBSCRIPTION_JSON_BYTES = 64 * 1024;

export async function POST(req: NextRequest) {
  const paymentDenied = denyIfPaymentCollectionDisabled();
  if (paymentDenied) return paymentDenied;
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const context = resolveRequestOrgContext(authUser);
  if (!context.ok) return orgContextError(context.code);
  const orgId = context.orgId;

  let body: {
    plan?: Plan;
    product?: Product;
    trialDays?: number;
    /** 'immediate' (default, prorate now) or 'next_cycle' (preserve prepaid time). */
    effective?: 'immediate' | 'next_cycle';
    /** Override prorate behavior. Default: true on upgrade-immediate, false on next_cycle. */
    prorate?: boolean;
  } = {};
  try { body = await readBoundedJson(req, SUBSCRIPTION_JSON_BYTES); }
  catch (error) {
    const bodyError = boundedJsonError(error);
    if (bodyError?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Request body too large' }, { status: bodyError.status });
  }
  const { product = 'nexyfab', trialDays, effective = 'immediate', prorate } = body;
  const requestedPlan = body.plan;

  if (!requestedPlan || !['pro', 'team', 'enterprise'].includes(requestedPlan)) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
  }
  const plan: Plan = requestedPlan;

  const planId = getAwPlanId(product, plan);
  if (!planId) {
    // No Airwallex plan configured yet — update plan directly (for dev/staging)
    const db = getDbAdapter();
    if (orgId) await db.execute('UPDATE nf_orgs SET plan = ? WHERE id = ?', plan, orgId);
    else await db.execute('UPDATE nf_users SET plan = ? WHERE id = ?', plan, authUser.userId);
    return NextResponse.json({ plan, message: 'Plan updated (no payment gateway configured)' });
  }

  const db = getDbAdapter();
  const awCustomerId = await ensureAwCustomer(authUser.userId);

  // Check for existing active subscription to upgrade
  const existingSub = await db.queryOne<{ id: string; aw_subscription_id: string }>(
    orgId
      ? "SELECT id, aw_subscription_id FROM nf_aw_subscriptions WHERE product = ? AND org_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1"
      : "SELECT id, aw_subscription_id FROM nf_aw_subscriptions WHERE user_id = ? AND product = ? AND org_id IS NULL AND status = 'active' ORDER BY created_at DESC LIMIT 1",
    ...(orgId ? [product, orgId] : [authUser.userId, product]),
  );

  const now = Date.now();
  let awSub;

  if (existingSub) {
    // Upgrade/downgrade — pass prorate + effective so the gateway either
    // charges the difference now (immediate upgrade) or schedules the plan
    // swap at the period end (downgrade preserving prepaid time).
    awSub = await updateSubscriptionPlan(existingSub.aw_subscription_id, planId, {
      effective,
      prorate: prorate ?? (effective === 'immediate'),
    });
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
  if (orgId) await db.execute('UPDATE nf_orgs SET plan = ? WHERE id = ?', plan, orgId);
  else await db.execute('UPDATE nf_users SET plan = ? WHERE id = ?', plan, authUser.userId);

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
  const context = resolveRequestOrgContext(authUser);
  if (!context.ok) return orgContextError(context.code);

  let cancelBody: { product?: string };
  try { cancelBody = await readBoundedJson(req, SUBSCRIPTION_JSON_BYTES); }
  catch (error) {
    const bodyError = boundedJsonError(error);
    if (bodyError?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Request body too large' }, { status: bodyError.status });
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const product = (cancelBody.product ?? 'nexyfab') as Product;
  const db = getDbAdapter();
  const orgId = context.orgId;

  const sub = await db.queryOne<{ id: string; aw_subscription_id: string }>(
    orgId
      ? "SELECT id, aw_subscription_id FROM nf_aw_subscriptions WHERE product = ? AND org_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1"
      : "SELECT id, aw_subscription_id FROM nf_aw_subscriptions WHERE user_id = ? AND product = ? AND org_id IS NULL AND status = 'active' ORDER BY created_at DESC LIMIT 1",
    ...(orgId ? [product, orgId] : [authUser.userId, product]),
  );
  if (!sub) return NextResponse.json({ error: 'No active subscription' }, { status: 404 });

  const awSub = await cancelSubscription(sub.aw_subscription_id);
  const now   = Date.now();

  await db.execute(
    "UPDATE nf_aw_subscriptions SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?",
    now, now, sub.id,
  );
  if (orgId) await db.execute("UPDATE nf_orgs SET plan = 'free' WHERE id = ?", orgId);
  else await db.execute("UPDATE nf_users SET plan = 'free' WHERE id = ?", authUser.userId);

  await recordBillingAnalytics({
    eventType: 'subscription.cancelled',
    userId: authUser.userId, product,
    payload: awSub,
  });

  return NextResponse.json({ cancelled: true });
}
