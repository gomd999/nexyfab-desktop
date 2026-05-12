import { AiProviderError, type ChatCompletionRequest, type ChatCompletionResponse, type ProviderAdapter } from '../types';
import { getSetting, getSettingSync } from '../../admin-settings';

const DEFAULT_MODEL = 'gpt-4o-mini';

export const openaiProvider: ProviderAdapter = {
  name: 'openai',

  isConfigured(): boolean {
    return Boolean(getSettingSync('openai.api_key') || process.env.OPENAI_API_KEY);
  },

  async complete(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const apiKey = await getSetting('openai.api_key');
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
      body: JSON.stringify({
        model,
        messages: req.messages,
        max_tokens: req.maxTokens ?? 4096,
        temperature: req.temperature ?? 0.2,
      }),
      signal: AbortSignal.timeout(req.timeoutMs ?? 30_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AiProviderError('openai', res.status, `OpenAI error ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = data.choices?.[0]?.message?.content ?? '';

    return {
      text: content,
      provider: 'openai',
      model,
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
      latencyMs: Date.now() - startedAt,
    };
  },
};
