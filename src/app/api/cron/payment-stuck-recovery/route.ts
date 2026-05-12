/**
 * GET /api/cron/payment-stuck-recovery
 *
 * Every 5 minutes — reset orders stuck in payment_status='processing' for
 * more than 5 minutes back to 'pending' so the user can retry.
 *
 * Why: the PATCH /payment endpoint takes a row-level lock by flipping
 * status to 'processing' before calling Toss. If the user closes the
 * Toss popup mid-confirm or the function times out, the order stays
 * 'processing' forever — re-attempting returns 409 "이미 처리 중".
 *
 * 5-minute window is safe: Toss confirms typically resolve in <30s.
 * Anything older is genuinely stuck.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STUCK_THRESHOLD_MS = 5 * 60 * 1000;

interface StuckRow { id: string; user_id: string; updated_at: number | null }

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = Date.now();
  const cutoff = now - STUCK_THRESHOLD_MS;
  const db = getDbAdapter();

  // Find stuck orders.
  const stuck = await db.queryAll<StuckRow>(
    `SELECT id, user_id, updated_at
       FROM nf_orders
      WHERE payment_status = 'processing'
        AND updated_at < ?`,
    cutoff,
  ).catch((): StuckRow[] => []);

  if (stuck.length === 0) {
    return NextResponse.json({ ok: true, recovered: 0 });
  }

  // Reset to 'pending' so user can retry. We do not auto-call Toss
  // confirm here — that would race with a possible delayed user click.
  // The user simply hits the retry button and our regular PATCH path
  // handles it (with idempotency guard from nf_payment_attempts).
  let recovered = 0;
  for (const row of stuck) {
    const result = await db.execute(
      `UPDATE nf_orders SET payment_status = 'pending', updated_at = ?
        WHERE id = ? AND payment_status = 'processing'`,
      now, row.id,
    ).catch(() => null);
    if (result && (result as { changes?: number }).changes && (result as { changes?: number }).changes! > 0) {
      recovered++;
    }
  }

  return NextResponse.json({ ok: true, recovered, scanned: stuck.length });
}
