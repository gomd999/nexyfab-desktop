import { AiProviderError, type ChatCompletionRequest, type ChatCompletionResponse, type ProviderAdapter } from '../types';
import { truncationOf } from './truncation';
import { getSetting, getSettingSync } from '../../admin-settings';

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
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = data.choices?.[0]?.message?.content ?? '';

    return {
      text: content,
      ...truncationOf(data.choices?.[0]?.finish_reason),
      provider: 'openai',
      model,
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
      latencyMs: Date.now() - startedAt,
    };
  },
};
