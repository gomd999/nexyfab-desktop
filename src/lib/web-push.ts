// Web Push helper — VAPID-signed POST to each subscription endpoint.
// Server-only library (no DOM Notification API). For the actual signing
// we use the `web-push` package when installed; otherwise we degrade to
// a stub that logs the payload so dev runs aren't blocked.

import { getDbAdapter } from './db-adapter';

interface PushSubscriptionRow {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body?: string;
  url?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  /** Auto-close after N seconds. */
  ttlSeconds?: number;
}

/**
 * Send a push payload to all subscriptions of the given user. Returns
 * counts of successful/failed deliveries. Dead subscriptions (HTTP 410
 * Gone from the push service) are pruned automatically.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; failed: number; pruned: number }> {
  const db = getDbAdapter();
  const subs = await db.queryAll<PushSubscriptionRow>(
    'SELECT user_id, endpoint, p256dh, auth FROM nf_push_subscriptions WHERE user_id = ?',
    userId,
  ).catch(() => []);
  if (subs.length === 0) return { sent: 0, failed: 0, pruned: 0 };

  const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
  const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
  const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:nexyfab@nexysys.com';
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.warn('[web-push] VAPID keys not configured — logging payload only.');
    console.log('[web-push] would send to', subs.length, 'subscriptions:', payload);
    return { sent: 0, failed: 0, pruned: 0 };
  }

  // `web-push` is optional — degrade gracefully when the package is
  // missing so unrelated builds aren't blocked.
  interface WebPushLike {
    setVapidDetails: (subject: string, publicKey: string, privateKey: string) => void;
    sendNotification: (
      sub: { endpoint: string; keys: { p256dh: string; auth: string } },
      payload: string,
      opts?: { TTL?: number },
    ) => Promise<unknown>;
  }
  let wp: WebPushLike | null = null;
  try {
    const mod = (await import('web-push' as string)) as { default?: WebPushLike } & WebPushLike;
    wp = (mod.default ?? mod) as WebPushLike;
    wp.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  } catch (err) {
    console.warn('[web-push] package not installed; payload logged but not sent.', err);
    return { sent: 0, failed: 0, pruned: 0 };
  }

  let sent = 0, failed = 0, pruned = 0;
  const body = JSON.stringify(payload);

  for (const s of subs) {
    try {
      await wp.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
        { TTL: payload.ttlSeconds ?? 60 },
      );
      sent++;
    } catch (err) {
      const e = err as { statusCode?: number; body?: string };
      if (e.statusCode === 404 || e.statusCode === 410) {
        // Subscription expired — remove from DB so we don't keep trying.
        await db.execute(
          'DELETE FROM nf_push_subscriptions WHERE user_id = ? AND endpoint = ?',
          s.user_id, s.endpoint,
        ).catch(() => { /* ignore */ });
        pruned++;
      } else {
        failed++;
      }
    }
  }

  return { sent, failed, pruned };
}
