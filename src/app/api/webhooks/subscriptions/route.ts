import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { deliverWebhook } from '@/lib/webhook-delivery';
import type { WebhookEvent } from '@/lib/webhook-delivery';

export const dynamic = 'force-dynamic';

const VALID_EVENTS: WebhookEvent[] = [
  'rfq.created','rfq.quoted','rfq.accepted','rfq.rejected',
  'contract.created','contract.status_changed','contract.completed',
  'quote.created','quote.accepted','quote.rejected',
  'milestone.completed','qc.passed','qc.failed',
  'payment.completed','payment.failed',
];

// GET — list webhooks
export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { meetsPlan } = await import('@/lib/plan-guard');
  if (!meetsPlan(authUser.plan, 'team')) {
    return NextResponse.json({ error: 'Team plan required for webhooks.' }, { status: 403 });
  }

  const db = getDbAdapter();
  const subs = await db.queryAll<{
    id: string; url: string; events: string; status: string;
    description: string | null; last_triggered_at: number | null; failure_count: number; created_at: number;
  }>(
    'SELECT id, url, events, status, description, last_triggered_at, failure_count, created_at FROM nf_webhook_subscriptions WHERE user_id = ? ORDER BY created_at DESC',
    authUser.userId,
  );

  return NextResponse.json({
    subscriptions: subs.map(s => ({ ...s, events: JSON.parse(s.events ?? '[]') })),
    validEvents: VALID_EVENTS,
  });
}

// POST — create webhook
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { meetsPlan } = await import('@/lib/plan-guard');
  if (!meetsPlan(authUser.plan, 'team')) {
    return NextResponse.json({ error: 'Team plan required for webhooks.' }, { status: 403 });
  }

  const schema = z.object({
    url: z.string().url().max(500).refine(u => u.startsWith('https://'), { message: 'HTTPS URL required' }),
    events: z.array(z.string()).max(20).default([]),
    description: z.string().max(200).optional(),
  });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  // Max 10 webhooks per user
  const db = getDbAdapter();
  const count = await db.queryOne<{ c: number }>(
    "SELECT COUNT(*) as c FROM nf_webhook_subscriptions WHERE user_id = ? AND status = 'active'",
    authUser.userId,
  );
  if ((count?.c ?? 0) >= 10) return NextResponse.json({ error: '최대 10개의 웹훅을 등록할 수 있습니다.' }, { status: 400 });

  const id = `wh-${crypto.randomUUID()}`;
  const secret = randomBytes(32).toString('hex');
  const now = Date.now();

  await db.execute(
    'INSERT INTO nf_webhook_subscriptions (id, user_id, url, secret, events, status, description, failure_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
    id, authUser.userId, parsed.data.url, secret,
    JSON.stringify(parsed.data.events), 'active',
    parsed.data.description ?? null, now, now,
  );

  return NextResponse.json({ subscription: { id, url: parsed.data.url, secret, events: parsed.data.events } }, { status: 201 });
}

// DELETE — remove webhook
export async function DELETE(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await req.json().catch(() => ({})) as { id?: string };
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getDbAdapter();
  const result = await db.execute(
    'DELETE FROM nf_webhook_subscriptions WHERE id = ? AND user_id = ?',
    id, authUser.userId,
  );

  if (result.changes === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
