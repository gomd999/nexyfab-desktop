/**
 * Sentry PII redaction — shared by the client and server instrumentation
 * `beforeSend` hooks. Defense in depth: even if an error message or breadcrumb
 * carries a token/email, it is scrubbed before the event leaves the process.
 * Pure + unit-tested (sentryRedact.test.ts) — this is security-critical.
 */
export const REDACT_PATTERNS: Array<[RegExp, string]> = [
  // JWT (three base64url segments)
  [/\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]'],
  // email
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '[REDACTED_EMAIL]'],
  // Bearer token
  [/\bBearer\s+[A-Za-z0-9._-]{16,}/gi, 'Bearer [REDACTED]'],
];

export function scrubString(s: unknown): unknown {
  if (typeof s !== 'string') return s;
  let out = s;
  for (const [pat, rep] of REDACT_PATTERNS) out = out.replace(pat, rep);
  return out;
}

export function scrubDeep(value: unknown, depth = 0): unknown {
  if (depth > 4 || value == null) return value;
  if (typeof value === 'string') return scrubString(value);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = scrubDeep(v, depth + 1);
  }
  return out;
}

/** Structural shape of the fields a Sentry event exposes that we scrub. */
export interface ScrubbableEvent {
  message?: unknown;
  extra?: Record<string, unknown>;
  user?: { id?: string; [k: string]: unknown } | null;
  request?: { cookies?: unknown; query_string?: unknown; headers?: unknown; [k: string]: unknown };
}

/**
 * Scrub a Sentry event in place: redact the message + `extra`, strip the user to
 * just `id` (never email/ip), drop request cookies, redact the query string.
 * Never throws — scrubbing must not prevent an event from being sent.
 */
// Unconstrained `T` so it accepts Sentry's ErrorEvent (whose field types are not
// structurally assignable to ScrubbableEvent) and returns the same type; we read
// it through the ScrubbableEvent view internally.
export function scrubEvent<T>(event: T): T {
  const e = event as unknown as ScrubbableEvent;
  try {
    if (typeof e.message === 'string') e.message = scrubString(e.message) as string;
    if (e.extra) e.extra = scrubDeep(e.extra) as Record<string, unknown>;
    if (e.user) e.user = { id: e.user.id };
    if (e.request) {
      delete e.request.cookies;
      const headers = e.request.headers;
      if (headers && typeof headers === 'object') {
        delete (headers as Record<string, unknown>).authorization;
        delete (headers as Record<string, unknown>).cookie;
      }
      if (typeof e.request.query_string === 'string') {
        e.request.query_string = scrubString(e.request.query_string) as string;
      }
    }
  } catch { /* never block sending */ }
  return event;
}
