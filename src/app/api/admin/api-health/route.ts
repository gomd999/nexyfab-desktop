/**
 * GET /api/admin/api-health
 *
 * Read-only summary for the admin observability dashboard. Aggregates
 * nf_api_usage by provider over a window (default 24h) so the operator
 * can see at-a-glance: who am I calling, how often, how much, and how
 * many failures.
 *
 * Query params:
 *   ?windowH=24        — window in hours (default 24, max 720 = 30d)
 *   ?provider=anthropic — filter to one provider (optional)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ProviderRow {
  provider: string;
  calls: number;
  errors: number;
  total_tokens_in: number | null;
  total_tokens_out: number | null;
  total_cost_usd: number | null;
  avg_latency_ms: number;
  p95_latency_ms: number | null;
}

interface RecentErrorRow {
  provider: string;
  endpoint: string | null;
  error_message: string;
  called_at: number;
}

export async function GET(req: NextRequest) {
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = await verifyAdmin(req).catch(() => false);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(req.url);
  const windowH = Math.min(720, Math.max(1, Number(url.searchParams.get('windowH') ?? 24) || 24));
  const provider = url.searchParams.get('provider');
  const since = Date.now() - windowH * 60 * 60 * 1000;

  const db = getDbAdapter();

  // P95 differs by dialect: Postgres has percentile_cont, SQLite doesn't.
  // Try Postgres first; on failure fall back to a no-p95 query so the
  // dashboard still renders during local dev.
  let providers: ProviderRow[] = [];
  try {
    providers = await db.queryAll<ProviderRow>(
      `SELECT
         provider,
         COUNT(*)::int                                AS calls,
         SUM(CASE WHEN status_code = 0 OR status_code >= 500 THEN 1 ELSE 0 END)::int AS errors,
         SUM(tokens_in)                               AS total_tokens_in,
         SUM(tokens_out)                              AS total_tokens_out,
         ROUND(SUM(COALESCE(cost_usd, 0))::numeric, 4) AS total_cost_usd,
         ROUND(AVG(latency_ms)::numeric, 0)::int      AS avg_latency_ms,
         ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::numeric, 0)::int AS p95_latency_ms
       FROM nf_api_usage
       WHERE called_at >= ?
         ${provider ? 'AND provider = ?' : ''}
       GROUP BY provider
       ORDER BY calls DESC`,
      ...(provider ? [since, provider] : [since]),
    );
  } catch {
    providers = await db.queryAll<ProviderRow>(
      `SELECT provider,
              COUNT(*) AS calls,
              SUM(CASE WHEN status_code = 0 OR status_code >= 500 THEN 1 ELSE 0 END) AS errors,
              SUM(tokens_in) AS total_tokens_in,
              SUM(tokens_out) AS total_tokens_out,
              SUM(COALESCE(cost_usd, 0)) AS total_cost_usd,
              CAST(AVG(latency_ms) AS INTEGER) AS avg_latency_ms,
              NULL AS p95_latency_ms
         FROM nf_api_usage
         WHERE called_at >= ?
           ${provider ? 'AND provider = ?' : ''}
         GROUP BY provider
         ORDER BY calls DESC`,
      ...(provider ? [since, provider] : [since]),
    ).catch((): ProviderRow[] => []);
  }

  // Most recent failures across all providers — gives the operator a
  // jump-off point to investigate without paging.
  const recentErrors = await db.queryAll<RecentErrorRow>(
    `SELECT provider, endpoint, error_message, called_at
       FROM nf_api_usage
      WHERE called_at >= ?
        AND error_message IS NOT NULL
        ${provider ? 'AND provider = ?' : ''}
      ORDER BY called_at DESC
      LIMIT 30`,
    ...(provider ? [since, provider] : [since]),
  ).catch((): RecentErrorRow[] => []);

  // Top features by cost — answers "where is the AI spend going?".
  const topFeatures = await db.queryAll<{ feature: string | null; calls: number; cost_usd: number | null }>(
    `SELECT feature,
            COUNT(*) AS calls,
            SUM(COALESCE(cost_usd, 0)) AS cost_usd
       FROM nf_api_usage
      WHERE called_at >= ?
        AND feature IS NOT NULL
        ${provider ? 'AND provider = ?' : ''}
      GROUP BY feature
      ORDER BY cost_usd DESC NULLS LAST
      LIMIT 10`,
    ...(provider ? [since, provider] : [since]),
  ).catch(async () => {
    return db.queryAll<{ feature: string | null; calls: number; cost_usd: number | null }>(
      `SELECT feature,
              COUNT(*) AS calls,
              SUM(COALESCE(cost_usd, 0)) AS cost_usd
         FROM nf_api_usage
        WHERE called_at >= ?
          AND feature IS NOT NULL
          ${provider ? 'AND provider = ?' : ''}
        GROUP BY feature
        ORDER BY cost_usd DESC
        LIMIT 10`,
      ...(provider ? [since, provider] : [since]),
    ).catch((): Array<{ feature: string | null; calls: number; cost_usd: number | null }> => []);
  });

  // ── Forecast ─────────────────────────────────────────────────────────
  // Linear extrapolation: take the last 1h cost rate, project against the
  // hourly + daily caps. Gives the operator an "ETA to auto-trip" so they
  // can intervene before the breaker fires.
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const lastHourRow = await db.queryOne<{ cost_usd: number | null; minutes_span: number }>(
    `SELECT SUM(COALESCE(cost_usd, 0)) AS cost_usd,
            CAST((? - MIN(called_at)) / 60000 AS INTEGER) AS minutes_span
       FROM nf_api_usage
      WHERE called_at >= ?
        ${provider ? 'AND provider = ?' : ''}`,
    ...(provider ? [Date.now(), oneHourAgo, provider] : [Date.now(), oneHourAgo]),
  ).catch(() => null);

  const { getSetting } = await import('@/lib/admin-settings');
  const hourlyCap = await getSetting('budget.hourly_usd_cap').then(v => v ? Number(v) : null);
  const dailyCap = await getSetting('budget.daily_usd_cap').then(v => v ? Number(v) : null);

  const lastHourCost = Number(lastHourRow?.cost_usd ?? 0);
  // Per-minute rate, normalised so a partial hour doesn't over/under-estimate.
  const minutesSpan = Math.max(1, Math.min(60, Number(lastHourRow?.minutes_span ?? 60)));
  const costPerMinute = lastHourCost / minutesSpan;

  function etaMinutes(cap: number | null, currentCost: number): number | null {
    if (!cap || costPerMinute <= 0) return null;
    const remaining = cap - currentCost;
    if (remaining <= 0) return 0;
    return Math.round(remaining / costPerMinute);
  }
  const forecast = {
    costPerMinute: Math.round(costPerMinute * 100_000) / 100_000,
    hourlyEtaMin: etaMinutes(hourlyCap, lastHourCost),
    dailyEtaMin: etaMinutes(dailyCap, Number(providers.reduce((s, p) => s + (p.total_cost_usd ?? 0), 0))),
    hourlyCap,
    dailyCap,
  };

  return NextResponse.json({
    ok: true,
    window: { hours: windowH, sinceMs: since },
    forecast,
    providers: providers.map(p => ({
      provider: p.provider,
      calls: Number(p.calls),
      errors: Number(p.errors),
      errorRate: p.calls > 0 ? Number(p.errors) / Number(p.calls) : 0,
      totalTokensIn: p.total_tokens_in == null ? null : Number(p.total_tokens_in),
      totalTokensOut: p.total_tokens_out == null ? null : Number(p.total_tokens_out),
      totalCostUsd: p.total_cost_usd == null ? null : Number(p.total_cost_usd),
      avgLatencyMs: Number(p.avg_latency_ms ?? 0),
      p95LatencyMs: p.p95_latency_ms == null ? null : Number(p.p95_latency_ms),
    })),
    recentErrors: recentErrors.map(e => ({
      provider: e.provider,
      endpoint: e.endpoint,
      message: e.error_message,
      calledAt: Number(e.called_at),
    })),
    topFeatures: topFeatures.map(f => ({
      feature: f.feature,
      calls: Number(f.calls),
      costUsd: f.cost_usd == null ? 0 : Number(f.cost_usd),
    })),
  });
}
