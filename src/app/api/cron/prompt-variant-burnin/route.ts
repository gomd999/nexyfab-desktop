/**
 * GET /api/cron/prompt-variant-burnin
 *
 * Daily check: compares each A/B variant's error rate and p95 latency against
 * its baseline (same promptId without ":variant" suffix). Flags variants that
 * regress on either axis, so we can roll back before the bad variant hits more
 * users than necessary.
 *
 * Verdict per variant:
 *   ok      — within 1.2x of baseline on both metrics
 *   warn    — 1.2x..2.0x on one or both metrics
 *   regress — >2.0x worse, OR error rate >5% absolute when baseline <2%
 *
 * Side effects: writes warnings via console.warn (picked up by Railway logs);
 * a future iteration can emit emails or Slack notifications. The HTTP response
 * is the structured verdict so a monitoring service can scrape it.
 *
 * Auth: Bearer ${CRON_SECRET} like other cron routes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { disableVariant, listDisabledVariants } from '@/lib/ai/disabledVariants';
import { sendOpsAlert } from '@/lib/notify/opsAlert';

export const dynamic = 'force-dynamic';

const WINDOW_MS = 24 * 60 * 60 * 1000;
const SAMPLE_LIMIT = 50_000;
/** Variants need at least this many calls before we trust the comparison. */
const MIN_CALLS = 50;
/**
 * Auto-disable threshold — meaningfully stricter than the warn threshold.
 * Variants must clear MIN_AUTO_DISABLE_CALLS before automation will pull the
 * trigger, and the regression must be 3x worse on a single axis (not the 2x
 * "regress" verdict alone) to avoid flapping disable/enable cycles.
 */
const MIN_AUTO_DISABLE_CALLS = 200;
const AUTO_DISABLE_RATIO = 3.0;

interface CallMeta {
  promptId: string;
  promptVersion?: string;
  latencyMs: number;
  success: boolean;
  errorClass?: string;
}

interface AggBucket {
  promptId: string;
  isVariant: boolean;
  baseId: string;
  count: number;
  errors: number;
  errorRate: number;
  successLatencies: number[];
  p95: number;
}

interface Verdict {
  baseId: string;
  variantId: string;
  variantCount: number;
  baselineCount: number;
  variantErrorRate: number;
  baselineErrorRate: number;
  errorRatio: number;
  variantP95: number;
  baselineP95: number;
  p95Ratio: number;
  verdict: 'ok' | 'warn' | 'regress' | 'insufficient_data';
  reason?: string;
}

function p95(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length));
  return sorted[idx];
}

