import { createHmac } from 'crypto';
import { getDbAdapter } from './db-adapter';
import { enqueueJob } from './job-queue';

export type WebhookEvent =
  | 'rfq.created' | 'rfq.quoted' | 'rfq.accepted' | 'rfq.rejected'
  | 'contract.created' | 'contract.status_changed' | 'contract.completed'
  | 'quote.created' | 'quote.accepted' | 'quote.rejected'
  | 'milestone.completed' | 'qc.passed' | 'qc.failed'
  | 'payment.completed' | 'payment.failed';

export interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  data: Record<string, unknown>;
}

// Sign payload with HMAC-SHA256
export function signPayload(secret: string, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

// Deliver to a single webhook endpoint
export async function deliverWebhook(
  url: string,
  secret: string,
  payload: WebhookPayload,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const body = JSON.stringify(payload);
  const signature = signPayload(secret, body);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-NexyFab-Signature': signature,
        'X-NexyFab-Event': payload.event,
        'X-NexyFab-Timestamp': payload.timestamp,
        'User-Agent': 'NexyFab-Webhook/1.0',
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Trigger webhooks for an event — fire-and-forget with job queue retry
export async function triggerWebhooks(
  userId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<void> {
  const db = getDbAdapter();

  let subscriptions: Array<{ id: string; url: string; secret: string; failure_count: number }> = [];
  try {
    subscriptions = await db.queryAll<{ id: string; url: string; secret: string; failure_count: number }>(
      `SELECT id, url, secret, failure_count FROM nf_webhook_subscriptions
       WHERE user_id = ? AND status = 'active' AND (events = '[]' OR events LIKE ?)`,
      userId, `%"${event}"%`,
    );
  } catch { return; } // table may not exist yet

  if (subscriptions.length === 0) return;

  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    data,
  };

  for (const sub of subscriptions) {
    const result = await deliverWebhook(sub.url, sub.secret, payload);

    if (result.ok) {
      await db.execute(
        'UPDATE nf_webhook_subscriptions SET last_triggered_at = ?, failure_count = 0, updated_at = ? WHERE id = ?',
        Date.now(), Date.now(), sub.id,
      ).catch(() => {});
    } else {
      const newFailures = sub.failure_count + 1;
      // Auto-disable after 10 consecutive failures
      const newStatus = newFailures >= 10 ? 'disabled' : 'active';
      await db.execute(
        'UPDATE nf_webhook_subscriptions SET failure_count = ?, status = ?, updated_at = ? WHERE id = ?',
        newFailures, newStatus, Date.now(), sub.id,
      ).catch(() => {});

      // Enqueue retry via job queue
      if (newStatus === 'active') {
        await enqueueJob('send_email', {
          to: 'webhook-retry@internal',
          subject: `webhook:${sub.id}`,
          html: JSON.stringify({ subId: sub.id, payload }),
        }, { delayMs: 60_000 * Math.min(newFailures, 60) }).catch(() => {});
      }
    }
  }
}

// Also trigger Slack if configured
export async function triggerSlack(
  userId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<void> {
  const db = getDbAdapter();
  let integration: { webhook_url: string; events: string } | null = null;
  try {
    integration = await db.queryOne<{ webhook_url: string; events: string }>(
      "SELECT webhook_url, events FROM nf_slack_integrations WHERE user_id = ? AND status = 'active'",
      userId,
    ) ?? null;
  } catch { return; }

  if (!integration) return;

  const allowedEvents: string[] = JSON.parse(integration.events ?? '[]');
  if (allowedEvents.length > 0 && !allowedEvents.includes(event)) return;

  const emoji: Record<string, string> = {
    'rfq.created': '📋', 'rfq.accepted': '✅', 'contract.completed': '🎉',
    'payment.completed': '💰', 'milestone.completed': '📦', 'qc.passed': '✔️', 'qc.failed': '❌',
  };

  const message = {
    text: `${emoji[event] ?? '🔔'} *NexyFab* — \`${event}\``,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${emoji[event] ?? '🔔'} *${event}*\n${Object.entries(data).slice(0, 5).map(([k, v]) => `• ${k}: ${v}`).join('\n')}`,
        },
      },
    ],
  };

  await fetch(integration.webhook_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(5_000),
  }).catch(() => {});
}
