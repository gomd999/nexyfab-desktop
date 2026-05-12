/**
 * GET /api/nexyfab/admin/prompt-stats
 *
 * Aggregates `prompt_call` telemetry events into per-prompt + per-variant
 * stats: count, success rate, latency p50/p95, token usage. Powers the A/B
 * variant comparison dashboard in admin UI.
 *
 * Query params:
 *   sinceDays — defaults 7. Range of history to aggregate.
 *   promptId  — optional filter (e.g. 'shape-chat').
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

interface UsageRow {
  metadata: string | null;
}

interface ParsedCall {
  promptId: string;
  promptVersion?: string;
  provider: string;
  model: string;
  latencyMs: number;
  success: boolean;
  errorClass?: string;
  promptTokens?: number;
  completionTokens?: number;
  costCents?: number;
}

interface VariantStats {
  promptId: string;
  promptVersion?: string;
  count: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  latencyP50: number;
  latencyP95: number;
  latencyMean: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCostCents: number;
  /** Avg cost per call in cents (only over calls with known pricing). */
  avgCostCents: number;
  topErrorClass: string | null;
  topProvider: string | null;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
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

  const sinceDays = Math.max(1, Math.min(90, parseInt(req.nextUrl.searchParams.get('sinceDays') ?? '7', 10)));
  const filterPromptId = req.nextUrl.searchParams.get('promptId') ?? undefined;
  const since = Date.now() - sinceDays * 86_400_000;

  const db = getDbAdapter();
  const rows = await db.queryAll<UsageRow>(
    `SELECT metadata FROM nf_usage_events WHERE metric = 'prompt_call' AND created_at > ? ORDER BY created_at DESC LIMIT 50000`,
    since,
  ).catch(() => [] as UsageRow[]);

  // Bucket by promptId+version. Same id different versions are tracked
  // separately so a v1.0→v1.1 rollout shows up as two rows.
  const buckets = new Map<string, ParsedCall[]>();
  for (const r of rows) {
    if (!r.metadata) continue;
    let m: ParsedCall;
    try { m = JSON.parse(r.metadata) as ParsedCall; } catch { continue; }
    if (!m.promptId) continue;
    if (filterPromptId && m.promptId !== filterPromptId) continue;
    const key = `${m.promptId}@${m.promptVersion ?? '?'}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(m);
  }

  const stats: VariantStats[] = [];
  for (const [, calls] of buckets) {
    if (calls.length === 0) continue;
    const successCount = calls.filter(c => c.success).length;
    const errorCount = calls.length - successCount;
    const successLatencies = calls
      .filter(c => c.success && Number.isFinite(c.latencyMs) && c.latencyMs > 0)
      .map(c => c.latencyMs)
      .sort((a, b) => a - b);
    const meanLatency = successLatencies.length === 0
      ? 0
      : Math.round(successLatencies.reduce((s, x) => s + x, 0) / successLatencies.length);
    const errors = calls.filter(c => !c.success && c.errorClass).map(c => c.errorClass!);
    const providers = calls.map(c => c.provider).filter(Boolean);

    const pricedCalls = calls.filter(c => typeof c.costCents === 'number' && c.costCents > 0);
    const totalCostCents = pricedCalls.reduce((s, c) => s + (c.costCents ?? 0), 0);
    stats.push({
      promptId: calls[0].promptId,
      promptVersion: calls[0].promptVersion,
      count: calls.length,
      successCount,
      errorCount,
      successRate: calls.length > 0 ? successCount / calls.length : 0,
      latencyP50: percentile(successLatencies, 50),
      latencyP95: percentile(successLatencies, 95),
      latencyMean: meanLatency,
      totalPromptTokens: calls.reduce((s, c) => s + (c.promptTokens ?? 0), 0),
      totalCompletionTokens: calls.reduce((s, c) => s + (c.completionTokens ?? 0), 0),
      totalCostCents: Math.round(totalCostCents * 100) / 100,
      avgCostCents: pricedCalls.length > 0 ? Math.round((totalCostCents / pricedCalls.length) * 100) / 100 : 0,
      topErrorClass: topByCount(errors),
      topProvider: topByCount(providers),
    });
  }

  // Order: highest count first so admins see the busiest prompts at the top.
  stats.sort((a, b) => b.count - a.count);

  return NextResponse.json({
    sinceDays,
    sampleSize: rows.length,
    truncated: rows.length >= 50000,
    stats,
  });
}
