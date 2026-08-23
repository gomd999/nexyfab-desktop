/**
 * Image → CAD intent extractor (Pro+ Pixar-of-CAD differentiator).
 *
 * Given a photo / sketch / screenshot of a mechanical part, ask a vision-
 * capable LLM to emit a strict JSON intent (shapeId + params + features +
 * summary). Then validate against the SUPPORTED_SHAPES / SUPPORTED_FEATURES
 * whitelists and pipe through `intentToScad` so the caller gets a SCAD
 * source they can immediately render.
 *
 * Used by:
 *   - POST /api/nexyfab/intent-from-image (route)
 *   - scad-agent's `intent_from_image` tool
 *
 * Centralized so the tool path doesn't re-implement validation + cache
 * keying; both paths share the same prompt/version/whitelist contract.
 */
import { createHash } from 'node:crypto';
import { truncationNote } from './providers/truncation';
import { visionCompletion, isVisionAvailable, VisionNotConfiguredError, VisionProviderError } from './vision';
import { getPrompt } from './prompts';
import {
  intentToScad,
  type IntentInput,
  type IntentFeature,
} from '../openscad-render/intentToScad';
import { getCachedIntent, setCachedIntent } from './intentCache';
import type { ProviderName } from './types';

/** Whitelists are duplicated from prompts/imageIntentFromSketch.v1.ts. Keep
 *  in lock-step with intentToScad's SUPPORTED_SHAPES / SUPPORTED_FEATURES. */
const SUPPORTED_SHAPES = new Set([
  'box', 'cylinder', 'sphere', 'cone', 'torus', 'wedge', 'pipe', 'disk',
  'hexNut', 'washer', 'iBeam', 'lBracket', 'flange', 'bolt',
  'gear', 'threadedRod', 'roundedBox', 'screw', 'springCoil',
  'sweep', 'loft', 'fanBlade',
  'heatsink', 'manifold', 'turbine',
  'enclosure', 'tBeam', 'uChannel', 'zPurlin',
  'rackUnit', 'shelfBracket', 'hingedBracket', 'motorMount',
  'nameplate', 'phoneStand', 'coaster', 'wallHook', 'drawerKnob', 'planterPot',
]);
const SUPPORTED_FEATURES = new Set([
  'hole', 'fillet', 'chamfer', 'mirror', 'linearPattern', 'circularPattern',
  'scale', 'shell', 'thread', 'draft', 'twist', 'rotate',
]);

export const IMAGE_INTENT_PROMPT_ID = 'imageIntentFromSketch.v1';

/** Maximum decoded image size in bytes (5 MB). Larger payloads are rejected
 *  before we burn vision-API budget on them. */
export const IMAGE_INTENT_MAX_BYTES = 5 * 1024 * 1024;

export interface ImageIntentInput {
  /** Raw image bytes (already decoded from base64). */
  imageBytes: Uint8Array;
  /** Default 'image/png'. */
  mimeType?: 'image/png' | 'image/jpeg' | 'image/webp';
  /** Optional NL hint the user pairs with the image. */
  hintText?: string;
  /** Entitlement-checked runtime model selected by the caller. */
  selectedModel?: { provider: ProviderName; model: string };
  signal?: AbortSignal;
  /** Caller already performed the cache probe (used by quota-reserving routes). */
  skipCacheRead?: boolean;
}

