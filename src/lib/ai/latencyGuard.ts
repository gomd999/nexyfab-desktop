/**
 * latencyGuard.ts — Per-call timeout, fallback chain, p50/p95/p99 tracking.
 *
 * NexyFab routes through DeepSeek (cheap+fast) → Anthropic (smart) →
 * OpenAI (backup). The chain matters for AI-SCAD because the SCAD
 * emit *must* respond within ~5s or the user gives up. Stage-2 gave
 * us the provider abstraction; Stage-3 adds the budget enforcement
 * + telemetry so we can SLO it.
 *
 * No external metrics deps — the rolling-window stat tracker is
 * in-memory and queried by an ops-alert cron (existing
 * `sendOpsAlert`). Persists nothing across restarts (intentional —
 * if the process crashed, the telemetry is moot).
 */

export interface LatencyBudget {
  /** Max wall-clock for a single attempt (ms). */
  attemptMs: number;
  /** Max wall-clock across all fallback attempts (ms). */
  totalMs?: number;
}

export interface ProviderCall<T> {
  name: string;
  invoke: (signal: AbortSignal) => Promise<T>;
}

export class TimeoutError extends Error {
  constructor(public readonly elapsedMs: number, public readonly provider: string) {
    super(`Provider ${provider} timed out after ${elapsedMs}ms`);
    this.name = 'TimeoutError';
  }
}

export class AllProvidersFailedError extends Error {
  constructor(public readonly causes: Array<{ provider: string; error: unknown }>) {
    super(`All ${causes.length} providers failed`);
    this.name = 'AllProvidersFailedError';
  }
}

/** Try each provider in order; success short-circuits. Per-attempt
 *  timeout via AbortController, plus a hard ceiling on total time. */
export async function tryProviders<T>(
  providers: ProviderCall<T>[],
  budget: LatencyBudget,
  onAttempt?: (provider: string, latencyMs: number, ok: boolean) => void,
): Promise<T> {
  const start = Date.now();
  const causes: Array<{ provider: string; error: unknown }> = [];

  for (const p of providers) {
    const remaining = budget.totalMs ? budget.totalMs - (Date.now() - start) : Infinity;
    if (remaining <= 0) break;
    const cap = Math.min(budget.attemptMs, remaining);
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), cap);
    const t0 = Date.now();
    try {
      const result = await p.invoke(ac.signal);
      clearTimeout(t);
      onAttempt?.(p.name, Date.now() - t0, true);
      return result;
    } catch (err) {
      clearTimeout(t);
      const elapsed = Date.now() - t0;
      onAttempt?.(p.name, elapsed, false);
      causes.push({ provider: p.name, error: err });
    }
  }
  throw new AllProvidersFailedError(causes);
}

/** Rolling-window percentile tracker. */
export class LatencyTracker {
  private readonly samples: number[] = [];
  private readonly windowSize: number;

  constructor(windowSize = 500) {
    this.windowSize = windowSize;
  }

  record(latencyMs: number): void {
    this.samples.push(latencyMs);
    if (this.samples.length > this.windowSize) this.samples.shift();
  }

  percentile(p: number): number {
    if (this.samples.length === 0) return 0;
    const sorted = this.samples.slice().sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)));
    return sorted[idx]!;
  }

  p50(): number { return this.percentile(0.50); }
  p95(): number { return this.percentile(0.95); }
  p99(): number { return this.percentile(0.99); }
  count(): number { return this.samples.length; }
  reset(): void { this.samples.length = 0; }
}

/** Higher-order: wrap a provider call with a regression alert hook.
 *  When p95 drifts > `regressionMs` from baseline, hook fires. */
export interface RegressionAlertOptions {
  tracker: LatencyTracker;
  baselineMs: number;
  regressionMs: number;
  onRegression: (p95: number) => void;
}

export function withRegressionGuard<T>(
  call: () => Promise<T>,
  opts: RegressionAlertOptions,
): Promise<T> {
  const t0 = Date.now();
  return call().finally(() => {
    const elapsed = Date.now() - t0;
    opts.tracker.record(elapsed);
    if (opts.tracker.count() >= 50) {
      const p95 = opts.tracker.p95();
      if (p95 - opts.baselineMs > opts.regressionMs) opts.onRegression(p95);
    }
  });
}
