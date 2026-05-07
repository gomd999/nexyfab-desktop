/**
 * SDK-free Sentry forwarder.
 *
 * We intentionally avoid `@sentry/nextjs` because it pulls in webpack plugins,
 * instrumentation hooks, and source-map upload machinery that add build
 * complexity and bundle weight. All we need from Sentry is "drop an error in
 * the Issues feed so ops can see it" — that's a single POST to the envelope
 * endpoint described at https://develop.sentry.dev/sdk/envelopes/.
 *
 * Activated only when `SENTRY_DSN` is set. If missing, every function here
 * is a cheap no-op, so wiring it into hot paths is safe.
 *
 * DSN format: https://{publicKey}@{host}/{projectId}
 */

interface ParsedDsn {
  publicKey: string;
  host: string;
  projectId: string;
}

let cachedDsn: ParsedDsn | null | undefined;

function parseDsn(): ParsedDsn | null {
  if (cachedDsn !== undefined) return cachedDsn;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) { cachedDsn = null; return null; }
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\//, '');
    if (!u.username || !u.host || !projectId) { cachedDsn = null; return null; }
    cachedDsn = { publicKey: u.username, host: u.host, projectId };
    return cachedDsn;
  } catch {
    cachedDsn = null;
    return null;
  }
}

interface SentryEventPayload {
  level: 'error' | 'warning' | 'info';
  message: string;
  stack?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: { id?: string; ip_address?: string };
  release?: string;
  environment?: string;
}

/**
 * Fire-and-forget. Returns immediately if Sentry isn't configured. The caller
 * does not need to await — failures are swallowed so telemetry can never
 * become a failure mode for the request it's reporting.
 */
export function forwardToSentry(ev: SentryEventPayload): void {
  const dsn = parseDsn();
  if (!dsn) return;

  const eventId = randomHex(32);
  const timestamp = Date.now() / 1000;

  const envelopeHeader = JSON.stringify({
    event_id: eventId,
    sent_at: new Date().toISOString(),
    dsn: `https://${dsn.publicKey}@${dsn.host}/${dsn.projectId}`,
  });

  const itemPayload = JSON.stringify({
    event_id: eventId,
    timestamp,
    platform: 'javascript',
    level: ev.level,
    logger: 'nexyfab',
    release: ev.release ?? process.env.NEXT_PUBLIC_RELEASE,
    environment: ev.environment ?? process.env.NODE_ENV ?? 'development',
    message: { formatted: ev.message },
    tags: ev.tags,
    extra: ev.extra,
    user: ev.user,
    exception: ev.stack
      ? {
          values: [{
            type: 'Error',
            value: ev.message,
            stacktrace: { frames: parseStack(ev.stack) },
          }],
        }
      : undefined,
  });

  const itemHeader = JSON.stringify({
    type: 'event',
    content_type: 'application/json',
    length: Buffer.byteLength(itemPayload, 'utf8'),
  });

  const body = `${envelopeHeader}\n${itemHeader}\n${itemPayload}\n`;
  const url = `https://${dsn.host}/api/${dsn.projectId}/envelope/`;
  const auth = `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=nexyfab-lite/1.0`;

  // Fire and forget. We never await this — Sentry latency must not bleed into
  // user-facing requests.
  void fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-sentry-envelope',
      'X-Sentry-Auth': auth,
    },
    body,
  }).catch(() => { /* swallow */ });
}

function randomHex(len: number): string {
  const bytes = new Uint8Array(len / 2);
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// Minimal stack parser — Sentry accepts loose frames, we just need function
// names and approximate line numbers to make the issue page useful.
function parseStack(stack: string): Array<{ function?: string; filename?: string; lineno?: number; colno?: number }> {
  const lines = stack.split('\n').slice(0, 50);
  const frames: Array<{ function?: string; filename?: string; lineno?: number; colno?: number }> = [];
  for (const line of lines) {
    const m = line.match(/at\s+(?:(\S+)\s+)?\(?([^():]+):(\d+):(\d+)\)?/);
    if (m) {
      frames.push({
        function: m[1],
        filename: m[2],
        lineno: Number(m[3]),
        colno: Number(m[4]),
      });
    }
  }
  // Sentry expects frames in reverse (oldest first).
  return frames.reverse();
}
