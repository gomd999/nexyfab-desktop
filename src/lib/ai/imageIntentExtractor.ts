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
import { visionCompletion, isVisionAvailable, VisionNotConfiguredError, VisionProviderError } from './vision';
import { getPrompt } from './prompts';
import {
  intentToScad,
  type IntentInput,
  type IntentFeature,
} from '../openscad-render/intentToScad';
import { getCachedIntent, setCachedIntent } from './intentCache';

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
}

export type ImageIntentOutcome =
  | {
      ok: true;
      intent: IntentInput;
      scad: string;
      warnings: string[];
      summary?: string;
      cached: boolean;
      cacheKey: string;
      /** Provider metadata for telemetry — undefined on cache hits. */
      provider?: string;
      model?: string;
      latencyMs?: number;
      promptTokens?: number;
      completionTokens?: number;
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
  h.update(promptVersion);
  // Prefix so the cache key never collides with the NL→intent path.
  return `imgintent:${h.digest('hex')}`;
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
  if (!isVisionAvailable()) {
    return {
      ok: false,
      code: 'NO_VISION',
      message: 'No vision-capable AI provider configured. Set ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, or LOCAL_VISION_BASE_URL.',
    };
  }

  const promptDef = getPrompt(IMAGE_INTENT_PROMPT_ID);
  const cacheKey = buildImageIntentCacheKey(input, promptDef.version);

  // Cache lookup — same image+hint+promptVersion → same intent, no AI call.
  const cached = await getCachedIntent(cacheKey);
  if (cached) {
    return {
      ok: true,
      intent: cached.intent as IntentInput,
      scad: cached.scad,
      warnings: cached.warnings,
      summary: cached.summary,
      cached: true,
      cacheKey,
    };
  }

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
  try {
    const resp = await visionCompletion({
      prompt: `${promptDef.template}\n\n---\n${userPrompt}`,
      images: [{ bytes: input.imageBytes, label: 'Part image' }],
      maxTokens: promptDef.defaults.maxTokens ?? 500,
      timeoutMs: promptDef.defaults.timeoutMs ?? 30_000,
    });
    raw = resp.text;
    provider = resp.provider;
    model = resp.model;
    latencyMs = resp.latencyMs;
    promptTokens = resp.promptTokens;
    completionTokens = resp.completionTokens;
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
    return {
      ok: false,
      code: 'NON_JSON',
      message: 'vision model returned non-JSON output',
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

  // Fire-and-forget cache write. A failure here must not break the response.
  setCachedIntent(cacheKey, {
    intent,
    scad: conv.scad,
    warnings: conv.warnings,
    summary,
  }).catch(e => console.warn('[image-intent] cache write failed:', e));

  return {
    ok: true,
    intent,
    scad: conv.scad,
    warnings: conv.warnings,
    summary,
    cached: false,
    cacheKey,
    provider,
    model,
    latencyMs,
    promptTokens,
    completionTokens,
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
