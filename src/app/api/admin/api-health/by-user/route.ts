/**
 * GET /api/admin/api-health/by-user
 *
 * Top users by AI cost / call volume. Answers "which user is burning
 * tokens?" — useful for catching abuse (prompt injection, runaway agents)
 * and for understanding which paying users are most engaged.
 *
 * Joined against nf_users for email + plan so the operator can drill
 * straight to the account.
 *
 * Query:
 *   ?windowH=1..720      lookback hours (default 24)
 *   ?provider=anthropic  filter to one provider (optional)
 *   ?sortBy=cost|calls   sort key (default cost)
 *   ?limit=20            max rows (default 20, max 100)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface UserCostRow {
  user_id: string;
  email: string | null;
  plan: string | null;
  calls: number;
  errors: number;
  cost_usd: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
}

export async function GET(req: NextRequest) {
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = await verifyAdmin(req).catch(() => false);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(req.url);
  const windowH = Math.min(720, Math.max(1, Number(url.searchParams.get('windowH') ?? 24) || 24));
  const provider = url.searchParams.get('provider');
  const sortBy = url.searchParams.get('sortBy') === 'calls' ? 'calls' : 'cost_usd';
  const limit = Math.min(100, Math.max(5, Number(url.searchParams.get('limit') ?? 20) || 20));
  const since = Date.now() - windowH * 60 * 60 * 1000;

  const db = getDbAdapter();

  // LEFT JOIN nf_users so we can show emails. user_id null rows skipped —
  // those are anonymous calls (e.g., cron-issued or webhook-driven).
  const rows = await db.queryAll<UserCostRow>(
    `SELECT
       u.user_id, nfu.email, nfu.plan,
       COUNT(*)  AS calls,
       SUM(CASE WHEN u.status_code = 0 OR u.status_code >= 500 THEN 1 ELSE 0 END) AS errors,
       SUM(COALESCE(u.cost_usd, 0)) AS cost_usd,
       SUM(u.tokens_in)  AS tokens_in,
       SUM(u.tokens_out) AS tokens_out
     FROM nf_api_usage u
     LEFT JOIN nf_users nfu ON nfu.id = u.user_id
     WHERE u.called_at >= ?
       AND u.user_id IS NOT NULL
       ${provider ? 'AND u.provider = ?' : ''}
     GROUP BY u.user_id, nfu.email, nfu.plan
     ORDER BY ${sortBy} DESC NULLS LAST
     LIMIT ?`,
    ...(provider ? [since, provider, limit] : [since, limit]),
  ).catch(async () => {
    // SQLite: no NULLS LAST.
    return db.queryAll<UserCostRow>(
      `SELECT
         u.user_id, nfu.email, nfu.plan,
         COUNT(*)  AS calls,
         SUM(CASE WHEN u.status_code = 0 OR u.status_code >= 500 THEN 1 ELSE 0 END) AS errors,
         SUM(COALESCE(u.cost_usd, 0)) AS cost_usd,
         SUM(u.tokens_in)  AS tokens_in,
         SUM(u.tokens_out) AS tokens_out
       FROM nf_api_usage u
       LEFT JOIN nf_users nfu ON nfu.id = u.user_id
       WHERE u.called_at >= ?
         AND u.user_id IS NOT NULL
         ${provider ? 'AND u.provider = ?' : ''}
       GROUP BY u.user_id, nfu.email, nfu.plan
       ORDER BY ${sortBy} DESC
       LIMIT ?`,
      ...(provider ? [since, provider, limit] : [since, limit]),
    ).catch((): UserCostRow[] => []);
  });

  // Also expose totals so the UI can compute % of total for each user.
  const totalRow = await db.queryOne<{ total_cost: number | null; total_calls: number }>(
    `SELECT SUM(COALESCE(cost_usd, 0)) AS total_cost, COUNT(*) AS total_calls
       FROM nf_api_usage
      WHERE called_at >= ?
      ${provider ? 'AND provider = ?' : ''}`,
    ...(provider ? [since, provider] : [since]),
  ).catch(() => null);

  return NextResponse.json({
    ok: true,
    window: { hours: windowH },
    totals: {
      cost: totalRow?.total_cost == null ? 0 : Number(totalRow.total_cost),
      calls: Number(totalRow?.total_calls ?? 0),
    },
    rows: rows.map(r => ({
      userId: r.user_id,
      email: r.email,
      plan: r.plan,
      calls: Number(r.calls),
      errors: Number(r.errors),
      errorRate: Number(r.calls) > 0 ? Number(r.errors) / Number(r.calls) : 0,
      costUsd: r.cost_usd == null ? 0 : Number(r.cost_usd),
      tokensIn: r.tokens_in == null ? 0 : Number(r.tokens_in),
      tokensOut: r.tokens_out == null ? 0 : Number(r.tokens_out),
    })),
  });
}
