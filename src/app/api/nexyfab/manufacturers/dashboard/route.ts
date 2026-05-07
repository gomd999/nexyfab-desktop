/**
 * GET /api/nexyfab/manufacturers/dashboard
 * Partner-facing dashboard data: KPIs, recent RFQs, availability schedule.
 * Requires: authenticated user with a matching nf_factories row (partner_email).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { findFactoryForPartnerEmail, normPartnerEmail } from '@/lib/partner-factory-access';

export const dynamic = 'force-dynamic';

// ─── DB row types ─────────────────────────────────────────────────────────────

interface FactoryRow {
  id: string;
  name: string;
  region: string;
  status: string;
}

interface QuoteStatsRow {
  quote_count: number;
  avg_response_ms: number | null;
}

interface ContractStatsRow {
  active_count: number;
  completed_count: number;
  total_revenue: number;
}

interface RfqRow {
  id: string;
  shape_name: string | null;
  status: string;
  created_at: number;
  assigned_at: number | null;
  quantity: number | null;
  material: string | null;
}

interface AvailabilityRow {
  schedule: string;
}

// ─── GET handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDbAdapter();

  const factoryRow = await findFactoryForPartnerEmail(authUser.email, { activeOnly: true });
  if (!factoryRow) {
    return NextResponse.json({ error: 'No active factory found for this account' }, { status: 404 });
  }

  const factory: FactoryRow = {
    id: factoryRow.id,
    name: factoryRow.name,
    region: factoryRow.region ?? '',
    status: factoryRow.status ?? 'active',
  };

  const factoryId = factory.id;
  const factoryName = factory.name;
  const emailKey = normPartnerEmail(authUser.email);

  // ── KPIs ────────────────────────────────────────────────────────────────────

  const quoteStats = await db.queryOne<QuoteStatsRow>(
    `SELECT
       COUNT(*) AS quote_count,
       AVG(
         CASE
           WHEN r.assigned_at IS NOT NULL
             THEN (CAST(strftime('%s', q.created_at) AS REAL) * 1000) - r.assigned_at
           ELSE NULL
         END
       ) AS avg_response_ms
     FROM nf_quotes q
     JOIN nf_rfqs r ON q.inquiry_id = r.id
     WHERE q.factory_name = ?
        OR (q.partner_email IS NOT NULL AND LOWER(TRIM(q.partner_email)) = ?)`,
    factoryName, emailKey,
  ).catch(() => null);

  const contractStats = await db.queryOne<ContractStatsRow>(
    `SELECT
       SUM(CASE WHEN status IN ('contracted','in_progress','quality_check','delivered') THEN 1 ELSE 0 END) AS active_count,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
       COALESCE(SUM(CASE WHEN status != 'cancelled' THEN contract_amount ELSE 0 END), 0) AS total_revenue
     FROM nf_contracts
     WHERE factory_name = ?
        OR (partner_email IS NOT NULL AND LOWER(TRIM(partner_email)) = ?)`,
    factoryName, emailKey,
  ).catch(() => null);

  const quoteCount = quoteStats?.quote_count ?? 0;
  const activeOrders = contractStats?.active_count ?? 0;
  const completedCount = contractStats?.completed_count ?? 0;
  const totalRevenueMYR = contractStats?.total_revenue ?? 0;
  const avgResponseHours = quoteStats?.avg_response_ms != null
    ? Math.round(quoteStats.avg_response_ms / 3_600_000)
    : null;
  const winRate = quoteCount > 0
    ? Math.round(((completedCount + activeOrders) / quoteCount) * 100)
    : null;

  const kpis = {
    quoteCount,
    winRate,
    activeOrders,
    totalRevenueMYR,
    avgResponseHours,
  };

  // ── Recent RFQs ─────────────────────────────────────────────────────────────

  const rfqs = await db.queryAll<RfqRow>(
    `SELECT id, shape_name, status, created_at, assigned_at, quantity, material
     FROM nf_rfqs
     WHERE assigned_factory_id = ?
     ORDER BY created_at DESC
     LIMIT 20`,
    factoryId,
  ).catch(() => [] as RfqRow[]);

  // ── Availability schedule ───────────────────────────────────────────────────

  let availability: { schedule: Record<string, { enabled: boolean; from: string; to: string }> } = {
    schedule: {},
  };

  try {
    const availRow = await db.queryOne<AvailabilityRow>(
      'SELECT schedule FROM nf_factory_availability WHERE factory_id = ? LIMIT 1',
      factoryId,
    );
    if (availRow?.schedule) {
      availability = { schedule: JSON.parse(availRow.schedule) };
    }
  } catch {
    // Table may not exist yet — silently return empty
  }

  return NextResponse.json({
    factory: { id: factory.id, name: factory.name, region: factory.region },
    kpis,
    rfqs,
    availability,
  });
}
