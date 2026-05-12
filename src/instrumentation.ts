/**
 * Next.js instrumentation — Sentry (Node/Edge) + 서버 기동 검증·DB 초기화.
 * `next build` 시 Node 런타임에서만 startup/Postgres 경로가 실행됩니다.
 */
import { captureRequestError, init as sentryInit } from '@sentry/nextjs';

export const onRequestError = captureRequestError;

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

const sentryOptions = {
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  debug: false,
  sendDefaultPii: false,
  beforeSend(event: Parameters<NonNullable<Parameters<typeof sentryInit>[0]['beforeSend']>>[0]) {
    try {
      if (event.message) event.message = scrubString(event.message) as string;
      if (event.extra) event.extra = scrubDeep(event.extra) as Record<string, unknown>;
      if (event.user) event.user = { id: event.user.id };
      if (event.request) {
        delete event.request.cookies;
        if (typeof event.request.headers === 'object' && event.request.headers) {
          delete (event.request.headers as Record<string, unknown>).authorization;
          delete (event.request.headers as Record<string, unknown>).cookie;
        }
        if (typeof event.request.query_string === 'string') {
          event.request.query_string = scrubString(event.request.query_string) as string;
        }
      }
    } catch { /* never let scrubbing block the send */ }
    return event;
  },
} as const;

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    sentryInit({ ...sentryOptions });

    const { validateStartup } = await import('./lib/startup-validation');
    validateStartup();

    if (process.env.DATABASE_URL) {
      const { initPostgresSchema } = await import('./lib/db-adapter');
      await initPostgresSchema().catch((err: unknown) => {
        console.error('[instrumentation] PostgreSQL schema init failed:', err);
        process.exit(1);
      });
    }
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    sentryInit({ ...sentryOptions });
  }
}
