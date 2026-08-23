/**
 * POST /api/billing/checkout
 *
 * 결제 인텐트 생성 + 클라이언트 결제 파라미터 반환
 *
 * KR 국가:
 *   → Toss Payments 파라미터 반환 (orderId, amount, customerKey, productName)
 *
 * 기타 국가:
 *   → Airwallex Drop-in 파라미터 반환 (intentId, clientSecret, amount, currency)
 *
 * POST /api/billing/checkout/complete (액션: complete)
 *   → 결제 성공 후 인텐트 검증 + 구독 생성/업그레이드 + 플랜 활성화
 */
import { NextRequest, NextResponse } from 'next/server';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import {
  createPaymentIntent,
  getPaymentIntent,
  toAirwallexAmount,
} from '@/lib/airwallex-client';
import {
  ensureAwCustomer,
  generateCycleInvoice as _generateCycleInvoice,
  recordBillingAnalytics,
  type Product,
  type Plan,
  PLAN_PRICE_KRW,
} from '@/lib/billing-engine';
import {
  getPlanPrice,
  getCurrencyForCountry,
  getTaxConfig,
  getPaymentMethodsForCountry,
  ANNUAL_DISCOUNT,
  type CountryCode,
  type CurrencyCode,
} from '@/lib/country-pricing';
import { z } from 'zod';
import { resolveRequestOrgContext } from '@/lib/org-context';
import { denyIfPaymentCollectionDisabled } from '@/lib/payment-gate';

const checkoutSchema = z.object({
  plan:    z.enum(['pro', 'team', 'enterprise']),
  product: z.enum(['nexyfab', 'nexyflow', 'nexywise']).default('nexyfab'),
  action:  z.enum(['create', 'complete']).default('create'),
  period:  z.enum(['monthly', 'annual']).default('monthly'),
  // complete 전용
  intentId:   z.string().optional(),
  tossOrderId: z.string().optional(),
  tossPaymentKey: z.string().optional(),
  tossAmount:  z.number().optional(),
});

const CHECKOUT_JSON_BYTES = 64 * 1024;

