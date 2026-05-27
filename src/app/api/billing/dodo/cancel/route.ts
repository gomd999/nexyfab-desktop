/**
 * POST /api/billing/dodo/cancel — Cancel the current user's Dodo subscription.
 * The actual DB state transition happens in the webhook handler to avoid races.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cancelSubscription } from '@/lib/dodo';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const db = getDbAdapter();
  const sub = await db.queryOne<{ payment_id: string; payment_provider: string }>(
    'SELECT payment_id, payment_provider FROM nf_subscriptions WHERE user_id = ?', user.userId,
  ).catch(() => null);

  if (!sub?.payment_id || sub.payment_provider !== 'dodo') {
    return NextResponse.json({ error: 'no_dodo_subscription' }, { status: 404 });
  }

  try {
    await cancelSubscription(sub.payment_id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const e = err as Error & { status?: number };
    return NextResponse.json({ error: 'cancel_failed', message: e.message }, { status: e.status ?? 500 });
  }
}
