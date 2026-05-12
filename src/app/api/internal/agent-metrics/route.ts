/**
 * GET /api/internal/agent-metrics
 *
 * Ops dashboard endpoint. Aggregates SCAD agent activity from
 * `nf_usage_events` over the last N days (default 7) and returns
 * per-day + per-provider breakdowns.
 *
 * Drives:
 *   - Daily cron summary email ("yesterday: 142 runs, 89% success, $2.31")
 *   - Slack alert when crash rate exceeds CRASH_BUDGETS budget
 *   - Future admin UI panel
 *
 * Auth: ADMIN_SECRET via header `x-admin-secret` or `?secret=` query
 * (same gate as /api/health/openscad). Returns 401 when set + missing.
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface UsageRow {
  user_id: string;
  metric: string;
  metadata: string | null;
  created_at: number;
}

interface AgentRunMeta {
  promptId?: string;
  provider?: string;
  model?: string;
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  success?: boolean;
}

interface DayBucket {
  date: string;            // YYYY-MM-DD
  runs: number;
  successes: number;
  failures: number;
  totalTokens: number;
  totalCostCents: number;
  avgLatencyMs: number;
  // Distinct user count for the day
  uniqueUsers: number;
}

interface ProviderBucket {
  provider: string;
  runs: number;
  successes: number;
  totalTokens: number;
  avgLatencyMs: number;
}

interface MetricsReport {
  rangeDays: number;
  generatedAt: string;
  totals: {
    runs: number;
    successes: number;
    failures: number;
    successRate: number;
    totalTokens: number;
    totalCostCents: number;
    uniqueUsers: number;
  };
  perDay: DayBucket[];
  perProvider: ProviderBucket[];
}

function dayKey(ts: number): string {
  const d = new Date(ts);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (adminSecret) {
    const provided = req.headers.get('x-admin-secret') ?? new URL(req.url).searchParams.get('secret');
    if (provided !== adminSecret) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const url = new URL(req.url);
  const days = Math.max(1, Math.min(90, Number(url.searchParams.get('days') ?? '7')));
  const sinceMs = Date.now() - days * 86_400_000;

  let rows: UsageRow[];
  try {
    const { getDbAdapter } = await import('@/lib/db-adapter');
    const db = getDbAdapter();
    rows = await db.queryAll<UsageRow>(
      `SELECT user_id, metric, metadata, created_at FROM nf_usage_events
       WHERE created_at > ?
         AND (metric = 'prompt_call' OR metric = 'scad_agent')
       ORDER BY created_at ASC`,
      sinceMs,
    );
  } catch (e) {
    return NextResponse.json(
      { error: `db query failed: ${(e as Error).message}` },
      { status: 503 },
    );
  }

  // Filter to scad-agent-specific rows. The promptId we record from the
  // route is `scad-agent` per recordPromptCall() call. The `scad_agent`
  // metric covers the monthly slot consumption events.
  const agentRows: { ts: number; userId: string; meta: AgentRunMeta; isPromptCall: boolean }[] = [];
  for (const r of rows) {
    let meta: AgentRunMeta = {};
    try { meta = r.metadata ? JSON.parse(r.metadata) as AgentRunMeta : {}; } catch { /* skip */ }
    if (r.metric === 'prompt_call') {
      if (meta.promptId === 'scad-agent' || meta.promptId === 'scad-agent-validation') {
        agentRows.push({ ts: r.created_at, userId: r.user_id, meta, isPromptCall: true });
      }
    } else if (r.metric === 'scad_agent') {
      // monthly-slot-only entries — count as runs but we won't have token info.
      agentRows.push({ ts: r.created_at, userId: r.user_id, meta, isPromptCall: false });
    }
  }

  // ─── Aggregate ────────────────────────────────────────────────────────
  const perDayMap = new Map<string, DayBucket & { _users: Set<string>; _latencies: number[] }>();
  const perProviderMap = new Map<string, ProviderBucket & { _latencies: number[] }>();
  const allUsers = new Set<string>();

  let totalRuns = 0;
  let totalSuccesses = 0;
  let totalFailures = 0;
  let totalTokens = 0;
  let totalCostCents = 0;

  for (const r of agentRows) {
    const key = dayKey(r.ts);
    if (!perDayMap.has(key)) {
      perDayMap.set(key, {
        date: key, runs: 0, successes: 0, failures: 0, totalTokens: 0, totalCostCents: 0,
        avgLatencyMs: 0, uniqueUsers: 0, _users: new Set(), _latencies: [],
      });
    }
    const day = perDayMap.get(key)!;
    day.runs++; totalRuns++;
    day._users.add(r.userId);
    allUsers.add(r.userId);

    if (!r.isPromptCall) continue; // monthly slot only — no token/latency data

    if (r.meta.success === true) { day.successes++; totalSuccesses++; }
    else if (r.meta.success === false) { day.failures++; totalFailures++; }

    const tokens = (r.meta.promptTokens ?? 0) + (r.meta.completionTokens ?? 0);
    day.totalTokens += tokens; totalTokens += tokens;

    if (typeof r.meta.latencyMs === 'number') day._latencies.push(r.meta.latencyMs);

    // Cost approximation: use cost lib estimate when possible. Skip if no provider/model.
    if (r.meta.provider && r.meta.model && tokens > 0) {
      try {
        const { estimateCostCents } = await import('@/lib/ai/cost');
        const cents = estimateCostCents(r.meta.provider, r.meta.model, r.meta.promptTokens ?? 0, r.meta.completionTokens ?? 0);
        day.totalCostCents += cents; totalCostCents += cents;
      } catch { /* ignore */ }
    }

    if (r.meta.provider) {
      if (!perProviderMap.has(r.meta.provider)) {
        perProviderMap.set(r.meta.provider, {
          provider: r.meta.provider, runs: 0, successes: 0, totalTokens: 0, avgLatencyMs: 0, _latencies: [],
        });
      }
      const p = perProviderMap.get(r.meta.provider)!;
      p.runs++;
      if (r.meta.success === true) p.successes++;
      p.totalTokens += tokens;
      if (typeof r.meta.latencyMs === 'number') p._latencies.push(r.meta.latencyMs);
    }
  }

  // Finalize averages.
  const perDay: DayBucket[] = [];
  for (const b of perDayMap.values()) {
    const avgLatency = b._latencies.length > 0
      ? Math.round(b._latencies.reduce((s, v) => s + v, 0) / b._latencies.length)
      : 0;
    perDay.push({
      date: b.date, runs: b.runs, successes: b.successes, failures: b.failures,
      totalTokens: b.totalTokens, totalCostCents: Math.round(b.totalCostCents),
      avgLatencyMs: avgLatency, uniqueUsers: b._users.size,
    });
  }
  perDay.sort((a, b) => a.date.localeCompare(b.date));

  const perProvider: ProviderBucket[] = [];
  for (const p of perProviderMap.values()) {
    const avgLatency = p._latencies.length > 0
      ? Math.round(p._latencies.reduce((s, v) => s + v, 0) / p._latencies.length)
      : 0;
    perProvider.push({
      provider: p.provider, runs: p.runs, successes: p.successes,
      totalTokens: p.totalTokens, avgLatencyMs: avgLatency,
    });
  }
  perProvider.sort((a, b) => b.runs - a.runs);

  const report: MetricsReport = {
    rangeDays: days,
    generatedAt: new Date().toISOString(),
    totals: {
      runs: totalRuns,
      successes: totalSuccesses,
      failures: totalFailures,
      successRate: totalRuns > 0 ? totalSuccesses / Math.max(1, totalSuccesses + totalFailures) : 0,
      totalTokens,
      totalCostCents: Math.round(totalCostCents),
      uniqueUsers: allUsers.size,
    },
    perDay,
    perProvider,
  };

  return NextResponse.json(report);
}
