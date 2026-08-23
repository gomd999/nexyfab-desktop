import { AiProviderError, type ChatCompletionRequest, type ChatCompletionResponse, type ChatMessage, type ProviderAdapter } from '../types';
import { truncationOf } from './truncation';
import { createHash } from 'crypto';
import { getSetting, getSettingSync } from '../../admin-settings';

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

function apiKeySync(): string | undefined {
  return getSettingSync('gemini.api_key') || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
}

interface GeminiCacheEntry {
  name: string;
  expiresAt: number;
  writeTokens: number;
  key: string;
}

const explicitCaches = new Map<string, GeminiCacheEntry>();
const cacheCreates = new Map<string, Promise<GeminiCacheEntry | null>>();
const cacheDisabledUntil = new Map<string, number>();
const GEMINI_CACHE_TTL_SECONDS = 3_600;

function stableSystemText(messages: ChatMessage[]): string {
  return messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n');
}

function geminiMinimumCacheTokens(model: string): number {
  return /^gemini-(?:3|4)/i.test(model) ? 4_096 : 2_048;
}

function estimatedTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
}

function geminiCacheKey(model: string, systemText: string): string {
  const digest = createHash('sha256').update(`${model}\n${systemText}`).digest('hex').slice(0, 24);
  return `nexyfab:gemini:${model}:${digest}:v1`;
}

async function ensureGeminiExplicitCache(
  key: string,
  model: string,
  systemText: string,
  apiKeyValue: string,
): Promise<GeminiCacheEntry | null> {
  const now = Date.now();
  const current = explicitCaches.get(key);
  if (current && current.expiresAt > now + 60_000) {
    return { ...current, writeTokens: 0 };
  }
  if ((cacheDisabledUntil.get(key) ?? 0) > now) return null;
  const pending = cacheCreates.get(key);
  if (pending) return pending;

  const creation = (async (): Promise<GeminiCacheEntry | null> => {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${encodeURIComponent(apiKeyValue)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${model}`,
          displayName: `nexyfab-${key.slice(-27, -3)}`,
          systemInstruction: { role: 'system', parts: [{ text: systemText }] },
          ttl: `${GEMINI_CACHE_TTL_SECONDS}s`,
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok) {
      // Explicit caching is an optimization. Unsupported/undersized contexts
      // must fall back to Gemini's implicit cache without failing generation.
      await response.text().catch(() => '');
      cacheDisabledUntil.set(key, Date.now() + 5 * 60_000);
      return null;
    }
    const data = await response.json() as {
      name?: string;
      expireTime?: string;
      usageMetadata?: { totalTokenCount?: number };
    };
    if (!data.name) return null;
    const providerExpiry = data.expireTime ? Date.parse(data.expireTime) : Number.NaN;
    const entry: GeminiCacheEntry = {
      name: data.name,
      expiresAt: Number.isFinite(providerExpiry)
        ? providerExpiry
        : Date.now() + (GEMINI_CACHE_TTL_SECONDS - 60) * 1_000,
      writeTokens: data.usageMetadata?.totalTokenCount ?? 0,
      key,
    };
    explicitCaches.set(key, entry);
    return entry;
  })().finally(() => cacheCreates.delete(key));
  cacheCreates.set(key, creation);
  return creation;
}

/** Map our system/user/assistant messages into Gemini's contents + systemInstruction. */
export function toGemini(messages: ChatMessage[]): {
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
    return Boolean(apiKeySync());
  },

  async complete(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const key = (await getSetting('gemini.api_key')) || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!key) throw new AiProviderError('gemini', undefined, 'GEMINI_API_KEY is not set');

    // Only honour a gemini-family model name; a caller's deepseek/openai model
    // (passed for the fallback provider) must not leak into the Gemini URL.
    const model = req.model?.startsWith('gemini') ? req.model : (process.env.GEMINI_TEXT_MODEL ?? DEFAULT_MODEL);
    const startedAt = Date.now();
    const { systemInstruction, contents } = toGemini(req.messages);
    const systemText = stableSystemText(req.messages);
    const cacheKey = systemText ? geminiCacheKey(model, systemText) : undefined;
    const cacheEligible = Boolean(
      cacheKey
      && estimatedTokens(systemText) >= geminiMinimumCacheTokens(model),
    );
    const explicitCache = cacheEligible && cacheKey
      ? await ensureGeminiExplicitCache(cacheKey, model, systemText, key)
      : null;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    const generate = (cachedContent?: string) => fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(cachedContent
            ? { cachedContent }
            : systemInstruction ? { systemInstruction } : {}),
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
    let res = await generate(explicitCache?.name);

    // A cache can expire between our local TTL check and generation. Retry the
    // actual request once without the stale resource; never retry model errors.
    if (!res.ok && explicitCache && (res.status === 400 || res.status === 404)) {
      await res.text().catch(() => '');
      explicitCaches.delete(explicitCache.key);
      res = await generate();
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AiProviderError('gemini', res.status, `Gemini error ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        cachedContentTokenCount?: number;
      };
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
      // ★260731 — `MAX_TOKENS` 를 여기서 노출한다. 종전엔 **빈 응답일 때만** 사유를 봤고,
      //   내용이 있으면서 잘린 경우(가장 흔한 형태)는 그대로 통과했다.
      ...truncationOf(data.candidates?.[0]?.finishReason),
      provider: 'gemini',
      model,
      promptTokens: data.usageMetadata?.promptTokenCount,
      completionTokens: data.usageMetadata?.candidatesTokenCount,
      cachedPromptTokens: data.usageMetadata?.cachedContentTokenCount,
      cacheWriteTokens: explicitCache?.writeTokens,
      cacheMissTokens: Math.max(
        0,
        (data.usageMetadata?.promptTokenCount ?? 0) - (data.usageMetadata?.cachedContentTokenCount ?? 0),
      ),
      promptCacheKey: cacheKey,
      cacheProfile: explicitCache ? 'gemini-explicit' : 'gemini-implicit',
      latencyMs: Date.now() - startedAt,
    };
  },
};
