import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { notificationRecipientKeys, sqlPlaceholders } from '@/lib/notificationRecipientKeys';

export const dynamic = 'force-dynamic';

interface NfNotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: number | boolean;
  created_at: number;
}

function toClientNotification(row: NfNotificationRow) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.body ?? '',
    link: row.link,
    createdAt: new Date(row.created_at).toISOString(),
    read: row.read === true || row.read === 1,
  };
}

// GET /api/notifications
// Returns notifications for the authenticated user (ignores ?recipient param for security)
export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const keys = notificationRecipientKeys(authUser);
  const db = getDbAdapter();
  const rows = await db.queryAll<NfNotificationRow>(
    `SELECT id, type, title, body, link, read, created_at
     FROM nf_notifications
     WHERE user_id IN (${sqlPlaceholders(keys.length)})
     ORDER BY read ASC, created_at DESC
     LIMIT 50`,
    ...keys,
  );
  const notifications = rows.map(toClientNotification);
  return NextResponse.json({ notifications });
}

// POST — 읽음 처리
// body: { id } 또는 { all: true }
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { id, all: markAll } = body;

  const keys = notificationRecipientKeys(authUser);
  const db = getDbAdapter();

  if (markAll) {
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
  } else {
    return NextResponse.json({ error: 'id 또는 all: true 가 필요합니다.' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

// DELETE — clear notifications
// body: { id } to delete one, or {} / { all: true } to clear all
export async function DELETE(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { id?: string };
  const keys = notificationRecipientKeys(authUser);
  const db = getDbAdapter();

  if (body.id) {
    await db.execute(
      `DELETE FROM nf_notifications WHERE id = ? AND user_id IN (${sqlPlaceholders(keys.length)})`,
      body.id,
      ...keys,
    );
  } else {
    await db.execute(
      `DELETE FROM nf_notifications WHERE user_id IN (${sqlPlaceholders(keys.length)})`,
      ...keys,
    );
  }
  return NextResponse.json({ ok: true });
}
