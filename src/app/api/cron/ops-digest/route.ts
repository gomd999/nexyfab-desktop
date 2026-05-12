/**
 * GET /api/cron/ops-digest
 *
 * Daily ops digest. Sends a single summary alert covering the last 24h:
 *   - new signups (signup_complete count)
 *   - new conversions (upgrade_completed count)
 *   - payment failures (subscription_payment_failed count)
 *   - cron grace downgrades (subscription_grace_expired count)
 *   - top UTM sources by signups
 *
 * Why a once-a-day summary:
 *   - Per-event alerts (Round 27) catch acute incidents but flood inboxes
 *     once advertising drives volume. A digest gives operators a single
 *     daily pulse to scan.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { sendOpsAlert } from '@/lib/notify/opsAlert';
import { getTopUtmSources } from '@/lib/funnel-logger';

export const dynamic = 'force-dynamic';

const WINDOW_MS = 24 * 60 * 60 * 1000;

interface CountRow { event_type: string; c: number }

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = Date.now();
  const since = now - WINDOW_MS;
  const db = getDbAdapter();

  // Single grouped query covers all the funnel event types we report on.
  const rows = await db.queryAll<CountRow>(
    `SELECT event_type, COUNT(*) AS c
       FROM nf_funnel_event
      WHERE created_at >= ? AND created_at <= ?
      GROUP BY event_type`,
    since, now,
  ).catch(() => [] as CountRow[]);

  const byType = new Map<string, number>(rows.map(r => [r.event_type, Number(r.c)]));
  const signups       = byType.get('signup_complete')              ?? 0;
  const upgrades      = byType.get('upgrade_completed')            ?? 0;
  const cancellations = byType.get('subscription_cancelled')       ?? 0;
  const payFailures   = byType.get('subscription_payment_failed')  ?? 0;
  const graceExpired  = byType.get('subscription_grace_expired')   ?? 0;
  const paywallShown  = byType.get('paywall_shown')                ?? 0;
  const paywallClicked = byType.get('paywall_upgrade_clicked')     ?? 0;

  // Top 5 sources by signup count in window — gives ops a sense of where
  // the day's traffic came from.
  const topSources = await getTopUtmSources({ sinceMs: since, limit: 5 });

  // Severity heuristic: any payment failure or grace expiration with no
  // upgrade activity gets warning. Otherwise info.
  const severity =
    (payFailures + graceExpired) > 0 && upgrades === 0 ? 'warning' :
    (payFailures + graceExpired) >= 5 ? 'warning' : 'info';

  const conversionPct = paywallShown > 0 ? (paywallClicked / paywallShown * 100).toFixed(1) : 'n/a';

  const bodyLines: string[] = [
    `Window: last 24h (${new Date(since).toISOString()} → ${new Date(now).toISOString()})`,
    '',
    `New signups:           ${signups}`,
    `Upgrades to paid:      ${upgrades}`,
    `Cancellations:         ${cancellations}`,
    `Payment failures:      ${payFailures}`,
    `Grace expired:         ${graceExpired}`,
    `Paywall shown:         ${paywallShown}`,
    `Paywall→upgrade %:     ${conversionPct}`,
  ];
  if (topSources.length > 0) {
    bodyLines.push('', 'Top sources by signups:');
    for (const s of topSources) {
      bodyLines.push(`  ${s.source}: ${s.signups}`);
    }
  }

  // Skip the alert entirely on completely-quiet days (zero of everything)
  // — a noiseless mailbox is the best signal that the system is healthy.
  const totalActivity = signups + upgrades + cancellations + payFailures + graceExpired + paywallShown;
  if (totalActivity === 0) {
    return NextResponse.json({ ok: true, sent: false, reason: 'no activity' });
  }

  await sendOpsAlert({
    severity,
    title: `NexyFab daily ops digest — ${signups} signups, ${upgrades} upgrades, ${payFailures} payment failures`,
    bodyLines,
    source: 'cron:ops-digest',
  }).catch(err => console.warn('[ops-digest] alert send failed:', err));

  return NextResponse.json({
    ok: true,
    sent: true,
    severity,
    counts: {
      signups, upgrades, cancellations, payFailures, graceExpired,
      paywallShown, paywallClicked,
    },
    topSources,
  });
}
