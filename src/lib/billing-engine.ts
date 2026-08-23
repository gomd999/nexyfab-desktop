/**
 * Nexysys Unified Billing Engine (Airwallex)
 *
 * Handles:
 * - Customer provisioning (Airwallex customer ↔ nf_users)
 * - Usage-based billing: track events → calculate charges at cycle end
 * - Invoice creation and charge
 * - Smart retry scheduling (1d → 3d → 7d → failed)
 * - BI analytics: store every payment API response for internal dashboards
 *
 * Products: NexyFab | NexyFlow | NexyWise (shared DB, product-scoped)
 */

import { getDbAdapter } from './db-adapter';
import {
  getCurrencyForCountry,
  getPlanPrice,
  getUsagePrice,
  getTaxConfig,
  detectCountryFromRequest as _detectCountryFromRequest,
  type CountryCode,
  type CurrencyCode,
} from './country-pricing';
import {
  createCustomer,
  createPaymentIntent,
  confirmPaymentIntent,
  createInvoice,
  finalizeInvoice,
  toAirwallexAmount,
  type AwInvoice,
} from './airwallex-client';

// ─── Plan definitions ─────────────────────────────────────────────────────────

export type Product = 'nexyfab' | 'nexyflow' | 'nexywise';
export type Plan = 'free' | 'pro' | 'team' | 'enterprise';

// Monthly base price in KRW
export const PLAN_PRICE_KRW: Record<Plan, number> = {
  free:       0,
  pro:        29_000,
  team:       42_000,
  enterprise: 299_000,
};

// Usage price per unit in KRW
export const USAGE_UNIT_PRICE_KRW: Record<string, number> = {
  rfq_submission:  500,    // NexyFab: per RFQ beyond plan limit
  render_3d:       200,    // NexyFab: per 3D render beyond plan limit
  team_seat:       15_000, // NexyFlow/NexyWise: per extra seat/month
  api_call_1k:     1_000,  // per 1,000 API calls beyond limit
  storage_gb:      84,     // per GB beyond plan storage (≈$0.06 USD/GB)
};

// Free tier limits per product/plan
export const PLAN_LIMITS: Record<Plan, Record<string, number>> = {
  free:       { rfq_submission: 3,  render_3d: 10, team_seat: 1,  api_call_1k: 10,  storage_gb: 1   },
  pro:        { rfq_submission: 30, render_3d: 100, team_seat: 3,  api_call_1k: 100, storage_gb: 10  },
  team:       { rfq_submission: 200, render_3d: 1000, team_seat: 20, api_call_1k: 1000, storage_gb: 50 },
  enterprise: { rfq_submission: 99999, render_3d: 99999, team_seat: 99999, api_call_1k: 99999, storage_gb: 999 },
};

// ─── Airwallex Plan IDs (set in env or Airwallex dashboard) ──────────────────

export function getAwPlanId(product: Product, plan: Plan): string | null {
  const key = `AIRWALLEX_PLAN_${product.toUpperCase()}_${plan.toUpperCase()}`;
  return process.env[key] ?? null;
}

// ─── Customer provisioning ────────────────────────────────────────────────────

export async function ensureAwCustomer(userId: string, country?: string): Promise<string> {
  const db = getDbAdapter();
  const existing = await db.queryOne<{ aw_customer_id: string }>(
    'SELECT aw_customer_id FROM nf_aw_customers WHERE user_id = ?',
    userId,
  );
  if (existing) return existing.aw_customer_id;

  // Get user info
  const user = await db.queryOne<{ email: string; name: string }>(
    'SELECT email, name FROM nf_users WHERE id = ?',
    userId,
  );
  if (!user) throw new Error(`User ${userId} not found`);

  const customer = await createCustomer({
    email:    user.email,
    name:     user.name,
    metadata: { nexysys_user_id: userId, country: country ?? 'KR' },
  });

  const now = Date.now();
  await db.execute(
    'INSERT INTO nf_aw_customers (id, user_id, aw_customer_id, created_at) VALUES (?, ?, ?, ?)',
    `awc-${crypto.randomUUID()}`, userId, customer.id, now,
  );

  await recordBillingAnalytics({
    eventType: 'customer.created',
    userId,
    product: 'nexyfab',
    payload: customer,
  });

  return customer.id;
}

// ─── Usage event tracking ─────────────────────────────────────────────────────

