/**
 * GET /api/admin/partner-cutover
 *
 * Reads `nf_partner_legacy_session_hits` (populated by
 * `getPartnerAuth` whenever the legacy opaque-session branch fires) and
 * returns aggregates so the platform team can decide when to cut over
 * the legacy → NexySys SSO migration.
 *
 * Returns:
 *   daily: [{ day, hits, partners }]   // last `days` days
 *   topPartners: [{ partner_id, hits, lastDay, email?, company? }]
 *   totals: { totalHits, distinctPartners, last7DayHits, last30DayHits }
 *
 * Joins partner identity from `nf_users` where possible so the dashboard
 * can show recognisable names instead of opaque UUIDs.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

interface DailyRow { day: string; hits: number; partners: number; }
interface TopRow {
  partner_id: string;
  hits: number;
  lastDay: string;
  email?: string;
  company?: string;
}

export async function GET(req: NextRequest) {
  const isAdmin = await verifyAdmin(req);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const days = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get('days') || '30', 10) || 30, 1), 180);
  const topLimit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get('top') || '20', 10) || 20, 1), 100);

  const db = getDbAdapter();

  // Daily aggregate.
  const daily = await db.queryAll<DailyRow>(
    `SELECT day,
            SUM(hits) AS hits,
            COUNT(DISTINCT partner_id) AS partners
       FROM nf_partner_legacy_session_hits
       GROUP BY day
       ORDER BY day DESC
       LIMIT ?`,
    days,
  ).catch(() => [] as DailyRow[]);

  // Per-partner top offenders (highest hit count overall).
  const topRaw = await db.queryAll<{ partner_id: string; hits: number; last_day: string }>(
    `SELECT partner_id,
            SUM(hits) AS hits,
            MAX(day)  AS last_day
       FROM nf_partner_legacy_session_hits
       GROUP BY partner_id
       ORDER BY hits DESC
       LIMIT ?`,
    topLimit,
  ).catch(() => [] as { partner_id: string; hits: number; last_day: string }[]);

  // Resolve identities best-effort. Failures (e.g. partner row deleted)
  // leave the row as just the id.
  const topPartners: TopRow[] = [];
  for (const row of topRaw) {
    const u = await db.queryOne<{ email: string; company: string | null }>(
      'SELECT email, company FROM nf_users WHERE id = ?',
      row.partner_id,
    ).catch(() => null);
    topPartners.push({
      partner_id: row.partner_id,
      hits: row.hits,
      lastDay: row.last_day,
      email: u?.email,
      company: u?.company ?? undefined,
    });
  }

  // Headline totals.
  const today = new Date();
  const cutoff7  = new Date(today.getTime() - 7  * 86400_000).toISOString().slice(0, 10);
  const cutoff30 = new Date(today.getTime() - 30 * 86400_000).toISOString().slice(0, 10);

  const totalsRow = await db.queryOne<{ total: number; partners: number }>(
    `SELECT COALESCE(SUM(hits), 0) AS total,
            COUNT(DISTINCT partner_id) AS partners
       FROM nf_partner_legacy_session_hits`,
  ).catch(() => ({ total: 0, partners: 0 }));

  const last7Row = await db.queryOne<{ total: number }>(
    `SELECT COALESCE(SUM(hits), 0) AS total
       FROM nf_partner_legacy_session_hits
       WHERE day >= ?`,
    cutoff7,
  ).catch(() => ({ total: 0 }));

  const last30Row = await db.queryOne<{ total: number }>(
    `SELECT COALESCE(SUM(hits), 0) AS total
       FROM nf_partner_legacy_session_hits
       WHERE day >= ?`,
    cutoff30,
  ).catch(() => ({ total: 0 }));

  return NextResponse.json({
    daily,
    topPartners,
    totals: {
      totalHits:        totalsRow?.total ?? 0,
      distinctPartners: totalsRow?.partners ?? 0,
      last7DayHits:     last7Row?.total ?? 0,
      last30DayHits:    last30Row?.total ?? 0,
    },
    asOf: new Date().toISOString(),
  });
}
