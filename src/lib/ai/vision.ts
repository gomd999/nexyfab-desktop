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

export interface VisionImage {
  /** Raw image bytes (PNG only — JPEG converted by caller if needed). */
  bytes: Uint8Array;
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
  /** Wall-clock timeout in ms. Default 60s. */
  timeoutMs?: number;
  /** Max output tokens. Default 600 (vision critique is short). */
  maxTokens?: number;
}

export interface VisionResponse {
  text: string;
  provider: ProviderName;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs: number;
}

export class VisionNotConfiguredError extends Error {
  constructor() {
    super('No vision-capable AI provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.');
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

  const provider = req.provider ?? autoSelectProvider();
  if (!provider) throw new VisionNotConfiguredError();

  const t0 = Date.now();
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new VisionNotConfiguredError();
  const resp = await adapter(req);
  return { ...resp, latencyMs: Date.now() - t0 };
}

/**
 * Auto-select the best available vision provider.
 *
 * Priority is shaped by quality + cost: Anthropic > Gemini > OpenAI > Local.
 * Anthropic Claude vision is currently the highest-quality CAD reviewer in
 * our internal eval (handles assembly proportions well). Gemini 2.0 Flash
 * is ~10× cheaper and good enough for most checks. OpenAI gpt-4o is solid
 * but pricier than Gemini. Local is the free fallback for self-hosted /
 * air-gapped deployments.
 *
 * Override the auto choice by passing `provider:` explicitly to
 * `visionCompletion`.
 */
function autoSelectProvider(): ProviderName | null {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return 'gemini';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.LOCAL_VISION_BASE_URL) return 'local';
  return null;
}

// ─── Adapters ───────────────────────────────────────────────────────────────

type Adapter = (req: VisionRequest) => Promise<Omit<VisionResponse, 'latencyMs'>>;

const ADAPTERS: Partial<Record<ProviderName, Adapter>> = {
  anthropic: anthropicVision,
  openai: openaiVision,
  gemini: geminiVision,
  local: localVision,
};

async function anthropicVision(req: VisionRequest): Promise<Omit<VisionResponse, 'latencyMs'>> {
  const key = process.env.ANTHROPIC_API_KEY;
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
        media_type: 'image/png',
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
      messages: [{ role: 'user', content }],
    }),
    signal: AbortSignal.timeout(req.timeoutMs ?? 60_000),
  });
  if (!resp.ok) {
    const err = await safeJson(resp);
    throw new VisionProviderError('anthropic', resp.status, err?.error?.message ?? `HTTP ${resp.status}`);
  }
  const body = await resp.json() as {
    content: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = (body.content ?? [])
    .filter(c => c.type === 'text' && typeof c.text === 'string')
    .map(c => c.text!)
    .join('\n')
    .trim();
  return {
    text,
    provider: 'anthropic',
    model,
    promptTokens: body.usage?.input_tokens,
    completionTokens: body.usage?.output_tokens,
  };
}

async function openaiVision(req: VisionRequest): Promise<Omit<VisionResponse, 'latencyMs'>> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new VisionNotConfiguredError();
  const model = req.model ?? 'gpt-4o';
  const content: unknown[] = [];
  for (let i = 0; i < req.images.length; i++) {
    const img = req.images[i];
    content.push({ type: 'text', text: img.label ?? `Image ${i + 1}:` });
    content.push({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${bytesToBase64(img.bytes)}` },
    });
  }
  content.push({ type: 'text', text: req.prompt });

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 600,
      messages: [{ role: 'user', content }],
    }),
    signal: AbortSignal.timeout(req.timeoutMs ?? 60_000),
  });
  if (!resp.ok) {
    const err = await safeJson(resp);
    throw new VisionProviderError('openai', resp.status, err?.error?.message ?? `HTTP ${resp.status}`);
  }
  const body = await resp.json() as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = body.choices?.[0]?.message?.content?.trim() ?? '';
  return {
    text,
    provider: 'openai',
    model,
    promptTokens: body.usage?.prompt_tokens,
    completionTokens: body.usage?.completion_tokens,
  };
}

async function geminiVision(req: VisionRequest): Promise<Omit<VisionResponse, 'latencyMs'>> {
  const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!key) throw new VisionNotConfiguredError();
  // gemini-2.0-flash is fast + cheap and has solid multimodal grounding;
  // gemini-1.5-flash works as fallback. Pro variants overkill for CAD review.
  const model = req.model ?? 'gemini-2.0-flash';

  // Gemini wants `parts` with mixed text + inline_data entries.
  const parts: unknown[] = [];
  for (let i = 0; i < req.images.length; i++) {
    const img = req.images[i];
    parts.push({ text: img.label ?? `Image ${i + 1}:` });
    parts.push({
      inline_data: {
        mime_type: 'image/png',
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
    signal: AbortSignal.timeout(req.timeoutMs ?? 60_000),
  });
  if (!resp.ok) {
    const err = await safeJson(resp);
    throw new VisionProviderError('gemini', resp.status, err?.error?.message ?? `HTTP ${resp.status}`);
  }
  const body = await resp.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const text = (body.candidates?.[0]?.content?.parts ?? [])
    .map(p => typeof p.text === 'string' ? p.text : '')
    .join('')
    .trim();
  return {
    text,
    provider: 'gemini',
    model,
    promptTokens: body.usageMetadata?.promptTokenCount,
    completionTokens: body.usageMetadata?.candidatesTokenCount,
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
      image_url: { url: `data:image/png;base64,${bytesToBase64(img.bytes)}` },
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
    signal: AbortSignal.timeout(req.timeoutMs ?? 90_000),
  });
  if (!resp.ok) {
    const err = await safeJson(resp);
    throw new VisionProviderError('local', resp.status, err?.error?.message ?? `HTTP ${resp.status}`);
  }
  const body = await resp.json() as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = body.choices?.[0]?.message?.content?.trim() ?? '';
  return {
    text,
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
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.LOCAL_VISION_BASE_URL
  );
}
