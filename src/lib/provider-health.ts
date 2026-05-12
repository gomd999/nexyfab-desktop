/**
 * provider-health — recent-error-rate based degraded state for AI providers.
 *
 * Tracks the last N (=10) calls per provider in memory; if ≥50% failed,
 * the provider is marked degraded for COOLDOWN_MS so the chain skips
 * straight to the next fallback. After cooldown, the provider gets
 * one probe call to test recovery.
 *
 * In-process state is intentional: a Railway service runs as a single
 * Node process so this is sufficient. Multi-region deploys would need
 * Redis here.
 */

const WINDOW_SIZE = 10;
const DEGRADE_THRESHOLD = 0.5;   // ≥50% errors → degraded
const COOLDOWN_MS = 5 * 60 * 1000;

interface ProviderState {
  recent: boolean[];        // true = error, false = ok
  degradedUntilMs: number;  // 0 = healthy
  lastErrorMessage?: string;
}

const STATE = new Map<string, ProviderState>();

function ensureState(provider: string): ProviderState {
  let s = STATE.get(provider);
  if (!s) { s = { recent: [], degradedUntilMs: 0 }; STATE.set(provider, s); }
  return s;
}

/** Record an outcome for a provider call. Updates degraded state. */
export function recordProviderOutcome(
  provider: string,
  ok: boolean,
  errorMessage?: string,
): void {
  const s = ensureState(provider);
  s.recent.push(!ok);
  if (s.recent.length > WINDOW_SIZE) s.recent.shift();
  if (!ok && errorMessage) s.lastErrorMessage = errorMessage.slice(0, 200);

  // Once we have at least 5 samples, evaluate degraded state.
  if (s.recent.length >= 5) {
    const errors = s.recent.filter(Boolean).length;
    const rate = errors / s.recent.length;
    if (rate >= DEGRADE_THRESHOLD && s.degradedUntilMs <= Date.now()) {
      s.degradedUntilMs = Date.now() + COOLDOWN_MS;
    } else if (rate < DEGRADE_THRESHOLD && ok && s.degradedUntilMs > 0 && Date.now() > s.degradedUntilMs) {
      // After cooldown, a single successful probe clears the state.
      s.degradedUntilMs = 0;
      s.recent = [];
    }
  }
}

/** Returns true if the provider is currently in cooldown. */
export function isProviderDegraded(provider: string): boolean {
  const s = STATE.get(provider);
  return !!s && s.degradedUntilMs > Date.now();
}

/** Snapshot for the admin dashboard. */
export function getProviderHealth(): Array<{
  provider: string;
  recentErrors: number;
  recentTotal: number;
  errorRate: number;
  degraded: boolean;
  degradedUntilMs: number;
  lastError?: string;
}> {
  const out: ReturnType<typeof getProviderHealth> = [];
  const now = Date.now();
  for (const [provider, s] of STATE) {
    const recentErrors = s.recent.filter(Boolean).length;
    out.push({
      provider,
      recentErrors,
      recentTotal: s.recent.length,
      errorRate: s.recent.length > 0 ? recentErrors / s.recent.length : 0,
      degraded: s.degradedUntilMs > now,
      degradedUntilMs: s.degradedUntilMs,
      lastError: s.lastErrorMessage,
    });
  }
  return out;
}

/** Manual reset — useful for the admin UI's "test provider" button. */
export function resetProviderHealth(provider?: string): void {
  if (provider) STATE.delete(provider);
  else STATE.clear();
}
