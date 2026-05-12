/**
 * GET /api/cron/cost-breaker-check
 *
 * Every 5 min — sums AI cost over the last hour and last 24 hours,
 * compares against operator-set budgets, and trips the circuit breaker
 * if either threshold is exceeded.
 *
 * Without this, a runaway AI loop (prompt injection, infinite agent
 * recursion) could rack up hundreds of dollars before the daily ops
 * digest catches it the next morning.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { tripBreaker } from '@/lib/cost-breaker';
import { sendOpsAlert } from '@/lib/notify/opsAlert';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDbAdapter();
  const now = Date.now();

  // Import once at the top; the warnings-dedup logic below reads the same module.
  const { getSetting, setSetting } = await import('@/lib/admin-settings');

  // Read operator-set caps from admin settings; missing = no enforcement.
  const hourlyCapStr = await getSetting('budget.hourly_usd_cap');
  const dailyCapStr = await getSetting('budget.daily_usd_cap');
  const hourlyCap = hourlyCapStr ? Number(hourlyCapStr) : null;
  const dailyCap = dailyCapStr ? Number(dailyCapStr) : null;

  if (hourlyCap == null && dailyCap == null) {
    return NextResponse.json({ ok: true, skipped: 'no caps set' });
  }

  // Sum cost over both windows in a single query each — cheap on indexed
  // (provider, called_at) range scan.
  const [hourlyRow, dailyRow] = await Promise.all([
    db.queryOne<{ cost_usd: number | null }>(
      `SELECT SUM(COALESCE(cost_usd, 0)) AS cost_usd
         FROM nf_api_usage
        WHERE called_at >= ?
          AND cost_usd IS NOT NULL`,
      now - HOUR_MS,
    ).catch(() => null),
    db.queryOne<{ cost_usd: number | null }>(
      `SELECT SUM(COALESCE(cost_usd, 0)) AS cost_usd
         FROM nf_api_usage
        WHERE called_at >= ?
          AND cost_usd IS NOT NULL`,
      now - DAY_MS,
    ).catch(() => null),
  ]);

  const hourlyCost = Number(hourlyRow?.cost_usd ?? 0);
  const dailyCost = Number(dailyRow?.cost_usd ?? 0);

  const tripped: Array<{ scope: 'hourly' | 'daily'; cost: number; cap: number }> = [];
  const warnings: Array<{ scope: 'hourly' | 'daily'; cost: number; cap: number; pct: number }> = [];

  // Threshold ladder: 50% (info) / 80% (warning) / 100% (auto-trip).
  // Pre-trip warnings give the operator time to investigate before the
  // hard cutoff kicks in, especially useful during product launches.
  function evaluate(scope: 'hourly' | 'daily', cost: number, cap: number | null) {
    if (cap == null) return;
    const pct = cost / cap;
    if (pct >= 1) {
      tripped.push({ scope, cost, cap });
    } else if (pct >= 0.5) {
      warnings.push({ scope, cost, cap, pct });
    }
  }
  evaluate('hourly', hourlyCost, hourlyCap);
  evaluate('daily', dailyCost, dailyCap);

  for (const t of tripped) {
    await tripBreaker(
      t.scope,
      `${t.scope === 'hourly' ? '시간당' : '일일'} AI 비용 $${t.cost.toFixed(4)} ≥ cap $${t.cap.toFixed(2)} (cron auto-trip)`,
      'cron:cost-breaker-check',
    );
  }

  // De-dup warnings within an hour — without this, every 5-min cron would
  // spam ops 12 times. Stash the last-warned percentage band per scope.
  for (const w of warnings) {
    const band = w.pct >= 0.8 ? '80' : '50';
    const dedupKey = `breaker.warn.${w.scope}.last_band`;
    const lastBand = await getSetting(dedupKey);
    if (lastBand !== band) {
      await sendOpsAlert({
        severity: band === '80' ? 'warning' : 'info',
        title: `⚠️ AI 비용 ${band}% 도달 — ${w.scope}`,
        bodyLines: [
          `${w.scope === 'hourly' ? '시간당' : '일일'} AI 비용: $${w.cost.toFixed(4)} / $${w.cap.toFixed(2)} (${(w.pct * 100).toFixed(1)}%)`,
          ``,
          `자동 차단 까지 ${(100 - w.pct * 100).toFixed(1)}% 남음`,
          `→ /admin/api-health 에서 추세 확인`,
        ],
        source: 'cron:cost-breaker-check',
      }).catch(() => {});
      await setSetting(dedupKey, band, {
        scope: 'budget',
        description: `Last warn band for ${w.scope} (auto-dedup)`,
        updatedBy: 'cron:cost-breaker-check',
        encrypt: false,
      });
    }
  }
  // Reset dedup if back below 50% (so next breach re-alerts).
  if (hourlyCap != null && hourlyCost / hourlyCap < 0.5) {
    await setSetting('breaker.warn.hourly.last_band', '0', {
      scope: 'budget', description: 'Reset', updatedBy: 'cron:cost-breaker-check', encrypt: false,
    }).catch(() => {});
  }
  if (dailyCap != null && dailyCost / dailyCap < 0.5) {
    await setSetting('breaker.warn.daily.last_band', '0', {
      scope: 'budget', description: 'Reset', updatedBy: 'cron:cost-breaker-check', encrypt: false,
    }).catch(() => {});
  }

  if (tripped.length > 0) {
    await sendOpsAlert({
      severity: 'warning',
      title: `🚨 AI 비용 자동 차단 (${tripped.map(t => t.scope).join(', ')})`,
      bodyLines: [
        `다음 임계값을 초과하여 AI 호출이 자동 차단되었습니다:`,
        '',
        ...tripped.map(t => `  ${t.scope}: $${t.cost.toFixed(4)} ≥ $${t.cap.toFixed(2)}`),
        '',
        `→ 원인 파악 후 /admin/api-health 에서 수동 해제`,
        `→ 차단 중에도 결제/주문 등 비-AI API 는 정상 동작`,
      ],
      source: 'cron:cost-breaker-check',
    }).catch(err => console.warn('[cost-breaker] alert send failed:', err));
  }

  return NextResponse.json({
    ok: true,
    hourlyCost,
    dailyCost,
    hourlyCap,
    dailyCap,
    tripped: tripped.map(t => t.scope),
    warnings: warnings.map(w => ({ scope: w.scope, pct: w.pct })),
  });
}
