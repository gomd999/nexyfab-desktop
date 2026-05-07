import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { deliverWebhook } from '@/lib/webhook-delivery';
import { checkOrigin } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await req.json().catch(() => ({})) as { id?: string };
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getDbAdapter();
  const sub = await db.queryOne<{ url: string; secret: string }>(
    'SELECT url, secret FROM nf_webhook_subscriptions WHERE id = ? AND user_id = ?',
    id, authUser.userId,
  );
  if (!sub) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const result = await deliverWebhook(sub.url, sub.secret, {
    event: 'rfq.created',
    timestamp: new Date().toISOString(),
    data: { test: true, message: 'NexyFab webhook test ping' },
  });

  return NextResponse.json({ ok: result.ok, status: result.status, error: result.error });
}
