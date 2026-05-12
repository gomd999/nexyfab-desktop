/**
 * L4 — Sim quota lookup endpoint.
 *
 * GET /api/nexyfab/sim-quota
 *
 * Returns the user's current month sim_run usage + plan limit + remaining.
 * Powers the dashboard widget so users can see how many simulations they
 * have left before hitting the monthly cap.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkMonthlyLimit } from '@/lib/plan-guard';
import { getDbAdapter } from '@/lib/db-adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDbAdapter();
  const userPlanRow = await db.queryOne<{ plan: string }>(
    'SELECT plan FROM nf_users WHERE id = ?', auth.userId,
  ).catch(() => null);
  const plan = userPlanRow?.plan ?? 'free';

  const r = await checkMonthlyLimit(auth.userId, plan, 'sim_run');

  // Recent run breakdown by kind (last 30 days).
  const monthStart = Date.now() - 30 * 86_400_000;
  const breakdown = await db.queryAll<{ metadata: string | null; count: number }>(
    `SELECT metadata, COUNT(*) as count
       FROM nf_usage_events
      WHERE user_id = ? AND metric = 'sim_run' AND created_at > ?
   GROUP BY metadata`,
    auth.userId, monthStart,
  ).catch((): Array<{ metadata: string | null; count: number }> => []);

  const byKind: Record<string, number> = {};
  for (const row of breakdown) {
    let kind = 'unknown';
    try {
      if (row.metadata) {
        const meta = JSON.parse(row.metadata) as { kind?: string };
        if (meta.kind) kind = meta.kind;
      }
    } catch { /* skip */ }
    byKind[kind] = (byKind[kind] ?? 0) + Number(row.count);
  }

  return NextResponse.json({
    ok: true,
    plan,
    metric: 'sim_run',
    used: r.used,
    limit: r.limit,                 // -1 unlimited, -2 plan-locked, else number
    remaining: r.limit > 0 ? Math.max(0, r.limit - r.used) : null,
    byKind,
  });
}
