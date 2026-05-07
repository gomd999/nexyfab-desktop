/**
 * Airwallex API Client
 * Docs: https://www.airwallex.com/docs/api
 *
 * Auth: Client Credentials → Bearer token (24h TTL)
 * Env:
 *   AIRWALLEX_CLIENT_ID    — Airwallex client ID
 *   AIRWALLEX_API_KEY      — Airwallex API key
 *   AIRWALLEX_ENV          — 'demo' | 'prod' (default: 'demo')
 */

const BASE_URL =
  process.env.AIRWALLEX_ENV === 'prod'
    ? 'https://api.airwallex.com/api/v1'
    : 'https://api-demo.airwallex.com/api/v1';

// ─── Token cache (module-level singleton) ────────────────────────────────────

let _cachedToken: string | null = null;
let _tokenExpiresAt = 0;

async function getAccessToken(): Promise<string> {
  if (_cachedToken && Date.now() < _tokenExpiresAt - 60_000) return _cachedToken;

  const clientId = process.env.AIRWALLEX_CLIENT_ID;
  const apiKey   = process.env.AIRWALLEX_API_KEY;
  if (!clientId || !apiKey) throw new Error('[Airwallex] Missing AIRWALLEX_CLIENT_ID or AIRWALLEX_API_KEY');

  const res = await fetch(`${BASE_URL}/authentication/login`, {
    method: 'POST',
    headers: {
      'x-client-id': clientId,
      'x-api-key':   apiKey,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[Airwallex] Auth failed ${res.status}: ${body}`);
  }
  const data = await res.json() as { token: string; expires_at: string };
  _cachedToken  = data.token;
  _tokenExpiresAt = new Date(data.expires_at).getTime();
  return _cachedToken;
}

async function awFetch<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json() as T;
  if (!res.ok) {
    const err = (json as { message?: string; code?: string });
    throw new Error(`[Airwallex] ${method} ${path} → ${res.status}: ${err.message ?? JSON.stringify(json)}`);
  }
  return json;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AwCustomer {
  id: string;
  email?: string;
  name?: string;
  phone_number?: string;
  metadata?: Record<string, string>;
  created_at: string;
}

export interface AwPaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: string;
  client_secret: string;
  customer_id?: string;
  metadata?: Record<string, string>;
  created_at: string;
}

export interface AwSubscription {
  id: string;
  status: string; // active | past_due | cancelled | trialing
  customer_id: string;
  plan_id: string;
  current_period_start: string;
  current_period_end: string;
  metadata?: Record<string, string>;
  created_at: string;
}

export interface AwInvoice {
  id: string;
  subscription_id?: string;
  customer_id: string;
  amount: number;
  currency: string;
  status: string; // draft | open | paid | uncollectible | void
  due_date?: string;
  paid_at?: string;
  metadata?: Record<string, string>;
  created_at: string;
}

// ─── Customer APIs ───────────────────────────────────────────────────────────

export async function createCustomer(params: {
  email?: string;
  name?: string;
  phone?: string;
  metadata?: Record<string, string>;
}): Promise<AwCustomer> {
  return awFetch<AwCustomer>('POST', '/customers/create', {
    email:        params.email,
    name:         params.name,
    phone_number: params.phone,
    metadata:     params.metadata,
  });
}

export async function getCustomer(customerId: string): Promise<AwCustomer> {
  return awFetch<AwCustomer>('GET', `/customers/${customerId}`);
}

// ─── Payment Intent APIs ─────────────────────────────────────────────────────

export async function createPaymentIntent(params: {
  amount: number;               // In smallest currency unit (e.g., cents)
  currency: string;             // ISO 4217 e.g. 'KRW', 'USD'
  customerId?: string;
  description?: string;
  metadata?: Record<string, string>;
  returnUrl?: string;
  countryCode?: string;         // ISO 3166-1 alpha-2 — used to activate local payment methods
  paymentMethodTypes?: string[]; // e.g. ['card', 'alipay_cn', 'wechatpay']
}): Promise<AwPaymentIntent> {
  return awFetch<AwPaymentIntent>('POST', '/payment_intents/create', {
    amount:                params.amount,
    currency:              params.currency,
    customer_id:           params.customerId,
    descriptor:            params.description,
    metadata:              params.metadata,
    return_url:            params.returnUrl,
    // Local payment method hints
    ...(params.countryCode         && { country_code:           params.countryCode }),
    ...(params.paymentMethodTypes?.length && { payment_method_types: params.paymentMethodTypes }),
  });
}

export async function confirmPaymentIntent(
  intentId: string,
  paymentMethodId: string,
): Promise<AwPaymentIntent> {
  return awFetch<AwPaymentIntent>('POST', `/payment_intents/${intentId}/confirm`, {
    payment_method: { id: paymentMethodId },
  });
}

export async function capturePaymentIntent(
  intentId: string,
  amount?: number,
): Promise<AwPaymentIntent> {
  return awFetch<AwPaymentIntent>('POST', `/payment_intents/${intentId}/capture`, {
    amount,
  });
}

export async function getPaymentIntent(intentId: string): Promise<AwPaymentIntent> {
  return awFetch<AwPaymentIntent>('GET', `/payment_intents/${intentId}`);
}

// ─── Subscription APIs ───────────────────────────────────────────────────────

export async function createSubscription(params: {
  customerId: string;
  planId: string;
  trialDays?: number;
  metadata?: Record<string, string>;
}): Promise<AwSubscription> {
  return awFetch<AwSubscription>('POST', '/subscriptions/create', {
    customer_id: params.customerId,
    plan_id:     params.planId,
    trial_end:   params.trialDays
      ? new Date(Date.now() + params.trialDays * 86_400_000).toISOString()
      : undefined,
    metadata: params.metadata,
  });
}

export async function getSubscription(subscriptionId: string): Promise<AwSubscription> {
  return awFetch<AwSubscription>('GET', `/subscriptions/${subscriptionId}`);
}

export async function cancelSubscription(subscriptionId: string): Promise<AwSubscription> {
  return awFetch<AwSubscription>('POST', `/subscriptions/${subscriptionId}/cancel`, {});
}

export async function updateSubscriptionPlan(
  subscriptionId: string,
  newPlanId: string,
): Promise<AwSubscription> {
  return awFetch<AwSubscription>('PUT', `/subscriptions/${subscriptionId}`, {
    plan_id: newPlanId,
  });
}

// ─── Invoice APIs ────────────────────────────────────────────────────────────

export async function createInvoice(params: {
  customerId: string;
  amount: number;
  currency: string;
  description?: string;
  dueDays?: number;
  metadata?: Record<string, string>;
}): Promise<AwInvoice> {
  return awFetch<AwInvoice>('POST', '/invoices/create', {
    customer_id: params.customerId,
    amount:      params.amount,
    currency:    params.currency,
    description: params.description,
    due_date:    params.dueDays
      ? new Date(Date.now() + params.dueDays * 86_400_000).toISOString()
      : undefined,
    metadata: params.metadata,
  });
}

export async function listInvoices(customerId: string, limit = 20): Promise<{ items: AwInvoice[] }> {
  return awFetch<{ items: AwInvoice[] }>('GET', `/invoices?customer_id=${customerId}&page_size=${limit}`);
}

export async function finalizeInvoice(invoiceId: string): Promise<AwInvoice> {
  return awFetch<AwInvoice>('POST', `/invoices/${invoiceId}/finalize`, {});
}

// ─── Refund APIs ────────────────────────────────────────────────────────────

export interface AwRefund {
  id: string;
  payment_intent_id: string;
  amount: number;
  currency: string;
  reason: string;
  status: string; // CREATED | SUCCEEDED | FAILED
  created_at: string;
}

export async function createRefund(params: {
  paymentIntentId: string;
  amount?: number; // partial refund; omit for full refund
  reason?: string;
}): Promise<AwRefund> {
  return awFetch<AwRefund>('POST', '/refunds/create', {
    payment_intent_id: params.paymentIntentId,
    ...(params.amount != null && { amount: params.amount }),
    reason: params.reason ?? 'requested_by_customer',
  });
}

export async function getRefund(refundId: string): Promise<AwRefund> {
  return awFetch<AwRefund>('GET', `/refunds/${refundId}`);
}

// ─── Webhook signature verification ─────────────────────────────────────────

/**
 * Verify Airwallex webhook signature.
 * Airwallex sends: x-timestamp, x-signature headers
 * Signature = HMAC-SHA256(webhookSecretKey, timestamp + '.' + rawBody)
 */
export async function verifyWebhookSignature(
  rawBody: string,
  timestamp: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const { createHmac, timingSafeEqual } = await import('crypto');
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// ─── Utility ─────────────────────────────────────────────────────────────────

/**
 * Convert a human-readable amount to Airwallex's smallest-unit integer.
 *
 * Decimal places by currency:
 *   0 decimals : KRW, JPY, VND, IDR, HUF, ...
 *   2 decimals : USD, EUR, GBP, AED, SAR, QAR, EGP, SGD, AUD, ... (most)
 *   3 decimals : KWD (Kuwaiti Dinar), BHD (Bahraini Dinar), OMR (Omani Rial)
 *
 * Example:
 *   AED 19.00  → 1900   (× 100)
 *   KWD  5.500 → 5500   (× 1000)
 *   KRW 29000  → 29000  (× 1)
 */
const CURRENCY_DECIMALS: Record<string, number> = {
  // 0 decimal place currencies
  KRW: 0, JPY: 0, VND: 0, IDR: 0, HUF: 0, ISK: 0, CLP: 0, PYG: 0,
  // 3 decimal place currencies (Gulf)
  KWD: 3, BHD: 3, OMR: 3,
  // default = 2 (USD, EUR, GBP, AED, SAR, QAR, EGP, SGD, AUD, CNY, ...)
};

export function toAirwallexAmount(amount: number, currency = 'KRW'): number {
  const decimals = CURRENCY_DECIMALS[currency] ?? 2;
  return Math.round(amount * Math.pow(10, decimals));
}
