/**
 * GET /api/admin/partner-kpi
 * Per-factory performance KPI for admin dashboard.
 *
 * Returns per-factory:
 *  - avgResponseHours: average hours from RFQ assignment → first quote submitted
 *  - quoteCount: total quotes submitted
 *  - winRate: accepted contracts / quotes submitted (%)
 *  - completionRate: completed contracts / total contracts (%)
 *  - activeCount: in-progress contracts
 *  - completedCount: completed contracts
 *  - cancelledCount: cancelled contracts
 *  - avgDaysOverdue: average days past deadline for overdue contracts
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { normPartnerEmail } from '@/lib/partner-factory-access';

export const dynamic = 'force-dynamic';

export interface PartnerKPI {
  factoryId: string;
  factoryName: string;
  partnerEmail: string | null;
  quoteCount: number;
  avgResponseHours: number | null;
  winRate: number | null;          // 0-100
  completionRate: number | null;   // 0-100
  activeCount: number;
  completedCount: number;
  cancelledCount: number;
  avgDaysOverdue: number | null;
  totalRevenue: number;
}

export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDbAdapter();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // 1. All factories
  type FactoryRow = { id: string; name: string; partner_email: string | null; contact_email: string | null };
  const factories = await db.queryAll<FactoryRow>(
    'SELECT id, name, partner_email, contact_email FROM nf_factories ORDER BY name ASC',
  ).catch((): FactoryRow[] => []);

  if (factories.length === 0) {
    return NextResponse.json({ partners: [], total: 0 });
  }

  const kpis: PartnerKPI[] = [];

  for (const f of factories) {
    const emailKeys = [...new Set(
      [normPartnerEmail(f.partner_email), normPartnerEmail(f.contact_email ?? '')].filter(k => k.length > 0),
    )];
    const inPh = emailKeys.map(() => '?').join(', ');
    const partnerQuoteMatch = emailKeys.length
      ? `(q.partner_email IS NOT NULL AND LOWER(TRIM(q.partner_email)) IN (${inPh}))`
      : '0';

    // ── Quote count + average response time ───────────────────────────────────
    // Response time = quote.created_at (ISO) – rfq.assigned_at (ms timestamp)
    // 데모 격리: 원본 RFQ user_id='demo-user' 제외.
    type QuoteRow = { cnt: number; avg_response_ms: number | null };
    const quoteStats = await db.queryOne<QuoteRow>(
      `SELECT
         COUNT(*) AS cnt,
         AVG(
           CASE
             WHEN r.assigned_at IS NOT NULL
               THEN (CAST(strftime('%s', q.created_at) AS REAL) * 1000) - r.assigned_at
             ELSE NULL
           END
         ) AS avg_response_ms
       FROM nf_quotes q
       JOIN nf_rfqs r ON q.inquiry_id = r.id
       WHERE (q.factory_name IN (SELECT name FROM nf_factories WHERE id = ?)
          OR ${partnerQuoteMatch})
         AND r.user_id <> 'demo-user'`,
      f.id, ...emailKeys,
    ).catch(() => null);

    const quoteCount = quoteStats?.cnt ?? 0;
    const avgResponseHours = quoteStats?.avg_response_ms != null
      ? Math.round(quoteStats.avg_response_ms / 3_600_000)
      : null;

    // ── Contract stats ────────────────────────────────────────────────────────
    type ContractStats = {
      total_cnt: number; active_cnt: number; completed_cnt: number;
      cancelled_cnt: number; total_revenue: number;
    };
    const partnerContractMatch = emailKeys.length
      ? `(c.partner_email IS NOT NULL AND LOWER(TRIM(c.partner_email)) IN (${inPh}))`
      : '0';
    const contractStats = await db.queryOne<ContractStats>(
      `SELECT
         COUNT(*) AS total_cnt,
         SUM(CASE WHEN status IN ('contracted','in_progress','quality_check','delivered') THEN 1 ELSE 0 END) AS active_cnt,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_cnt,
         SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_cnt,
         COALESCE(SUM(CASE WHEN status != 'cancelled' THEN contract_amount ELSE 0 END), 0) AS total_revenue
       FROM nf_contracts c
       WHERE (${partnerContractMatch} OR c.factory_name = (SELECT name FROM nf_factories WHERE id = ? LIMIT 1))
         AND NOT EXISTS (
           SELECT 1 FROM nf_quotes q JOIN nf_rfqs r ON r.id = q.inquiry_id
             WHERE q.id = c.quote_id AND r.user_id = 'demo-user'
         )`,
      ...emailKeys, f.id,
    ).catch(() => null);

    const activeCount = contractStats?.active_cnt ?? 0;
    const completedCount = contractStats?.completed_cnt ?? 0;
    const cancelledCount = contractStats?.cancelled_cnt ?? 0;
    const totalContracts = contractStats?.total_cnt ?? 0;
    const totalRevenue = contractStats?.total_revenue ?? 0;

    // Win rate: accepted contracts / quotes submitted
    const winRate = quoteCount > 0
      ? Math.round(((completedCount + activeCount) / quoteCount) * 100)
      : null;

    // Completion rate: completed / (total non-cancelled)
    const nonCancelled = totalContracts - cancelledCount;
    const completionRate = nonCancelled > 0
      ? Math.round((completedCount / nonCancelled) * 100)
      : null;

    // Average days overdue for active contracts past deadline
    type OverdueRow = { avg_overdue_days: number | null };
    const partnerOverdueMatch = emailKeys.length
      ? `(partner_email IS NOT NULL AND LOWER(TRIM(partner_email)) IN (${inPh}))`
      : '0';
    const overdueStats = await db.queryOne<OverdueRow>(
      `SELECT AVG(
         CASE
           WHEN deadline < ? AND status NOT IN ('completed','cancelled','delivered')
           THEN CAST((julianday(?) - julianday(deadline)) AS REAL)
           ELSE NULL
         END
       ) AS avg_overdue_days
       FROM nf_contracts
       WHERE (${partnerOverdueMatch} OR factory_name = (SELECT name FROM nf_factories WHERE id = ? LIMIT 1))
         AND deadline IS NOT NULL`,
      nowIso, nowIso, ...emailKeys, f.id,
    ).catch(() => null);

    const avgDaysOverdue = overdueStats?.avg_overdue_days != null
      ? Math.round(overdueStats.avg_overdue_days)
      : null;

    kpis.push({
      factoryId: f.id,
      factoryName: f.name,
      partnerEmail: f.partner_email,
      quoteCount,
      avgResponseHours,
      winRate,
      completionRate,
      activeCount,
      completedCount,
      cancelledCount,
      avgDaysOverdue: avgDaysOverdue && avgDaysOverdue > 0 ? avgDaysOverdue : null,
      totalRevenue,
    });
  }

  // Sort by completed contracts desc, then by win rate desc
  kpis.sort((a, b) => b.completedCount - a.completedCount || (b.winRate ?? 0) - (a.winRate ?? 0));

  return NextResponse.json({ partners: kpis, total: kpis.length });
}
