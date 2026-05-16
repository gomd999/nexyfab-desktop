// Web Push subscription endpoint.
// Browser → /api/nexyfab/push/subscribe with the PushSubscription JSON.
// Subscription stored per (userId, endpoint) so multiple devices per user
// work. /api/nexyfab/push/send fans messages to the user's subscriptions.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().max(200),
    auth: z.string().max(80),
  }),
  ua: z.string().max(500).optional(),
});

async function ensureTable() {
  const db = getDbAdapter();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      ua TEXT,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      UNIQUE(user_id, endpoint)
    )
  `);
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const raw = await req.json().catch(() => null);
  const parsed = subscribeSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  await ensureTable();
  const db = getDbAdapter();
  const now = Date.now();
  const id = `pushsub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  // Upsert so re-subscribing from the same device just refreshes keys + last_seen.
  await db.execute(
    `INSERT INTO nf_push_subscriptions (id, user_id, endpoint, p256dh, auth, ua, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, endpoint) DO UPDATE SET
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       ua = excluded.ua,
       last_seen_at = excluded.last_seen_at`,
    id, authUser.userId, parsed.data.endpoint, parsed.data.keys.p256dh, parsed.data.keys.auth,
    parsed.data.ua ?? null, now, now,
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const endpoint = req.nextUrl.searchParams.get('endpoint');
  if (!endpoint) return NextResponse.json({ error: 'endpoint required' }, { status: 400 });

  await ensureTable();
  const db = getDbAdapter();
  await db.execute(
    'DELETE FROM nf_push_subscriptions WHERE user_id = ? AND endpoint = ?',
    authUser.userId, endpoint,
  );
  return NextResponse.json({ ok: true });
}
