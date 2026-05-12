/**
 * GET /api/cron/budget-warning-prune
 *
 * Daily cron — drops `nf_budget_warning_sent` rows older than 30 days so the
 * dedupe table doesn't grow without bound for users who hit 80% repeatedly.
 *
 * Why 30 days:
 *   - The 24h cooldown only needs ~1 day of history per user. Anything older
 *     is dead weight.
 *   - Keeping 30 days lets us reuse the same row when a user re-crosses
 *     within the same month without re-creating it.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cutoff = Date.now() - RETENTION_MS;
  const db = getDbAdapter();
  const result = await db.execute(
    'DELETE FROM nf_budget_warning_sent WHERE last_sent_at < ?',
    cutoff,
  ).catch(() => ({ changes: 0 }));

  return NextResponse.json({
    ok: true,
    cutoffMs: cutoff,
    cutoffISO: new Date(cutoff).toISOString(),
    deleted: result.changes ?? 0,
  });
}
