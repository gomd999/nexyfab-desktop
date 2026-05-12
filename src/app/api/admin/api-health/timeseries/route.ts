/**
 * GET /api/admin/api-health/timeseries
 *
 * Time-bucketed metrics for the dashboard's chart strip. The non-bucketed
 * /api/admin/api-health gives totals; this one gives the curve over time
 * so spike detection (cost runaway, error storm) is visual.
 *
 * Query:
 *   ?bucketM=1|5|60|360|1440  bucket size in minutes (default 60)
 *   ?windowH=1..720           lookback hours (default 24)
 *   ?provider=anthropic       filter to one provider (optional)
 *
 * Bucketing uses `floor(called_at / bucketMs) * bucketMs` so the result
 * is dialect-agnostic (no DATE_TRUNC). Empty buckets are zero-filled.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_BUCKETS = new Set([1, 5, 60, 360, 1440]);

interface BucketRow {
  bucket_ts: number;
  calls: number;
  errors: number;
  cost_usd: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  avg_latency_ms: number;
}

export async function GET(req: NextRequest) {
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = await verifyAdmin(req).catch(() => false);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(req.url);
  const bucketM = Number(url.searchParams.get('bucketM') ?? 60) || 60;
  if (!ALLOWED_BUCKETS.has(bucketM)) {
    return NextResponse.json({
      error: `bucketM must be one of: ${Array.from(ALLOWED_BUCKETS).join(', ')}`,
    }, { status: 400 });
  }
  const windowH = Math.min(720, Math.max(1, Number(url.searchParams.get('windowH') ?? 24) || 24));
  const provider = url.searchParams.get('provider');

  const bucketMs = bucketM * 60 * 1000;
  const now = Date.now();
  const sinceMs = now - windowH * 60 * 60 * 1000;
  // Snap window start to bucket boundary so the X-axis lines up.
  const sinceBucket = Math.floor(sinceMs / bucketMs) * bucketMs;

  const db = getDbAdapter();

  // (called_at / bucketMs) integer division then multiply back. Both
  // Postgres and SQLite support integer arithmetic on BIGINT.
  const rows = await db.queryAll<BucketRow>(
    `SELECT
       (called_at / ? ) * ?  AS bucket_ts,
       COUNT(*)              AS calls,
       SUM(CASE WHEN status_code = 0 OR status_code >= 500 THEN 1 ELSE 0 END) AS errors,
       SUM(COALESCE(cost_usd, 0)) AS cost_usd,
       SUM(tokens_in)        AS tokens_in,
       SUM(tokens_out)       AS tokens_out,
       CAST(AVG(latency_ms) AS INTEGER) AS avg_latency_ms
     FROM nf_api_usage
     WHERE called_at >= ?
       ${provider ? 'AND provider = ?' : ''}
     GROUP BY (called_at / ? )
     ORDER BY bucket_ts ASC`,
    bucketMs, bucketMs, sinceBucket,
    ...(provider ? [provider] : []),
    bucketMs,
  ).catch((): BucketRow[] => []);

  // Zero-fill: chart needs continuous buckets, not just the ones with data.
  // Cap at 1440 buckets so a 30d × 1min query (43k buckets) doesn't OOM.
  const bucketCount = Math.min(1440, Math.ceil((now - sinceBucket) / bucketMs));
  const dataMap = new Map<number, BucketRow>();
  for (const r of rows) dataMap.set(Number(r.bucket_ts), r);

  const series: Array<{
    ts: number; calls: number; errors: number; costUsd: number;
    tokensIn: number; tokensOut: number; avgLatencyMs: number;
  }> = [];
  for (let i = 0; i < bucketCount; i++) {
    const ts = sinceBucket + i * bucketMs;
    const row = dataMap.get(ts);
    series.push({
      ts,
      calls: row ? Number(row.calls) : 0,
      errors: row ? Number(row.errors) : 0,
      costUsd: row?.cost_usd != null ? Number(row.cost_usd) : 0,
      tokensIn: row?.tokens_in != null ? Number(row.tokens_in) : 0,
      tokensOut: row?.tokens_out != null ? Number(row.tokens_out) : 0,
      avgLatencyMs: row ? Number(row.avg_latency_ms ?? 0) : 0,
    });
  }

  return NextResponse.json({
    ok: true,
    window: { hours: windowH, bucketMinutes: bucketM, sinceMs: sinceBucket },
    provider: provider ?? null,
    series,
  });
}
