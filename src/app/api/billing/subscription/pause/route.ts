// Pause / resume subscription — Notion / Substack pattern. User pauses
// for 3 / 6 / 12 months; gateway suspends billing but keeps the customer
// + payment method linked so resume is one-click.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { pauseSubscription, resumeSubscription } from '@/lib/airwallex-client';
import { recordBillingAnalytics, type Product } from '@/lib/billing-engine';

const pauseSchema = z.object({
  product: z.enum(['nexyfab', 'nexyflow', 'nexywise', 'nexyremote']).default('nexyfab'),
  months: z.number().int().min(1).max(12),
  reason: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const raw = await req.json().catch(() => null);
  const parsed = pauseSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const db = getDbAdapter();
  const orgId = authUser.orgIds[0] ?? null;
  const sub = await db.queryOne<{ id: string; aw_subscription_id: string }>(
    orgId
      ? "SELECT id, aw_subscription_id FROM nf_aw_subscriptions WHERE product = ? AND (user_id = ? OR org_id = ?) AND status = 'active' ORDER BY created_at DESC LIMIT 1"
      : "SELECT id, aw_subscription_id FROM nf_aw_subscriptions WHERE user_id = ? AND product = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
    ...(orgId ? [parsed.data.product, authUser.userId, orgId] : [authUser.userId, parsed.data.product]),
  );
  if (!sub) return NextResponse.json({ error: 'No active subscription' }, { status: 404 });

  const resumesAt = Date.now() + parsed.data.months * 30 * 86_400_000;

  let awSub;
  try {
    awSub = await pauseSubscription(sub.aw_subscription_id, resumesAt);
  } catch (err) {
    console.error('[subscription/pause] gateway error:', err);
    return NextResponse.json({ error: 'Gateway pause failed' }, { status: 502 });
  }

  await db.execute(
    "UPDATE nf_aw_subscriptions SET status = 'paused', updated_at = ? WHERE id = ?",
    Date.now(), sub.id,
  );

  await recordBillingAnalytics({
    eventType: 'subscription.paused',
    userId: authUser.userId,
    product: parsed.data.product as Product,
    payload: { months: parsed.data.months, resumesAt, reason: parsed.data.reason, awSub },
  });

  return NextResponse.json({ ok: true, resumesAt, months: parsed.data.months });
}

export async function DELETE(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const product = (req.nextUrl.searchParams.get('product') ?? 'nexyfab') as Product;
  const db = getDbAdapter();
  const orgId = authUser.orgIds[0] ?? null;
  const sub = await db.queryOne<{ id: string; aw_subscription_id: string }>(
    orgId
      ? "SELECT id, aw_subscription_id FROM nf_aw_subscriptions WHERE product = ? AND (user_id = ? OR org_id = ?) AND status = 'paused' ORDER BY created_at DESC LIMIT 1"
      : "SELECT id, aw_subscription_id FROM nf_aw_subscriptions WHERE user_id = ? AND product = ? AND status = 'paused' ORDER BY created_at DESC LIMIT 1",
    ...(orgId ? [product, authUser.userId, orgId] : [authUser.userId, product]),
  );
  if (!sub) return NextResponse.json({ error: 'No paused subscription' }, { status: 404 });

  try {
    await resumeSubscription(sub.aw_subscription_id);
  } catch (err) {
    console.error('[subscription/pause] resume error:', err);
    return NextResponse.json({ error: 'Gateway resume failed' }, { status: 502 });
  }
  await db.execute(
    "UPDATE nf_aw_subscriptions SET status = 'active', updated_at = ? WHERE id = ?",
    Date.now(), sub.id,
  );
  await recordBillingAnalytics({
    eventType: 'subscription.resumed',
    userId: authUser.userId,
    product,
    payload: { resumedAt: Date.now() },
  });
  return NextResponse.json({ ok: true });
}
