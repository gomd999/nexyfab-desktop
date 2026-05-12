/**
 * GET /api/cron/prompt-cost-budget
 *
 * Daily AI spend guardrail. Sums `costCents` across `prompt_call` events in
 * the last 24h and fires an ops alert when the total crosses
 * `COST_BUDGET_USD_DAILY`. Useful as a "we got hit by a runaway loop"
 * tripwire — a stuck client shouldn't be able to silently rack up $$$.
 *
 * Configuration:
 *   COST_BUDGET_USD_DAILY  — daily limit in USD. If unset, alert is disabled.
 *   COST_BUDGET_WARN_AT    — fraction of the limit to start warning at
 *                            (default 0.8 → 80%).
 *
 * Auth: Bearer ${CRON_SECRET}.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { sendOpsAlert } from '@/lib/notify/opsAlert';

export const dynamic = 'force-dynamic';

const WINDOW_MS = 24 * 60 * 60 * 1000;
const SAMPLE_LIMIT = 50_000;

interface CallMeta {
  promptId?: string;
  provider?: string;
  costCents?: number;
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!cronSecret || token !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limitUsd = parseFloat(process.env.COST_BUDGET_USD_DAILY ?? '');
  const warnFraction = parseFloat(process.env.COST_BUDGET_WARN_AT ?? '0.8');
  const limitCents = Number.isFinite(limitUsd) && limitUsd > 0 ? limitUsd * 100 : null;

  const since = Date.now() - WINDOW_MS;
  const db = getDbAdapter();
  const rows = await db.queryAll<{ metadata: string | null }>(
    `SELECT metadata FROM nf_usage_events WHERE metric = 'prompt_call' AND created_at > ? LIMIT ${SAMPLE_LIMIT}`,
    since,
  ).catch(() => [] as { metadata: string | null }[]);

  let totalCents = 0;
  const byProvider = new Map<string, number>();
  const byPrompt = new Map<string, number>();
  for (const r of rows) {
    if (!r.metadata) continue;
    let m: CallMeta;
    try { m = JSON.parse(r.metadata) as CallMeta; } catch { continue; }
    const c = typeof m.costCents === 'number' && m.costCents > 0 ? m.costCents : 0;
    if (c <= 0) continue;
    totalCents += c;
    if (m.provider) byProvider.set(m.provider, (byProvider.get(m.provider) ?? 0) + c);
    if (m.promptId) byPrompt.set(m.promptId, (byPrompt.get(m.promptId) ?? 0) + c);
  }

  const totalUsd = totalCents / 100;
  let verdict: 'no_limit' | 'ok' | 'warn' | 'over' = 'no_limit';
  if (limitCents !== null) {
    if (totalCents > limitCents) verdict = 'over';
    else if (totalCents > limitCents * warnFraction) verdict = 'warn';
    else verdict = 'ok';
  }

  // Sorted top-N for the alert payload.
  const topProviders = Array.from(byProvider.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => `${k}: $${(v / 100).toFixed(2)}`);
  const topPrompts = Array.from(byPrompt.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => `${k}: $${(v / 100).toFixed(2)}`);

  if (verdict === 'over' || verdict === 'warn') {
    await sendOpsAlert({
      severity: verdict === 'over' ? 'critical' : 'warning',
      title: `AI spend ${verdict === 'over' ? 'over' : 'approaching'} daily budget`,
      bodyLines: [
        `Daily AI spend: $${totalUsd.toFixed(2)}${limitUsd ? ` / $${limitUsd.toFixed(2)} budget` : ''}`,
        '',
        'Top providers:',
        ...topProviders.map(s => `  ${s}`),
        '',
        'Top prompts:',
        ...topPrompts.map(s => `  ${s}`),
      ],
      context: {
        verdict,
        totalUsd: totalUsd.toFixed(2),
        limitUsd: limitUsd ? limitUsd.toFixed(2) : 'unset',
        sampleSize: rows.length,
      },
      source: 'cron:prompt-cost-budget',
    }).catch(e => console.error('[cost-budget] alert dispatch failed:', e));
  }

  return NextResponse.json({
    windowMs: WINDOW_MS,
    sampleSize: rows.length,
    truncated: rows.length >= SAMPLE_LIMIT,
    verdict,
    totalUsd: Math.round(totalUsd * 100) / 100,
    totalCents: Math.round(totalCents * 100) / 100,
    limitUsd: limitCents !== null ? limitUsd : null,
    warnFraction,
    byProvider: Object.fromEntries(byProvider),
    byPrompt: Object.fromEntries(byPrompt),
  });
}
