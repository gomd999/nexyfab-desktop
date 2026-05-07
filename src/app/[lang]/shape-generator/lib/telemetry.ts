/**
 * Shape-generator client-side error telemetry.
 *
 * Centralized capture for CSG failures, feature pipeline errors, STEP import
 * errors, and constraint solver failures. Buffers events in memory, batches
 * them, and POSTs to `/api/nexyfab/telemetry` (noop if the endpoint doesn't
 * exist — we catch the error). Falls back to `console.error` in dev.
 *
 * Keep this tiny and dependency-free so it never becomes a failure mode itself.
 */

'use client';

export type TelemetryLevel = 'error' | 'warning' | 'info';

export type TelemetrySource =
  | 'csg'
  | 'feature_pipeline'
  | 'constraint_solver'
  | 'step_import'
  | 'step_export'
  | 'gcode'
  | 'project_io'
  | 'render'
  | 'drawing_export'
  | 'mesh_export'
  | 'cam_toolpath'
  | 'unknown';

export interface TelemetryEvent {
  id: string;
  ts: number;
  level: TelemetryLevel;
  source: TelemetrySource;
  message: string;
  /** Optional stack trace from the Error object */
  stack?: string;
  /**
   * Free-form context: `featureId`, `featureType`, `params`, and for `feature_pipeline`
   * **`diagnosticCode`** (M2 — from `classifyFeatureError`) when available.
   */
  context?: Record<string, unknown>;
  /** Session-scoped URL (where the error happened) — captured at enqueue time */
  url?: string;
  /** Session id — random at module load */
  sessionId: string;
}

// ─── Session state ──────────────────────────────────────────────────────────

const SESSION_ID = (() => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'sess_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
})();

const buffer: TelemetryEvent[] = [];
const MAX_BUFFER = 100;
const FLUSH_INTERVAL_MS = 15_000;
const ENDPOINT = '/api/nexyfab/telemetry';

let flushTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<(e: TelemetryEvent) => void>();

// Deduplication: don't re-send the exact same (source, message) within a short
// window. Prevents a runaway loop from flooding the endpoint.
const DEDUP_WINDOW_MS = 5_000;
const recentKeys = new Map<string, number>();

function shouldDedupe(ev: TelemetryEvent): boolean {
  let key = ev.source + '::' + ev.message;
  // Same message can map to different diagnosticCode / stage — don't merge those (M2 ops).
  if (ev.source === 'feature_pipeline' && ev.context && typeof ev.context === 'object') {
    const c = ev.context as Record<string, unknown>;
    if (typeof c.diagnosticCode === 'string') key += '::dc:' + c.diagnosticCode;
    if (typeof c.stage === 'string') key += '::st:' + c.stage;
  }
  const now = ev.ts;
  const last = recentKeys.get(key);
  if (last && now - last < DEDUP_WINDOW_MS) return true;
  recentKeys.set(key, now);
  // Sweep old entries occasionally
  if (recentKeys.size > 200) {
    for (const [k, t] of recentKeys) if (now - t > DEDUP_WINDOW_MS * 4) recentKeys.delete(k);
  }
  return false;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function reportError(
  source: TelemetrySource,
  err: unknown,
  context?: Record<string, unknown>,
): void {
  report('error', source, err, context);
}

export function reportWarning(
  source: TelemetrySource,
  err: unknown,
  context?: Record<string, unknown>,
): void {
  report('warning', source, err, context);
}

export function reportInfo(
  source: TelemetrySource,
  message: string,
  context?: Record<string, unknown>,
): void {
  enqueue({
    id: nextId(),
    ts: Date.now(),
    level: 'info',
    source,
    message,
    context,
    url: typeof window !== 'undefined' ? window.location.pathname : undefined,
    sessionId: SESSION_ID,
  });
}

/** Subscribe to events as they arrive (e.g. to show a toast or inspector row). */
export function subscribeTelemetry(fn: (e: TelemetryEvent) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Immediate flush — returns when the POST resolves (or fails silently). */
export async function flushTelemetry(): Promise<void> {
  if (buffer.length === 0) return;
  const batch = buffer.splice(0, buffer.length);
  try {
    if (typeof fetch === 'undefined') return;
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
      keepalive: true,
    });
  } catch {
    // Endpoint may not exist in dev — don't re-enqueue, just drop. Telemetry
    // must never become a failure mode for the app.
  }
}

/** Read the current in-memory buffer without flushing. Useful for debug UIs. */
export function peekBuffer(): ReadonlyArray<TelemetryEvent> {
  return buffer.slice();
}

// ─── Internals ──────────────────────────────────────────────────────────────

function report(
  level: TelemetryLevel,
  source: TelemetrySource,
  err: unknown,
  context?: Record<string, unknown>,
): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  enqueue({
    id: nextId(),
    ts: Date.now(),
    level,
    source,
    message,
    stack,
    context,
    url: typeof window !== 'undefined' ? window.location.pathname : undefined,
    sessionId: SESSION_ID,
  });
}

function enqueue(ev: TelemetryEvent): void {
  if (shouldDedupe(ev)) return;

  // Dev console output — gives us visibility even before wiring a backend.
  if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
    const fn = ev.level === 'error' ? console.error : ev.level === 'warning' ? console.warn : console.info;
    fn(`[telemetry:${ev.source}] ${ev.message}`, ev.context ?? '');
  }

  buffer.push(ev);
  if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);

  for (const l of listeners) {
    try { l(ev); } catch { /* listener must not break enqueue */ }
  }

  ensureFlushTimer();
}

function ensureFlushTimer(): void {
  if (flushTimer !== null) return;
  if (typeof window === 'undefined') return;
  flushTimer = setInterval(() => {
    if (buffer.length > 0) void flushTelemetry();
  }, FLUSH_INTERVAL_MS);
  // Flush on page hide so we don't lose events on navigation.
  window.addEventListener('pagehide', () => { void flushTelemetry(); }, { once: false });
}

let idCounter = 0;
function nextId(): string {
  idCounter++;
  return 'ev_' + Date.now().toString(36) + '_' + idCounter.toString(36);
}
