/**
 * visionSketchProvider — bind the (pure) vision sketch detector to the REAL
 * Anthropic image-content vision call (A3 of the image→sketch track, ADR-013).
 *
 * `visionSketchDetector` deliberately takes its model call as an injected
 * `VisionComplete` so it stays pure + unit-testable. `vision.ts` already speaks
 * the provider protocol (Anthropic base64 image blocks, OpenAI data-URI, Gemini
 * inline_data). This module is the thin seam between them: it adapts
 * (image bytes, prompt) → a one-image VisionRequest, runs it through
 * `visionCompletion`, and returns the model's raw text — exactly the
 * `VisionComplete` shape. The result plugs straight into
 * `inferSketchFromImage({ realDetector })`.
 *
 * The vision call is injectable (`opts.complete`) so this seam is testable
 * without a network round-trip; it defaults to the real `visionCompletion`.
 */

import { visionCompletion, type VisionRequest, type VisionResponse } from './vision';
import {
  createVisionSketchDetector,
  type VisionComplete,
} from './visionSketchDetector';
import type { SketchEntities } from '../sketch/sketchSvgExport';

export interface VisionSketchProviderOptions {
  /** Force a provider (default: Anthropic if ANTHROPIC_API_KEY present). */
  provider?: VisionRequest['provider'];
  /** Force a vision-capable model. */
  model?: string;
  /** Max output tokens. Sketch JSON is longer than a critique → default 1500. */
  maxTokens?: number;
  /** Wall-clock timeout (ms). */
  timeoutMs?: number;
  /** Test seam — override the vision call. Defaults to the real visionCompletion. */
  complete?: (req: VisionRequest) => Promise<VisionResponse>;
}

/**
 * A `VisionComplete` backed by the real provider vision API: sends the image as
 * a single labelled image block alongside the prompt and returns the reply text.
 */
export function anthropicVisionComplete(opts: VisionSketchProviderOptions = {}): VisionComplete {
  const complete = opts.complete ?? visionCompletion;
  return async (image: Uint8Array, prompt: string): Promise<string> => {
    const resp = await complete({
      prompt,
      images: [{ bytes: image, label: 'sketch' }],
      provider: opts.provider,
      model: opts.model,
      maxTokens: opts.maxTokens ?? 1500,
      timeoutMs: opts.timeoutMs,
    });
    return resp.text;
  };
}

/**
 * The real image→sketch detector: a `realDetector` for inferSketchFromImage,
 * backed by the provider vision API. Throws (via visionCompletion) when no
 * provider key is configured — callers fall back to the grid detector.
 */
export function createRealVisionSketchDetector(
  opts: VisionSketchProviderOptions = {},
): (image: Uint8Array) => Promise<SketchEntities> {
  return createVisionSketchDetector(anthropicVisionComplete(opts));
}
