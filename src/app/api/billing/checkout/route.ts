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
  generateCycleInvoice,
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

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as Record<string, unknown>;
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  const { plan, product, action, period } = parsed.data;
  const isAnnual = period === 'annual';
  const db = getDbAdapter();

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
      const { confirmPayment } = await import('@/lib/toss-client');
      const payment = await confirmPayment(tossPaymentKey, tossOrderId, tossAmount);
      if (payment.status !== 'DONE') {
        return NextResponse.json({ error: `결제 실패: ${payment.status}` }, { status: 400 });
      }
      await activateSubscription(authUser.userId, plan as Plan, product, country, currency, period, db, authUser.orgIds[0]);
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
      const intent = await getPaymentIntent(intentId);
      if (intent.status !== 'SUCCEEDED') {
        return NextResponse.json({ error: `결제 미완료: ${intent.status}` }, { status: 400 });
      }
      await activateSubscription(authUser.userId, plan as Plan, product, country, currency, period, db, authUser.orgIds[0]);
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
         (id, user_id, product, aw_invoice_id, aw_customer_id, plan,
          base_amount_krw, usage_amount_krw, total_amount_krw, currency,
          status, description, country, display_currency, display_amount, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      invoiceId, authUser.userId, product, orderId, awCustomerId ?? '', plan,
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
       (id, user_id, product, aw_invoice_id, aw_customer_id, plan,
        base_amount_krw, usage_amount_krw, total_amount_krw, currency,
        status, description, country, display_currency, display_amount, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    invoiceId, authUser.userId, product, intent.id, awCustomerId, plan,
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
) {
  const now = Date.now();
  const periodStart = now;
  const periodEnd   = period === 'annual'
    ? now + 365 * 86_400_000   // 1년
    : now + 30  * 86_400_000;  // 30일

  // Cancel any existing active subscription for this product
  await db.execute(
    "UPDATE nf_aw_subscriptions SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE user_id = ? AND product = ? AND status = 'active'",
    now, now, userId, product,
  );

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

  // Update user plan (and org plan if applicable)
  await db.execute("UPDATE nf_users SET plan = ? WHERE id = ?", plan, userId);
  if (orgId) {
    await db.execute("UPDATE nf_orgs SET plan = ? WHERE id = ?", plan, orgId);
  }

  // Mark pending invoice as paid
  await db.execute(
    "UPDATE nf_aw_invoices SET status = 'paid', paid_at = ? WHERE user_id = ? AND product = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
    now, userId, product,
  );
}
