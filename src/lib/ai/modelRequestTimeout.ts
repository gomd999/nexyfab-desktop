import type { ProviderName } from './types';

/**
 * User-selected reasoning models can take longer than the default chat path,
 * especially with NexyFab's engineering system prompt. Keep the normal fast
 * timeout for other providers while allowing the governed Qwen/DeepSeek
 * selections to finish before fallback is considered.
 */
export function selectedModelTimeoutMs(provider: ProviderName): number {
  if (provider === 'qwen') return 90_000;
  if (provider === 'deepseek') return 60_000;
  return 30_000;
}