export type ImageIntentOutcome =
  | {
      ok: true;
      intent: IntentInput;
      scad: string;
      warnings: string[];
      summary?: string;
      /**
       * ★260731 — **치수가 읽힌 값인가 추정된 값인가.**
       *
       * 실측(합성 픽토리얼 48장): 치수 표기가 **없는** 그림에서 비율 정확도는 **55%** 다.
       * 즉 표기 없는 이미지의 치수는 「대략」이지 「측정」이 아니다. 그런데 그 사실이
       * `summary` 산문에만 있어서 **하류 코드는 구별할 수 없었다** — 추정치가 그대로
       * 3D·견적으로 흘러간다.
       * ⚠ 프롬프트 개선으로 비율을 고치려 했으나(등각 단축 힌트) **비율은 거의 그대로**였다.
       *   못 고치는 것은 고친 척하지 말고 **표시**한다.
       */
      dimensionSource?: 'callouts' | 'inferred' | 'mixed';
      cached: boolean;
      cacheKey: string;
      /** Provider metadata for telemetry — undefined on cache hits. */
      provider?: string;
      model?: string;
      latencyMs?: number;
      promptTokens?: number;
      completionTokens?: number;
      cachedPromptTokens?: number;
      cacheWriteTokens?: number;
      cacheMissTokens?: number;
      cacheProfile?: 'openai-explicit' | 'qwen-explicit' | 'anthropic-explicit' | 'gemini-explicit' | 'gemini-implicit' | 'provider-default';
    }
  | {
      ok: false;
      code:
        | 'IMAGE_REQUIRED'
        | 'IMAGE_TOO_LARGE'
        | 'NO_VISION'
        | 'AI_REQUEST_FAILED'
        | 'NON_JSON'
        | 'INVALID_JSON_SHAPE'
        | 'UNSUPPORTED'
        | 'BAD_SHAPE_ID'
        | 'CONVERTER_REJECT';
      message: string;
      /** Trimmed raw model output, only when relevant. */
      raw?: string;
      /** Reason from the converter — only set when code = CONVERTER_REJECT. */
      reason?: string;
      /** Vision provider that surfaced the error, when applicable. */
      provider?: string;
    };

type CachedImageIntentOutcome = Extract<ImageIntentOutcome, { ok: true }>;

/**
 * Stable cache key — sha256 of (image bytes + hintText + promptVersion).
 *
 * Same image + same hint + same prompt version → cache hit, same SCAD,
 * no AI round-trip. Hint matters because "the bracket is 50mm wide"
 * vs no hint gives very different scales.
 */
export function buildImageIntentCacheKey(input: ImageIntentInput, promptVersion: string): string {
  const h = createHash('sha256');
  h.update(input.imageBytes);
  h.update('\x00');
  h.update(input.hintText ?? '');
  h.update('\x00');
  h.update(input.mimeType ?? 'image/png');
  h.update('\x00');
  h.update(input.selectedModel ? `${input.selectedModel.provider}:${input.selectedModel.model}` : 'auto');
  h.update('\x00');
  h.update(promptVersion);
  // Prefix so the cache key never collides with the NL→intent path.
  return `imgintent:${h.digest('hex')}`;
}

/** Read-only cache probe so callers can reserve quota before a paid VL call. */
export async function readCachedImageIntent(input: ImageIntentInput): Promise<CachedImageIntentOutcome | null> {
  if (!input.imageBytes || input.imageBytes.length === 0 || input.imageBytes.length > IMAGE_INTENT_MAX_BYTES) {
    return null;
  }
  const promptDef = getPrompt(IMAGE_INTENT_PROMPT_ID);
  const cacheKey = buildImageIntentCacheKey(input, promptDef.version);
  const cached = await getCachedIntent(cacheKey);
  if (!cached) return null;
  return {
    ok: true,
    intent: cached.intent as IntentInput,
    scad: cached.scad,
    warnings: cached.warnings,
    summary: cached.summary,
    dimensionSource: cached.dimensionSource,
    cached: true,
    cacheKey,
  };
}

/**
 * Strip markdown fences and isolate the first {...} block.
 * Mirrors scad-intent-from-nl's parser — vision models are even more prone
 * to wrapping JSON in commentary, so this matters.
 */
function extractJsonObject(raw: string): { ok: true; parsed: Record<string, unknown> } | { ok: false } {
  try {
    let s = raw.replace(/```json?\s*/gi, '').replace(/```/g, '');
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first !== -1 && last > first) s = s.slice(first, last + 1);
    const parsed = JSON.parse(s.trim()) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false };
    }
    return { ok: true, parsed: parsed as Record<string, unknown> };
  } catch {
    return { ok: false };
  }
}

/**
 * Main extractor. Both the route and the agent tool call this.
 *
 * Does NOT enforce plan / budget / rate-limit gates — those are caller
 * concerns (route gates them per-user; agent tool inherits the user's
 * agent-loop session budget). It DOES handle caching and validation so
 * the contract is uniform across callers.
 */
