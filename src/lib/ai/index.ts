/**
 * Provider-agnostic AI entry point.
 *
 * Usage from API routes:
 *
 *   import { chatCompletion } from '@/lib/ai';
 *
 *   const { text, provider } = await chatCompletion({
 *     messages: [{ role: 'system', ... }, { role: 'user', ... }],
 *     maxTokens: 4000,
 *     task: 'shape-chat',
 *   });
 *
 * Provider selection:
 *   1. If req.provider is set → use that one (no fallback)
 *   2. Otherwise: AI_PROVIDER_PRIMARY (default 'deepseek') is tried first.
 *   3. On AiProviderError, walk AI_PROVIDER_FALLBACKS (comma-separated).
 *   4. If none configured/working → AiNotConfiguredError.
 */

import {
  AiNotConfiguredError,
  AiProviderError,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
  type ProviderAdapter,
  type ProviderName,
} from './types';
import { deepseekProvider } from './providers/deepseek';
import { openaiProvider } from './providers/openai';
import { anthropicProvider } from './providers/anthropic';
import { localProvider } from './providers/local';
import { geminiProvider } from './providers/gemini';
import { qwenProvider } from './providers/qwen';
import { openrouterProvider } from './providers/openrouter';

// Partial because not every ProviderName has a chat adapter. Chat callers
// fall through the fallback chain when their requested provider isn't
// in this registry.
const REGISTRY: Partial<Record<ProviderName, ProviderAdapter>> = {
  deepseek: deepseekProvider,
  gemini: geminiProvider,
  qwen: qwenProvider,
  openrouter: openrouterProvider,
  openai: openaiProvider,
  anthropic: anthropicProvider,
  local: localProvider,
};

function parseProviderList(raw: string | undefined, fallback: ProviderName[]): ProviderName[] {
  if (!raw) return fallback;
  return raw
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter((s): s is ProviderName => s in REGISTRY);
}

function resolveDefaultChain(req: ChatCompletionRequest): ProviderName[] {
  // DB override wins over env when present. Lazy-load so env-only deployments
  // never pay the lookup cost; cache is in-process so this is trivial.
  let dbOverride: ProviderName[] | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./providerOverride') as typeof import('./providerOverride');
    dbOverride = mod.providerOverrideCached();
    mod.scheduleProviderOverrideRefresh();
  } catch { /* DB not available — fall back to env */ }
  if (dbOverride && dbOverride.length > 0) return dbOverride;

  // 260803 — back to deepseek primary (reverts the 260802 openai/gpt-5.6-sol
  // switch per explicit product decision). Gemini sits right behind it: it's
  // the provider that also serves vision, so a deepseek outage keeps text and
  // image judgement on the same vendor. OpenAI stays wired as a later fallback.
  const primary = parseProviderList(process.env.AI_PROVIDER_PRIMARY, ['deepseek']);
  // Default chain orders cheap → mid → free. Anthropic stays in REGISTRY for
  // callers that request it explicitly via req.provider or env override, but
  // is intentionally omitted from the default fallback to avoid surprise Opus
  // spend on provider outages.
  const fallbacks = parseProviderList(process.env.AI_PROVIDER_FALLBACKS, ['gemini', 'openai', 'local']);
  // A task-specific preference (e.g. CAD codegen → gemini) jumps the queue but
  // keeps the normal chain behind it as fallback. Only honoured if the
  // preferred provider is actually configured, so it degrades silently.
  const prefer = req.preferProvider && REGISTRY[req.preferProvider]?.isConfigured() ? [req.preferProvider] : [];
  return Array.from(new Set([...prefer, ...primary, ...fallbacks]));
}

function resolveChain(req: ChatCompletionRequest): ProviderName[] {
  if (req.provider && !req.allowProviderFallback) return [req.provider];
  const defaults = resolveDefaultChain(req);
  return req.provider
    ? Array.from(new Set([req.provider, ...defaults]))
    : defaults;
}

