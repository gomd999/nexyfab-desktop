/**
 * X2 — Client-side Sentry capture helper.
 *
 * The server-side `captureServerError` exists in `lib/error-capture.ts`
 * but it pulls in Node-only imports (NextResponse, etc). This helper is
 * the browser-safe twin: dynamic-imports `@sentry/nextjs`, swallows any
 * SDK absence, and applies a basic in-memory rate limit so a runaway
 * heartbeat or render loop can't flood the project's Sentry quota.
 *
 * Pattern stays consistent with the WebGL context-loss capture in
 * ShapePreview.tsx (the only existing client capture site).
 */

const RECENT = new Map<string, number>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;

/** Returns true when this `key` should be silenced (over rate limit). */
function shouldSilence(key: string): boolean {
  const now = Date.now();
  for (const [k, ts] of RECENT) if (now - ts > WINDOW_MS) RECENT.delete(k);
  const count = Array.from(RECENT.entries()).filter(([k]) => k === key).length;
  if (count >= MAX_PER_WINDOW) return true;
  RECENT.set(`${key}#${now}`, now);
  return false;
}

export interface ClientCaptureContext {
  /** Logical area: 'scad-agent', 'brep-mesh', 'presence', 'webgl', etc. */
  source: string;
  /** Free-form tag scope (route, action, surface). */
  tags?: Record<string, string>;
  /** Any extra payload — keep small, will be JSON-serialized. */
  extra?: Record<string, unknown>;
}

export function captureClientError(err: unknown, ctx: ClientCaptureContext): void {
  if (typeof window === 'undefined') return;
  const key = `${ctx.source}:${err instanceof Error ? err.name : 'Unknown'}`;
  if (shouldSilence(key)) return;

  const tags = { source: ctx.source, ...(ctx.tags ?? {}) };
  void import('@sentry/nextjs').then(s => {
    if (s.captureException) {
      s.captureException(err instanceof Error ? err : new Error(String(err)), {
        tags,
        extra: ctx.extra,
      });
    }
  }).catch(() => { /* SDK absent — fail silent */ });
}

export function captureClientMessage(message: string, ctx: ClientCaptureContext, level: 'warning' | 'info' | 'error' = 'warning'): void {
  if (typeof window === 'undefined') return;
  const key = `${ctx.source}:${message.slice(0, 40)}`;
  if (shouldSilence(key)) return;

  const tags = { source: ctx.source, ...(ctx.tags ?? {}) };
  void import('@sentry/nextjs').then(s => {
    if (s.captureMessage) {
      s.captureMessage(message, { level, tags, extra: ctx.extra });
    }
  }).catch(() => { /* SDK absent — fail silent */ });
}
