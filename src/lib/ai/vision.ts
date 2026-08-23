/**
 * Provider-agnostic vision API wrapper.
 *
 * The agent's `view_render` tool calls this with one or more PNG images
 * (rendered from the current SCAD source) plus a text prompt asking the
 * model to critique the geometry. The model returns natural-language
 * analysis the agent can act on (e.g. "wheels are too small relative to
 * the body").
 *
 * Provider support:
 *   - Anthropic (Claude 3 / 4 family) — base64 image blocks
 *   - OpenAI (gpt-4o, gpt-4o-mini) — image_url with data URI
 *   - Google Gemini (2.0-flash, 1.5-flash) — inline_data base64 parts
 *   - Local (Ollama / vLLM with OpenAI-compatible vision) —
 *     point LOCAL_VISION_BASE_URL at e.g. http://localhost:11434/v1
 *   - DeepSeek — no public vision API (returns NotConfiguredError)
 *
 * Cost note: vision requests are 5–20× more expensive than text-only.
 * The route layer enforces a separate per-user budget gate before this
 * is invoked.
 */

import type { ProviderName } from './types';
import { truncationOf } from './providers/truncation';
import { getSetting, getSettingSync } from '../admin-settings';
import { supportsNativeVision } from './modelCapabilities';
import { getQwenApiKey, getQwenBaseUrl } from './providers/qwen';

export interface VisionImage {
  /** Raw image bytes (PNG only — JPEG converted by caller if needed). */
  bytes: Uint8Array;
  /** Actual media type. Defaults to image/png for rendered CAD views. */
  mimeType?: 'image/png' | 'image/jpeg' | 'image/webp';
  /** Optional caption shown to the model (e.g. "Front view"). */
  label?: string;
}

export interface VisionRequest {
  prompt: string;
  images: VisionImage[];
  /** Force a specific provider. Default: Anthropic if key present, else OpenAI. */
  provider?: ProviderName;
  /** Force a specific vision-capable model. */
  model?: string;
  /** User-selected model. Native VL is preferred; text-only models use Luna. */
  selectedModel?: { provider: ProviderName; model: string };
  /** Wall-clock timeout in ms. Default 60s. */
  timeoutMs?: number;
  /** Max output tokens. Default 600 (vision critique is short). */
  maxTokens?: number;
  /** Cancels provider retries and any Luna fallback when the caller disconnects. */
  signal?: AbortSignal;
}

export interface VisionResponse {
  text: string;
  provider: ProviderName;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  cachedPromptTokens?: number;
  cacheWriteTokens?: number;
  cacheMissTokens?: number;
  cacheProfile?: 'openai-explicit' | 'qwen-explicit' | 'anthropic-explicit' | 'gemini-implicit' | 'provider-default';
  visionAutoRouted?: boolean;
  visionFallbackReason?: 'selected_model_transient_failure';
  latencyMs: number;
  /**
   * ★260731 — **응답이 상한에 걸려 잘렸는가.** `undefined` 는 「안 잘림」이 아니라
   * 「제공자가 말하지 않음」이다(`providers/truncation.ts` 참조).
   *
   * 이 필드가 없어서 실제로 물렸다: `imageIntentFromSketch` 24장 중 16장이 `NON_JSON`
   * 이었는데, 원인은 형식 위반이 아니라 **`maxTokens 500` 을 thinking 이 써 버린 절단**
   * 이었다. 원문을 손으로 찍어 보고서야 알았다.
   */
  truncated?: boolean;
  finishReason?: string;
}

export class VisionNotConfiguredError extends Error {
  constructor() {
    super('No vision-capable AI provider configured. Set OPENAI_API_KEY, QWEN_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, or LOCAL_VISION_BASE_URL.');
    this.name = 'VisionNotConfiguredError';
  }
}