export async function recordUsage(params: {
  userId: string;
  orgId?: string | null;
  product: Product;
  metric: string;         // e.g. 'rfq_submission', 'render_3d', 'team_seat'
  quantity?: number;      // default 1
  metadata?: string;      // JSON string of context
}): Promise<void> {
  const db = getDbAdapter();
  await db.execute('ALTER TABLE nf_usage_events ADD COLUMN org_id TEXT').catch(() => {});
  const now = Date.now();
  // Get current billing cycle start
  const sub = await db.queryOne<{ current_period_start: number }>(
    params.orgId
      ? "SELECT current_period_start FROM nf_aw_subscriptions WHERE org_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1"
      : "SELECT current_period_start FROM nf_aw_subscriptions WHERE user_id = ? AND org_id IS NULL AND status = 'active' ORDER BY created_at DESC LIMIT 1",
    params.orgId ?? params.userId,
  );
  const cycleStart = sub?.current_period_start ?? getCycleStart();

  await db.execute(
    `INSERT INTO nf_usage_events
       (id, user_id, org_id, product, metric, quantity, cycle_start, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    `ue-${crypto.randomUUID()}`,
    params.userId,
    params.orgId ?? null,
    params.product,
    params.metric,
    params.quantity ?? 1,
    cycleStart,
    params.metadata ?? null,
    now,
  );
}

/** Calculate usage for current billing cycle and return overage amounts */
export async function calculateCycleUsage(
  userId: string,
  product: Product,
  plan: Plan,
  orgId?: string | null,
): Promise<{ metric: string; used: number; limit: number; overage: number; chargeKrw: number }[]> {
  const db = getDbAdapter();
  await db.execute('ALTER TABLE nf_usage_events ADD COLUMN org_id TEXT').catch(() => {});
  const cycleStart = getCycleStart();
  const limits = PLAN_LIMITS[plan];

  const rows = await db.queryAll<{ metric: string; total: number }>(
    `SELECT metric, SUM(quantity) as total
     FROM nf_usage_events
     WHERE ${orgId ? 'org_id = ?' : 'user_id = ? AND org_id IS NULL'} AND product = ? AND cycle_start = ?
     GROUP BY metric`,
    orgId ?? userId, product, cycleStart,
  );

  return rows.map(row => {
    const limit  = limits[row.metric] ?? 0;
    const overage = Math.max(0, row.total - limit);
    const unitPrice = USAGE_UNIT_PRICE_KRW[row.metric] ?? 0;
    return {
      metric: row.metric,
      used:   row.total,
      limit,
      overage,
      chargeKrw: overage * unitPrice,
    };
  });
}

// ─── Invoice generation & charge ─────────────────────────────────────────────

export async function generateCycleInvoice(
  userId: string,
  product: Product,
  plan: Plan,
  country?: string,
  orgId?: string | null,
): Promise<{ invoiceId: string; totalKrw: number; totalLocal: number; currency: string; skipped?: boolean }> {
  const db = getDbAdapter();

  // Get user's billing profile country
  const profile = await db.queryOne<{ country: string; currency: string }>(
    'SELECT country, currency FROM nf_user_billing_profile WHERE user_id = ?',
    userId,
  );
  const resolvedCountry = (country ?? profile?.country ?? 'KR') as CountryCode;
  const currency = (profile?.currency ?? getCurrencyForCountry(resolvedCountry)) as CurrencyCode;

  const usageItems = await calculateCycleUsage(userId, product, plan, orgId);
  const usageTotal = usageItems.reduce((sum, i) => sum + i.chargeKrw, 0);
  const basePrice  = PLAN_PRICE_KRW[plan];
  const totalKrw   = basePrice + usageTotal;

  if (totalKrw === 0) return { invoiceId: '', totalKrw: 0, totalLocal: 0, currency, skipped: true };

  // Convert to local currency for display
  const localBasePrice  = getPlanPrice(plan, currency);
  const localUsageTotal = usageItems.reduce((sum, i) => sum + getUsagePrice(i.metric, currency) * i.overage, 0);
  const totalLocal      = Math.round((localBasePrice + localUsageTotal) * 100) / 100;

  // Tax calculation
  const taxCfg    = getTaxConfig(resolvedCountry);
  const taxAmount = taxCfg.included ? 0 : Math.round(totalLocal * taxCfg.rate * 100) / 100;
  const totalWithTax = totalLocal + taxAmount;

  const awCustomerId = await ensureAwCustomer(userId, resolvedCountry);

  const usageDescription = usageItems
    .filter(i => i.overage > 0)
    .map(i => `${i.metric}: +${i.overage} × ${USAGE_UNIT_PRICE_KRW[i.metric]?.toLocaleString()}원`)
    .join(', ');

  const description = [
    `${product} ${plan} plan — ${new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' })}`,
    usageDescription ? `초과 사용: ${usageDescription}` : '',
  ].filter(Boolean).join(' | ');

  const awInvoice: AwInvoice = await createInvoice({
    customerId:  awCustomerId,
    amount:      toAirwallexAmount(totalWithTax, currency),
    currency:    currency,
    description,
    dueDays:     7,
    metadata: {
      nexysys_user_id: userId,
      nexysys_org_id: orgId ?? 'personal',
      product,
      plan,
      base_price_krw:  String(basePrice),
      usage_total_krw: String(usageTotal),
    },
  });

  await finalizeInvoice(awInvoice.id);

  const invoiceId = `awiv-${crypto.randomUUID()}`;
  const now = Date.now();
  await db.execute(
    `INSERT INTO nf_aw_invoices
       (id, user_id, org_id, product, aw_invoice_id, aw_customer_id, plan, base_amount_krw,
        usage_amount_krw, total_amount_krw, currency, status, description,
        country, display_currency, display_amount, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    invoiceId, userId, orgId ?? null, product, awInvoice.id, awCustomerId, plan,
    basePrice, usageTotal, totalKrw, currency, 'open', description,
    resolvedCountry, currency, totalWithTax, now,
  );

  await recordBillingAnalytics({
    eventType: 'invoice.created',
    userId,
    product,
    invoiceId,
    payload: { ...awInvoice, usage_items: usageItems },
  });

  return { invoiceId, totalKrw, totalLocal: totalWithTax, currency };
}

// ─── Payment charge & smart retry ────────────────────────────────────────────

const RETRY_SCHEDULE_DAYS = [1, 3, 7]; // retry on day 1, 3, 7 after failure

export async function chargeInvoice(
  invoiceId: string,
  paymentMethodId: string,
): Promise<{ success: boolean; attemptId: string; requiresAction?: boolean }> {
  const db = getDbAdapter();
  const invoice = await db.queryOne<{
    user_id: string; product: string; aw_invoice_id: string;
    aw_customer_id: string; display_amount: number; currency: string;
  }>(
    'SELECT user_id, product, aw_invoice_id, aw_customer_id, display_amount, currency FROM nf_aw_invoices WHERE id = ?',
    invoiceId,
  );
  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

  // display_amount is in the invoice's local currency (e.g. USD 19.00, KRW 29000)
  const chargeAmount = toAirwallexAmount(invoice.display_amount, invoice.currency);

  const attemptId = `awpa-${crypto.randomUUID()}`;
  const now = Date.now();

  try {
    // Step 1: create the payment intent
    const intent = await createPaymentIntent({
      amount:      chargeAmount,
      currency:    invoice.currency,
      customerId:  invoice.aw_customer_id,
      description: `Invoice ${invoiceId}`,
      metadata:    { invoice_id: invoiceId, nexysys_user_id: invoice.user_id },
    });

    // Step 2: confirm with saved payment method
    const confirmed = await confirmPaymentIntent(intent.id, paymentMethodId);
    const isSuccess       = confirmed.status === 'SUCCEEDED';
    const requiresAction  = confirmed.status === 'REQUIRES_ACTION';
    const attemptStatus   = isSuccess ? 'succeeded' : requiresAction ? 'pending' : 'failed';

    await db.execute(
      `INSERT INTO nf_aw_payment_attempts
         (id, invoice_id, user_id, aw_intent_id, status, attempt_number, attempted_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      attemptId, invoiceId, invoice.user_id, confirmed.id, attemptStatus, now,
    );

    if (isSuccess) {
      await db.execute(
        "UPDATE nf_aw_invoices SET status = 'paid', paid_at = ? WHERE id = ?",
        now, invoiceId,
      );
    }
    // REQUIRES_ACTION: status stays 'open', webhook will update when 3DS completes
    // FAILED: fall through to catch-like handling below

    await recordBillingAnalytics({
      eventType: `payment.${attemptStatus}`,
      userId:    invoice.user_id,
      product:   invoice.product as Product,
      invoiceId,
      payload:   confirmed,
    });

    if (!isSuccess && !requiresAction) {
      // Synchronous failure (e.g. card declined before 3DS) — schedule retry
      const nextRetryAt = Date.now() + RETRY_SCHEDULE_DAYS[0] * 86_400_000;
      await db.execute(
        "UPDATE nf_aw_payment_attempts SET next_retry_at = ? WHERE id = ?",
        nextRetryAt, attemptId,
      );
      await db.execute(
        "UPDATE nf_aw_invoices SET status = 'past_due' WHERE id = ?",
        invoiceId,
      );
      return { success: false, attemptId };
    }

    return { success: isSuccess, attemptId, requiresAction };
  } catch (err) {
    // Network/API error — schedule smart retry
    const nextRetryAt = Date.now() + RETRY_SCHEDULE_DAYS[0] * 86_400_000;

    await db.execute(
      `INSERT INTO nf_aw_payment_attempts
         (id, invoice_id, user_id, aw_intent_id, status, attempt_number, error_message,
          next_retry_at, attempted_at)
       VALUES (?, ?, ?, ?, 'failed', 1, ?, ?, ?)`,
      attemptId, invoiceId, invoice.user_id, null,
      err instanceof Error ? err.message : String(err),
      nextRetryAt, now,
    );

    await db.execute(
      "UPDATE nf_aw_invoices SET status = 'past_due' WHERE id = ?",
      invoiceId,
    );

    await recordBillingAnalytics({
      eventType: 'payment.failed',
      userId:    invoice.user_id,
      product:   invoice.product as Product,
      invoiceId,
      payload:   { error: err instanceof Error ? err.message : String(err) },
    });

    return { success: false, attemptId };
  }
}

/** Process pending smart retries — call this from a cron/background job */
export async function processSmartRetries(paymentMethodId: string): Promise<{
  processed: number; succeeded: number; failed: number;
}> {
  const db = getDbAdapter();
  const now = Date.now();

  // Find invoices with pending retries due now
  const pending = await db.queryAll<{
    invoice_id: string; attempt_number: number; id: string; user_id: string;
    payment_method_id: string | null;
  }>(
    `SELECT pa.invoice_id, pa.attempt_number, pa.id, pa.user_id, pa.payment_method_id
     FROM nf_aw_payment_attempts pa
     INNER JOIN nf_aw_invoices inv ON inv.id = pa.invoice_id
     WHERE pa.status = 'failed'
       AND pa.next_retry_at IS NOT NULL
       AND pa.next_retry_at <= ?
       AND inv.status = 'past_due'
     ORDER BY pa.next_retry_at ASC
     LIMIT 50`,
    now,
  );

  let succeeded = 0;
  let failed    = 0;

  for (const row of pending) {
    const attemptNum = row.attempt_number + 1;

    try {
      const invoice = await db.queryOne<{
        aw_customer_id: string; display_amount: number; currency: string; product: string;
      }>(
        'SELECT aw_customer_id, display_amount, currency, product FROM nf_aw_invoices WHERE id = ?',
        row.invoice_id,
      );
      if (!invoice) continue;

      const intent = await createPaymentIntent({
        amount:      toAirwallexAmount(invoice.display_amount, invoice.currency),
        currency:    invoice.currency,
        customerId:  invoice.aw_customer_id,
        description: `Retry #${attemptNum} — Invoice ${row.invoice_id}`,
        metadata:    { invoice_id: row.invoice_id, retry_attempt: String(attemptNum) },
      });

      // Confirm with the same payment method stored on the customer
      const confirmed = await confirmPaymentIntent(intent.id, row.payment_method_id ?? paymentMethodId);
      if (confirmed.status !== 'SUCCEEDED') throw new Error(`Confirm status: ${confirmed.status}`);

      const retryId = `awpa-${crypto.randomUUID()}`;
      await db.execute(
        `INSERT INTO nf_aw_payment_attempts
           (id, invoice_id, user_id, aw_intent_id, status, attempt_number, attempted_at)
         VALUES (?, ?, ?, ?, 'succeeded', ?, ?)`,
        retryId, row.invoice_id, row.user_id, confirmed.id, attemptNum, now,
      );

      await db.execute("UPDATE nf_aw_invoices SET status = 'paid', paid_at = ? WHERE id = ?", now, row.invoice_id);

      // Clear retry from previous attempt
      await db.execute("UPDATE nf_aw_payment_attempts SET next_retry_at = NULL WHERE id = ?", row.id);

      await recordBillingAnalytics({
        eventType: `payment.retry_succeeded.attempt_${attemptNum}`,
        userId: row.user_id, product: invoice.product as Product,
        invoiceId: row.invoice_id, payload: intent,
      });

      // Notify user of successful recovery so they know the issue is resolved.
      void sendDunningEmail(row.user_id, 'recovered', row.invoice_id, attemptNum)
        .catch(err => console.warn('[dunning] recovered mail failed:', err));

      succeeded++;
    } catch (err) {
      // Schedule next retry or mark as permanently failed.
      // attemptNum is 1-indexed: 2 = first retry, 3 = second retry, 4 = third retry.
      // RETRY_SCHEDULE_DAYS[0]=D+1, [1]=D+3, [2]=D+7, [3]=undefined → permanently failed.
      // After attemptNum-th attempt fails, next offset is at index (attemptNum - 1).
      const nextDayOffset = RETRY_SCHEDULE_DAYS[attemptNum - 1];
      const nextRetryAt   = nextDayOffset ? Date.now() + nextDayOffset * 86_400_000 : null;

      const retryId = `awpa-${crypto.randomUUID()}`;
      await db.execute(
        `INSERT INTO nf_aw_payment_attempts
           (id, invoice_id, user_id, aw_intent_id, status, attempt_number, error_message,
            next_retry_at, attempted_at)
         VALUES (?, ?, ?, ?, 'failed', ?, ?, ?, ?)`,
        retryId, row.invoice_id, row.user_id, null, attemptNum,
        err instanceof Error ? err.message : String(err),
        nextRetryAt, now,
      );

      if (!nextRetryAt) {
        // No more retries → mark invoice as uncollectible.
        await db.execute("UPDATE nf_aw_invoices SET status = 'uncollectible' WHERE id = ?", row.invoice_id);
        // Final notice — account is now at risk of downgrade.
        void sendDunningEmail(row.user_id, 'final', row.invoice_id, attemptNum)
          .catch(err => console.warn('[dunning] final mail failed:', err));
      } else {
        // Retry scheduled — keep the user informed at each attempt so they
        // can fix the card before time runs out.
        void sendDunningEmail(row.user_id, `attempt_${attemptNum}` as DunningStage, row.invoice_id, attemptNum, nextRetryAt)
          .catch(err => console.warn('[dunning] attempt mail failed:', err));
      }

      await db.execute("UPDATE nf_aw_payment_attempts SET next_retry_at = NULL WHERE id = ?", row.id);

      failed++;
    }
  }

  return { processed: pending.length, succeeded, failed };
}

// ─── Dunning email ────────────────────────────────────────────────────────
// Stripe Smart Retries equivalent — notify the user at each retry attempt
// so they have a chance to fix the card before the subscription suspends.

export type DunningStage = 'attempt_2' | 'attempt_3' | 'attempt_4' | 'final' | 'recovered';

const DUNNING_COPY: Record<DunningStage, { subject: string; preheader: string; cta: string; tone: 'info' | 'warn' | 'error' | 'success' }> = {
  attempt_2: {
    subject: '[NexyFab] 결제 실패 — 카드를 확인해주세요',
    preheader: '다음 청구 시도까지 2일 남았습니다.',
    cta: '결제 수단 업데이트',
    tone: 'warn',
  },
  attempt_3: {
    subject: '[NexyFab] 결제 재시도 실패 — 두 번째 안내',
    preheader: '카드를 업데이트하지 않으면 4일 후 마지막 시도가 진행됩니다.',
    cta: '지금 카드 변경',
    tone: 'warn',
  },
  attempt_4: {
    subject: '[NexyFab] ⚠ 최종 결제 시도 안내',
    preheader: '카드를 업데이트하지 않으면 곧 구독이 일시 중지됩니다.',
    cta: '카드 즉시 업데이트',
    tone: 'error',
  },
  final: {
    subject: '[NexyFab] 결제 미수금 — 구독이 일시 중지되었습니다',
    preheader: '미납 인보이스를 결제하면 즉시 복구됩니다.',
    cta: '미납 인보이스 결제',
    tone: 'error',
  },
  recovered: {
    subject: '[NexyFab] ✓ 결제 정상 처리 — 구독이 복구되었습니다',
    preheader: '걱정 마세요, 모든 기능이 정상 작동합니다.',
    cta: '청구 내역 보기',
    tone: 'success',
  },
};

export async function sendDunningEmail(
  userId: string,
  stage: DunningStage,
  invoiceId: string,
  attemptNumber: number,
  nextRetryAt?: number | null,
): Promise<void> {
  const db = getDbAdapter();
  const user = await db.queryOne<{ email: string; name: string; language: string | null }>(
    'SELECT email, name, language FROM nf_users WHERE id = ?',
    userId,
  );
  if (!user) return;

  const invoice = await db.queryOne<{ id: string; display_amount: number; currency: string; product: string }>(
    'SELECT id, display_amount, currency, product FROM nf_aw_invoices WHERE id = ?',
    invoiceId,
  );
  if (!invoice) return;

  const copy = DUNNING_COPY[stage];
  const toneColor =
    copy.tone === 'success' ? '#10b981'
    : copy.tone === 'error' ? '#ef4444'
    : copy.tone === 'warn' ? '#f59e0b'
    : '#60a5fa';

  const portalUrl = (process.env.NEXT_PUBLIC_NEXYFAB_URL ?? 'https://nexyfab.com') + '/kr/nexyfab/billing';
  const amountLabel = invoice.currency === 'KRW'
    ? `₩${Math.round(invoice.display_amount).toLocaleString()}`
    : `${invoice.currency} ${invoice.display_amount.toFixed(2)}`;
  const retryLabel = nextRetryAt
    ? new Date(nextRetryAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' })
    : null;

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#0f0f0f;font-family:-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 0;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:12px;border:1px solid #2a2a2a;overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:32px 40px;border-bottom:3px solid ${toneColor};">
          <span style="font-size:22px;font-weight:700;color:#60a5fa;">NexyFab</span>
          <span style="font-size:22px;font-weight:300;color:#94a3b8;"> — 결제 안내</span>
        </td></tr>
        <tr><td style="padding:32px 40px;">
          <p style="color:#94a3b8;font-size:12px;margin:0 0 8px;">${copy.preheader}</p>
          <h1 style="color:${toneColor};font-size:18px;font-weight:700;margin:0 0 16px;">${copy.subject.replace('[NexyFab] ', '')}</h1>
          <p style="color:#e2e8f0;font-size:14px;line-height:1.6;margin:0 0 16px;">
            ${user.name} 님, NexyFab ${invoice.product} 구독의 결제(${amountLabel})가 처리되지 않았습니다.
          </p>
          ${retryLabel ? `<p style="color:#94a3b8;font-size:13px;margin:0 0 20px;">다음 자동 재시도: <strong style="color:#e2e8f0;">${retryLabel}</strong></p>` : ''}
          <a href="${portalUrl}" style="display:inline-block;padding:12px 24px;background:${toneColor};color:#fff;text-decoration:none;border-radius:6px;font-weight:700;font-size:14px;">
            ${copy.cta} →
          </a>
        </td></tr>
        <tr><td style="padding:20px 40px;border-top:1px solid #2a2a2a;">
          <p style="color:#475569;font-size:11px;margin:0;line-height:1.6;">
            인보이스 ID: <span style="font-family:monospace;color:#64748b;">${invoice.id}</span><br/>
            시도 횟수: ${attemptNumber} / 4<br/>
            © ${new Date().getFullYear()} Nexysys Lab Co., Ltd.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  try {
    const { sendEmail } = await import('@/lib/nexyfab-email');
    await sendEmail(user.email, copy.subject, html);
  } catch (err) {
    console.error('[dunning] send failed:', err);
  }
}

// ─── BI Analytics ─────────────────────────────────────────────────────────────

export async function recordBillingAnalytics(params: {
  eventType: string;
  userId:    string;
  product:   Product;
  invoiceId?: string;
  payload:   unknown;
}): Promise<void> {
  const db = getDbAdapter();
  await db.execute(
    `INSERT INTO nf_billing_analytics
       (id, event_type, user_id, product, invoice_id, payload, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    `ba-${crypto.randomUUID()}`,
    params.eventType,
    params.userId,
    params.product,
    params.invoiceId ?? null,
    JSON.stringify(params.payload),
    Date.now(),
  ).catch(() => {}); // fire-and-forget, never block billing
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the start of the current monthly billing cycle (1st of month, 00:00 UTC) */
function getCycleStart(): number {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}
