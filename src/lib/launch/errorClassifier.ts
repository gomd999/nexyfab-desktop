/**
 * errorClassifier.ts — Route + panel error classification for the
 * upgraded boundary hierarchy.
 *
 * The actual ErrorBoundary react components depend on the React
 * tree. To keep this module unit-testable, the *classification* —
 * deciding which fallback UI to show and what tag to send to
 * Sentry — lives here in pure logic.
 *
 * Three levels:
 *   - 'transient'  : retry-friendly (network, lock contention)
 *   - 'recoverable': feature-scoped (one panel broke, app still usable)
 *   - 'fatal'      : whole route corrupted, reload required
 *
 * Classification is best-effort — when in doubt we escalate so the
 * boundary catches more than it lets through.
 */

export type ErrorSeverity = 'transient' | 'recoverable' | 'fatal';

export type SurfaceArea = 'route' | 'panel' | 'worker' | 'ai' | 'wasm' | 'unknown';

export interface ClassifiedError {
  severity: ErrorSeverity;
  surface: SurfaceArea;
  /** Human-friendly summary for the fallback UI. */
  summary: string;
  /** Stable tag for Sentry (e.g. `error.transient.network`). */
  sentryTag: string;
  /** Whether the boundary should auto-retry after a short delay. */
  autoRetry: boolean;
}

const TRANSIENT_HINTS = [
  /\bnetwork\b/i, /fetch.*failed/i, /\btimeout\b/i,
  /\baborted?\b/i, /sqlite.*locked/i, /econnreset/i,
  /\b429\b/, /HTTP\s*5\d\d/i, /status\s*5\d\d/i,
  /Service Unavailable/i,
];

const WASM_HINTS = [/wasm/i, /occt/i, /replicad/i, /memory access/i];

const AI_HINTS = [/deepseek/i, /openai/i, /anthropic/i, /rate limit/i];

const WORKER_HINTS = [/worker/i, /postmessage/i, /transferable/i];

function describe(e: unknown): { name: string; message: string; stack?: string } {
  if (e instanceof Error) {
    return { name: e.name, message: e.message, stack: e.stack };
  }
  if (typeof e === 'string') return { name: 'StringError', message: e };
  return { name: 'UnknownError', message: String(e) };
}

function matches(rx: RegExp[], text: string): boolean {
  return rx.some(r => r.test(text));
}

export function classifyError(e: unknown, hint?: { surface?: SurfaceArea }): ClassifiedError {
  const { message, stack = '' } = describe(e);
  const haystack = `${message} ${stack}`;
  const surface = hint?.surface ?? detectSurface(haystack);

  if (matches(TRANSIENT_HINTS, haystack)) {
    return {
      severity: 'transient',
      surface,
      summary: 'Temporary connection issue — retrying.',
      sentryTag: `error.transient.${surface}`,
      autoRetry: true,
    };
  }

  if (matches(WASM_HINTS, haystack)) {
    return {
      severity: 'recoverable',
      surface: 'wasm',
      summary: 'CAD engine hiccup. Switch back to the mesh fallback.',
      sentryTag: 'error.recoverable.wasm',
      autoRetry: false,
    };
  }

  if (matches(AI_HINTS, haystack)) {
    return {
      severity: 'recoverable',
      surface: 'ai',
      summary: 'AI service unavailable — use manual mode for now.',
      sentryTag: 'error.recoverable.ai',
      autoRetry: false,
    };
  }

  if (surface === 'panel') {
    return {
      severity: 'recoverable',
      surface,
      summary: 'A panel hit an unexpected error.',
      sentryTag: `error.recoverable.panel`,
      autoRetry: false,
    };
  }

  return {
    severity: 'fatal',
    surface,
    summary: 'Something broke. Please reload.',
    sentryTag: `error.fatal.${surface}`,
    autoRetry: false,
  };
}

function detectSurface(haystack: string): SurfaceArea {
  if (matches(WORKER_HINTS, haystack)) return 'worker';
  if (matches(AI_HINTS, haystack)) return 'ai';
  if (matches(WASM_HINTS, haystack)) return 'wasm';
  return 'unknown';
}