export class VisionProviderError extends Error {
  constructor(
    public readonly provider: ProviderName,
    public readonly status: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'VisionProviderError';
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

export async function visionCompletion(req: VisionRequest): Promise<VisionResponse> {
  if (!req.images || req.images.length === 0) {
    throw new Error('visionCompletion requires at least one image');
  }
  if (req.images.length > 8) {
    throw new Error('visionCompletion: max 8 images per request (cost guard)');
  }

  const selection = await resolveVisionSelection(req);
  const provider = selection?.provider ?? null;
  if (!provider) throw new VisionNotConfiguredError();

  const t0 = Date.now();
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new VisionNotConfiguredError();
  // Vision models (esp. Gemini Flash) intermittently return "high demand /
  // try again later" (503/429/UNAVAILABLE). These are transient — retry a few
  // times with backoff before surfacing the error to the user.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await adapter({ ...req, provider, model: selection?.model });
      return { ...resp, visionAutoRouted: selection?.visionAutoRouted, latencyMs: Date.now() - t0 };
    } catch (e) {
      lastErr = e;
      if (req.signal?.aborted) throw e;
      const transient = isTransientVisionError(e);
      if (!transient) throw e;
      if (attempt === 2) break;
      await waitForVisionRetry(700 * (attempt + 1) + Math.floor(Math.random() * 400), req.signal);
    }
  }
  if (!req.provider && isTransientVisionError(lastErr) && !req.signal?.aborted) {
    const fallbacks = await configuredVisionFallbacks(provider);
    const attempted: ProviderName[] = [provider];
    for (const fallback of fallbacks) {
      if (req.signal?.aborted) throw lastErr;
      attempted.push(fallback.provider);
      const fallbackAdapter = ADAPTERS[fallback.provider];
      if (!fallbackAdapter) continue;
      try {
        const resp = await fallbackAdapter({
          ...req,
          provider: fallback.provider,
          model: fallback.model,
          selectedModel: undefined,
        });
        void reportVisionFailure({
          provider,
          model: selection?.model,
          error: lastErr,
          attempted,
          recoveredBy: { provider: resp.provider, model: resp.model },
        });
        return {
          ...resp,
          visionAutoRouted: true,
          visionFallbackReason: 'selected_model_transient_failure',
          latencyMs: Date.now() - t0,
        };
      } catch (fallbackError) {
        if (!isTransientVisionError(fallbackError)) continue;
      }
    }
    void reportVisionFailure({
      provider,
      model: selection?.model,
      error: lastErr,
      attempted,
    });
  }
  throw lastErr ?? new Error('vision failed');
}

async function configuredVisionFallbacks(
  primaryProvider: ProviderName,
): Promise<Array<{ provider: ProviderName; model?: string }>> {
  const candidates: ProviderName[] = ['openai', 'qwen', 'anthropic', 'gemini', 'local'];
  const out: Array<{ provider: ProviderName; model?: string }> = [];
  for (const candidate of candidates) {
    if (candidate === primaryProvider) continue;
    if (!(await isVisionProviderConfigured(candidate))) continue;
    const model = candidate === 'openai' ? await configuredLunaModel() ?? undefined : undefined;
    out.push({ provider: candidate, model });
  }
  return out;
}

async function reportVisionFailure(input: {
  provider: ProviderName;
  model?: string;
  error: unknown;
  attempted: ProviderName[];
  recoveredBy?: { provider: ProviderName; model: string };
}): Promise<void> {
  try {
    const { notifyAiProviderFailure } = await import('./providerFailureAlert');
    const status = input.error instanceof VisionProviderError ? input.error.status : undefined;
    await notifyAiProviderFailure({
      provider: input.provider,
      model: input.model,
      status,
      errorMessage: input.error instanceof Error ? input.error.message : String(input.error),
      task: 'vision',
      attemptedProviders: input.attempted,
      recoveredBy: input.recoveredBy,
    });
  } catch (error) {
    console.warn('[vision] provider failure alert could not be dispatched:', error);
  }
}

function isTransientVisionError(error: unknown): boolean {
  return error instanceof VisionProviderError && (
    error.status === 429 || error.status === 500 || error.status === 502 || error.status === 503 || error.status === 504 || error.status === undefined ||
    /high demand|overload|unavailable|try again|resource_exhausted|temporarily|rate.?limit/i.test(error.message)
  );
}

function waitForVisionRetry(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('Vision request aborted'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('Vision request aborted'));
    }, { once: true });
  });
}

export interface VisionSelection {
  provider: ProviderName;
  model?: string;
  visionAutoRouted: boolean;
}

/** Resolve the visual stage without making a paid provider call. */
export async function resolveVisionSelection(
  req: Pick<VisionRequest, 'provider' | 'model' | 'selectedModel'>,
): Promise<VisionSelection | null> {
  if (req.provider) return { provider: req.provider, model: req.model, visionAutoRouted: false };

  if (req.selectedModel) {
    const selected = req.selectedModel;
    if (supportsNativeVision(selected.provider, selected.model) && await isVisionProviderConfigured(selected.provider)) {
      return { provider: selected.provider, model: selected.model, visionAutoRouted: false };
    }
    const luna = await configuredLunaModel();
    if (luna) return { provider: 'openai', model: luna, visionAutoRouted: true };
  }

  const provider = await autoSelectProvider();
  if (!provider) return null;
  return {
    provider,
    model: provider === 'openai' ? await configuredLunaModel() ?? undefined : undefined,
    visionAutoRouted: false,
  };
}

