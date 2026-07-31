import { AiProviderError, type ChatCompletionRequest, type ChatCompletionResponse, type ProviderAdapter } from '../types';
import { truncationOf } from './truncation';

const DEFAULT_MODEL = 'llama3.1';

/**
 * Local OpenAI-compatible endpoint (Ollama, vLLM, llama.cpp, LM Studio, etc.).
 * Activated by setting LOCAL_AI_BASE_URL. No auth header is sent unless
 * LOCAL_AI_API_KEY is also set.
 */
export const localProvider: ProviderAdapter = {
  name: 'local',

  isConfigured(): boolean {
    return Boolean(process.env.LOCAL_AI_BASE_URL);
  },

  async complete(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const baseUrl = process.env.LOCAL_AI_BASE_URL;
    if (!baseUrl) throw new AiProviderError('local', undefined, 'LOCAL_AI_BASE_URL is not set');

    const apiKey = process.env.LOCAL_AI_API_KEY;
    const model = req.model ?? process.env.LOCAL_AI_MODEL ?? DEFAULT_MODEL;
    const startedAt = Date.now();

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: req.messages,
        max_tokens: req.maxTokens ?? 4096,
        temperature: req.temperature ?? 0.2,
      }),
      signal: req.signal
        ? AbortSignal.any([req.signal, AbortSignal.timeout(req.timeoutMs ?? 60_000)])
        : AbortSignal.timeout(req.timeoutMs ?? 60_000), // local can be slower
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AiProviderError('local', res.status, `Local AI error ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = await res.json() as {
      // ★260731 — 절단 신호를 읽는다. 종전엔 버려서 잘린 응답이 「형식 오류」로만 보였다.
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = data.choices?.[0]?.message?.content ?? '';

    return {
      text: content,
      ...truncationOf(data.choices?.[0]?.finish_reason),
      provider: 'local',
      model,
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
      latencyMs: Date.now() - startedAt,
    };
  },
};
