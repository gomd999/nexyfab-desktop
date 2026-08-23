/**
 * Provider/model token cost estimation.
 *
 * Prices are USD per 1M tokens, per provider docs as of 2026-05.
 * Update entries when providers change pricing — telemetry rows already
 * captured will keep their historical cost (we record costCents at call time,
 * not retroactively).
 *
 * Returns 0 for unknown providers/models so the caller can still proceed —
 * unknown is logged as "unpriced" in admin UI for manual investigation.
 */

interface PricePerMillion {
  inputUsd: number;
  outputUsd: number;
  cachedInputUsd?: number;
  cacheWriteInputUsd?: number;
}

/**
 * Lookup table. Keys are case-insensitive `provider:model`. The prefix-match
 * fallback (resolveByPrefix) lets new model versions inherit a sane default
 * price until the table is updated explicitly.
 */
const PRICES: Record<string, PricePerMillion> = {
  // DeepSeek (https://api-docs.deepseek.com/quick_start/pricing) — 2026-05 rates
  'deepseek:deepseek-chat':                 { inputUsd: 0.14, cachedInputUsd: 0.0028, outputUsd: 0.28 },
  'deepseek:deepseek-reasoner':             { inputUsd: 0.14, cachedInputUsd: 0.0028, outputUsd: 0.28 },
  'deepseek:deepseek-v4-flash':             { inputUsd: 0.14, cachedInputUsd: 0.0028, outputUsd: 0.28 },
  'deepseek:deepseek-v4-pro':               { inputUsd: 0.435, cachedInputUsd: 0.003625, outputUsd: 0.87 },

  // OpenAI (https://openai.com/api/pricing/) — 2026-05 rates unless noted
  'openai:gpt-4o-mini':                     { inputUsd: 0.15, outputUsd: 0.60 },
  'openai:gpt-4o':                          { inputUsd: 2.50, outputUsd: 10.00 },
  'openai:gpt-4-turbo':                     { inputUsd: 10.00, outputUsd: 30.00 },
  // 260802 rates, short-context tier (cached-input/cache-write/long-context tiers
  // exist but aren't tracked here — PricePerMillion has no field for them yet).
  'openai:gpt-5.6-sol':                     { inputUsd: 5.00, cachedInputUsd: 0.50, cacheWriteInputUsd: 6.25, outputUsd: 30.00 },
  'openai:gpt-5.6-terra':                   { inputUsd: 2.00, cachedInputUsd: 0.20, cacheWriteInputUsd: 2.50, outputUsd: 12.00 },
  'openai:gpt-5.6-luna':                    { inputUsd: 0.20, cachedInputUsd: 0.02, cacheWriteInputUsd: 0.25, outputUsd: 1.20 },

  // Anthropic (https://docs.anthropic.com/en/docs/about-claude/pricing) — 2026-05
  'anthropic:claude-haiku-4-5-20251001':    { inputUsd: 1.00, cachedInputUsd: 0.10, cacheWriteInputUsd: 1.25, outputUsd: 5.00 },
  'anthropic:claude-sonnet-4-6':            { inputUsd: 3.00, cachedInputUsd: 0.30, cacheWriteInputUsd: 3.75, outputUsd: 15.00 },
  'anthropic:claude-opus-4-7':              { inputUsd: 15.00, cachedInputUsd: 1.50, cacheWriteInputUsd: 18.75, outputUsd: 75.00 },

  // Local — assumed free (self-hosted inference)
  'local:llama3.1':                         { inputUsd: 0, outputUsd: 0 },
  'local:llama3':                           { inputUsd: 0, outputUsd: 0 },
};

/**
 * Prefix-match fallback for new model variants we haven't priced yet.
 * For "openai:gpt-4o-2025-XX" we'd inherit "openai:gpt-4o" pricing.
 */
function resolveByPrefix(provider: string, model: string): PricePerMillion | null {
  const key = `${provider.toLowerCase()}:${model.toLowerCase()}`;
  // Sort prefixes longest-first so more specific matches win.
  const prefixes = Object.keys(PRICES)
    .filter(k => k.startsWith(`${provider.toLowerCase()}:`))
    .sort((a, b) => b.length - a.length);
  for (const p of prefixes) {
    if (key.startsWith(p)) return PRICES[p];
  }
  return null;
}

/**
 * Compute the cost of a single chat completion in cents (USD × 100), rounded
 * to 4 decimal places to keep small calls non-zero. Returns 0 when the
 * provider/model is not in the table.
 */
export function estimateCostCents(
  provider: string,
  model: string,
  promptTokens: number | undefined,
  completionTokens: number | undefined,
  cache?: { cachedPromptTokens?: number; cacheWriteTokens?: number },
): number {
  // Sanitize per-input: NaN/Infinity → 0 so callers passing dirty values
  // never get NaN back. Negative inputs are also clamped to zero.
  const pIn = typeof promptTokens === 'number' && Number.isFinite(promptTokens) && promptTokens > 0 ? promptTokens : 0;
  const pOut = typeof completionTokens === 'number' && Number.isFinite(completionTokens) && completionTokens > 0 ? completionTokens : 0;
  if (pIn <= 0 && pOut <= 0) return 0;

  const exact = PRICES[`${provider.toLowerCase()}:${model.toLowerCase()}`];
  const price = exact ?? resolveByPrefix(provider, model);
  if (!price) return 0;

  const cached = Math.min(
    pIn,
    typeof cache?.cachedPromptTokens === 'number' && Number.isFinite(cache.cachedPromptTokens)
      ? Math.max(0, cache.cachedPromptTokens)
      : 0,
  );
  const written = Math.min(
    Math.max(0, pIn - cached),
    typeof cache?.cacheWriteTokens === 'number' && Number.isFinite(cache.cacheWriteTokens)
      ? Math.max(0, cache.cacheWriteTokens)
      : 0,
  );
  const uncached = Math.max(0, pIn - cached - written);
  const usd = (uncached / 1_000_000) * price.inputUsd
    + (cached / 1_000_000) * (price.cachedInputUsd ?? price.inputUsd)
    + (written / 1_000_000) * (price.cacheWriteInputUsd ?? price.inputUsd)
    + (pOut / 1_000_000) * price.outputUsd;
  return Math.round(usd * 10_000) / 100;  // → cents with 2 decimals
}

/** Whether we have a known price for this provider+model pair. */
export function isPriced(provider: string, model: string): boolean {
  if (!provider || !model) return false;
  const exact = PRICES[`${provider.toLowerCase()}:${model.toLowerCase()}`];
  if (exact) return true;
  return resolveByPrefix(provider, model) !== null;
}
