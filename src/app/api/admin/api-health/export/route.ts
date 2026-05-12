/**
 * GET /api/admin/api-health/export.csv
 *
 * Streaming CSV download of raw nf_api_usage rows for accounting / tax
 * reconciliation. Per-row resolution rather than aggregated — that's why
 * it's separate from the dashboard endpoints (which only return summaries).
 *
 * Query:
 *   ?windowH=24..720     window (default 168 = 7d, max 720 = 30d)
 *   ?provider=anthropic  filter (optional)
 *
 * Auth: admin. Rows are capped at 100k to avoid blowing up memory; if
 * you need more, slice by time range.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ROWS = 100_000;

interface UsageRow {
  id: string;
  provider: string;
  endpoint: string | null;
  feature: string | null;
  status_code: number | null;
  latency_ms: number;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  user_id: string | null;
  error_message: string | null;
  called_at: number;
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: NextRequest) {
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = await verifyAdmin(req).catch(() => false);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(req.url);
  const windowH = Math.min(720, Math.max(1, Number(url.searchParams.get('windowH') ?? 168) || 168));
  const provider = url.searchParams.get('provider');
  const since = Date.now() - windowH * 60 * 60 * 1000;

  const db = getDbAdapter();
  const rows = await db.queryAll<UsageRow>(
    `SELECT id, provider, endpoint, feature, status_code, latency_ms,
            tokens_in, tokens_out, cost_usd, user_id, error_message, called_at
       FROM nf_api_usage
       WHERE called_at >= ?
         ${provider ? 'AND provider = ?' : ''}
       ORDER BY called_at DESC
       LIMIT ?`,
    ...(provider ? [since, provider, MAX_ROWS] : [since, MAX_ROWS]),
  ).catch((): UsageRow[] => []);

  const header = [
    'id', 'called_at_iso', 'provider', 'endpoint', 'feature',
    'status_code', 'latency_ms', 'tokens_in', 'tokens_out',
    'cost_usd', 'user_id', 'error_message',
  ].join(',');

  const body = rows.map(r => [
    csvEscape(r.id),
    csvEscape(new Date(Number(r.called_at)).toISOString()),
    csvEscape(r.provider),
    csvEscape(r.endpoint),
    csvEscape(r.feature),
    csvEscape(r.status_code),
    csvEscape(r.latency_ms),
    csvEscape(r.tokens_in),
    csvEscape(r.tokens_out),
    csvEscape(r.cost_usd),
    csvEscape(r.user_id),
    csvEscape(r.error_message),
  ].join(',')).join('\n');

  const csv = `${header}\n${body}\n`;
  const filename = `nexyfab-api-usage-${new Date().toISOString().slice(0, 10)}-${windowH}h${provider ? `-${provider}` : ''}.csv`;

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
