/**
 * GET /api/admin/partner-kpi/charts
 * Chart data for the Partner KPI dashboard:
 *   - monthly: 6-month order trend (top 5 partners)
 *   - statusDist: contract status distribution
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

const PALETTE = ['#4f46e5', '#0284c7', '#16a34a', '#d97706', '#db2777'];

export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDbAdapter();
  const sixMonthsAgo = Date.now() - 180 * 24 * 3600_000;

  // ── 1. Monthly orders — top 5 partners by total contracts ─────────────────
  type MonthRow = { month: string; factory_name: string | null; cnt: number };
  const monthRows = await db.queryAll<MonthRow>(
    `SELECT
       strftime('%Y-%m', datetime(c.created_at / 1000, 'unixepoch')) AS month,
       COALESCE(f.name, c.factory_name, c.partner_email) AS factory_name,
       COUNT(*) AS cnt
     FROM nf_contracts c
     LEFT JOIN nf_factories f ON c.partner_email = f.partner_email
     WHERE c.created_at >= ?
     GROUP BY month, COALESCE(f.name, c.factory_name, c.partner_email)
     ORDER BY month ASC, cnt DESC`,
    sixMonthsAgo,
  ).catch((): MonthRow[] => []);

  // Determine top 5 partners by total volume in the period
  const partnerTotals: Record<string, number> = {};
  for (const r of monthRows) {
    if (!r.factory_name) continue;
    partnerTotals[r.factory_name] = (partnerTotals[r.factory_name] ?? 0) + r.cnt;
  }
  const top5 = Object.entries(partnerTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name], idx) => ({ name, color: PALETTE[idx] ?? '#6b7280' }));

  const partnerColors: Record<string, string> = {};
  for (const { name, color } of top5) partnerColors[name] = color;

  // Build month buckets for last 6 months
  const now = new Date();
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const monthly = months.map(m => {
    const partners: Record<string, number> = {};
    for (const { name } of top5) {
      const row = monthRows.find(r => r.month === m && r.factory_name === name);
      partners[name] = row?.cnt ?? 0;
    }
    return { month: m.slice(5), partners }; // "YYYY-MM" → "MM"
  });

  // ── 2. Contract status distribution ───────────────────────────────────────
  type StatusRow = { status: string; cnt: number };
  const statusRows = await db.queryAll<StatusRow>(
    `SELECT status, COUNT(*) AS cnt FROM nf_contracts GROUP BY status ORDER BY cnt DESC`,
  ).catch((): StatusRow[] => []);

  const STATUS_META: Record<string, { label: string; color: string }> = {
    completed:     { label: '완료',       color: '#16a34a' },
    delivered:     { label: '납품완료',   color: '#0284c7' },
    in_progress:   { label: '진행중',     color: '#4f46e5' },
    contracted:    { label: '계약됨',     color: '#7c3aed' },
    quality_check: { label: '품질검사',   color: '#d97706' },
    cancelled:     { label: '취소',       color: '#dc2626' },
    pending:       { label: '대기',       color: '#9ca3af' },
  };

  const statusDist = statusRows.map(r => ({
    label: STATUS_META[r.status]?.label ?? r.status,
    count: r.cnt,
    color: STATUS_META[r.status]?.color ?? '#6b7280',
  }));

  return NextResponse.json({
    monthly,
    partnerColors,
    statusDist,
  });
}
