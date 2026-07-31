import { AiProviderError, type ChatCompletionRequest, type ChatCompletionResponse, type ChatMessage, type ProviderAdapter } from '../types';
import { truncationOf } from './truncation';
import { getSetting, getSettingSync } from '../../admin-settings';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

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
    const apiKey = await getSetting('anthropic.api_key');
    if (!apiKey) throw new AiProviderError('anthropic', undefined, 'ANTHROPIC_API_KEY is not set');

    const baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
    const model = req.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
    const startedAt = Date.now();

    const systemParts: string[] = [];
    const messages: ChatMessage[] = [];
    for (const m of req.messages) {
      if (m.role === 'system') systemParts.push(m.content);
      else messages.push(m);
    }

    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        system: systemParts.join('\n\n') || undefined,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        max_tokens: req.maxTokens ?? 4096,
        temperature: req.temperature ?? 0.2,
      }),
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
      usage?: { input_tokens?: number; output_tokens?: number };
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
      promptTokens: data.usage?.input_tokens,
      completionTokens: data.usage?.output_tokens,
      latencyMs: Date.now() - startedAt,
    };
  },
};