function classify(v: Verdict): { v: 'ok' | 'warn' | 'regress' | 'insufficient_data'; reason?: string } {
  if (v.variantCount < MIN_CALLS || v.baselineCount < MIN_CALLS) {
    return { v: 'insufficient_data', reason: `need ≥${MIN_CALLS} calls each (variant ${v.variantCount}, baseline ${v.baselineCount})` };
  }
  // Hard regress: error rate >2x AND absolute error rate jumps past 5%.
  if (v.errorRatio >= 2.0 && v.variantErrorRate >= 0.05 && v.baselineErrorRate < 0.05) {
    return { v: 'regress', reason: `error rate ${(v.variantErrorRate * 100).toFixed(1)}% vs baseline ${(v.baselineErrorRate * 100).toFixed(1)}%` };
  }
  // Hard regress: p95 > 2x baseline.
  if (v.p95Ratio >= 2.0 && v.variantP95 > 1000) {
    return { v: 'regress', reason: `p95 ${v.variantP95}ms vs baseline ${v.baselineP95}ms` };
  }
  // Warn band: 1.2x..2.0x on either metric.
  if (v.errorRatio >= 1.2 || v.p95Ratio >= 1.2) {
    return { v: 'warn', reason: `errorRatio ${v.errorRatio.toFixed(2)}, p95Ratio ${v.p95Ratio.toFixed(2)}` };
  }
  return { v: 'ok' };
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!cronSecret || token !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDbAdapter();
  const since = Date.now() - WINDOW_MS;
  const rows = await db.queryAll<{ metadata: string | null }>(
    `SELECT metadata FROM nf_usage_events WHERE metric = 'prompt_call' AND created_at > ? LIMIT ${SAMPLE_LIMIT}`,
    since,
  ).catch(() => [] as { metadata: string | null }[]);

  // Bucket by promptId.
  const buckets = new Map<string, AggBucket>();
  for (const r of rows) {
    if (!r.metadata) continue;
    let m: CallMeta;
    try { m = JSON.parse(r.metadata) as CallMeta; } catch { continue; }
    if (!m.promptId) continue;

    const baseId = m.promptId.split(':')[0];
    const isVariant = m.promptId !== baseId;
    if (!buckets.has(m.promptId)) {
      buckets.set(m.promptId, {
        promptId: m.promptId, isVariant, baseId,
        count: 0, errors: 0, errorRate: 0, successLatencies: [], p95: 0,
      });
    }
    const b = buckets.get(m.promptId)!;
    b.count++;
    if (m.success) {
      if (Number.isFinite(m.latencyMs) && m.latencyMs > 0) b.successLatencies.push(m.latencyMs);
    } else {
      b.errors++;
    }
  }

  // Compute final stats for each bucket.
  for (const b of buckets.values()) {
    b.errorRate = b.count > 0 ? b.errors / b.count : 0;
    b.successLatencies.sort((a, b2) => a - b2);
    b.p95 = p95(b.successLatencies);
  }

  // For every variant bucket, find its baseline and compute verdict.
  const verdicts: Verdict[] = [];
  for (const b of buckets.values()) {
    if (!b.isVariant) continue;
    const baseline = buckets.get(b.baseId);
    if (!baseline) {
      verdicts.push({
        baseId: b.baseId,
        variantId: b.promptId,
        variantCount: b.count,
        baselineCount: 0,
        variantErrorRate: b.errorRate,
        baselineErrorRate: 0,
        errorRatio: 0,
        variantP95: b.p95,
        baselineP95: 0,
        p95Ratio: 0,
        verdict: 'insufficient_data',
        reason: 'no baseline traffic in window',
      });
      continue;
    }
    const v: Verdict = {
      baseId: b.baseId,
      variantId: b.promptId,
      variantCount: b.count,
      baselineCount: baseline.count,
      variantErrorRate: b.errorRate,
      baselineErrorRate: baseline.errorRate,
      errorRatio: baseline.errorRate === 0 ? (b.errorRate > 0 ? Infinity : 1) : b.errorRate / baseline.errorRate,
      variantP95: b.p95,
      baselineP95: baseline.p95,
      p95Ratio: baseline.p95 === 0 ? (b.p95 > 0 ? Infinity : 1) : b.p95 / baseline.p95,
      verdict: 'ok',
    };
    const cls = classify(v);
    v.verdict = cls.v;
    v.reason = cls.reason;
    if (v.verdict === 'regress' || v.verdict === 'warn') {
      console.warn(`[variant-burnin] ${v.verdict.toUpperCase()} ${v.variantId}: ${v.reason}`);
    }
    verdicts.push(v);
  }

  // Auto-disable: opt-in via BURNIN_AUTO_DISABLE=1. Pulls the kill switch on
  // variants that clearly regress AND have enough volume that we trust the
  // signal. Already-disabled variants are skipped so we don't churn.
  const autoDisableEnabled = process.env.BURNIN_AUTO_DISABLE === '1' || process.env.BURNIN_AUTO_DISABLE === 'true';
  const autoDisabled: Array<{ variantId: string; reason: string }> = [];
  if (autoDisableEnabled) {
    const alreadyDisabled = new Set((await listDisabledVariants()).map(d => d.variantId));
    for (const v of verdicts) {
      if (v.verdict !== 'regress') continue;
      if (alreadyDisabled.has(v.variantId)) continue;
      if (v.variantCount < MIN_AUTO_DISABLE_CALLS) continue;
      const stronglyRegressing =
        v.errorRatio >= AUTO_DISABLE_RATIO ||
        v.p95Ratio >= AUTO_DISABLE_RATIO;
      if (!stronglyRegressing) continue;

      const reason = `auto-disabled by burn-in: ${v.reason ?? 'regress'} (calls=${v.variantCount}, errorRatio=${v.errorRatio.toFixed(2)}, p95Ratio=${v.p95Ratio.toFixed(2)})`;
      try {
        await disableVariant({ variantId: v.variantId, reason, disabledBy: 'cron:variant-burnin' });
        console.warn(`[variant-burnin] AUTO-DISABLED ${v.variantId}: ${reason}`);
        autoDisabled.push({ variantId: v.variantId, reason });

        // High-priority ops alert — admins need to know a variant just got
        // auto-killed so they can verify and possibly re-enable.
        sendOpsAlert({
          severity: 'critical',
          title: `Variant auto-disabled: ${v.variantId}`,
          bodyLines: [
            `Burn-in cron pulled the kill switch on prompt variant \`${v.variantId}\`.`,
            `Variants will receive baseline prompts within ~30s on every instance.`,
          ],
          context: {
            variantId: v.variantId,
            baseId: v.baseId,
            calls: v.variantCount,
            errorRate: `${(v.variantErrorRate * 100).toFixed(2)}%`,
            baselineErrorRate: `${(v.baselineErrorRate * 100).toFixed(2)}%`,
            p95: `${v.variantP95}ms`,
            baselineP95: `${v.baselineP95}ms`,
            errorRatio: v.errorRatio.toFixed(2),
            p95Ratio: v.p95Ratio.toFixed(2),
          },
          source: 'cron:variant-burnin:auto-disable',
        }).catch(e => console.error('[variant-burnin] opsAlert dispatch failed:', e));
      } catch (e) {
        console.error(`[variant-burnin] auto-disable failed for ${v.variantId}:`, e);
      }
    }
  }

  // Also alert (non-critical) on plain regress verdicts so admins see the
  // signal before auto-disable trips. Skipped when auto-disable already
  // covered the variant in this run.
  const regressNotAuto = verdicts.filter(
    v => v.verdict === 'regress' && !autoDisabled.some(a => a.variantId === v.variantId),
  );
  if (regressNotAuto.length > 0) {
    sendOpsAlert({
      severity: 'warning',
      title: `${regressNotAuto.length} prompt variant(s) regressing`,
      bodyLines: regressNotAuto.map(
        v => `• \`${v.variantId}\` — ${v.reason ?? 'regress'} (calls=${v.variantCount})`,
      ),
      source: 'cron:variant-burnin',
    }).catch(e => console.error('[variant-burnin] opsAlert dispatch failed:', e));
  }

  return NextResponse.json({
    windowMs: WINDOW_MS,
    sampleSize: rows.length,
    truncated: rows.length >= SAMPLE_LIMIT,
    minCalls: MIN_CALLS,
    autoDisableEnabled,
    autoDisabled,
    verdicts,
    summary: {
      regress: verdicts.filter(v => v.verdict === 'regress').length,
      warn: verdicts.filter(v => v.verdict === 'warn').length,
      ok: verdicts.filter(v => v.verdict === 'ok').length,
      insufficient: verdicts.filter(v => v.verdict === 'insufficient_data').length,
      autoDisabled: autoDisabled.length,
    },
  });
}
