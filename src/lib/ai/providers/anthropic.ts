import { AiProviderError, type ChatCompletionRequest, type ChatCompletionResponse, type ChatMessage, type ProviderAdapter } from '../types';
import { truncationOf } from './truncation';
import { getSetting, getSettingSync } from '../../admin-settings';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

export function buildAnthropicMessagesBody(
  req: ChatCompletionRequest,
  model: string,
): Record<string, unknown> {
  const systemParts: string[] = [];
  const messages: ChatMessage[] = [];
  for (const message of req.messages) {
    if (message.role === 'system') systemParts.push(message.content);
    else messages.push(message);
  }
  const systemText = systemParts.join('\n\n');
  return {
    model,
    ...(systemText ? {
      system: [{
        type: 'text',
        text: systemText,
        cache_control: { type: 'ephemeral' },
      }],
    } : {}),
    messages: messages.map(message => ({ role: message.role, content: message.content })),
    max_tokens: req.maxTokens ?? 4096,
    temperature: req.temperature ?? 0.2,
  };
}

/**
 * Anthropic uses /v1/messages, not /v1/chat/completions. This adapter folds
 * the OpenAI-style messages array into Anthropic's expected shape:
 *   - system messages → top-level `system` field (concatenated)
 *   - user/assistant messages → `messages` array
 */
export const anthropicProvider: ProviderAdapter = {
  name: 'anthropic',

  isConfigured(): boolean {
    return Boolean(getSettingSync('anthropic.api_key') || process.env.ANTHROPIC_API_KEY);
  },

  async complete(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const apiKey = (await getSetting('anthropic.api_key')) || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new AiProviderError('anthropic', undefined, 'ANTHROPIC_API_KEY is not set');

    const baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
    const model = req.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
    const startedAt = Date.now();

    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(buildAnthropicMessagesBody(req, model)),
      signal: req.signal
        ? AbortSignal.any([req.signal, AbortSignal.timeout(req.timeoutMs ?? 30_000)])
        : AbortSignal.timeout(req.timeoutMs ?? 30_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AiProviderError('anthropic', res.status, `Anthropic error ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = await res.json() as {
      content?: Array<{ type: string; text?: string }>;
      // ★260731 — `max_tokens` 로 끝났는지. 버리면 절단이 파싱 실패로 둔갑한다.
      stop_reason?: string;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
    };
    const text = (data.content ?? [])
      .filter(b => b.type === 'text')
      .map(b => b.text ?? '')
      .join('');

    return {
      text,
      ...truncationOf(data.stop_reason),
      provider: 'anthropic',
      model,
      promptTokens: (data.usage?.input_tokens ?? 0)
        + (data.usage?.cache_creation_input_tokens ?? 0)
        + (data.usage?.cache_read_input_tokens ?? 0),
      completionTokens: data.usage?.output_tokens,
      cachedPromptTokens: data.usage?.cache_read_input_tokens,
      cacheWriteTokens: data.usage?.cache_creation_input_tokens,
      cacheMissTokens: data.usage?.input_tokens,
      cacheProfile: 'anthropic-explicit',
      latencyMs: Date.now() - startedAt,
    };
  },
};
