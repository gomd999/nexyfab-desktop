/**
 * GET /api/admin/analytics
 *
 * Returns all billing analytics in one call:
 *   summary       — MRR, active subs, failed payments, total users
 *   monthlyRevenue — last 12 months, by product
 *   byCountry     — revenue + count per country
 *   retryFunnel   — attempt counts by attempt_number and outcome
 *   topUsage      — top 20 users by usage this cycle
 *   planDist      — subscription counts by plan
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

// ── In-memory cache (60 s TTL, admin-only endpoint) ──────────────────────────
let _cache: { data: unknown; expiresAt: number } | null = null;
const CACHE_TTL = 60_000;

export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Serve from cache if fresh; bust with ?refresh=1
  if (_cache && _cache.expiresAt > Date.now() && req.nextUrl.searchParams.get('refresh') !== '1') {
    return NextResponse.json(_cache.data, { headers: { 'X-Cache': 'HIT' } });
  }

  const db = getDbAdapter();

  const [
    summaryRows,
    monthlyRevenue,
    byCountry,
    retryFunnel,
    topUsage,
    planDist,
    recentFailures,
  ] = await Promise.all([

    // ── Summary KPIs ─────────────────────────────────────────────────────────
    db.queryAll<{ key: string; value: number }>(
      `SELECT 'active_subs'   AS key, COUNT(*) AS value FROM nf_aw_subscriptions WHERE status = 'active'
       UNION ALL
       SELECT 'paid_invoices_mtd', COUNT(*) FROM nf_aw_invoices
         WHERE status = 'paid' AND created_at >= strftime('%s', date('now','start of month')) * 1000
       UNION ALL
       SELECT 'revenue_krw_mtd', COALESCE(SUM(total_amount_krw), 0) FROM nf_aw_invoices
         WHERE status = 'paid' AND created_at >= strftime('%s', date('now','start of month')) * 1000
       UNION ALL
       SELECT 'failed_mtd', COUNT(*) FROM nf_aw_payment_attempts
         WHERE status = 'failed' AND attempted_at >= strftime('%s', date('now','start of month')) * 1000
       UNION ALL
       SELECT 'retry_queue', COUNT(*) FROM nf_aw_payment_attempts
         WHERE status = 'failed' AND next_retry_at IS NOT NULL
       UNION ALL
       SELECT 'total_users', COUNT(*) FROM nf_users`,
    ),

    // ── Monthly revenue (last 12 months) ─────────────────────────────────────
    db.queryAll<{ month: string; product: string; revenue_krw: number; count: number }>(
      `SELECT
         strftime('%Y-%m', datetime(created_at / 1000, 'unixepoch')) AS month,
         product,
         SUM(total_amount_krw)  AS revenue_krw,
         COUNT(*)               AS count
       FROM nf_aw_invoices
       WHERE status = 'paid'
         AND created_at >= strftime('%s', date('now', '-11 months', 'start of month')) * 1000
       GROUP BY month, product
       ORDER BY month ASC`,
    ),

    // ── Revenue by country ────────────────────────────────────────────────────
    db.queryAll<{ country: string; revenue_krw: number; count: number }>(
      `SELECT
         country,
         SUM(total_amount_krw) AS revenue_krw,
         COUNT(*)              AS count
       FROM nf_aw_invoices
       WHERE status = 'paid'
       GROUP BY country
       ORDER BY revenue_krw DESC
       LIMIT 20`,
    ),

    // ── Retry funnel ──────────────────────────────────────────────────────────
    db.queryAll<{ attempt_number: number; status: string; count: number }>(
      `SELECT attempt_number, status, COUNT(*) AS count
       FROM nf_aw_payment_attempts
       GROUP BY attempt_number, status
       ORDER BY attempt_number ASC`,
    ),

    // ── Top 20 users by usage this billing cycle ──────────────────────────────
    db.queryAll<{ user_id: string; email: string; name: string; product: string; total: number }>(
      `SELECT ue.user_id, u.email, u.name, ue.product, SUM(ue.quantity) AS total
       FROM nf_usage_events ue
       LEFT JOIN nf_users u ON u.id = ue.user_id
       WHERE ue.cycle_start = strftime('%s', date('now','start of month')) * 1000
       GROUP BY ue.user_id, ue.product
       ORDER BY total DESC
       LIMIT 20`,
    ),

    // ── Plan distribution ─────────────────────────────────────────────────────
    db.queryAll<{ plan: string; count: number; product: string }>(
      `SELECT plan, product, COUNT(*) AS count
       FROM nf_aw_subscriptions
       WHERE status = 'active'
       GROUP BY plan, product
       ORDER BY plan ASC`,
    ),

    // ── Recent failures (last 20) ─────────────────────────────────────────────
    db.queryAll<{
      id: string; invoice_id: string; email: string;
      attempt_number: number; error_message: string | null;
      attempted_at: number; next_retry_at: number | null;
    }>(
      `SELECT pa.id, pa.invoice_id, u.email,
              pa.attempt_number, pa.error_message,
              pa.attempted_at, pa.next_retry_at
       FROM nf_aw_payment_attempts pa
       LEFT JOIN nf_aw_invoices inv ON inv.id = pa.invoice_id
       LEFT JOIN nf_users u ON u.id = inv.user_id
       WHERE pa.status = 'failed'
       ORDER BY pa.attempted_at DESC
       LIMIT 20`,
    ),
  ]);

  const summary = Object.fromEntries(summaryRows.map(r => [r.key, r.value]));

  // Build monthly revenue as { month, nexyfab, nexyflow, nexywise, total }
  const monthMap: Record<string, Record<string, number>> = {};
  for (const r of monthlyRevenue) {
    if (!monthMap[r.month]) monthMap[r.month] = { nexyfab: 0, nexyflow: 0, nexywise: 0 };
    monthMap[r.month][r.product] = (monthMap[r.month][r.product] ?? 0) + r.revenue_krw;
  }
  const monthlyChart = Object.entries(monthMap).map(([month, products]) => ({
    month,
    ...products,
    total: Object.values(products).reduce((a, b) => a + b, 0),
  }));

  // Build retry funnel as [{attempt, succeeded, failed, total}]
  const funnelMap: Record<number, { succeeded: number; failed: number; pending: number }> = {};
  for (const r of retryFunnel) {
    if (!funnelMap[r.attempt_number]) funnelMap[r.attempt_number] = { succeeded: 0, failed: 0, pending: 0 };
    funnelMap[r.attempt_number][r.status as 'succeeded' | 'failed' | 'pending'] += r.count;
  }
  const funnelChart = Object.entries(funnelMap).map(([attempt, counts]) => ({
    attempt:   parseInt(attempt),
    ...counts,
    total:     counts.succeeded + counts.failed + counts.pending,
    successPct: counts.succeeded + counts.failed > 0
      ? Math.round(counts.succeeded / (counts.succeeded + counts.failed) * 100)
      : null,
  }));

  const payload = {
    summary,
    monthlyChart,
    byCountry,
    funnelChart,
    topUsage,
    planDist,
    recentFailures,
  };

  _cache = { data: payload, expiresAt: Date.now() + CACHE_TTL };

  return NextResponse.json(payload, { headers: { 'X-Cache': 'MISS' } });
}
