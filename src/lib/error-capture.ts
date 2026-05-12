/**
 * Server-side error capture helper.
 *
 * Wraps `@sentry/nextjs` `captureException` with:
 *   - PII scrubbing (emails, JWTs, query strings, secret-like keys)
 *   - structured tags (route, method, errorClass)
 *   - graceful degradation when the SDK isn't initialized (DSN missing)
 *   - fallback to `forwardToSentry` envelope POST when SDK init failed
 *
 * Use from API route catch blocks so production crashes hit the Issues feed
 * without each route hand-rolling Sentry boilerplate.
 *
 * Why a wrapper instead of raw `captureException`:
 *   - PII rules live in one place. We can update SCRUB_KEYS + scrubValue and
 *     every route inherits the new policy.
 *   - The route doesn't need to know whether @sentry/nextjs is initialized;
 *     we resolve that here.
 *   - Tags/extras are normalized so the Sentry UI groups events sensibly.
 */
import { forwardToSentry } from './sentry-forward';

/**
 * Substring match (case-insensitive) on object keys → value redacted.
 * Used for both `extras` and any nested object the caller passes.
 */
const SCRUB_KEYS = [
  'authorization', 'cookie', 'set-cookie', 'token', 'password', 'secret',
  'apikey', 'api_key', 'sessionid', 'session_id', 'jwt', 'pin',
  'ssn', 'national_id', 'card_number', 'cvv',
];

/** Redact JWT-shaped strings (3 dot-separated b64 segments) and email-shaped strings. */
function scrubString(s: string): string {
  if (typeof s !== 'string' || s.length === 0) return s;
  // JWT: ey... base64.base64.base64
  let out = s.replace(/\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]');
  // Email
  out = out.replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '[REDACTED_EMAIL]');
  // Bearer token in Authorization headers reproduced inside messages
  out = out.replace(/\bBearer\s+[A-Za-z0-9._-]{16,}/gi, 'Bearer [REDACTED]');
  return out;
}

/**
 * Recursively scrub a value tree:
 *   - keys matching SCRUB_KEYS (case-insensitive substring) → '[REDACTED]'
 *   - string values → JWT/email/Bearer redacted
 *   - cycle/depth guard so a self-referential extras object can't hang the request
 */
export function scrubValue(input: unknown, depth = 0, seen?: WeakSet<object>): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (input == null) return input;
  if (typeof input === 'string') return scrubString(input);
  if (typeof input !== 'object') return input;
  if (!seen) seen = new WeakSet<object>();
  if (seen.has(input as object)) return '[CYCLE]';
  seen.add(input as object);
  if (Array.isArray(input)) {
    return input.slice(0, 200).map(v => scrubValue(v, depth + 1, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const lower = k.toLowerCase();
    if (SCRUB_KEYS.some(s => lower.includes(s))) {
      out[k] = '[REDACTED]';
      continue;
    }
    out[k] = scrubValue(v, depth + 1, seen);
  }
  return out;
}

interface CaptureContext {
  /** Logical route, e.g. "/api/shape-chat". */
  route?: string;
  method?: string;
  /** Free-form classification — DB / AI / VALIDATION / etc. */
  errorClass?: string;
  userId?: string;
  /** Anything else useful — will be PII-scrubbed before send. */
  extras?: Record<string, unknown>;
  /** Free tag key/values; values must be primitives Sentry can index. */
  tags?: Record<string, string>;
}

/**
 * Capture an error into Sentry. Always safe to call:
 *   - returns immediately when no DSN is set
 *   - never throws (wraps the SDK call in a try/catch)
 *   - never blocks the response (envelope POST is fire-and-forget)
 */
export function captureServerError(err: unknown, ctx: CaptureContext = {}): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;

  const scrubbedExtras = ctx.extras ? scrubValue(ctx.extras) as Record<string, unknown> : undefined;
  const tags: Record<string, string> = {
    ...(ctx.route ? { route: ctx.route } : {}),
    ...(ctx.method ? { method: ctx.method } : {}),
    ...(ctx.errorClass ? { errorClass: ctx.errorClass } : {}),
    ...(ctx.tags ?? {}),
  };

  // Try the @sentry/nextjs SDK first — it has the richest stack traces and
  // ties events to the active span/transaction. Dynamic import keeps the
  // bundle slim when this file is reached during edge or test runs that
  // didn't initialize the SDK.
  void (async () => {
    try {
      const sentry = await import('@sentry/nextjs').catch(() => null);
      if (sentry?.captureException) {
        sentry.captureException(err instanceof Error ? err : new Error(message), {
          tags,
          extra: scrubbedExtras,
          user: ctx.userId ? { id: ctx.userId } : undefined,
        });
        return;
      }
    } catch { /* fall through to envelope POST */ }

    // Fallback: SDK not initialized → POST directly to the envelope endpoint.
    // forwardToSentry is also a no-op when SENTRY_DSN is unset, so this path
    // is safe in dev.
    forwardToSentry({
      level: 'error',
      message: scrubString(message),
      stack,
      tags,
      extra: scrubbedExtras,
      user: ctx.userId ? { id: ctx.userId } : undefined,
    });
  })();
}
