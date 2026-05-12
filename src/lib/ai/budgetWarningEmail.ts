/**
 * Budget warning email — fires once per 24h when a user crosses the
 * BUDGET_WARN_AT threshold (default 80%). Without this, users only learn
 * about the limit when they hit the hard 402 cooldown — too late to react.
 *
 * Dedupe model:
 *   nf_budget_warning_sent (user_id PK, last_sent_at INTEGER)
 *   We only send when (now - last_sent_at) >= 24h. The 24h floor lines up
 *   with the rolling-window budget itself, so a user who is at 85% today
 *   gets one note today; tomorrow's window resets and may produce another
 *   note if they're still hot.
 *
 * Failures are swallowed. Email send latency / table missing must never
 * block the AI response.
 */

import { getDbAdapter } from '@/lib/db-adapter';

const COOLDOWN_MS = 24 * 60 * 60 * 1000;
let tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  const db = getDbAdapter();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_budget_warning_sent (
      user_id      TEXT PRIMARY KEY,
      last_sent_at INTEGER NOT NULL
    );
  `).catch(() => {});
  tableEnsured = true;
}

interface SendArgs {
  userId: string;
  fraction: number;
  usedCents: number;
  limitUsd: number;
}

/**
 * Returns true if an email was actually sent (or queued), false if skipped
 * by the dedupe window.
 */
export async function maybeSendBudgetWarningEmail(args: SendArgs): Promise<boolean> {
  if (args.fraction < 0.8) return false;
  await ensureTable();
  const db = getDbAdapter();
  const now = Date.now();

  const row = await db.queryOne<{ last_sent_at: number }>(
    'SELECT last_sent_at FROM nf_budget_warning_sent WHERE user_id = ?',
    args.userId,
  ).catch(() => null);
  if (row && Number(row.last_sent_at) + COOLDOWN_MS > now) {
    return false;  // still within dedupe cooldown
  }

  // Look up the user email so we can address the message. Skip if missing —
  // the warning isn't worth waking ops over a malformed user row.
  const userRow = await db.queryOne<{ email: string; name: string | null }>(
    'SELECT email, name FROM nf_users WHERE id = ?',
    args.userId,
  ).catch(() => null);
  if (!userRow?.email) return false;

  // Lazy import keeps the email module out of cold-start when budgets aren't
  // configured. sendNotificationEmail handles SMTP/dry-run modes per env.
  try {
    const { sendNotificationEmail } = await import('@/app/lib/mailer');
    const pct = Math.round(args.fraction * 100);
    const usedDollars = (args.usedCents / 100).toFixed(2);
    const body = [
      `Hi${userRow.name ? ' ' + userRow.name : ''},`,
      '',
      `You've used $${usedDollars} of your $${args.limitUsd.toFixed(2)} daily AI budget on NexyFab — about ${pct}% of the limit.`,
      '',
      `Once you hit 100%, AI features will pause until the rolling 24-hour window resets. To keep working without interruption you can:`,
      `  • Wait for the window to reset (it always rolls)`,
      `  • Upgrade to a higher tier — see https://nexyfab.com/en/pricing`,
      `  • Reduce model size in settings if you don't need top-tier output`,
      '',
      'This is an automated heads-up — no action is required if the rate is expected.',
      '',
      '— NexyFab',
    ].join('\n');
    await sendNotificationEmail(
      userRow.email,
      `[NexyFab] Daily AI usage at ${pct}% — heads up`,
      body,
    );
  } catch {
    // Email failed — don't update the dedupe row, so we'll try again next
    // time the user crosses the threshold. Better to over-warn than silently
    // skip when SMTP is broken.
    return false;
  }

  // Record the send so we don't spam the user.
  await db.execute(
    `INSERT INTO nf_budget_warning_sent (user_id, last_sent_at) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET last_sent_at = excluded.last_sent_at`,
    args.userId, now,
  ).catch(() => { /* swallow */ });

  return true;
}
