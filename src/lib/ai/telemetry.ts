/**
 * Lightweight telemetry for AI provider calls.
 *
 * Records one `prompt_call` event per chatCompletion invocation, capturing the
 * resolved prompt id (after A/B variant routing), provider, model, latency,
 * and success/error state. This lets us compare variant performance and detect
 * provider regressions without standing up a separate metrics service.
 *
 * Storage: piggybacks on the existing `nf_usage_events` table via
 * `recordUsageEvent` (fire-and-forget), so a write failure cannot break
 * the AI request itself.
 *
 * Privacy: no prompt or response content is logged — only metadata IDs.
 */

import { recordUsageEvent } from '@/lib/plan-guard';
import { estimateCostCents } from './cost';

export interface PromptCallTelemetry {
  /** Anonymous if userId omitted; metric still captured for system-wide stats. */
  userId?: string;
  /** Prompt id after variant resolution (e.g. "shape-chat" or "scad-intent-from-nl:tighter"). */
  promptId: string;
  /** Prompt version at call time (e.g. "1.1.0"). */
  promptVersion: string;
  /** Provider that actually served (after fallback chain). */
  provider: string;
  /** Specific model name. */
  model: string;
  /** Wall-clock duration in ms. */
  latencyMs: number;
  /** Token counts when reported by the provider. */
  promptTokens?: number;
  completionTokens?: number;
  /** True if the call succeeded; false if the provider chain failed. */
  success: boolean;
  /** Short error code/class on failure (e.g. "AiNotConfigured", "deepseek_502"). */
  errorClass?: string;
}

const METRIC = 'prompt_call';

/**
 * Fire-and-forget. Caller does NOT await this — telemetry must never block
 * the response path. Failure is silently swallowed by recordUsageEvent.
 */
export function recordPromptCall(t: PromptCallTelemetry): void {
  // Anonymous calls: use a synthetic anon-bucket id so DB isn't filled with
  // null user_ids (some pipelines reject those). It still groups stats
  // sensibly per provider/prompt.
  const userId = t.userId ?? 'anon';
  const metadata: Record<string, unknown> = {
    promptId: t.promptId,
    promptVersion: t.promptVersion,
    provider: t.provider,
    model: t.model,
    latencyMs: t.latencyMs,
    success: t.success,
  };
  if (t.promptTokens !== undefined) metadata.promptTokens = t.promptTokens;
  if (t.completionTokens !== undefined) metadata.completionTokens = t.completionTokens;
  if (t.errorClass) metadata.errorClass = t.errorClass;

  // Compute cost at write time so historical rows keep their pricing even if
  // the rate card changes later. Cost is only meaningful for successful calls
  // that report token counts.
  if (t.success && (t.promptTokens || t.completionTokens)) {
    const cents = estimateCostCents(t.provider, t.model, t.promptTokens, t.completionTokens);
    if (cents > 0) metadata.costCents = cents;
  }

  recordUsageEvent(userId, METRIC, metadata);
}

/** Classify an unknown error into a short string for telemetry. */
export function classifyAiError(err: unknown): string {
  if (err === null || err === undefined) return 'unknown';
  if (typeof err === 'object' && err !== null && 'name' in err && typeof (err as { name?: unknown }).name === 'string') {
    const name = (err as { name: string }).name;
    if (name === 'AiNotConfiguredError' || name === 'AiProviderError') return name;
  }
  if (err instanceof Error) {
    if (err.message.includes('timed out')) return 'timeout';
    if (err.message.includes('aborted')) return 'aborted';
    return 'error';
  }
  return 'unknown';
}
