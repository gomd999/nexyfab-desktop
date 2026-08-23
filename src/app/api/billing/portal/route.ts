/**
 * GET /api/billing/portal
 * Returns billing portal data (plan, usage, invoices) for the billing UI.
 *
 * POST /api/billing/portal/payment-method
 * Create Airwallex payment intent for adding/updating payment method.
 */
import { NextRequest, NextResponse } from 'next/server';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import {
  ensureAwCustomer,
  PLAN_PRICE_KRW,
  PLAN_LIMITS,
  USAGE_UNIT_PRICE_KRW,
  calculateCycleUsage,
  type Product,
  type Plan,
} from '@/lib/billing-engine';
import { createPaymentIntent, toAirwallexAmount } from '@/lib/airwallex-client';
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

  const user = await db.queryOne<{ plan: string; email: string; name: string; created_at: number }>(
    'SELECT plan, email, name, created_at FROM nf_users WHERE id = ?',
    authUser.userId,
  );
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const orgId = context.orgId;
  const org = orgId
    ? await db.queryOne<{ id: string; name: string; plan: string }>(
        'SELECT id, name, plan FROM nf_orgs WHERE id = ?', orgId,
      )
    : null;

  // Plan comes from org if org exists, otherwise from user
  const plan = ((org?.plan ?? user.plan) || 'free') as Plan;

  // Billing queries: scope to org if org exists, otherwise to user
  const billingUserId = authUser.userId;
  const billingOrgId = orgId;
  await db.execute('ALTER TABLE nf_files ADD COLUMN org_id TEXT').catch(() => {});

  const [subscription, invoices, usageItems, storageRow] = await Promise.all([
    // Never mix an organization's billing records with personal records.
    billingOrgId
      ? db.queryOne<{
          id: string; status: string; current_period_start: number; current_period_end: number;
        }>(
          "SELECT id, status, current_period_start, current_period_end FROM nf_aw_subscriptions WHERE org_id = ? AND product = ? AND status != 'cancelled' ORDER BY created_at DESC LIMIT 1",
          billingOrgId, product,
        )
      : db.queryOne<{
          id: string; status: string; current_period_start: number; current_period_end: number;
        }>(
          "SELECT id, status, current_period_start, current_period_end FROM nf_aw_subscriptions WHERE user_id = ? AND product = ? AND org_id IS NULL AND status != 'cancelled' ORDER BY created_at DESC LIMIT 1",
          billingUserId, product,
        ),
    // Invoice history follows the selected context only.
    billingOrgId
      ? db.queryAll<{
          id: string; total_amount_krw: number; status: string; created_at: number; paid_at: number | null; description: string;
        }>(
          'SELECT id, total_amount_krw, status, created_at, paid_at, description FROM nf_aw_invoices WHERE org_id = ? AND product = ? ORDER BY created_at DESC LIMIT 12',
          billingOrgId, product,
        )
      : db.queryAll<{
          id: string; total_amount_krw: number; status: string; created_at: number; paid_at: number | null; description: string;
        }>(
          'SELECT id, total_amount_krw, status, created_at, paid_at, description FROM nf_aw_invoices WHERE user_id = ? AND org_id IS NULL AND product = ? ORDER BY created_at DESC LIMIT 12',
          billingUserId, product,
        ),
    calculateCycleUsage(billingUserId, product, plan, billingOrgId),
    // Storage: aggregate all org members' files if org exists
    billingOrgId
      ? db.queryOne<{ total_bytes: number }>(
          `SELECT COALESCE(SUM(size_bytes), 0) as total_bytes FROM nf_files WHERE org_id = ?`,
          billingOrgId,
        )
      : db.queryOne<{ total_bytes: number }>(
          'SELECT COALESCE(SUM(size_bytes), 0) as total_bytes FROM nf_files WHERE user_id = ? AND org_id IS NULL',
          billingUserId,
        ),
  ]);

  const cycleEnd = (() => {
    const d = new Date(); d.setUTCMonth(d.getUTCMonth() + 1, 1); d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  })();

  const limits = PLAN_LIMITS[plan];

  // Inject storage_gb as a real-time usage item (from nf_files SUM, not event-based)
  const storageBytes = storageRow?.total_bytes ?? 0;
  const storageGbUsed = +(storageBytes / (1024 ** 3)).toFixed(3);
  const storageLimit = limits.storage_gb ?? 1;
  const storageOverage = Math.max(0, Math.ceil(storageGbUsed) - storageLimit);
  const storageChargeKrw = storageOverage * USAGE_UNIT_PRICE_KRW.storage_gb;
  const storageItem = {
    metric: 'storage_gb',
    used: +storageGbUsed.toFixed(2),
    limit: storageLimit,
    overage: storageOverage,
    chargeKrw: storageChargeKrw,
  };
  // Replace any event-based storage_gb with the real-time one
  const allUsageItems = [
    ...usageItems.filter(i => i.metric !== 'storage_gb'),
    storageItem,
  ];

  const totalOverageKrw = allUsageItems.reduce((sum, i) => sum + i.chargeKrw, 0);
  const estimatedTotal  = PLAN_PRICE_KRW[plan] + totalOverageKrw;

  return NextResponse.json({
    user: { email: user.email, name: user.name, memberSince: user.created_at },
    org: org ? { id: org.id, name: org.name } : null,
    plan,
    planPriceKrw:  PLAN_PRICE_KRW[plan],
    subscription:  subscription ?? null,
    invoices,
    usage: {
      items: allUsageItems.map(item => ({
        ...item,
        limit:    limits[item.metric] ?? 0,
        usagePct: limits[item.metric]
          ? Math.min(100, Math.round((item.used / limits[item.metric]) * 100))
          : 0,
      })),
      totalOverageKrw,
    },
    billing: {
      cycleEnd,
      estimatedTotalKrw: estimatedTotal,
      currency: 'KRW',
    },
    availablePlans: Object.entries(PLAN_PRICE_KRW).map(([p, priceKrw]) => ({
      plan: p,
      priceKrw,
      isCurrent: p === plan,
      limits: PLAN_LIMITS[p as Plan],
    })),
  });
}

const BILLING_PORTAL_JSON_BYTES = 64 * 1024;

export async function POST(req: NextRequest) {
  const paymentDenied = denyIfPaymentCollectionDisabled();
  if (paymentDenied) return paymentDenied;
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const context = resolveRequestOrgContext(authUser);
  if (!context.ok) return orgContextError(context.code);

  let body: { action?: string; returnUrl?: string } = {};
  try { body = await readBoundedJson(req, BILLING_PORTAL_JSON_BYTES); }
  catch (error) {
    const bodyError = boundedJsonError(error);
    if (bodyError?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Request body too large' }, { status: bodyError.status });
  }

  if (body.action === 'setup-payment-method') {
    // Create a zero-amount payment intent for card setup
    const awCustomerId = await ensureAwCustomer(authUser.userId);
    const intent = await createPaymentIntent({
      amount:      toAirwallexAmount(0, 'KRW'),
      currency:    'KRW',
      customerId:  awCustomerId,
      description: 'Payment method setup',
      returnUrl:   body.returnUrl,
      metadata: {
        nexysys_user_id: authUser.userId,
        nexysys_org_id: context.orgId ?? 'personal',
        type: 'setup',
      },
    });

    return NextResponse.json({
      clientSecret: intent.client_secret,
      intentId:     intent.id,
    });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