async function configuredLunaModel(): Promise<string | null> {
  if (!(process.env.OPENAI_API_KEY || await getSetting('openai.api_key'))) return null;
  return (await getSetting('ai.model.gpt_luna'))?.trim() || 'gpt-5.6-luna';
}

async function isVisionProviderConfigured(provider: ProviderName): Promise<boolean> {
  if (provider === 'openai') return !!(process.env.OPENAI_API_KEY || await getSetting('openai.api_key'));
  if (provider === 'qwen') return !!(await getQwenApiKey());
  if (provider === 'anthropic') return !!(process.env.ANTHROPIC_API_KEY || await getSetting('anthropic.api_key'));
  if (provider === 'gemini') return !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || await getSetting('gemini.api_key'));
  if (provider === 'local') return !!process.env.LOCAL_VISION_BASE_URL;
  return false;
}

/**
 * Auto-select the best available vision provider.
 *
 * Automatic calls without a selected model use GPT Luna first. Calls that
 * provide `selectedModel` use that model's native VL capability first.
 * Local remains the last fallback for self-hosted / air-gapped deployments.
 *
 * Override the auto choice by passing `provider:` explicitly to
 * `visionCompletion`.
 */
async function autoSelectProvider(): Promise<ProviderName | null> {
  if (process.env.OPENAI_API_KEY || await getSetting('openai.api_key')) return 'openai';
  if (await getQwenApiKey()) return 'qwen';
  if (process.env.ANTHROPIC_API_KEY || await getSetting('anthropic.api_key')) return 'anthropic';
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || await getSetting('gemini.api_key')) return 'gemini';
  if (process.env.LOCAL_VISION_BASE_URL) return 'local';
  return null;
}

// ─── Adapters ───────────────────────────────────────────────────────────────

type Adapter = (req: VisionRequest) => Promise<Omit<VisionResponse, 'latencyMs'>>;

function requestSignal(req: VisionRequest): AbortSignal {
  const timeout = AbortSignal.timeout(req.timeoutMs ?? 60_000);
  return req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
}

const ADAPTERS: Partial<Record<ProviderName, Adapter>> = {
  anthropic: anthropicVision,
  openai: openaiVision,
  qwen: qwenVision,
  gemini: geminiVision,
  local: localVision,
};

