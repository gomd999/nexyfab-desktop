/**
 * lib/dodo.ts — Dodo Payments client wrapper (TypeScript).
 *
 * Dodo Payments is a Merchant of Record (MoR) global payment gateway. Used
 * for non-KRW currencies on NexyFab; KRW remains on Toss/NicePay/Airwallex.
 *
 * API:      https://docs.dodopayments.com
 * Webhooks: Svix-signed. Headers: svix-id / svix-timestamp / svix-signature
 *
 * Env:
 *   DODO_API_KEY        — Bearer token (live or test)
 *   DODO_WEBHOOK_SECRET — `whsec_...` from the Dodo dashboard
 *   DODO_MODE           — 'live' (default) or 'test'
 */

import crypto from 'crypto';

const apiBase = (): string =>
  process.env.DODO_MODE === 'test' ? 'https://test.dodopayments.com' : 'https://live.dodopayments.com';

export class DodoError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export function isConfigured(): boolean {
  return !!process.env.DODO_API_KEY;
}

async function request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  if (!isConfigured()) {
    throw new DodoError('DODO_API_KEY is not configured', 503, null);
  }
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${process.env.DODO_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep null */ }
  if (!res.ok) {
    const msg = (json as { message?: string; error?: string } | null)?.message
             ?? (json as { message?: string; error?: string } | null)?.error
             ?? `Dodo API ${res.status}`;
    throw new DodoError(msg, res.status, json);
  }
  return json as T;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DodoBillingAddress {
  city?: string;
  country?: string;
  state?: string;
  street?: string;
  zipcode?: string;
}

export interface DodoSubscriptionResponse {
  subscription_id?: string;
  payment_link?: string;
  client_secret?: string;
  status?: string;
  [k: string]: unknown;
}

export interface DodoPaymentResponse {
  payment_id?: string;
  payment_link?: string;
  status?: string;
  total_amount?: number;
  currency?: string;
  [k: string]: unknown;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function createSubscription(args: {
  productId: string;
  customerEmail: string;
  customerName?: string;
  quantity?: number;
  billingAddress?: DodoBillingAddress;
  metadata?: Record<string, string>;
  returnUrl?: string;
  trialPeriodDays?: number;
}): Promise<DodoSubscriptionResponse> {
  const { productId, customerEmail, customerName, quantity = 1, billingAddress, metadata, returnUrl, trialPeriodDays } = args;
  return request<DodoSubscriptionResponse>('POST', '/subscriptions', {
    product_id: productId,
    quantity,
    customer: { email: customerEmail, name: customerName ?? customerEmail },
    billing: billingAddress,
    payment_link: true,
    return_url: returnUrl,
    metadata: metadata ?? {},
    ...(trialPeriodDays ? { trial_period_days: trialPeriodDays } : {}),
  });
}

export function createPayment(args: {
  productId: string;
  customerEmail: string;
  customerName?: string;
  quantity?: number;
  billingAddress?: DodoBillingAddress;
  metadata?: Record<string, string>;
  returnUrl?: string;
}): Promise<DodoPaymentResponse> {
  const { productId, customerEmail, customerName, quantity = 1, billingAddress, metadata, returnUrl } = args;
  return request<DodoPaymentResponse>('POST', '/payments', {
    product_cart: [{ product_id: productId, quantity }],
    customer: { email: customerEmail, name: customerName ?? customerEmail },
    billing: billingAddress,
    payment_link: true,
    return_url: returnUrl,
    metadata: metadata ?? {},
  });
}

export function getSubscription(subscriptionId: string): Promise<DodoSubscriptionResponse> {
  return request<DodoSubscriptionResponse>('GET', `/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

export function cancelSubscription(subscriptionId: string): Promise<DodoSubscriptionResponse> {
  return request<DodoSubscriptionResponse>('PATCH', `/subscriptions/${encodeURIComponent(subscriptionId)}`, { status: 'cancelled' });
}

export function createRefund(args: { paymentId: string; amount?: number; reason?: string }): Promise<unknown> {
  const { paymentId, amount, reason } = args;
  return request<unknown>('POST', '/refunds', {
    payment_id: paymentId,
    ...(amount != null ? { amount } : {}),
    ...(reason ? { reason } : {}),
  });
}

// ─── Webhook signature verification (Svix-compatible) ──────────────────────

const TIMESTAMP_TOLERANCE_SEC = 5 * 60;

export function verifyWebhook(rawBody: string, headers: Headers | Record<string, string>, secret: string): boolean {
  if (!secret) return false;
  const get = (k: string): string | null => {
    if (headers instanceof Headers) return headers.get(k);
    const lower = Object.keys(headers).reduce<Record<string, string>>((acc, key) => {
      acc[key.toLowerCase()] = headers[key]; return acc;
    }, {});
    return lower[k.toLowerCase()] ?? null;
  };
  const svixId = get('svix-id') ?? get('webhook-id');
  const svixTs = get('svix-timestamp') ?? get('webhook-timestamp');
  const svixSig = get('svix-signature') ?? get('webhook-signature');
  if (!svixId || !svixTs || !svixSig) return false;

  const tsNum = parseInt(svixTs, 10);
  if (!Number.isFinite(tsNum)) return false;
  const ageSec = Math.abs(Math.floor(Date.now() / 1000) - tsNum);
  if (ageSec > TIMESTAMP_TOLERANCE_SEC) return false;

  const keyB64 = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  let keyBytes: Buffer;
  try { keyBytes = Buffer.from(keyB64, 'base64'); }
  catch { return false; }
  if (keyBytes.length === 0) return false;

  const signedContent = `${svixId}.${svixTs}.${rawBody}`;
  const expected = crypto.createHmac('sha256', keyBytes).update(signedContent).digest('base64');

  for (const c of svixSig.split(' ')) {
    const [version, sigB64] = c.split(',');
    if (version !== 'v1' || !sigB64) continue;
    try {
      const a = Buffer.from(sigB64, 'base64');
      const b = Buffer.from(expected, 'base64');
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
    } catch { /* ignore */ }
  }
  return false;
}
