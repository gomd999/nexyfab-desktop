/**
 * Lightweight ops alert dispatcher.
 *
 * Sends alerts to a Slack incoming webhook (preferred) and/or an admin email
 * via the existing email pipeline. Designed for cron jobs that need to surface
 * a small number of high-signal events ("variant auto-disabled", "cost budget
 * exceeded") without standing up a full incident system.
 *
 * Configuration:
 *   SLACK_WEBHOOK_URL — incoming webhook. If set, alerts post here.
 *   OPS_ALERT_EMAIL   — comma-separated list of admin emails. If set, also
 *                       sends a plain-text email per alert.
 *
 * Both channels are optional. If neither is configured, alerts fall back to
 * console.warn so signal isn't lost.
 *
 * Failure isolation: alert failures are caught and console-logged. A broken
 * Slack webhook must never break the cron job that triggered the alert.
 */

import { sendNotificationEmail } from '@/app/lib/mailer';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface OpsAlert {
  severity: AlertSeverity;
  /** Short title — first line of Slack/email subject. */
  title: string;
  /** Body lines. Joined with newlines. Avoid HTML — sent as plain text. */
  bodyLines: string[];
  /** Optional context map rendered as `key: value` lines below body. */
  context?: Record<string, string | number | boolean | undefined>;
  /** Source tag for log lines (e.g. "cron:variant-burnin"). */
  source: string;
}

const SLACK_TIMEOUT_MS = 5_000;
const EMOJI: Record<AlertSeverity, string> = {
  info: ':information_source:',
  warning: ':warning:',
  critical: ':rotating_light:',
};

function fmtContext(ctx?: Record<string, unknown>): string[] {
  if (!ctx) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(ctx)) {
    if (v === undefined) continue;
    out.push(`  ${k}: ${String(v)}`);
  }
  return out;
}

async function postToSlack(alert: OpsAlert): Promise<boolean> {
  const url = process.env.SLACK_WEBHOOK_URL?.trim();
  if (!url) return false;
  const lines = [
    `${EMOJI[alert.severity]} *${alert.title}*`,
    '',
    ...alert.bodyLines,
    ...fmtContext(alert.context),
    '',
    `_source: ${alert.source}_`,
  ];
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: lines.join('\n') }),
      signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[opsAlert] slack POST failed: ${res.status} ${await res.text().catch(() => '')}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[opsAlert] slack POST threw:', e);
    return false;
  }
}

async function emailAdmins(alert: OpsAlert): Promise<boolean> {
  const raw = process.env.OPS_ALERT_EMAIL?.trim();
  if (!raw) return false;
  const recipients = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (recipients.length === 0) return false;

  const subject = `[NexyFab ${alert.severity.toUpperCase()}] ${alert.title}`;
  const bodyLines = [
    ...alert.bodyLines,
    '',
    ...fmtContext(alert.context),
    '',
    `Source: ${alert.source}`,
    `Time:   ${new Date().toISOString()}`,
  ];
  const body = bodyLines.join('\n');
  let allOk = true;
  for (const to of recipients) {
    try {
      await sendNotificationEmail(to, subject, body);
    } catch (e) {
      console.warn(`[opsAlert] email to ${to} failed:`, e);
      allOk = false;
    }
  }
  return allOk;
}

/**
 * Send an alert through every configured channel. Returns the channels that
 * succeeded — caller can log this. Always falls back to console.warn so the
 * signal survives even when no channel is configured.
 */
export async function sendOpsAlert(alert: OpsAlert): Promise<{ channels: string[] }> {
  const channels: string[] = [];

  // Always emit a log line so platform log scrapers pick up the event.
  const logLine = `[opsAlert] ${alert.severity.toUpperCase()} ${alert.title} — ${alert.bodyLines.join(' | ')}`;
  if (alert.severity === 'critical' || alert.severity === 'warning') {
    console.warn(logLine);
  } else {
    console.log(logLine);
  }

  const [slackOk, emailOk] = await Promise.all([
    postToSlack(alert),
    emailAdmins(alert),
  ]);
  if (slackOk) channels.push('slack');
  if (emailOk) channels.push('email');
  return { channels };
}