export async function POST(req: NextRequest) {
  const paymentDenied = denyIfPaymentCollectionDisabled();
  if (paymentDenied) return paymentDenied;
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown> = {};
  try { body = await readBoundedJson(req, CHECKOUT_JSON_BYTES); }
  catch (error) {
    const bodyError = boundedJsonError(error);
    if (bodyError?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Request body too large' }, { status: bodyError.status });
  }
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  const { plan, product, action, period } = parsed.data;
  const isAnnual = period === 'annual';
  const db = getDbAdapter();
  const context = resolveRequestOrgContext(authUser);
  if (!context.ok) {
    return NextResponse.json({ error: 'Select a valid billing context', code: context.code }, { status: 409 });
  }
  const orgId = context.orgId;

  // ── Get user's billing profile ─────────────────────────────────────────────
  const profile = await db.queryOne<{ country: string; currency: string }>(
    'SELECT country, currency FROM nf_user_billing_profile WHERE user_id = ?',
    authUser.userId,
  );

  const country  = (profile?.country ?? 'KR') as CountryCode;
  // 모든 국가 현지 통화 사용. 미지원 국가는 getCurrencyForCountry → USD fallback.
  const currency = (profile?.currency ?? getCurrencyForCountry(country)) as CurrencyCode;
  const effectiveCurrency: CurrencyCode = currency;

  // ── Local price calculation ────────────────────────────────────────────────
  const basePrice = getPlanPrice(plan, effectiveCurrency);

  const taxCfg   = getTaxConfig(country);
  const taxAmount = taxCfg.included ? 0 : Math.round(basePrice * taxCfg.rate * 100) / 100;
  const total     = Math.round((basePrice + taxAmount) * 100) / 100;

  const planLabel: Record<Plan, string> = {
    free: 'Free', pro: 'Pro', team: 'Team', enterprise: 'Enterprise',
  };
  const productLabel: Record<Product, string> = {
    nexyfab: 'NexyFab', nexyflow: 'NexyFlow', nexywise: 'NexyWise',
  };
  const periodLabel = isAnnual ? '연간 구독 (20% 할인)' : '월 구독';
  const orderName = `${productLabel[product]} ${planLabel[plan as Plan]} ${periodLabel}`;

  // ══════════════════════════════════════════════════════════════════════════
  // ACTION: complete — 결제 완료 후 구독 활성화
  // ══════════════════════════════════════════════════════════════════════════
  if (action === 'complete') {
    const { intentId, tossOrderId, tossPaymentKey, tossAmount } = parsed.data;

    // Toss 결제 확인
    if (tossPaymentKey && tossOrderId && tossAmount != null) {
      if (!await hasPendingCheckoutInvoice(db, tossOrderId, authUser.userId, orgId, product, plan)) {
        return NextResponse.json({ error: 'Checkout does not belong to the active billing context' }, { status: 404 });
      }
      const { confirmPayment } = await import('@/lib/toss-client');
      const payment = await confirmPayment(tossPaymentKey, tossOrderId, tossAmount);
      if (payment.status !== 'DONE') {
        return NextResponse.json({ error: `결제 실패: ${payment.status}` }, { status: 400 });
      }
      await activateSubscription(authUser.userId, plan as Plan, product, country, currency, period, db, orgId, tossOrderId);
      await recordBillingAnalytics({
        eventType: 'checkout.toss.complete',
        userId: authUser.userId,
        product,
        payload: { plan, period, payment: { orderId: payment.orderId, method: payment.method } },
      });
      return NextResponse.json({ ok: true, plan });
    }

    // Airwallex 결제 확인
    if (intentId) {
      if (!await hasPendingCheckoutInvoice(db, intentId, authUser.userId, orgId, product, plan)) {
        return NextResponse.json({ error: 'Checkout does not belong to the active billing context' }, { status: 404 });
      }
      const intent = await getPaymentIntent(intentId);
      if (intent.status !== 'SUCCEEDED') {
        return NextResponse.json({ error: `결제 미완료: ${intent.status}` }, { status: 400 });
      }
      await activateSubscription(authUser.userId, plan as Plan, product, country, currency, period, db, orgId, intentId);
      await recordBillingAnalytics({
        eventType: 'checkout.airwallex.complete',
        userId: authUser.userId,
        product,
        payload: { plan, period, intentId, currency: intent.currency },
      });
      return NextResponse.json({ ok: true, plan });
    }

    return NextResponse.json({ error: 'intentId or toss params required' }, { status: 400 });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ACTION: create — 결제 파라미터 생성
  // ══════════════════════════════════════════════════════════════════════════

  // ── Toss (KR) ──────────────────────────────────────────────────────────────
  if (country === 'KR') {
    const monthlyKrw = PLAN_PRICE_KRW[plan as Plan];
    if (monthlyKrw === 0) return NextResponse.json({ error: 'Free plan requires no payment' }, { status: 400 });

    const krwAmount = isAnnual
      ? Math.round(monthlyKrw * 12 * ANNUAL_DISCOUNT)
      : monthlyKrw;

    const orderId = `nf-${product}-${plan}-${period === 'annual' ? 'y' : 'm'}-${authUser.userId.slice(-6)}-${Date.now()}`;

    // Pre-create invoice record for tracking
    const invoiceId = `awiv-${crypto.randomUUID()}`;
    const now = Date.now();
    const awCustomerId = await ensureAwCustomer(authUser.userId, country).catch(() => null);
    await db.execute(
      `INSERT OR IGNORE INTO nf_aw_invoices
         (id, user_id, org_id, product, aw_invoice_id, aw_customer_id, plan,
          base_amount_krw, usage_amount_krw, total_amount_krw, currency,
          status, description, country, display_currency, display_amount, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      invoiceId, authUser.userId, orgId, product, orderId, awCustomerId ?? '', plan,
      krwAmount, 0, krwAmount, 'KRW', 'pending', orderName,
      country, 'KRW', krwAmount, now,
    );

    return NextResponse.json({
      provider:    'toss',
      orderId,
      invoiceId,
      amount:      krwAmount,
      currency:    'KRW',
      orderName,
      customerKey: `nf-${authUser.userId}`,
    });
  }

  // ── Airwallex (전세계) ────────────────────────────────────────────────────
  const annualTotal = isAnnual
    ? Math.round(total * 12 * ANNUAL_DISCOUNT * 100) / 100
    : total;
  const awAmount    = toAirwallexAmount(annualTotal, effectiveCurrency);
  const awCustomerId = await ensureAwCustomer(authUser.userId, country);

  // Derive local payment method types for this country (Airwallex provider only)
  const localMethods = getPaymentMethodsForCountry(country)
    .filter(m => m.provider === 'airwallex' && m.awMethod)
    .map(m => m.awMethod as string);
  // Always include 'card' as fallback; deduplicate
  const paymentMethodTypes = [...new Set(['card', ...localMethods])];

  const intent = await createPaymentIntent({
    amount:             awAmount,
    currency:           effectiveCurrency,
    customerId:         awCustomerId,
    description:        orderName,
    countryCode:        country,
    paymentMethodTypes,
    returnUrl: `${process.env.NEXT_PUBLIC_BASE_URL ?? ''}/nexyfab/settings/billing?checkout=success`,
    metadata: {
      nexysys_user_id: authUser.userId,
      nexysys_org_id: orgId ?? 'personal',
      product,
      plan,
      period,
      checkout: 'true',
    },
  });

  // Pre-create invoice record
  const invoiceId = `awiv-${crypto.randomUUID()}`;
  const annualKrw = isAnnual
    ? Math.round(PLAN_PRICE_KRW[plan as Plan] * 12 * ANNUAL_DISCOUNT)
    : PLAN_PRICE_KRW[plan as Plan];
  await db.execute(
    `INSERT OR IGNORE INTO nf_aw_invoices
       (id, user_id, org_id, product, aw_invoice_id, aw_customer_id, plan,
        base_amount_krw, usage_amount_krw, total_amount_krw, currency,
        status, description, country, display_currency, display_amount, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    invoiceId, authUser.userId, orgId, product, intent.id, awCustomerId, plan,
    annualKrw, 0, annualKrw, effectiveCurrency,
    'pending', orderName, country, effectiveCurrency, annualTotal, Date.now(),
  );

  await recordBillingAnalytics({
    eventType: 'checkout.airwallex.created',
    userId: authUser.userId,
    product,
    invoiceId,
    payload: { plan, period, intentId: intent.id, currency: effectiveCurrency, amount: annualTotal },
  });

  return NextResponse.json({
    provider:           'airwallex',
    intentId:           intent.id,
    clientSecret:       intent.client_secret,
    invoiceId,
    amount:             annualTotal,
    currency:           effectiveCurrency,
    paymentMethodTypes,
    env:                process.env.AIRWALLEX_ENV === 'prod' ? 'prod' : 'demo',
  });
}

// ── Helper: activate subscription after successful payment ─────────────────

async function activateSubscription(
  userId: string,
  plan: Plan,
  product: Product,
  country: CountryCode,
  currency: CurrencyCode,
  period: 'monthly' | 'annual',
  db: ReturnType<typeof getDbAdapter>,
  orgId?: string | null,
  paymentReference?: string,
) {
  const now = Date.now();
  const periodStart = now;
  const periodEnd   = period === 'annual'
    ? now + 365 * 86_400_000   // 1년
    : now + 30  * 86_400_000;  // 30일

  // Cancel any existing active subscription for this product
  if (orgId) {
    await db.execute(
      "UPDATE nf_aw_subscriptions SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE org_id = ? AND product = ? AND status = 'active'",
      now, now, orgId, product,
    );
  } else {
    await db.execute(
      "UPDATE nf_aw_subscriptions SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE user_id = ? AND org_id IS NULL AND product = ? AND status = 'active'",
      now, now, userId, product,
    );
  }

  // Resolve Airwallex customer ID (idempotent)
  let awCustomerId: string;
  try {
    awCustomerId = await ensureAwCustomer(userId, country);
  } catch {
    // Fallback: look up from DB
    const row = await db.queryOne<{ aw_customer_id: string }>(
      'SELECT aw_customer_id FROM nf_aw_customers WHERE user_id = ?', userId,
    );
    awCustomerId = row?.aw_customer_id ?? `nf-direct-${userId}`;
  }

  // Create new subscription record
  const subId = `awsub-${crypto.randomUUID()}`;
  await db.execute(
    `INSERT INTO nf_aw_subscriptions
       (id, user_id, org_id, product, aw_subscription_id, aw_customer_id, plan, status,
        country, currency, billing_period, current_period_start, current_period_end,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
    subId, userId, orgId ?? null, product,
    subId,        // aw_subscription_id: use internal ID for direct payments
    awCustomerId,
    plan, country, currency,
    period, periodStart, periodEnd, now, now,
  );

  // Read prior plan first so we can fire upgrade_completed exactly once
  // on the free→paid transition (renewals or tier-equal updates skip).
  const priorRow = await db.queryOne<{ plan: string }>(
    'SELECT plan FROM nf_users WHERE id = ?', userId,
  ).catch(() => null);

  if (orgId) await db.execute("UPDATE nf_orgs SET plan = ? WHERE id = ?", plan, orgId);
  else await db.execute("UPDATE nf_users SET plan = ? WHERE id = ?", plan, userId);

  // Funnel: free→paid transition. Fire-and-forget; we're already past the
  // money-touching writes so logging failure must not roll back the plan.
  if (priorRow && priorRow.plan !== plan && (priorRow.plan === 'free' || !priorRow.plan)) {
    void import('@/lib/funnel-logger').then(({ logFunnelEvent }) =>
      logFunnelEvent(userId, {
        eventType: 'upgrade_completed',
        contextType: 'subscription',
        contextId: subId,
        metadata: { fromPlan: priorRow.plan, toPlan: plan, product, period, source: 'checkout-direct' },
      }),
    ).catch(() => { /* swallow */ });
  }

  // Mark pending invoice as paid
  if (paymentReference) {
    await db.execute(
      "UPDATE nf_aw_invoices SET status = 'paid', paid_at = ? WHERE aw_invoice_id = ? AND product = ? AND status = 'pending'",
      now, paymentReference, product,
    );
  }
}

async function hasPendingCheckoutInvoice(
  db: ReturnType<typeof getDbAdapter>,
  paymentReference: string,
  userId: string,
  orgId: string | null,
  product: Product,
  plan: string,
): Promise<boolean> {
  const row = await db.queryOne<{ id: string }>(
    orgId
      ? "SELECT id FROM nf_aw_invoices WHERE aw_invoice_id = ? AND org_id = ? AND product = ? AND plan = ? AND status = 'pending'"
      : "SELECT id FROM nf_aw_invoices WHERE aw_invoice_id = ? AND user_id = ? AND org_id IS NULL AND product = ? AND plan = ? AND status = 'pending'",
    paymentReference,
    orgId ?? userId,
    product,
    plan,
  );
  return Boolean(row);
}
