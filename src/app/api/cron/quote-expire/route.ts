/**
 * GET /api/cron/quote-expire
 * Sweeps pending quotes past their valid_until date and marks them expired.
 * Same auth pattern as /api/cron/rfq-expire (Bearer ${CRON_SECRET}).
 *
 * Without this, stale "응답 대기" rows accumulate forever in partner inboxes
 * and customers see quotes that the supplier no longer honors.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { createNotification } from '@/app/lib/notify';
import { normPartnerEmail } from '@/lib/partner-factory-access';

export const dynamic = 'force-dynamic';

interface QuoteRow {
  id: string;
  inquiry_id: string | null;
  project_name: string | null;
  partner_email: string | null;
  valid_until: string | null;
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!cronSecret || token !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDbAdapter();
  const now = Date.now();
  const todayIso = new Date(now).toISOString().slice(0, 10); // YYYY-MM-DD

  let rows: QuoteRow[] = [];
  try {
    rows = await db.queryAll<QuoteRow>(
      `SELECT id, inquiry_id, project_name, partner_email, valid_until
         FROM nf_quotes
        WHERE status IN ('pending', 'responded')
          AND valid_until IS NOT NULL
          AND valid_until <> ''
          AND valid_until < ?`,
      todayIso,
    );
  } catch (err) {
    console.error('[quote-expire] query failed:', err);
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }

  let expired = 0;
  for (const row of rows) {
    try {
      await db.execute(
        `UPDATE nf_quotes SET status = 'expired', updated_at = datetime('now') WHERE id = ?`,
        row.id,
      );

      // Notify partner so they know the quote was auto-expired (not silently dropped).
      if (row.partner_email) {
        createNotification(
          `partner:${normPartnerEmail(row.partner_email)}`,
          'quote_expired',
          '견적 자동 만료',
          `${row.project_name || row.id.slice(0, 8)} 견적이 유효기간(${row.valid_until})을 지나 자동 만료되었습니다.`,
          { quoteId: row.id },
        );
      }
      expired++;
    } catch (err) {
      console.error(`[quote-expire] failed to expire ${row.id}:`, err);
    }
  }

  return NextResponse.json({
    expired,
    scanned: rows.length,
    timestamp: new Date(now).toISOString(),
  });
}
