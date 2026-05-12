/**
 * GET /api/admin/api-health/by-endpoint
 *
 * Provider→endpoint drilldown. The summary view groups by provider; this
 * one breaks each provider down to its endpoints (chat.completions vs
 * embeddings, payments/confirm vs payments/cancel, etc.) so the operator
 * can answer "which exact call is burning money / failing".
 *
 * Query:
 *   ?windowH=1..720           lookback hours (default 24)
 *   ?provider=anthropic       filter (optional, but typical when drilling)
 *   ?limit=50                 max rows (default 50, max 200)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface EndpointRow {
  provider: string;
  endpoint: string | null;
  calls: number;
  errors: number;
  cost_usd: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  avg_latency_ms: number;
  max_latency_ms: number;
}

export async function GET(req: NextRequest) {
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = await verifyAdmin(req).catch(() => false);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(req.url);
  const windowH = Math.min(720, Math.max(1, Number(url.searchParams.get('windowH') ?? 24) || 24));
  const provider = url.searchParams.get('provider');
  const limit = Math.min(200, Math.max(10, Number(url.searchParams.get('limit') ?? 50) || 50));
  const since = Date.now() - windowH * 60 * 60 * 1000;

  const db = getDbAdapter();

  const rows = await db.queryAll<EndpointRow>(
    `SELECT
       provider,
       endpoint,
       COUNT(*) AS calls,
       SUM(CASE WHEN status_code = 0 OR status_code >= 500 THEN 1 ELSE 0 END) AS errors,
       SUM(COALESCE(cost_usd, 0)) AS cost_usd,
       SUM(tokens_in) AS tokens_in,
       SUM(tokens_out) AS tokens_out,
       CAST(AVG(latency_ms) AS INTEGER) AS avg_latency_ms,
       MAX(latency_ms) AS max_latency_ms
     FROM nf_api_usage
     WHERE called_at >= ?
       ${provider ? 'AND provider = ?' : ''}
     GROUP BY provider, endpoint
     ORDER BY calls DESC
     LIMIT ?`,
    ...(provider ? [since, provider, limit] : [since, limit]),
  ).catch((): EndpointRow[] => []);

  return NextResponse.json({
    ok: true,
    window: { hours: windowH },
    rows: rows.map(r => ({
      provider: r.provider,
      endpoint: r.endpoint,
      calls: Number(r.calls),
      errors: Number(r.errors),
      errorRate: Number(r.calls) > 0 ? Number(r.errors) / Number(r.calls) : 0,
      costUsd: r.cost_usd != null ? Number(r.cost_usd) : 0,
      tokensIn: r.tokens_in != null ? Number(r.tokens_in) : 0,
      tokensOut: r.tokens_out != null ? Number(r.tokens_out) : 0,
      avgLatencyMs: Number(r.avg_latency_ms ?? 0),
      maxLatencyMs: Number(r.max_latency_ms ?? 0),
    })),
  });
}
