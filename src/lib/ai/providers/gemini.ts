import { AiProviderError, type ChatCompletionRequest, type ChatCompletionResponse, type ChatMessage, type ProviderAdapter } from '../types';

/**
 * Google Gemini text provider (generateContent). Gemini is markedly stronger
 * at spatial / geometric reasoning than DeepSeek, so it is the preferred
 * provider for CAD codegen (free-form OpenSCAD + precise feature programs) —
 * the same family of models competitors use to turn a photo into a real car.
 *
 * Reuses the GEMINI_API_KEY / GOOGLE_API_KEY already configured for vision.
 * Default model is a Pro tier for codegen fidelity; override with
 * GEMINI_TEXT_MODEL or req.model.
 */
const DEFAULT_MODEL = 'gemini-2.5-pro';

function apiKey(): string | undefined {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
}

/** Map our system/user/assistant messages into Gemini's contents + systemInstruction. */
function toGemini(messages: ChatMessage[]): {
  systemInstruction?: { parts: { text: string }[] };
  contents: { role: 'user' | 'model'; parts: { text: string }[] }[];
} {
  const sys = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model', parts: [{ text: m.content }] }));
  // Gemini requires the conversation to start with a user turn.
  if (contents.length === 0 || contents[0].role !== 'user') {
    contents.unshift({ role: 'user', parts: [{ text: sys || 'Proceed.' }] });
  }
  return { ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}), contents };
}

export const geminiProvider: ProviderAdapter = {
  name: 'gemini',

  isConfigured(): boolean {
    return Boolean(apiKey());
  },

  async complete(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const key = apiKey();
    if (!key) throw new AiProviderError('gemini', undefined, 'GEMINI_API_KEY is not set');

    // Only honour a gemini-family model name; a caller's deepseek/openai model
    // (passed for the fallback provider) must not leak into the Gemini URL.
    const model = req.model?.startsWith('gemini') ? req.model : (process.env.GEMINI_TEXT_MODEL ?? DEFAULT_MODEL);
    const startedAt = Date.now();
    const { systemInstruction, contents } = toGemini(req.messages);

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(systemInstruction ? { systemInstruction } : {}),
        contents,
        generationConfig: {
          maxOutputTokens: req.maxTokens ?? 8192,
          temperature: req.temperature ?? 0.2,
        },
      }),
      signal: req.signal
        ? AbortSignal.any([req.signal, AbortSignal.timeout(req.timeoutMs ?? 60_000)])
        : AbortSignal.timeout(req.timeoutMs ?? 60_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AiProviderError('gemini', res.status, `Gemini error ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const content = (data.candidates?.[0]?.content?.parts ?? [])
      .map(p => p.text ?? '')
      .join('')
      .trim();
    if (!content) {
      const reason = data.candidates?.[0]?.finishReason ?? 'empty';
      throw new AiProviderError('gemini', undefined, `Gemini returned no text (finishReason: ${reason})`);
    }

    return {
      text: content,
      provider: 'gemini',
      model,
      promptTokens: data.usageMetadata?.promptTokenCount,
      completionTokens: data.usageMetadata?.candidatesTokenCount,
      latencyMs: Date.now() - startedAt,
    };
  },
};
