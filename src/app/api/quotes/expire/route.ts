import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

// GET /api/quotes/expire — 만료 견적 일괄 처리 (cron 또는 admin 수동 트리거)
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;
  if (!isCron && !(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDbAdapter();
  const today = new Date().toISOString().slice(0, 10);
  const result = await db.execute(
    `UPDATE nf_quotes
     SET status = 'expired', updated_at = datetime('now')
     WHERE status IN ('pending', 'responded')
       AND valid_until IS NOT NULL
       AND valid_until < ?`,
    today,
  );

  return NextResponse.json({ expired: result.changes });
}
