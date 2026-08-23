import { AiProviderError, type ChatCompletionRequest, type ChatCompletionResponse, type ProviderAdapter } from '../types';
import { truncationOf } from './truncation';
import { getSetting, getSettingSync } from '../../admin-settings';

/**
 * Alibaba DashScope (Bailian) provider — OpenAI-compatible endpoint. One key
 * unlocks a whole catalogue of strong models on a generous free tier:
 * qwen3.7-max / qwen3.7-plus (excellent spatial reasoning for CAD codegen),
 * glm-5.1, and deepseek-v4-pro. The model name on the request selects which.
 *
 * Configure with DASHSCOPE_API_KEY (or QWEN_API_KEY). Override the endpoint
 * with QWEN_BASE_URL and the default model with QWEN_TEXT_MODEL.
 */
const DEFAULT_MODEL = 'qwen3.7-max';
// NexyFab's current DashScope key is issued in Singapore. Region and key must
// match; operators serving China can override qwen.base_url in Admin Settings.
const DEFAULT_BASE = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';

export const QWEN_REGION_BASE_URLS = {
  china: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  singapore: DEFAULT_BASE,
} as const;

function keySync(): string | undefined {
  return getSettingSync('qwen.api_key') || process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY;
}

export async function getQwenApiKey(): Promise<string | undefined> {
  return (await getSetting('qwen.api_key')) || process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY;
}

export function normalizeQwenBaseUrl(value: string | null | undefined): string {
  const candidate = (value || DEFAULT_BASE).trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new AiProviderError('qwen', undefined, 'Invalid Qwen base URL');
  }
  const officialHost = parsed.protocol === 'https:'
    && (parsed.hostname === 'aliyuncs.com' || parsed.hostname.endsWith('.aliyuncs.com'));
  if (!officialHost) {
    throw new AiProviderError('qwen', undefined, 'Qwen base URL must use an official HTTPS aliyuncs.com endpoint');
  }
  return candidate;
}

export async function getQwenBaseUrl(): Promise<string> {
  const configured = (await getSetting('qwen.base_url')) || process.env.QWEN_BASE_URL || DEFAULT_BASE;
  return normalizeQwenBaseUrl(configured);
}

const EXPLICIT_CACHE_MIN_PREFIX_CHARS = 4096;

export function shouldUseQwenExplicitCache(req: ChatCompletionRequest, model: string): boolean {
  const explicitCacheModel = /^(?:qwen(?:3\.8-max|3\.7-(?:max|plus|flash)|3\.6-(?:max-preview|plus|flash)|3\.5-(?:plus|flash)|3-max|3-coder-(?:plus|flash)|3-vl-(?:plus|flash)|plus|flash)|deepseek-v3\.2)/i.test(model);
  return explicitCacheModel && req.messages
    .filter(message => message.role === 'system')
    .reduce((total, message) => total + message.content.length, 0) >= EXPLICIT_CACHE_MIN_PREFIX_CHARS;
}

/**
 * DashScope explicit context cache uses an Anthropic-style cache marker on a
 * message content block. Mark only the final stable system block so the
 * changing user request remains outside the cached prefix.
 */
export function buildQwenChatBody(req: ChatCompletionRequest, model: string): Record<string, unknown> {
  const explicitCache = shouldUseQwenExplicitCache(req, model);
  const lastSystemIndex = req.messages.reduce(
    (found, message, index) => message.role === 'system' ? index : found,
    -1,
  );
  const messages = req.messages.map((message, index) => {
    if (!explicitCache || index !== lastSystemIndex) return message;
    return {
      role: message.role,
      content: [{
        type: 'text',
        text: message.content,
        cache_control: { type: 'ephemeral' },
      }],
    };
  });
  return {
    model,
    messages,
    max_tokens: req.maxTokens ?? 4096,
    temperature: req.temperature ?? 0.2,
  };
}

export const qwenProvider: ProviderAdapter = {
  name: 'qwen',

  isConfigured(): boolean {
    return Boolean(keySync());
  },

  async complete(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const apiKey = await getQwenApiKey();
    if (!apiKey) throw new AiProviderError('qwen', undefined, 'DASHSCOPE_API_KEY is not set');

    const baseUrl = await getQwenBaseUrl();
    // Honour any DashScope-catalogue model name; otherwise the default.
    const model = req.model && !req.model.startsWith('deepseek-reasoner') && !req.model.startsWith('gemini') && !req.model.startsWith('gpt-')
      ? req.model
      : (process.env.QWEN_TEXT_MODEL || DEFAULT_MODEL);
    const startedAt = Date.now();

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(buildQwenChatBody(req, model)),
      signal: req.signal
        ? AbortSignal.any([req.signal, AbortSignal.timeout(req.timeoutMs ?? 60_000)])
        : AbortSignal.timeout(req.timeoutMs ?? 60_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AiProviderError('qwen', res.status, `DashScope error ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = await res.json() as {
      // ★260731 — 절단 신호를 읽는다. 종전엔 버려서 잘린 응답이 「형식 오류」로만 보였다.
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: {
          cached_tokens?: number;
          cache_creation_input_tokens?: number;
        };
      };
    };
    const content = data.choices?.[0]?.message?.content ?? '';
    if (!content) throw new AiProviderError('qwen', undefined, 'DashScope returned no text');

    return {
      text: content,
      ...truncationOf(data.choices?.[0]?.finish_reason),
      provider: 'qwen',
      model,
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
      cachedPromptTokens: data.usage?.prompt_tokens_details?.cached_tokens,
      cacheWriteTokens: data.usage?.prompt_tokens_details?.cache_creation_input_tokens,
      cacheMissTokens: Math.max(
        0,
        (data.usage?.prompt_tokens ?? 0) - (data.usage?.prompt_tokens_details?.cached_tokens ?? 0),
      ),
      cacheProfile: shouldUseQwenExplicitCache(req, model) ? 'qwen-explicit' : 'provider-default',
      latencyMs: Date.now() - startedAt,
    };
  },
};
