/**
 * Toss Payments API Client (한국 전용)
 * Docs: https://docs.tosspayments.com/reference
 *
 * Airwallex가 카카오페이/네이버페이를 직접 지원하지 않으므로
 * 토스페이먼츠를 통해 한국 간편결제를 처리합니다.
 *
 * 환경변수:
 *   TOSS_SECRET_KEY     — 토스페이먼츠 시크릿 키 (test_sk_... 또는 live_sk_...)
 *   TOSS_CLIENT_KEY     — 클라이언트 키 (NEXT_PUBLIC_TOSS_CLIENT_KEY)
 */

const TOSS_BASE = 'https://api.tosspayments.com/v1';

function getAuthHeader(): string {
  const sk = process.env.TOSS_SECRET_KEY ?? '';
  if (!sk) throw new Error('[Toss] Missing TOSS_SECRET_KEY');
  return 'Basic ' + Buffer.from(sk + ':').toString('base64');
}

async function tossFetch<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${TOSS_BASE}${path}`, {
    method,
    headers: {
      Authorization:  getAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json() as T;
  if (!res.ok) {
    const e = json as { code?: string; message?: string };
    throw new Error(`[Toss] ${method} ${path} → ${res.status}: ${e.message ?? JSON.stringify(json)}`);
  }
  return json;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TossPayment {
  paymentKey:    string;
  orderId:       string;
  orderName:     string;
  status:        string;  // READY | IN_PROGRESS | DONE | CANCELED | ABORTED | EXPIRED
  method:        string;  // 카드 | 간편결제 | 계좌이체 etc.
  totalAmount:   number;
  balanceAmount: number;
  currency:      string;
  approvedAt?:   string;
  metadata?:     Record<string, string>;
}

export interface TossBillingKey {
  billingKey:        string;
  customerKey:       string;
  authenticatedAt:   string;
  method:            string;
  card?: {
    issuerCode: string;
    acquirerCode: string;
    number: string;
    cardType: string;
    ownerType: string;
  };
}

// ─── 결제 승인 ─────────────────────────────────────────────────────────────────

export async function confirmPayment(
  paymentKey: string,
  orderId: string,
  amount: number,
): Promise<TossPayment> {
  return tossFetch<TossPayment>('POST', '/payments/confirm', {
    paymentKey,
    orderId,
    amount,
  });
}

export async function getPayment(paymentKey: string): Promise<TossPayment> {
  return tossFetch<TossPayment>('GET', `/payments/${paymentKey}`);
}

export async function cancelPayment(
  paymentKey: string,
  cancelReason: string,
  cancelAmount?: number,
): Promise<TossPayment> {
  return tossFetch<TossPayment>('POST', `/payments/${paymentKey}/cancel`, {
    cancelReason,
    ...(cancelAmount != null ? { cancelAmount } : {}),
  });
}

// ─── 빌링키 (자동결제) ─────────────────────────────────────────────────────────

/**
 * 빌링키 발급 (자동결제용)
 * 브라우저에서 토스 결제창을 띄운 후 authKey + customerKey를 받아서 서버에서 호출
 */
export async function issueBillingKey(
  authKey: string,
  customerKey: string,
): Promise<TossBillingKey> {
  return tossFetch<TossBillingKey>('POST', '/billing/authorizations/issue', {
    authKey,
    customerKey,
  });
}

/**
 * 빌링키로 자동결제 실행
 * 구독 갱신 시 서버에서 직접 호출
 */
export async function chargeWithBillingKey(params: {
  billingKey:  string;
  customerKey: string;
  orderId:     string;
  orderName:   string;
  amount:      number;
  customerEmail?: string;
  customerName?:  string;
}): Promise<TossPayment> {
  return tossFetch<TossPayment>('POST', `/billing/${params.billingKey}`, {
    customerKey:   params.customerKey,
    orderId:       params.orderId,
    orderName:     params.orderName,
    amount:        params.amount,
    currency:      'KRW',
    customerEmail: params.customerEmail,
    customerName:  params.customerName,
  });
}

// ─── 웹훅 서명 검증 ────────────────────────────────────────────────────────────

export async function verifyTossWebhook(
  rawBody: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const { createHmac, timingSafeEqual } = await import('crypto');
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