async function qwenVision(req: VisionRequest): Promise<Omit<VisionResponse, 'latencyMs'>> {
  const key = await getQwenApiKey();
  if (!key) throw new VisionNotConfiguredError();
  const model = req.model ?? process.env.QWEN_VISION_MODEL ?? 'qwen3.7-plus';
  if (!supportsNativeVision('qwen', model)) {
    throw new VisionProviderError('qwen', 400, `${model} is not registered as a native vision model`);
  }

  const content: unknown[] = [];
  for (let i = 0; i < req.images.length; i++) {
    const img = req.images[i];
    content.push({ type: 'text', text: img.label ?? `Image ${i + 1}:` });
    content.push({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType ?? 'image/png'};base64,${bytesToBase64(img.bytes)}` },
    });
  }
  content.push({ type: 'text', text: req.prompt });

  const baseUrl = await getQwenBaseUrl();
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 600,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: 'Analyze engineering images faithfully. Distinguish observations from estimates and keep the result concise.',
        },
        { role: 'user', content },
      ],
    }),
    signal: requestSignal(req),
  });
  if (!resp.ok) {
    const err = await safeJson(resp);
    throw new VisionProviderError('qwen', resp.status, err?.error?.message ?? `HTTP ${resp.status}`);
  }
  const body = await resp.json() as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number; cache_creation_input_tokens?: number };
    };
  };
  const text = body.choices?.[0]?.message?.content?.trim() ?? '';
  return {
    text,
    ...truncationOf(body.choices?.[0]?.finish_reason),
    provider: 'qwen',
    model,
    promptTokens: body.usage?.prompt_tokens,
    completionTokens: body.usage?.completion_tokens,
    cachedPromptTokens: body.usage?.prompt_tokens_details?.cached_tokens,
    cacheWriteTokens: body.usage?.prompt_tokens_details?.cache_creation_input_tokens,
    cacheMissTokens: Math.max(0, (body.usage?.prompt_tokens ?? 0) - (body.usage?.prompt_tokens_details?.cached_tokens ?? 0)),
    cacheProfile: 'provider-default',
  };
}

async function anthropicVision(req: VisionRequest): Promise<Omit<VisionResponse, 'latencyMs'>> {
  const key = process.env.ANTHROPIC_API_KEY || await getSetting('anthropic.api_key');
  if (!key) throw new VisionNotConfiguredError();
  const model = req.model ?? 'claude-sonnet-4-6';
  const content: unknown[] = req.images.map((img, i) => ([
    img.label
      ? { type: 'text', text: img.label }
      : { type: 'text', text: `Image ${i + 1}:` },
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mimeType ?? 'image/png',
        data: bytesToBase64(img.bytes),
      },
    },
  ])).flat();
  content.push({ type: 'text', text: req.prompt });

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 600,
      system: [{
        type: 'text',
        text: 'Analyze engineering images faithfully. Distinguish observations from estimates and keep the result concise.',
        cache_control: { type: 'ephemeral' },
      }],
      messages: [{ role: 'user', content }],
    }),
    signal: requestSignal(req),
  });
  if (!resp.ok) {
    const err = await safeJson(resp);
    throw new VisionProviderError('anthropic', resp.status, err?.error?.message ?? `HTTP ${resp.status}`);
  }
  const body = await resp.json() as {
    content: { type: string; text?: string }[];
    stop_reason?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  const text = (body.content ?? [])
    .filter(c => c.type === 'text' && typeof c.text === 'string')
    .map(c => c.text!)
    .join('\n')
    .trim();
  return {
    text,
    ...truncationOf(body.stop_reason),
    provider: 'anthropic',
    model,
    promptTokens: (body.usage?.input_tokens ?? 0)
      + (body.usage?.cache_creation_input_tokens ?? 0)
      + (body.usage?.cache_read_input_tokens ?? 0),
    completionTokens: body.usage?.output_tokens,
    cachedPromptTokens: body.usage?.cache_read_input_tokens,
    cacheWriteTokens: body.usage?.cache_creation_input_tokens,
    cacheMissTokens: body.usage?.input_tokens,
    cacheProfile: 'anthropic-explicit',
  };
}

async function openaiVision(req: VisionRequest): Promise<Omit<VisionResponse, 'latencyMs'>> {
  const key = process.env.OPENAI_API_KEY || await getSetting('openai.api_key');
  if (!key) throw new VisionNotConfiguredError();
  const model = req.model ?? (await getSetting('ai.model.gpt_luna')) ?? 'gpt-5.6-luna';
  const content: unknown[] = [];
  for (let i = 0; i < req.images.length; i++) {
    const img = req.images[i];
    content.push({ type: 'text', text: img.label ?? `Image ${i + 1}:` });
    content.push({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType ?? 'image/png'};base64,${bytesToBase64(img.bytes)}` },
    });
  }
  content.push({ type: 'text', text: req.prompt });

  const openAiBase = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const resp = await fetch(`${openAiBase}/chat/completions`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_completion_tokens: req.maxTokens ?? 600,
      messages: [
        { role: 'system', content: 'Analyze engineering images faithfully. Distinguish observations from estimates and keep the result concise.' },
        { role: 'user', content },
      ],
    }),
    signal: requestSignal(req),
  });
  if (!resp.ok) {
    const err = await safeJson(resp);
    throw new VisionProviderError('openai', resp.status, err?.error?.message ?? `HTTP ${resp.status}`);
  }
  const body = await resp.json() as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
      cache_write_tokens?: number;
    };
  };
  const text = body.choices?.[0]?.message?.content?.trim() ?? '';
  return {
    text,
    ...truncationOf(body.choices?.[0]?.finish_reason),
    provider: 'openai',
    model,
    promptTokens: body.usage?.prompt_tokens,
    completionTokens: body.usage?.completion_tokens,
    cachedPromptTokens: body.usage?.prompt_tokens_details?.cached_tokens,
    cacheWriteTokens: body.usage?.prompt_tokens_details?.cache_write_tokens ?? body.usage?.cache_write_tokens,
    cacheMissTokens: Math.max(0, (body.usage?.prompt_tokens ?? 0) - (body.usage?.prompt_tokens_details?.cached_tokens ?? 0)),
    cacheProfile: 'provider-default',
  };
}

