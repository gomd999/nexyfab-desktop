import { NextRequest, NextResponse } from 'next/server';
import { getPartnerAuth } from '@/lib/partner-auth';
import {
  dbGetNotifications,
  dbMarkNotificationRead,
  dbMarkAllNotificationsRead,
  dbClearNotifications,
  dbDeleteNotification,
} from '@/app/lib/db';

export const dynamic = 'force-dynamic';

function partnerKey(email: string) {
  return `partner:${email}`;
}

// GET /api/partner/notifications
export async function GET(req: NextRequest) {
  const partner = await getPartnerAuth(req);
  if (!partner) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = partnerKey(partner.email);
  const notifications = dbGetNotifications(key, 50);
  return NextResponse.json({ notifications });
}

// POST — mark read
// body: { id } | { all: true }
export async function POST(req: NextRequest) {
  const partner = await getPartnerAuth(req);
  if (!partner) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { id?: string; all?: boolean };
  const key = partnerKey(partner.email);

  if (body.all) {
    dbMarkAllNotificationsRead(key);
  } else if (body.id) {
    dbMarkNotificationRead(key, body.id);
  } else {
    return NextResponse.json({ error: 'id 또는 all: true 가 필요합니다.' }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

// DELETE — clear notifications
// body: { id } to delete one, or {} to clear all
export async function DELETE(req: NextRequest) {
  const partner = await getPartnerAuth(req);
  if (!partner) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { id?: string };
  const key = partnerKey(partner.email);

  if (body.id) {
    dbDeleteNotification(key, body.id);
  } else {
    dbClearNotifications(key);
  }
  return NextResponse.json({ ok: true });
}