export async function extractIntentFromImage(input: ImageIntentInput): Promise<ImageIntentOutcome> {
  if (!input.imageBytes || input.imageBytes.length === 0) {
    return { ok: false, code: 'IMAGE_REQUIRED', message: 'image bytes are required' };
  }
  if (input.imageBytes.length > IMAGE_INTENT_MAX_BYTES) {
    return {
      ok: false,
      code: 'IMAGE_TOO_LARGE',
      message: `image exceeds ${IMAGE_INTENT_MAX_BYTES} bytes (got ${input.imageBytes.length})`,
    };
  }
  if (!input.skipCacheRead) {
    const cached = await readCachedImageIntent(input);
    if (cached) return cached;
  }
  if (!isVisionAvailable()) {
    return {
      ok: false,
      code: 'NO_VISION',
      message: 'No vision-capable AI provider configured. Set ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, or LOCAL_VISION_BASE_URL.',
    };
  }

  const promptDef = getPrompt(IMAGE_INTENT_PROMPT_ID);
  const cacheKey = buildImageIntentCacheKey(input, promptDef.version);

  // The user-side message is "extract intent". When a hint is provided we
  // prepend it so the model can use it as scale context.
  const userPrompt = input.hintText && input.hintText.trim()
    ? `User-supplied hint:\n${input.hintText.trim().slice(0, 2000)}\n\nExtract the intent JSON now.`
    : 'Extract the intent JSON now.';

  let raw: string;
  let provider: string;
  let model: string;
  let latencyMs: number;
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  let cachedPromptTokens: number | undefined;
  let cacheWriteTokens: number | undefined;
  let cacheMissTokens: number | undefined;
  let cacheProfile: 'openai-explicit' | 'qwen-explicit' | 'anthropic-explicit' | 'gemini-explicit' | 'gemini-implicit' | 'provider-default' | undefined;
  /**
   * ★260731 — **절단을 형식 오류와 구별한다.**
   *   실측: 합성 스케치 24장 중 16장이 `NON_JSON` 이었는데, 원인은 모델이 형식을 어긴 게
   *   아니라 `maxTokens 500` 을 thinking 이 써 버린 **절단**이었다. 원문을 손으로 찍어
   *   보고서야 알았다 — 그 한 단계를 없앤다. 대응이 정반대이기 때문이다:
   *   형식 위반이면 프롬프트를, **절단이면 상한을** 손봐야 한다.
   */
  let truncated: boolean | undefined;
  let finishReason: string | undefined;
  try {
    const resp = await visionCompletion({
      prompt: `${promptDef.template}\n\n---\n${userPrompt}`,
      images: [{ bytes: input.imageBytes, mimeType: input.mimeType, label: 'Part image' }],
      selectedModel: input.selectedModel,
      signal: input.signal,
      maxTokens: promptDef.defaults.maxTokens ?? 500,
      timeoutMs: promptDef.defaults.timeoutMs ?? 30_000,
    });
    raw = resp.text;
    provider = resp.provider;
    model = resp.model;
    latencyMs = resp.latencyMs;
    promptTokens = resp.promptTokens;
    completionTokens = resp.completionTokens;
    cachedPromptTokens = resp.cachedPromptTokens;
    cacheWriteTokens = resp.cacheWriteTokens;
    cacheMissTokens = resp.cacheMissTokens;
    cacheProfile = resp.cacheProfile;
    truncated = resp.truncated;
    finishReason = resp.finishReason;
  } catch (e) {
    if (e instanceof VisionNotConfiguredError) {
      return {
        ok: false,
        code: 'NO_VISION',
        message: e.message,
      };
    }
    const providerName = e instanceof VisionProviderError ? e.provider : 'unknown';
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      code: 'AI_REQUEST_FAILED',
      message: `Vision provider failed: ${msg}`,
      provider: providerName,
    };
  }

  const parsedOut = extractJsonObject(raw);
  if (!parsedOut.ok) {
    const cap = promptDef.defaults.maxTokens ?? 500;
    const note = truncationNote({ truncated, finishReason }, cap);
    return {
      ok: false,
      // ⚠ 같은 `NON_JSON` 이라도 **원인이 다르면 다른 말을 해야 한다.**
      code: 'NON_JSON',
      message: note
        ? `vision output truncated — ${note}`
        : `vision model returned non-JSON output${finishReason ? ` (finishReason: ${finishReason})` : ''}`,
      raw: raw.slice(0, 400),
      provider,
    };
  }
  const parsed = parsedOut.parsed;

  if (parsed.error === 'unsupported') {
    return {
      ok: false,
      code: 'UNSUPPORTED',
      message: typeof parsed.reason === 'string'
        ? parsed.reason
        : 'vision model could not identify a supported shape',
      provider,
    };
  }

  if (typeof parsed.shapeId !== 'string' || !SUPPORTED_SHAPES.has(parsed.shapeId)) {
    return {
      ok: false,
      code: 'BAD_SHAPE_ID',
      message: `vision model picked an unsupported shapeId: ${String(parsed.shapeId)}`,
      raw: raw.slice(0, 400),
      provider,
    };
  }

  // params + features — narrow to expected shapes; reject obviously bad values.
  let params: Record<string, number> = {};
  if (parsed.params && typeof parsed.params === 'object' && !Array.isArray(parsed.params)) {
    const cleanedParams: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed.params as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) cleanedParams[k] = v;
    }
    params = cleanedParams;
  }
  let features: IntentFeature[] = [];
  if (Array.isArray(parsed.features)) {
    features = (parsed.features as unknown[]).filter((f): f is IntentFeature => {
      if (!f || typeof f !== 'object' || Array.isArray(f)) return false;
      const t = (f as Record<string, unknown>).type;
      return typeof t === 'string' && SUPPORTED_FEATURES.has(t);
    });
  }

  const intent: IntentInput = {
    shapeId: parsed.shapeId,
    params,
    features,
    facets: typeof parsed.facets === 'number' ? parsed.facets : undefined,
  };

  const conv = intentToScad(intent);
  if (!conv.ok) {
    return {
      ok: false,
      code: 'CONVERTER_REJECT',
      message: conv.reason,
      reason: conv.reason,
      provider,
    };
  }

  const summary = typeof parsed.summary === 'string' ? parsed.summary.slice(0, 240) : undefined;
  /**
   * ⚠ 모델이 말하지 않았으면 **`undefined` 로 둔다** — `'callouts'`(=읽었다) 로 채우면
   *   추정치가 측정치로 승격된다. 모르는 것을 안전한 쪽으로도 위험한 쪽으로도 지어내지 않는다.
   */
  const ds = parsed.dimensionSource;
  const dimensionSource = ds === 'callouts' || ds === 'inferred' || ds === 'mixed' ? ds : undefined;

  // Fire-and-forget cache write. A failure here must not break the response.
  setCachedIntent(cacheKey, {
    intent,
    scad: conv.scad,
    warnings: conv.warnings,
    summary,
    dimensionSource,
  }).catch(e => console.warn('[image-intent] cache write failed:', e));

  return {
    ok: true,
    intent,
    scad: conv.scad,
    warnings: conv.warnings,
    summary,
    dimensionSource,
    cached: false,
    cacheKey,
    provider,
    model,
    latencyMs,
    promptTokens,
    completionTokens,
    cachedPromptTokens,
    cacheWriteTokens,
    cacheMissTokens,
    cacheProfile,
  };
}

/** Decode a data URL or bare base64 into Uint8Array. Returns null on parse failure. */
export function decodeImageBase64(input: string): { bytes: Uint8Array; mimeType?: 'image/png' | 'image/jpeg' | 'image/webp' } | null {
  if (typeof input !== 'string' || input.length === 0) return null;
  let payload = input;
  let mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | undefined;
  // data:image/png;base64,XXXX
  const m = /^data:(image\/(?:png|jpeg|webp));base64,(.*)$/.exec(input);
  if (m) {
    mimeType = m[1] as 'image/png' | 'image/jpeg' | 'image/webp';
    payload = m[2];
  }
  try {
    const bytes = Buffer.from(payload, 'base64');
    if (bytes.length === 0) return null;
    return { bytes: new Uint8Array(bytes), mimeType };
  } catch {
    return null;
  }
}
