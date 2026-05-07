import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

export interface NotificationSettings {
  emailRfqUpdate: boolean;
  emailQuoteExpiry: boolean;
  emailOrderStatus: boolean;
  emailMarketing: boolean;
  browserNotifications: boolean;
}

const DEFAULTS: NotificationSettings = {
  emailRfqUpdate: true,
  emailQuoteExpiry: true,
  emailOrderStatus: true,
  emailMarketing: false,
  browserNotifications: false,
};

type DbRow = {
  email_rfq_update: number;
  email_quote_expiry: number;
  email_order_status: number;
  email_marketing: number;
  browser_notifications: number;
};

function rowToSettings(row: DbRow): NotificationSettings {
  return {
    emailRfqUpdate: !!row.email_rfq_update,
    emailQuoteExpiry: !!row.email_quote_expiry,
    emailOrderStatus: !!row.email_order_status,
    emailMarketing: !!row.email_marketing,
    browserNotifications: !!row.browser_notifications,
  };
}

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const db = getDbAdapter();
  const row = await db.queryOne<DbRow>(
    'SELECT email_rfq_update, email_quote_expiry, email_order_status, email_marketing, browser_notifications FROM nf_user_notification_settings WHERE user_id = ?',
    authUser.userId,
  );

  return NextResponse.json({ settings: row ? rowToSettings(row) : DEFAULTS });
}

export async function PATCH(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { settings } = body as { settings?: Partial<NotificationSettings> };

    if (!settings || typeof settings !== 'object') {
      return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
    }

    const db = getDbAdapter();

    // Read current (or default) then merge
    const existing = await db.queryOne<DbRow>(
      'SELECT email_rfq_update, email_quote_expiry, email_order_status, email_marketing, browser_notifications FROM nf_user_notification_settings WHERE user_id = ?',
      authUser.userId,
    );
    const current: NotificationSettings = existing ? rowToSettings(existing) : { ...DEFAULTS };
    const merged: NotificationSettings = { ...current, ...settings };

    await db.execute(
      `INSERT INTO nf_user_notification_settings
         (user_id, email_rfq_update, email_quote_expiry, email_order_status, email_marketing, browser_notifications, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         email_rfq_update     = excluded.email_rfq_update,
         email_quote_expiry   = excluded.email_quote_expiry,
         email_order_status   = excluded.email_order_status,
         email_marketing      = excluded.email_marketing,
         browser_notifications = excluded.browser_notifications,
         updated_at           = excluded.updated_at`,
      authUser.userId,
      merged.emailRfqUpdate ? 1 : 0,
      merged.emailQuoteExpiry ? 1 : 0,
      merged.emailOrderStatus ? 1 : 0,
      merged.emailMarketing ? 1 : 0,
      merged.browserNotifications ? 1 : 0,
      Date.now(),
    );

    return NextResponse.json({ ok: true, settings: merged });
  } catch {
    return NextResponse.json({ error: '요청 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
