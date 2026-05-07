import { NextRequest, NextResponse } from 'next/server';
import { getPartnerAuth } from '@/lib/partner-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { partnerNotificationRecipientKeys, sqlPlaceholders } from '@/lib/notificationRecipientKeys';

export const dynamic = 'force-dynamic';

interface NfNotifRow {
  id: string; type: string; title: string; body: string | null;
  link: string | null; read: number; created_at: number;
}

// GET /api/partner/notifications
export async function GET(req: NextRequest) {
  const partner = await getPartnerAuth(req);
  if (!partner) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const keys = partnerNotificationRecipientKeys(partner);
  const db = getDbAdapter();
  const rows = await db.queryAll<NfNotifRow>(
    `SELECT id, type, title, body, link, read, created_at
     FROM nf_notifications
     WHERE user_id IN (${sqlPlaceholders(keys.length)})
     ORDER BY created_at DESC LIMIT 50`,
    ...keys,
  ).catch((): NfNotifRow[] => []);

  const notifications = rows.map(r => ({
    id: r.id, type: r.type, title: r.title,
    message: r.body ?? '', link: r.link,
    read: r.read === 1,
    createdAt: new Date(r.created_at).toISOString(),
  }));

  return NextResponse.json({ notifications });
}

// POST — mark read
// body: { id } | { all: true }
export async function POST(req: NextRequest) {
  const partner = await getPartnerAuth(req);
  if (!partner) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { id?: string; all?: boolean };
  const keys = partnerNotificationRecipientKeys(partner);
  const db = getDbAdapter();

  if (body.all) {
    await db.execute(
      `UPDATE nf_notifications SET read = 1 WHERE user_id IN (${sqlPlaceholders(keys.length)})`,
      ...keys,
    ).catch(() => {});
  } else if (body.id) {
    await db.execute(
      `UPDATE nf_notifications SET read = 1 WHERE id = ? AND user_id IN (${sqlPlaceholders(keys.length)})`,
      body.id,
      ...keys,
    ).catch(() => {});
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
  const keys = partnerNotificationRecipientKeys(partner);
  const db = getDbAdapter();

  if (body.id) {
    await db.execute(
      `DELETE FROM nf_notifications WHERE id = ? AND user_id IN (${sqlPlaceholders(keys.length)})`,
      body.id,
      ...keys,
    ).catch(() => {});
  } else {
    await db.execute(
      `DELETE FROM nf_notifications WHERE user_id IN (${sqlPlaceholders(keys.length)})`,
      ...keys,
    ).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
