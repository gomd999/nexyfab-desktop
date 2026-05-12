import { AiProviderError, type ChatCompletionRequest, type ChatCompletionResponse, type ProviderAdapter } from '../types';
import { getSetting, getSettingSync } from '../../admin-settings';

const DEFAULT_MODEL = 'deepseek-chat';

export const deepseekProvider: ProviderAdapter = {
  name: 'deepseek',

  // Sync probe — checks the in-process settings cache + env. The cache is
  // populated on first complete() call, so during cold-start this still
  // falls back to env, which is correct (only the DB-rotated key would
  // be missed for one request).
  isConfigured(): boolean {
    return Boolean(getSettingSync('deepseek.api_key') || process.env.DEEPSEEK_API_KEY);
  },

  async complete(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    // Resolve via getSetting (DB → env fallback) so a rotated key takes
    // effect within the 30s cache TTL without a redeploy.
    const apiKey = await getSetting('deepseek.api_key');
    if (!apiKey) throw new AiProviderError('deepseek', undefined, 'DEEPSEEK_API_KEY is not set');

    const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
    const model = req.model ?? DEFAULT_MODEL;
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
      throw new AiProviderError('deepseek', res.status, `DeepSeek error ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = data.choices?.[0]?.message?.content ?? '';

    return {
      text: content,
      provider: 'deepseek',
      model,
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
      latencyMs: Date.now() - startedAt,
    };
  },
};