export async function chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
  const chain = resolveChain(req);
  const errors: string[] = [];
  const failures: Array<{ provider: ProviderName; model?: string; status?: number; message: string }> = [];

  // Lazy imports so the unit tests don't need to mock these modules.
  const { recordApiUsage } = await import('../api-meter');
  const { estimateCostCents } = await import('./cost');
  const { getActiveBreaker } = await import('../cost-breaker');
  const { isProviderDegraded, recordProviderOutcome } = await import('../provider-health');

  // Cost breaker — if active, fail fast before incurring more spend.
  // Operator can clear from /admin/api-health.
  const breaker = await getActiveBreaker();
  if (breaker) {
    throw new AiProviderError(
      chain[0] ?? 'deepseek', 503,
      `AI cost breaker active (${breaker.scope}) until ${new Date(breaker.untilMs).toISOString()}: ${breaker.reason}`,
    );
  }

  for (const name of chain) {
    // Bail out fast on each fallback iteration if the caller aborted —
    // otherwise we'd keep retrying providers for a request whose response
    // can no longer be delivered.
    if (req.signal?.aborted) {
      throw new AiProviderError(name, undefined, 'aborted');
    }
    const adapter = REGISTRY[name];
    if (!adapter) {
      const message = 'no chat adapter (vision-only?)';
      errors.push(`${name}: ${message}`);
      failures.push({ provider: name, model: name === chain[0] ? req.model : undefined, message });
      continue;
    }
    if (!adapter.isConfigured()) {
      const message = 'not configured';
      errors.push(`${name}: ${message}`);
      failures.push({ provider: name, model: name === chain[0] ? req.model : undefined, message });
      continue;
    }
    // Skip providers in cooldown — chain.ts already orders by preference,
    // so the degraded one is jumped over and we go straight to the fallback.
    if (isProviderDegraded(name)) {
      const message = 'degraded (cooldown)';
      errors.push(`${name}: ${message}`);
      failures.push({ provider: name, model: name === chain[0] ? req.model : undefined, message });
      continue;
    }
    const t0 = Date.now();
    try {
      // A model identifier is vendor-specific. Keep it only for the selected
      // first provider and let fallback adapters resolve their own configured
      // defaults. This also prevents invalid-model 400s during failover.
      const attemptReq: ChatCompletionRequest = name === chain[0]
        ? req
        : { ...req, provider: undefined, preferProvider: undefined, model: undefined };
      const res = await adapter.complete(attemptReq);
      // Successful provider call — record cost / latency / tokens to the
      // unified nf_api_usage table for the admin observability dashboard.
      recordApiUsage({
        provider: name,
        endpoint: 'chat.completions',
        feature: req.task,
        statusCode: 200,
        latencyMs: res.latencyMs ?? (Date.now() - t0),
        tokensIn: res.promptTokens,
        tokensOut: res.completionTokens,
        cachedPromptTokens: res.cachedPromptTokens,
        cacheWriteTokens: res.cacheWriteTokens,
        cacheMissTokens: res.cacheMissTokens,
        cacheProfile: res.cacheProfile,
        costUsd: estimateCostCents(name, res.model, res.promptTokens, res.completionTokens, {
          cachedPromptTokens: res.cachedPromptTokens,
          cacheWriteTokens: res.cacheWriteTokens,
        }) / 100,
        userId: req.userId,
      });
      recordProviderOutcome(name, true);
      if (failures.length > 0) {
        void reportAiFailures(failures, {
          task: req.task,
          recoveredBy: { provider: res.provider, model: res.model },
        });
      }
      return res;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const status = e instanceof AiProviderError ? (e.status ?? 0) : 0;
      // Failed call still gets logged so the dashboard surfaces error rates
      // per provider — without this we'd only see successful spend.
      recordApiUsage({
        provider: name,
        endpoint: 'chat.completions',
        feature: req.task,
        statusCode: status,
        latencyMs: Date.now() - t0,
        userId: req.userId,
        errorMessage: msg,
      });
      recordProviderOutcome(name, false, msg);
      errors.push(`${name}: ${msg}`);
      failures.push({
        provider: name,
        model: name === chain[0] ? req.model : undefined,
        status: status || undefined,
        message: msg,
      });
      if (e instanceof AiProviderError) {
        // Bail out fallback for client errors (4xx other than 429) — those
        // normally indicate a request/configuration bug. A user-selected model
        // with governed fallback enabled is the exception: model retirement,
        // regional unavailability, or a stale deployment id often surfaces as
        // 400/404, and must not make the CAD workspace unusable. Exact admin
        // probes still fail on the first 4xx.
        if (!req.allowProviderFallback && e.status && e.status >= 400 && e.status < 500 && e.status !== 429) {
          throw e;
        }
      }
      // Otherwise continue to next provider in chain.
    }
  }

  if (errors.length === 0) throw new AiNotConfiguredError();
  void reportAiFailures(failures, { task: req.task });
  throw new AiProviderError(chain[0] ?? 'deepseek', undefined, `All providers failed: ${errors.join(' | ')}`);
}

async function reportAiFailures(
  failures: Array<{ provider: ProviderName; model?: string; status?: number; message: string }>,
  outcome: { task?: string; recoveredBy?: { provider: ProviderName; model: string } },
): Promise<void> {
  if (failures.length === 0) return;
  try {
    const { notifyAiProviderFailure } = await import('./providerFailureAlert');
    await notifyAiProviderFailure({
      provider: failures[0].provider,
      model: failures[0].model,
      status: failures[0].status,
      errorMessage: failures[0].message,
      task: outcome.task,
      attemptedProviders: failures.map(item => item.provider),
      recoveredBy: outcome.recoveredBy,
    });
  } catch (error) {
    // Alert delivery must never turn a successful fallback into a user error.
    console.warn('[ai] provider failure alert could not be dispatched:', error);
  }
}

export { AiProviderError, AiNotConfiguredError };
export type { ChatCompletionRequest, ChatCompletionResponse, ProviderName, ChatMessage } from './types';

// Lever B — self-consistency: run one model N times, use cross-run agreement as
// free confidence. Default runs=1 is a no-op passthrough (zero extra cost).
export {
  runSelfConsistent,
  type SelfConsistencyOptions,
  type SelfConsistencyResult,
  type ProjectedFields,
  type ScalarField,
} from './selfConsistency';
