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

// Partial because not every ProviderName has a chat adapter — `gemini`
// is currently vision-only (see src/lib/ai/vision.ts). Chat callers
// fall through the fallback chain when their requested provider isn't
// in this registry.
const REGISTRY: Partial<Record<ProviderName, ProviderAdapter>> = {
  deepseek: deepseekProvider,
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

function resolveChain(req: ChatCompletionRequest): ProviderName[] {
  if (req.provider) return [req.provider];
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

  const primary = parseProviderList(process.env.AI_PROVIDER_PRIMARY, ['deepseek']);
  // Default chain orders cheap → mid → free. Anthropic stays in REGISTRY for
  // callers that request it explicitly via req.provider or env override, but
  // is intentionally omitted from the default fallback to avoid surprise Opus
  // spend on provider outages.
  const fallbacks = parseProviderList(process.env.AI_PROVIDER_FALLBACKS, ['openai', 'local']);
  return Array.from(new Set([...primary, ...fallbacks]));
}

export async function chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
  const chain = resolveChain(req);
  const errors: string[] = [];

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
    const adapter = REGISTRY[name];
    if (!adapter) {
      errors.push(`${name}: no chat adapter (vision-only?)`);
      continue;
    }
    if (!adapter.isConfigured()) {
      errors.push(`${name}: not configured`);
      continue;
    }
    // Skip providers in cooldown — chain.ts already orders by preference,
    // so the degraded one is jumped over and we go straight to the fallback.
    if (isProviderDegraded(name)) {
      errors.push(`${name}: degraded (cooldown)`);
      continue;
    }
    const t0 = Date.now();
    try {
      const res = await adapter.complete(req);
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
        costUsd: estimateCostCents(name, res.model, res.promptTokens, res.completionTokens) / 100,
        userId: req.userId,
      });
      recordProviderOutcome(name, true);
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
      if (e instanceof AiProviderError) {
        // Bail out fallback for client errors (4xx other than 429) — those
        // indicate a bug in our request, not a provider outage.
        if (e.status && e.status >= 400 && e.status < 500 && e.status !== 429) {
          throw e;
        }
      }
      // Otherwise continue to next provider in chain.
    }
  }

  if (errors.length === 0) throw new AiNotConfiguredError();
  throw new AiProviderError(chain[0] ?? 'deepseek', undefined, `All providers failed: ${errors.join(' | ')}`);
}

export { AiProviderError, AiNotConfiguredError };
export type { ChatCompletionRequest, ChatCompletionResponse, ProviderName, ChatMessage } from './types';