async function geminiVision(req: VisionRequest): Promise<Omit<VisionResponse, 'latencyMs'>> {
  const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? await getSetting('gemini.api_key');
  if (!key) throw new VisionNotConfiguredError();
  // gemini-2.5-flash is fast + cheap with solid multimodal grounding. (The
  // older gemini-2.0-flash now 404s "no longer available" on newer projects.)
  // Override per-call via req.model or globally via GEMINI_VISION_MODEL.
  const model = req.model ?? process.env.GEMINI_VISION_MODEL ?? 'gemini-2.5-flash';

  // Gemini wants `parts` with mixed text + inline_data entries.
  const parts: unknown[] = [];
  for (let i = 0; i < req.images.length; i++) {
    const img = req.images[i];
    parts.push({ text: img.label ?? `Image ${i + 1}:` });
    parts.push({
      inline_data: {
        mime_type: img.mimeType ?? 'image/png',
        data: bytesToBase64(img.bytes),
      },
    });
  }
  parts.push({ text: req.prompt });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        maxOutputTokens: req.maxTokens ?? 600,
        temperature: 0.4,
      },
    }),
    signal: requestSignal(req),
  });
  if (!resp.ok) {
    const err = await safeJson(resp);
    throw new VisionProviderError('gemini', resp.status, err?.error?.message ?? `HTTP ${resp.status}`);
  }
  const body = await resp.json() as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      cachedContentTokenCount?: number;
    };
  };
  const text = (body.candidates?.[0]?.content?.parts ?? [])
    .map(p => typeof p.text === 'string' ? p.text : '')
    .join('')
    .trim();
  return {
    text,
    ...truncationOf(body.candidates?.[0]?.finishReason),
    provider: 'gemini',
    model,
    promptTokens: body.usageMetadata?.promptTokenCount,
    completionTokens: body.usageMetadata?.candidatesTokenCount,
    cachedPromptTokens: body.usageMetadata?.cachedContentTokenCount,
    cacheMissTokens: Math.max(0, (body.usageMetadata?.promptTokenCount ?? 0) - (body.usageMetadata?.cachedContentTokenCount ?? 0)),
    cacheProfile: 'gemini-implicit',
  };
}

/**
 * Local / self-hosted vision via an OpenAI-compatible chat endpoint.
 * Works with Ollama (`ollama serve` exposes `/v1/chat/completions`),
 * vLLM, llama.cpp's server, LocalAI, LM Studio — anything that speaks
 * the OpenAI JSON dialect with vision messages.
 *
 * Configure with:
 *   LOCAL_VISION_BASE_URL=http://localhost:11434/v1
 *   LOCAL_VISION_MODEL=llava   (or llama3.2-vision, qwen2-vl, etc.)
 *   LOCAL_VISION_API_KEY=optional
 */
async function localVision(req: VisionRequest): Promise<Omit<VisionResponse, 'latencyMs'>> {
  const baseUrl = process.env.LOCAL_VISION_BASE_URL?.trim();
  if (!baseUrl) throw new VisionNotConfiguredError();
  const model = req.model ?? process.env.LOCAL_VISION_MODEL ?? 'llava';
  const apiKey = process.env.LOCAL_VISION_API_KEY ?? 'not-needed';

  const content: unknown[] = [];
  for (let i = 0; i < req.images.length; i++) {
    const img = req.images[i];
    content.push({ type: 'text', text: img.label ?? `Image ${i + 1}:` });
    content.push({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType ?? 'image/png'};base64,${bytesToBase64(img.bytes)}` },
    });
  }
  content.push({ type: 'text', text: req.prompt });

  const endpoint = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 600,
      temperature: 0.3,
      messages: [{ role: 'user', content }],
    }),
    signal: requestSignal({ ...req, timeoutMs: req.timeoutMs ?? 90_000 }),
  });
  if (!resp.ok) {
    const err = await safeJson(resp);
    throw new VisionProviderError('local', resp.status, err?.error?.message ?? `HTTP ${resp.status}`);
  }
  const body = await resp.json() as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = body.choices?.[0]?.message?.content?.trim() ?? '';
  return {
    text,
    ...truncationOf(body.choices?.[0]?.finish_reason),
    provider: 'local',
    model,
    promptTokens: body.usage?.prompt_tokens,
    completionTokens: body.usage?.completion_tokens,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function bytesToBase64(bytes: Uint8Array): string {
  // Node Buffer fast path (server-side)
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  // Browser fallback (we don't expect to call this in browsers, but be safe)
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function safeJson(resp: Response): Promise<{ error?: { message?: string } } | null> {
  try {
    return await resp.json() as { error?: { message?: string } };
  } catch {
    return null;
  }
}

export function isVisionAvailable(): boolean {
  return !!(
    getSettingSync('openai.api_key') ||
    process.env.OPENAI_API_KEY ||
    getSettingSync('qwen.api_key') ||
    process.env.DASHSCOPE_API_KEY ||
    process.env.QWEN_API_KEY ||
    getSettingSync('anthropic.api_key') ||
    process.env.ANTHROPIC_API_KEY ||
    getSettingSync('gemini.api_key') ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.LOCAL_VISION_BASE_URL
  );
}
