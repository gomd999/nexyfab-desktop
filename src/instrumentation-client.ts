/**
 * Client-side instrumentation (runs before the app is interactive).
 * Sentry는 `NEXT_PUBLIC_SENTRY_DSN`이 유효할 때만 초기화(상용 배포에서 오류 수집).
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client
 */
import { captureRouterTransitionStart, init } from '@sentry/nextjs';

const rawDsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
const sentryEnabled = Boolean(
  rawDsn && rawDsn !== 'CHANGE_ME' && !rawDsn.startsWith('CHANGE_ME'),
);

// Strip JWT/email/Bearer-shaped substrings from any captured field. Defense
// in depth — even if a route includes a token in an error message we don't
// want it landing in Sentry.
const REDACT_PATTERNS: Array<[RegExp, string]> = [
  [/\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]'],
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '[REDACTED_EMAIL]'],
  [/\bBearer\s+[A-Za-z0-9._-]{16,}/gi, 'Bearer [REDACTED]'],
];
function scrubString(s: unknown): unknown {
  if (typeof s !== 'string') return s;
  let out = s;
  for (const [pat, rep] of REDACT_PATTERNS) out = out.replace(pat, rep);
  return out;
}
function scrubDeep(value: unknown, depth = 0): unknown {
  if (depth > 4 || value == null) return value;
  if (typeof value === 'string') return scrubString(value);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(v => scrubDeep(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = scrubDeep(v, depth + 1);
  }
  return out;
}

if (sentryEnabled) {
  const traces = Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1);
  const replayErr = Number(process.env.NEXT_PUBLIC_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE ?? 1);
  const replaySess = Number(process.env.NEXT_PUBLIC_SENTRY_REPLAY_SESSION_SAMPLE_RATE ?? 0.01);
  init({
    dsn: rawDsn,
    tracesSampleRate: Number.isFinite(traces) ? Math.min(1, Math.max(0, traces)) : 0.1,
    debug: false,
    replaysOnErrorSampleRate: Number.isFinite(replayErr) ? Math.min(1, Math.max(0, replayErr)) : 1,
    replaysSessionSampleRate: Number.isFinite(replaySess) ? Math.min(1, Math.max(0, replaySess)) : 0.01,
    integrations: [],
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_RELEASE,
    sendDefaultPii: false,
    beforeSend(event) {
      try {
        if (event.message) event.message = scrubString(event.message) as string;
        if (event.extra) event.extra = scrubDeep(event.extra) as Record<string, unknown>;
        if (event.user) {
          // Keep id but never email/ip in PII-strict mode.
          event.user = { id: event.user.id };
        }
        // Drop request query/cookies if present.
        if (event.request) {
          delete event.request.cookies;
          if (typeof event.request.query_string === 'string') {
            event.request.query_string = scrubString(event.request.query_string) as string;
          }
        }
      } catch { /* never let scrubbing prevent the event from sending */ }
      return event;
    },
  });
}

/** App Router 네비게이션 계측 — Sentry 비활성 시 no-op */
export const onRouterTransitionStart = sentryEnabled
  ? captureRouterTransitionStart
  : () => {};
