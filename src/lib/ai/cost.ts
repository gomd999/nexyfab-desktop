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
}

/**
 * Lookup table. Keys are case-insensitive `provider:model`. The prefix-match
 * fallback (resolveByPrefix) lets new model versions inherit a sane default
 * price until the table is updated explicitly.
 */
const PRICES: Record<string, PricePerMillion> = {
  // DeepSeek (https://api-docs.deepseek.com/quick_start/pricing) — 2026-05 rates
  'deepseek:deepseek-chat':                 { inputUsd: 0.14, outputUsd: 0.28 },
  'deepseek:deepseek-reasoner':             { inputUsd: 0.55, outputUsd: 2.19 },

  // OpenAI (https://openai.com/api/pricing/) — 2026-05 rates
  'openai:gpt-4o-mini':                     { inputUsd: 0.15, outputUsd: 0.60 },
  'openai:gpt-4o':                          { inputUsd: 2.50, outputUsd: 10.00 },
  'openai:gpt-4-turbo':                     { inputUsd: 10.00, outputUsd: 30.00 },

  // Anthropic (https://docs.anthropic.com/en/docs/about-claude/pricing) — 2026-05
  'anthropic:claude-haiku-4-5-20251001':    { inputUsd: 1.00, outputUsd: 5.00 },
  'anthropic:claude-sonnet-4-6':            { inputUsd: 3.00, outputUsd: 15.00 },
  'anthropic:claude-opus-4-7':              { inputUsd: 15.00, outputUsd: 75.00 },

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
): number {
  // Sanitize per-input: NaN/Infinity → 0 so callers passing dirty values
  // never get NaN back. Negative inputs are also clamped to zero.
  const pIn = typeof promptTokens === 'number' && Number.isFinite(promptTokens) && promptTokens > 0 ? promptTokens : 0;
  const pOut = typeof completionTokens === 'number' && Number.isFinite(completionTokens) && completionTokens > 0 ? completionTokens : 0;
  if (pIn <= 0 && pOut <= 0) return 0;

  const exact = PRICES[`${provider.toLowerCase()}:${model.toLowerCase()}`];
  const price = exact ?? resolveByPrefix(provider, model);
  if (!price) return 0;

  const usd = (pIn / 1_000_000) * price.inputUsd + (pOut / 1_000_000) * price.outputUsd;
  return Math.round(usd * 10_000) / 100;  // → cents with 2 decimals
}

/** Whether we have a known price for this provider+model pair. */
export function isPriced(provider: string, model: string): boolean {
  if (!provider || !model) return false;
  const exact = PRICES[`${provider.toLowerCase()}:${model.toLowerCase()}`];
  if (exact) return true;
  return resolveByPrefix(provider, model) !== null;
}
