import { AiProviderError, type ChatCompletionRequest, type ChatCompletionResponse, type ProviderAdapter } from '../types';
import { truncationOf } from './truncation';
import { getSetting, getSettingSync } from '../../admin-settings';

/**
 * OpenRouter provider — OpenAI-compatible gateway to a huge catalogue of models
 * (z-ai/glm-5.2, anthropic/claude-*, google/gemini-*, qwen/*, etc.) behind one
 * key. The model slug (vendor/model) on the request selects which.
 *
 * Configure with OPENROUTER_API_KEY. Optional OPENROUTER_REFERER / OPENROUTER_TITLE
 * populate the OpenRouter leaderboard headers.
 */
const DEFAULT_MODEL = 'z-ai/glm-5.2';
const BASE = 'https://openrouter.ai/api/v1';

function keySync(): string | undefined {
  return getSettingSync('openrouter.api_key') || process.env.OPENROUTER_API_KEY;
}

function supportsExplicitCacheMarker(model: string): boolean {
  return model.startsWith('anthropic/')
    || /^qwen\/(?:qwen3-max|qwen-plus|qwen3\.6-plus|qwen3-coder-plus|qwen3-coder-flash)(?:$|:)/.test(model);
}

/** Preserve a stable prefix and opt in only where OpenRouter documents it. */
export function buildOpenRouterChatBody(req: ChatCompletionRequest, model: string): Record<string, unknown> {
  const explicit = supportsExplicitCacheMarker(model);
  const lastSystemIndex = req.messages.reduce(
    (found, message, index) => message.role === 'system' ? index : found,
    -1,
  );
  const messages = req.messages.map((message, index) => explicit && index === lastSystemIndex
    ? {
        role: message.role,
        content: [{ type: 'text', text: message.content, cache_control: { type: 'ephemeral' } }],
      }
    : message);
  return {
    model,
    messages,
    max_tokens: req.maxTokens ?? 4096,
    temperature: req.temperature ?? 0.2,
  };
}

export const openrouterProvider: ProviderAdapter = {
  name: 'openrouter',

  isConfigured(): boolean {
    return Boolean(keySync());
  },

  async complete(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const apiKey = (await getSetting('openrouter.api_key')) || process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new AiProviderError('openrouter', undefined, 'OPENROUTER_API_KEY is not set');

    // OpenRouter model slugs contain a "vendor/model" slash; if a caller's
    // single-vendor model name (e.g. a deepseek/gemini fallback model) reaches
    // us, use the default so we never POST a slug OpenRouter can't resolve.
    const model = req.model?.includes('/') ? req.model : (process.env.OPENROUTER_TEXT_MODEL || DEFAULT_MODEL);
    const startedAt = Date.now();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
    if (process.env.OPENROUTER_REFERER) headers['HTTP-Referer'] = process.env.OPENROUTER_REFERER;
    if (process.env.OPENROUTER_TITLE) headers['X-Title'] = process.env.OPENROUTER_TITLE;

    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildOpenRouterChatBody(req, model)),
      signal: req.signal
        ? AbortSignal.any([req.signal, AbortSignal.timeout(req.timeoutMs ?? 60_000)])
        : AbortSignal.timeout(req.timeoutMs ?? 60_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AiProviderError('openrouter', res.status, `OpenRouter error ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = await res.json() as {
      // ★260731 — 절단 신호를 읽는다. 종전엔 버려서 잘린 응답이 「형식 오류」로만 보였다.
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
      };
    };
    const content = data.choices?.[0]?.message?.content ?? '';
    if (!content) throw new AiProviderError('openrouter', undefined, 'OpenRouter returned no text');

    return {
      text: content,
      ...truncationOf(data.choices?.[0]?.finish_reason),
      provider: 'openrouter',
      model,
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
      cachedPromptTokens: data.usage?.prompt_tokens_details?.cached_tokens,
      cacheWriteTokens: data.usage?.prompt_tokens_details?.cache_write_tokens,
      cacheMissTokens: Math.max(0, (data.usage?.prompt_tokens ?? 0) - (data.usage?.prompt_tokens_details?.cached_tokens ?? 0)),
      cacheProfile: 'openrouter-native',
      latencyMs: Date.now() - startedAt,
    };
  },
};
