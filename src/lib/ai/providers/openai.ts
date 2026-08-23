import { AiProviderError, type ChatCompletionRequest, type ChatCompletionResponse, type ProviderAdapter } from '../types';
import { truncationOf } from './truncation';
import { getSetting, getSettingSync } from '../../admin-settings';
import { createHash } from 'crypto';

/**
 * 260803 — 기본 모델을 `gpt-4o-mini` 로 되돌린다(260802 에 `gpt-5.6-sol` 이었다).
 *
 * ⚠ 되돌린 이유가 정책만은 아니다. **이 어댑터는 gpt-5.6-sol 을 호출할 수 없다** —
 *   아래 본문이 `temperature` 와 `max_tokens` 를 보내는데, 추론 계열인 gpt-5.6-sol 은
 *   temperature 오버라이드를 400 으로 거부하고 `max_completion_tokens` 를 요구한다
 *   (260802 실측, 커밋 7fe89736 메시지에 기록됨). 그 400 대응은 `ai-json.mjs` 에만
 *   들어갔고 이 파일에는 없다. 즉 openai 가 폴백으로 잡히는 순간 400 으로 죽는다.
 * ⚠ gpt-5.6-sol 을 여기서 다시 쓰려면 **본문 분기부터 옮겨 와야 한다** —
 *   `OPENAI_MODEL` 로 이름만 바꾸면 같은 400 을 다시 만난다.
 */
const DEFAULT_MODEL = 'gpt-4o-mini';

function isGpt56(model: string): boolean {
  return /^gpt-5\.6(?:-|$)/i.test(model);
}

function promptCacheKey(req: ChatCompletionRequest, model: string): string {
  const stablePrefix = req.messages
    .filter(message => message.role === 'system')
    .map(message => message.content)
    .join('\n');
  const digest = createHash('sha256').update(stablePrefix).digest('hex').slice(0, 20);
  return `nexyfab:${req.task ?? 'chat'}:${model}:${digest}:v1`;
}

const EXPLICIT_CACHE_MIN_PREFIX_CHARS = 4096;

export function shouldUseOpenAiExplicitCache(req: ChatCompletionRequest, model: string): boolean {
  if (!isGpt56(model)) return false;
  return req.messages
    .filter(message => message.role === 'system')
    .reduce((total, message) => total + message.content.length, 0) >= EXPLICIT_CACHE_MIN_PREFIX_CHARS;
}

/** Exported as a pure seam so cache and GPT-5.6 request rules are testable. */
export function buildOpenAiChatBody(req: ChatCompletionRequest, model: string): Record<string, unknown> {
  const gpt56 = isGpt56(model);
  const explicitCache = shouldUseOpenAiExplicitCache(req, model);
  const lastSystemIndex = req.messages.reduce(
    (found, message, index) => message.role === 'system' ? index : found,
    -1,
  );
  const messages = explicitCache
    ? req.messages.map((message, index) => index === lastSystemIndex
      ? {
          role: message.role,
          content: [{
            type: 'text',
            text: message.content,
            prompt_cache_breakpoint: { type: 'default' },
          }],
        }
      : message)
    : req.messages;
  return {
    model,
    messages,
    ...(req.jsonSchema ? {
      response_format: {
        type: 'json_schema',
        json_schema: req.jsonSchema,
      },
    } : {}),
    ...(gpt56
      ? {
          max_completion_tokens: req.maxTokens ?? 4096,
          ...(explicitCache ? {
            prompt_cache_key: promptCacheKey(req, model),
            prompt_cache_options: { mode: 'explicit', ttl: '30m' },
          } : {}),
        }
      : {
          max_tokens: req.maxTokens ?? 4096,
          temperature: req.temperature ?? 0.2,
        }),
  };
}

export const openaiProvider: ProviderAdapter = {
  name: 'openai',

  isConfigured(): boolean {
    return Boolean(getSettingSync('openai.api_key') || process.env.OPENAI_API_KEY);
  },

  async complete(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const apiKey = (await getSetting('openai.api_key')) || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new AiProviderError('openai', undefined, 'OPENAI_API_KEY is not set');

    const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const model = req.model ?? process.env.OPENAI_MODEL ?? DEFAULT_MODEL;
    const startedAt = Date.now();

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(buildOpenAiChatBody(req, model)),
      signal: req.signal
        ? AbortSignal.any([req.signal, AbortSignal.timeout(req.timeoutMs ?? 30_000)])
        : AbortSignal.timeout(req.timeoutMs ?? 30_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AiProviderError('openai', res.status, `OpenAI error ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = await res.json() as {
      // ★260731 — 절단 신호를 읽는다. 종전엔 버려서 잘린 응답이 「형식 오류」로만 보였다.
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
        cache_write_tokens?: number;
      };
    };
    const content = data.choices?.[0]?.message?.content ?? '';

    return {
      text: content,
      ...truncationOf(data.choices?.[0]?.finish_reason),
      provider: 'openai',
      model,
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
      cachedPromptTokens: data.usage?.prompt_tokens_details?.cached_tokens,
      cacheWriteTokens: data.usage?.prompt_tokens_details?.cache_write_tokens ?? data.usage?.cache_write_tokens,
      cacheMissTokens: Math.max(
        0,
        (data.usage?.prompt_tokens ?? 0) - (data.usage?.prompt_tokens_details?.cached_tokens ?? 0),
      ),
      promptCacheKey: shouldUseOpenAiExplicitCache(req, model) ? promptCacheKey(req, model) : undefined,
      cacheProfile: shouldUseOpenAiExplicitCache(req, model) ? 'openai-explicit' : 'provider-default',
      latencyMs: Date.now() - startedAt,
    };
  },
};
