/**
 * GET /api/nexyfab/admin/ai-usage-timeseries
 *
 * Daily AI cost rollup for the last N days. Drives the /admin/ai-usage
 * dashboard chart so ops can spot cost spikes and identify whales.
 *
 * Query params:
 *   days   — window length (default 30, max 90)
 *   userId — optional filter to a single user's series
 *
 * Returns:
 *   { days, series: [{ day: 'YYYY-MM-DD', cents, calls }],
 *     topUsers: [{ userId, cents, calls }] }
 *
 * Auth: super_admin / org_admin only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

interface UsageRow {
  user_id: string;
  metadata: string | null;
  created_at: number;
  product: string;
}

const VALID_PRODUCTS = ['nexyfab', 'nexyflow', 'nexywise'] as const;
type ValidProduct = typeof VALID_PRODUCTS[number];

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = authUser.globalRole === 'super_admin'
    || (authUser.roles?.some(r => r.role === 'org_admin' as string) ?? false);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const days = Math.max(1, Math.min(90,
    parseInt(req.nextUrl.searchParams.get('days') ?? '30', 10),
  ));
  const userIdFilter = req.nextUrl.searchParams.get('userId') ?? undefined;
  const productRaw = req.nextUrl.searchParams.get('product');
  const productFilter: ValidProduct | undefined =
    productRaw && (VALID_PRODUCTS as readonly string[]).includes(productRaw)
      ? productRaw as ValidProduct
      : undefined;
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;

  const db = getDbAdapter();
  // Pull raw prompt_call rows in window. Cost is buried in metadata JSON;
  // parsing client-side is cheaper than a JSON1 extension dependency.
  // Build the WHERE dynamically — both filters are optional.
  const wheres: string[] = ["metric = 'prompt_call'", 'created_at >= ?'];
  const args: unknown[] = [sinceMs];
  if (userIdFilter)  { wheres.push('user_id = ?'); args.push(userIdFilter); }
  if (productFilter) { wheres.push('product = ?'); args.push(productFilter); }
  const sql = `SELECT user_id, metadata, created_at, product
                 FROM nf_usage_events
                WHERE ${wheres.join(' AND ')}`;
  const rows = await db.queryAll<UsageRow>(sql, ...args).catch(() => [] as UsageRow[]);

  // Bucket by ISO day in UTC. Per-user totals collected in parallel.
  const bucketByDay = new Map<string, { cents: number; calls: number }>();
  const byUser = new Map<string, { cents: number; calls: number }>();
  for (const r of rows) {
    const day = new Date(r.created_at).toISOString().slice(0, 10);
    let cents = 0;
    if (r.metadata) {
      try {
        const m = JSON.parse(r.metadata) as { costCents?: number };
        if (typeof m?.costCents === 'number' && Number.isFinite(m.costCents)) cents = m.costCents;
      } catch { /* malformed JSON — count as zero cost but still a call */ }
    }
    const dayBucket = bucketByDay.get(day) ?? { cents: 0, calls: 0 };
    dayBucket.cents += cents; dayBucket.calls += 1;
    bucketByDay.set(day, dayBucket);
    const userBucket = byUser.get(r.user_id) ?? { cents: 0, calls: 0 };
    userBucket.cents += cents; userBucket.calls += 1;
    byUser.set(r.user_id, userBucket);
  }

  // Fill missing days with zeros so the chart x-axis is continuous.
  const series: Array<{ day: string; cents: number; calls: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const day = d.toISOString().slice(0, 10);
    const b = bucketByDay.get(day) ?? { cents: 0, calls: 0 };
    series.push({ day, cents: b.cents, calls: b.calls });
  }

  const topUsers = Array.from(byUser.entries())
    .map(([userId, v]) => ({ userId, cents: v.cents, calls: v.calls }))
    .sort((a, b) => b.cents - a.cents)
    .slice(0, 10);

  // Per-product breakdown gives operators a quick read on which product
  // is driving spend, without needing a second round-trip.
  const byProduct = new Map<string, { cents: number; calls: number }>();
  for (const r of rows) {
    let cents = 0;
    if (r.metadata) {
      try {
        const m = JSON.parse(r.metadata) as { costCents?: number };
        if (typeof m?.costCents === 'number' && Number.isFinite(m.costCents)) cents = m.costCents;
      } catch { /* ignore */ }
    }
    const b = byProduct.get(r.product) ?? { cents: 0, calls: 0 };
    b.cents += cents; b.calls += 1;
    byProduct.set(r.product, b);
  }
  const products = Array.from(byProduct.entries())
    .map(([product, v]) => ({ product, cents: v.cents, calls: v.calls }))
    .sort((a, b) => b.cents - a.cents);

  return NextResponse.json({
    days,
    series,
    topUsers,
    products,
    ...(userIdFilter ? { userId: userIdFilter } : {}),
    ...(productFilter ? { product: productFilter } : {}),
  });
}
