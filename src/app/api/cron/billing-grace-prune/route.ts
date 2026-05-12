/**
 * GET /api/cron/billing-grace-prune
 *
 * Daily cron that walks subscriptions in non-active states and downgrades
 * users whose grace window has elapsed:
 *
 *   - status = 'cancel_pending' AND current_period_end <= now → flip to
 *     'cancelled' + nf_users.plan = 'free' (user paid through period_end).
 *   - status = 'past_due'      AND updated_at + GRACE_DAYS <= now → flip to
 *     'cancelled' + nf_users.plan = 'free' (card never recovered).
 *
 * Why a cron instead of the webhook itself:
 *   - subscription.cancelled fires immediately, but we *don't* want to
 *     downgrade until the paid period ends. Airwallex doesn't fire a
 *     webhook at period_end specifically — we own that schedule.
 *   - past_due downgrade should respect a multi-day window so users have
 *     time to update their card; we run the check daily, not per webhook.
 *
 * Auth: Bearer ${CRON_SECRET}. Same pattern as audit-prune.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { logFunnelEvent } from '@/lib/funnel-logger';
import { sendOpsAlert } from '@/lib/notify/opsAlert';

export const dynamic = 'force-dynamic';

const DEFAULT_GRACE_DAYS = 3;

interface SubscriptionRow {
  user_id: string;
  aw_subscription_id: string;
  status: string;
  current_period_end: number;
  updated_at: number;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const graceDaysRaw = parseInt(process.env.BILLING_GRACE_DAYS ?? '', 10);
  const graceDays = Number.isFinite(graceDaysRaw) && graceDaysRaw > 0 ? graceDaysRaw : DEFAULT_GRACE_DAYS;
  const graceMs = graceDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const db = getDbAdapter();

  // Fetch candidates. Bound the scan via WHERE so even a million-row table
  // returns quickly — both predicates are indexed (status + period_end).
  const cancelExpired = await db.queryAll<SubscriptionRow>(
    `SELECT user_id, aw_subscription_id, status, current_period_end, updated_at
       FROM nf_aw_subscriptions
      WHERE status = 'cancel_pending'
        AND current_period_end <= ?`,
    now,
  ).catch(() => [] as SubscriptionRow[]);

  const pastDueExpired = await db.queryAll<SubscriptionRow>(
    `SELECT user_id, aw_subscription_id, status, current_period_end, updated_at
       FROM nf_aw_subscriptions
      WHERE status = 'past_due'
        AND updated_at <= ?`,
    now - graceMs,
  ).catch(() => [] as SubscriptionRow[]);

  const allExpired = [...cancelExpired, ...pastDueExpired];
  const downgraded: string[] = [];

  let totalArchived = 0;
  for (const row of allExpired) {
    if (!row.user_id) continue;
    await db.execute(
      "UPDATE nf_aw_subscriptions SET status = 'cancelled', updated_at = ? WHERE aw_subscription_id = ?",
      now, row.aw_subscription_id,
    );
    await db.execute(
      "UPDATE nf_users SET plan = 'free' WHERE id = ? AND plan != 'free'",
      row.user_id,
    );
    downgraded.push(row.user_id);

    // Free plan = 1 active project. On downgrade, keep the user's oldest
    // active project and archive the rest so they're not silently locked
    // out / lost. The user can re-subscribe to unarchive (UI work in a
    // follow-up task; data preservation is the goal here).
    const active = await db.queryAll<{ id: string; created_at: number }>(
      `SELECT id, created_at FROM nf_projects
        WHERE user_id = ? AND archived_at IS NULL
        ORDER BY created_at ASC`,
      row.user_id,
    ).catch(() => [] as { id: string; created_at: number }[]);
    if (active.length > 1) {
      // Keep [0], archive [1..]
      const toArchive = active.slice(1);
      for (const p of toArchive) {
        await db.execute(
          "UPDATE nf_projects SET archived_at = ?, updated_at = ? WHERE id = ?",
          now, now, p.id,
        );
      }
      totalArchived += toArchive.length;
    }

    void logFunnelEvent(row.user_id, {
      eventType: 'subscription_grace_expired',
      contextType: 'subscription',
      contextId: row.aw_subscription_id,
      metadata: {
        priorStatus: row.status,
        graceDays,
        activeProjectsBefore: active.length,
        archivedProjects: Math.max(0, active.length - 1),
      },
    }).catch(() => { /* swallow */ });
  }

  // Surface non-trivial runs to ops so they can spot abnormal churn (e.g.
  // payment provider outage causing a wave of past_due → cancel events).
  // Quiet runs (zero downgrades) skip the alert to avoid daily noise.
  if (downgraded.length > 0) {
    void sendOpsAlert({
      severity: downgraded.length >= 5 ? 'warning' : 'info',
      title: `Billing grace prune downgraded ${downgraded.length} user(s)`,
      bodyLines: [
        `cancel_pending → cancelled: ${cancelExpired.length}`,
        `past_due → cancelled: ${pastDueExpired.length}`,
        `Auto-archived projects: ${totalArchived}`,
      ],
      context: { graceDays, runAt: new Date(now).toISOString() },
      source: 'cron:billing-grace-prune',
    }).catch(() => { /* alert failure must not break cron */ });
  }

  return NextResponse.json({
    ok: true,
    graceDays,
    cancelExpiredCount: cancelExpired.length,
    pastDueExpiredCount: pastDueExpired.length,
    downgraded: downgraded.length,
    archivedProjects: totalArchived,
  });
}
