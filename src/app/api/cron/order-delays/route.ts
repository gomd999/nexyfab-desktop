/**
 * GET /api/cron/order-delays
 * Sweeps in-flight orders whose estimated_delivery_at has passed without
 * delivery, and notifies BOTH the partner (so they can post a delay update)
 * AND the customer (so they aren't surprised). Records a 'order_delivered_late'
 * intent? — no: lateness is finalized only when delivery actually happens, so
 * this cron only nudges. The terminal late metric is recorded in the orders
 * PATCH endpoint.
 *
 * Auth: Bearer ${CRON_SECRET}.
 *
 * Idempotency: each row is reminded at most once per day via the
 * `last_delay_reminder_at` column; sweeping the same window twice doesn't
 * spam the customer.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { createNotification } from '@/app/lib/notify';
import { normPartnerEmail } from '@/lib/partner-factory-access';

export const dynamic = 'force-dynamic';

interface OrderRow {
  id: string;
  user_id: string;
  partner_email: string | null;
  manufacturer_name: string;
  part_name: string;
  status: string;
  estimated_delivery_at: number;
  last_delay_reminder_at: number | null;
}

const ONE_DAY = 86_400_000;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!secret || token !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDbAdapter();
  await db.execute('ALTER TABLE nf_orders ADD COLUMN last_delay_reminder_at INTEGER').catch(() => {});

  const now = Date.now();
  const dayAgo = now - ONE_DAY;

  let rows: OrderRow[] = [];
  try {
    rows = await db.queryAll<OrderRow>(
      `SELECT id, user_id, partner_email, manufacturer_name, part_name, status,
              estimated_delivery_at, last_delay_reminder_at
         FROM nf_orders
        WHERE status IN ('placed', 'production', 'qc', 'shipped')
          AND estimated_delivery_at < ?
          AND (last_delay_reminder_at IS NULL OR last_delay_reminder_at < ?)`,
      now, dayAgo,
    );
  } catch (err) {
    console.error('[order-delays] query failed:', err);
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }

  let notified = 0;
  for (const row of rows) {
    try {
      const daysLate = Math.max(1, Math.round((now - row.estimated_delivery_at) / ONE_DAY));

      // Customer
      if (row.user_id) {
        createNotification(
          row.user_id,
          'order_delay',
          '⚠ 주문이 약속 납기일을 초과했습니다',
          `${row.part_name} 주문이 ${daysLate}일 지연되고 있습니다. 제조사에 진행 상황을 문의해 주세요.`,
          { contractId: row.id },
        );
      }
      // Partner
      if (row.partner_email) {
        createNotification(
          `partner:${normPartnerEmail(row.partner_email)}`,
          'order_delay',
          '🚨 납기 초과 주문 — 지연 사유 등록 필요',
          `${row.part_name} 주문(${row.id})이 ${daysLate}일 지연되었습니다. 지연 사유를 등록해 고객에게 안내해 주세요.`,
          { contractId: row.id },
        );
      }

      await db.execute(
        'UPDATE nf_orders SET last_delay_reminder_at = ? WHERE id = ?',
        now, row.id,
      ).catch(() => {});
      notified++;
    } catch (err) {
      console.error(`[order-delays] failed for ${row.id}:`, err);
    }
  }

  return NextResponse.json({
    ok: true, scanned: rows.length, notified,
    timestamp: new Date(now).toISOString(),
  });
}
