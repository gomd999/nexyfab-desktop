/**
 * GET /api/nexyfab/admin/cost-overshoot
 *
 * Per-user 24h AI cost roll-up. Used by the admin overshoot dashboard to
 * find which users are at or near the per-user daily budget limit.
 *
 * Returns rows sorted by cents desc, with `over` flag when the user is
 * past the configured `COST_BUDGET_USD_PER_USER_DAILY` (or `?limitUsd=`
 * override).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

const WINDOW_MS = 24 * 60 * 60 * 1000;
const SAMPLE_LIMIT = 50_000;

interface UsageRow {
  user_id: string;
  metadata: string | null;
}

interface CallMeta {
  costCents?: number;
  promptId?: string;
  provider?: string;
}

interface UserSummary {
  userId: string;
  cents: number;
  calls: number;
  topPromptId: string | null;
  topProvider: string | null;
  over: boolean;
}

function topByCount(items: string[]): string | null {
  if (items.length === 0) return null;
  const counts = new Map<string, number>();
  for (const x of items) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = -1;
  for (const [k, v] of counts) {
    if (v > bestCount) { best = k; bestCount = v; }
  }
  return best;
}

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = authUser.globalRole === 'super_admin'
    || (authUser.roles?.some(r => r.role === 'org_admin' as string) ?? false);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const limitOverride = parseFloat(req.nextUrl.searchParams.get('limitUsd') ?? '');
  const envLimit = parseFloat(process.env.COST_BUDGET_USD_PER_USER_DAILY ?? '');
  const limitUsd = Number.isFinite(limitOverride) && limitOverride > 0
    ? limitOverride
    : (Number.isFinite(envLimit) && envLimit > 0 ? envLimit : null);
  const limitCents = limitUsd === null ? null : limitUsd * 100;

  const since = Date.now() - WINDOW_MS;
  const db = getDbAdapter();
  const rows = await db
    .queryAll<UsageRow>(
      `SELECT user_id, metadata FROM nf_usage_events WHERE metric = 'prompt_call' AND created_at > ? LIMIT ${SAMPLE_LIMIT}`,
      since,
    )
    .catch(() => [] as UsageRow[]);

  // Bucket by user_id, accumulate cost + meta context.
  const buckets = new Map<string, { cents: number; calls: number; prompts: string[]; providers: string[] }>();
  for (const r of rows) {
    if (!r.user_id) continue;
    if (!r.metadata) continue;
    let m: CallMeta;
    try { m = JSON.parse(r.metadata) as CallMeta; } catch { continue; }
    const cents = typeof m.costCents === 'number' && m.costCents > 0 ? m.costCents : 0;
    if (!buckets.has(r.user_id)) buckets.set(r.user_id, { cents: 0, calls: 0, prompts: [], providers: [] });
    const b = buckets.get(r.user_id)!;
    b.cents += cents;
    b.calls += 1;
    if (m.promptId) b.prompts.push(m.promptId);
    if (m.provider) b.providers.push(m.provider);
  }

  const summaries: UserSummary[] = [];
  for (const [userId, b] of buckets) {
    summaries.push({
      userId,
      cents: Math.round(b.cents * 100) / 100,
      calls: b.calls,
      topPromptId: topByCount(b.prompts),
      topProvider: topByCount(b.providers),
      over: limitCents !== null && b.cents > limitCents,
    });
  }
  summaries.sort((a, b) => b.cents - a.cents);

  return NextResponse.json({
    windowMs: WINDOW_MS,
    sampleSize: rows.length,
    truncated: rows.length >= SAMPLE_LIMIT,
    limitUsd,
    summary: {
      users: summaries.length,
      over: summaries.filter(s => s.over).length,
      totalCents: Math.round(summaries.reduce((s, u) => s + u.cents, 0) * 100) / 100,
    },
    users: summaries,
  });
}
