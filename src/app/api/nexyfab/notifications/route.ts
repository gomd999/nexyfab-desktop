import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { notificationRecipientKeys, sqlPlaceholders } from '@/lib/notificationRecipientKeys';

export const dynamic = 'force-dynamic';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: number;
  created_at: number;
}

// GET — list notifications (unread first, max 50)
export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const keys = notificationRecipientKeys(authUser);
  const db = getDbAdapter();
  const rows = await db.queryAll<Notification>(
    `SELECT id, type, title, body, link, read, created_at FROM nf_notifications WHERE user_id IN (${sqlPlaceholders(keys.length)}) ORDER BY read ASC, created_at DESC LIMIT 50`,
    ...keys,
  );
  const unreadCount = rows.filter(r => r.read === 0).length;

  return NextResponse.json({ notifications: rows, unreadCount });
}

// PATCH — mark as read (body: { id?: string, all?: boolean })
export async function PATCH(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, all } = await req.json().catch(() => ({})) as { id?: string; all?: boolean };
  const keys = notificationRecipientKeys(authUser);
  const db = getDbAdapter();

  if (all) {
    await db.execute(
      `UPDATE nf_notifications SET read = 1 WHERE user_id IN (${sqlPlaceholders(keys.length)})`,
      ...keys,
    );
  } else if (id) {
    await db.execute(
      `UPDATE nf_notifications SET read = 1 WHERE id = ? AND user_id IN (${sqlPlaceholders(keys.length)})`,
      id,
      ...keys,
    );
  }

  return NextResponse.json({ ok: true });
}

// DELETE — clear all read notifications
export async function DELETE(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const keys = notificationRecipientKeys(authUser);
  const db = getDbAdapter();
  await db.execute(
    `DELETE FROM nf_notifications WHERE user_id IN (${sqlPlaceholders(keys.length)}) AND read = 1`,
    ...keys,
  );
  return NextResponse.json({ ok: true });
}
