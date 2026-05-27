/**
 * Sentry init for the occt-worker service.
 *
 * Same PII scrub as the main app (instrumentation-client.ts) — JWTs,
 * emails, Bearer tokens stripped before send. Reuse main app's DSN
 * with a `service: occt-worker` tag so alerts can filter.
 */

import * as Sentry from '@sentry/node';

const REDACT_PATTERNS: Array<[RegExp, string]> = [
  [/\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]'],
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '[REDACTED_EMAIL]'],
  [/\bBearer\s+[A-Za-z0-9._-]{16,}/gi, 'Bearer [REDACTED]'],
];

function scrub(s: string): string {
  let out = s;
  for (const [pat, rep] of REDACT_PATTERNS) out = out.replace(pat, rep);
  return out;
}

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn || dsn === 'CHANGE_ME' || dsn.startsWith('CHANGE_ME')) {
    console.log('[occt-worker] Sentry disabled (no SENTRY_DSN)');
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'production',
    release: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 8) ?? 'dev',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.05),
    sendDefaultPii: false,
    initialScope: {
      tags: { service: 'occt-worker' },
    },
    beforeSend(event) {
      try {
        if (event.message) event.message = scrub(event.message);
        if (event.request) {
          delete event.request.cookies;
          if (typeof event.request.query_string === 'string') {
            event.request.query_string = scrub(event.request.query_string);
          }
        }
        // Worker has no user PII to keep beyond the userId tag.
        if (event.user) event.user = { id: event.user.id };
      } catch {
        /* never let scrubbing prevent the event from sending */
      }
      return event;
    },
  });

  console.log(`[occt-worker] Sentry enabled (env=${process.env.NODE_ENV})`);
}
