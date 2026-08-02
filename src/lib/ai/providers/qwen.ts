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
const DEFAULT_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

function keySync(): string | undefined {
  return getSettingSync('qwen.api_key') || process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY;
}

export const qwenProvider: ProviderAdapter = {
  name: 'qwen',

  isConfigured(): boolean {
    return Boolean(keySync());
  },

  async complete(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const apiKey = (await getSetting('qwen.api_key')) || process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY;
    if (!apiKey) throw new AiProviderError('qwen', undefined, 'DASHSCOPE_API_KEY is not set');

    const baseUrl = process.env.QWEN_BASE_URL || DEFAULT_BASE;
    // Honour any DashScope-catalogue model name; otherwise the default.
    const model = req.model && !req.model.startsWith('deepseek-reasoner') && !req.model.startsWith('gemini') && !req.model.startsWith('gpt-')
      ? req.model
      : (process.env.QWEN_TEXT_MODEL || DEFAULT_MODEL);
    const startedAt = Date.now();

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: req.messages,
        max_tokens: req.maxTokens ?? 4096,
        temperature: req.temperature ?? 0.2,
      }),
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
      usage?: { prompt_tokens?: number; completion_tokens?: number };
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
      latencyMs: Date.now() - startedAt,
    };
  },
};
