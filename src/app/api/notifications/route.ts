import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { dbGetNotifications, dbMarkNotificationRead, dbMarkAllNotificationsRead, dbClearNotifications, dbDeleteNotification } from '@/app/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/notifications
// Returns notifications for the authenticated user (ignores ?recipient param for security)
export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Legacy system indexes by email; fall back to userId if email unavailable
  const recipient = authUser.email ?? authUser.userId;
  const notifications = dbGetNotifications(recipient, 50);
  return NextResponse.json({ notifications });
}

// POST — 읽음 처리
// body: { id } 또는 { all: true }
export async function POST(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { id, all: markAll } = body;

  const recipient = authUser.email ?? authUser.userId;

  if (markAll) {
    dbMarkAllNotificationsRead(recipient);
  } else if (id) {
    dbMarkNotificationRead(recipient, id);
  } else {
    return NextResponse.json({ error: 'id 또는 all: true 가 필요합니다.' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

// DELETE — clear notifications
// body: { id } to delete one, or {} / { all: true } to clear all
export async function DELETE(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const recipient = authUser.email ?? authUser.userId;
  const body = await req.json().catch(() => ({})) as { id?: string };

  if (body.id) {
    dbDeleteNotification(recipient, body.id);
  } else {
    dbClearNotifications(recipient);
  }
  return NextResponse.json({ ok: true });
}
