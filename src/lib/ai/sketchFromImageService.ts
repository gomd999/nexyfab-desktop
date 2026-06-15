/**
 * sketchFromImageService — the testable core behind POST /api/nexyfab/
 * sketch-from-image (image→sketch endpoint, A3 consumer).
 *
 * Decodes + size-validates an uploaded image, runs it through
 * inferSketchFromImage with the real provider-backed detector
 * (createRealVisionSketchDetector), and returns structured SketchEntities. The
 * detector is injectable so this layer is unit-tested without a vision API
 * round-trip; the thin route handler adds auth / rate-limit / budget and maps
 * the result to NextResponse.
 */

import { decodeImageBase64, IMAGE_INTENT_MAX_BYTES } from './imageIntentExtractor';
import { inferSketchFromImage } from './sketchInferenceFromImage';
import { createRealVisionSketchDetector } from './visionSketchProvider';
import type { SketchEntities } from '../sketch/sketchSvgExport';

export type SketchFromImageCode =
  | 'IMAGE_REQUIRED'
  | 'IMAGE_DECODE_FAILED'
  | 'IMAGE_TOO_LARGE'
  | 'INFER_FAILED';

export interface SketchFromImageInput {
  /** Data URL or raw base64. */
  imageBase64: string;
  /** Override the detector (tests). Defaults to the real provider-backed one. */
  detector?: (image: Uint8Array) => Promise<SketchEntities>;
  /** Max decoded image size in bytes (default 5 MB, matching intent-from-image). */
  maxBytes?: number;
}

export interface SketchFromImageResult {
  ok: boolean;
  entities?: SketchEntities;
  warnings: string[];
  error?: string;
  code?: SketchFromImageCode;
  /** Decoded image size in bytes (when decode succeeded). */
  imageBytes?: number;
}

/**
 * Decode → validate → infer. Pure orchestration; the detector and size limit are
 * injectable. Never throws — a detector failure is surfaced as ok:false /
 * INFER_FAILED (inferSketchFromImage already traps detector exceptions).
 */
export async function runSketchFromImage(input: SketchFromImageInput): Promise<SketchFromImageResult> {
  const maxBytes = input.maxBytes ?? IMAGE_INTENT_MAX_BYTES;

  if (!input.imageBase64) {
    return { ok: false, warnings: [], error: 'imageBase64 is required (data URL or raw base64)', code: 'IMAGE_REQUIRED' };
  }
  const decoded = decodeImageBase64(input.imageBase64);
  if (!decoded) {
    return { ok: false, warnings: [], error: 'Could not decode imageBase64 (expected data URL or valid base64)', code: 'IMAGE_DECODE_FAILED' };
  }
  if (decoded.bytes.length > maxBytes) {
    return {
      ok: false,
      warnings: [],
      error: `image exceeds ${Math.round(maxBytes / 1024 / 1024)} MB (got ${decoded.bytes.length} bytes after decoding)`,
      code: 'IMAGE_TOO_LARGE',
      imageBytes: decoded.bytes.length,
    };
  }

  const detector = input.detector ?? createRealVisionSketchDetector();
  const result = await inferSketchFromImage(decoded.bytes, { realDetector: detector });
  if (!result.ok || !result.entities) {
    return { ok: false, warnings: result.warnings, error: result.error ?? 'sketch inference failed', code: 'INFER_FAILED', imageBytes: decoded.bytes.length };
  }
  return { ok: true, entities: result.entities, warnings: result.warnings, imageBytes: decoded.bytes.length };
}
