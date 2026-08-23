/**
 * POST /api/billing/dodo/checkout
 *
 * Creates a Dodo Payments hosted subscription link for global (non-KRW)
 * customers. KRW stays on Toss/Airwallex.
 *
 * Request: { plan: 'lite'|'pro'|'enterprise', cycle?: 'monthly'|'annual', customerName?: string, billing?: {...} }
 * Response: { url, subscriptionId }
 *
 * Required env per (plan, cycle):
 *   DODO_PRODUCT_LITE_MONTHLY, DODO_PRODUCT_LITE_ANNUAL,
 *   DODO_PRODUCT_PRO_MONTHLY,  DODO_PRODUCT_PRO_ANNUAL, ...
 */
import { NextRequest, NextResponse } from 'next/server';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { createSubscription, type DodoBillingAddress } from '@/lib/dodo';
import { getAuthUser } from '@/lib/auth-middleware';
import { denyIfBeta } from '@/lib/billing-beta-gate';
import { denyIfPaymentCollectionDisabled } from '@/lib/payment-gate';

export const dynamic = 'force-dynamic';

const VALID_PLANS = ['lite', 'pro', 'enterprise'] as const;
const VALID_CYCLES = ['monthly', 'annual'] as const;

function getProductId(plan: string, cycle: string): string {
  const envKey = `DODO_PRODUCT_${plan.toUpperCase()}_${cycle.toUpperCase()}`;
  const v = process.env[envKey];
  if (!v) throw new Error(`${envKey} not configured`);
  return v;
}

const DODO_CHECKOUT_JSON_BYTES = 64 * 1024;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const paymentDenied = denyIfPaymentCollectionDisabled();
  if (paymentDenied) return paymentDenied;
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!user.emailVerified) {
    return NextResponse.json({ error: 'email_not_verified' }, { status: 403 });
  }

  const denied = denyIfBeta(user.email);
  if (denied) return denied;

  let body: { plan?: string; cycle?: string; customerName?: string; billing?: DodoBillingAddress };
  try { body = await readBoundedJson(req, DODO_CHECKOUT_JSON_BYTES); }
  catch (error) {
    const bodyError = boundedJsonError(error);
    if (bodyError?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'payload_too_large' }, { status: bodyError.status });
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const plan = body.plan ?? '';
  const cycle = body.cycle ?? 'monthly';
  if (!VALID_PLANS.includes(plan as typeof VALID_PLANS[number])) {
    return NextResponse.json({ error: 'invalid_plan' }, { status: 400 });
  }
  if (!VALID_CYCLES.includes(cycle as typeof VALID_CYCLES[number])) {
    return NextResponse.json({ error: 'invalid_cycle' }, { status: 400 });
  }

  let productId: string;
  try { productId = getProductId(plan, cycle); }
  catch {
    return NextResponse.json({
      error: 'dodo_product_not_configured',
      message: `${plan}/${cycle} 글로벌 결제는 아직 준비 중입니다.`,
    }, { status: 503 });
  }

  const clientUrl = process.env.CLIENT_URL || 'https://nexyfab.com';
  try {
    const session = await createSubscription({
      productId,
      customerEmail: user.email,
      customerName: body.customerName ?? user.email,
      billingAddress: body.billing,
      returnUrl: `${clientUrl}/billing?dodo=success`,
      metadata: { user_id: user.userId, plan, cycle },
    });
    return NextResponse.json({
      url: session.payment_link,
      subscriptionId: session.subscription_id,
    });
  } catch (err) {
    const e = err as Error & { status?: number };
    console.error('[dodo/checkout]', e.message);
    return NextResponse.json({
      error: 'dodo_checkout_failed',
      message: e.message,
    }, { status: e.status ?? 500 });
  }
}
