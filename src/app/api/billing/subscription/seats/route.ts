// Seat auto-billing — POST adjusts the seat count on the active
// subscription with proration. Charging the difference for the remaining
// days in the current cycle so a mid-month addition costs only the
// fraction of remaining time, matching Stripe/Linear/Figma conventions.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { updateSubscriptionQuantity } from '@/lib/airwallex-client';
import { type Product, recordBillingAnalytics } from '@/lib/billing-engine';
import { withRateLimit, RATE_LIMITS } from '@/lib/with-rate-limit';

const schema = z.object({
  product: z.enum(['nexyfab', 'nexyflow', 'nexywise', 'nexyremote']).default('nexyfab'),
  /** Absolute target seat count. */
  quantity: z.number().int().min(1).max(1000),
});

export const POST = withRateLimit({ key: 'billing-seats', ...RATE_LIMITS.billing_action }, async (req: NextRequest) => {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const raw = await req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }
  const { product, quantity } = parsed.data;

  const db = getDbAdapter();
  const orgId = authUser.orgIds[0] ?? null;
  if (!orgId) {
    return NextResponse.json(
      { error: 'Seat adjustments require an organisation. Create or join an org first.' },
      { status: 400 },
    );
  }
  const sub = await db.queryOne<{ id: string; aw_subscription_id: string; plan: string; current_period_end: number }>(
    "SELECT id, aw_subscription_id, plan, current_period_end FROM nf_aw_subscriptions WHERE product = ? AND org_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
    product as Product, orgId,
  );
  if (!sub) {
    return NextResponse.json({ error: 'No active subscription' }, { status: 404 });
  }
  if (sub.plan !== 'team' && sub.plan !== 'enterprise') {
    return NextResponse.json({ error: 'Seat-based billing requires Team or Enterprise plan' }, { status: 400 });
  }

  // Adjust the seat count on the gateway with proration.
  let awSub;
  try {
    awSub = await updateSubscriptionQuantity(sub.aw_subscription_id, quantity);
  } catch (err) {
    console.error('[billing/seats] gateway error:', err);
    return NextResponse.json({ error: 'Gateway error during seat update' }, { status: 502 });
  }

  // Estimate the user-facing proration so the UI can show "₩4,830 charged
  // today for 9 days remaining" before the receipt email arrives.
  const msUntilCycleEnd = Math.max(0, sub.current_period_end - Date.now());
  const fraction = msUntilCycleEnd / (30 * 86_400_000);
  const seatPriceKrw = 15_000; // matches USAGE_UNIT_PRICE_KRW.team_seat
  const prorationKrw = Math.round(fraction * seatPriceKrw * (quantity - 1));

  await db.execute(
    'UPDATE nf_aw_subscriptions SET updated_at = ? WHERE id = ?',
    Date.now(), sub.id,
  );

  await recordBillingAnalytics({
    eventType: 'subscription.seat_updated',
    userId: authUser.userId,
    product: product as Product,
    payload: { quantity, prorationKrw, awSubscription: awSub },
  });

  return NextResponse.json({
    ok: true,
    quantity,
    prorationKrw,
    daysRemaining: Math.round(msUntilCycleEnd / 86_400_000),
  });
});
