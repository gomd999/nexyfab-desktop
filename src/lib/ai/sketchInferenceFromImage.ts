/**
 * Image → sketch primitives inference (Phase 1: mock-driven).
 *
 * Given a raster image (base64-encoded data URL string OR raw Uint8Array of
 * encoded bytes), produce a `SketchEntities` shape the solver / overlays
 * understand. Pairs with `sketchSvgImport` (vector path) by giving the
 * editor a parallel ingestion route for hand-drawn / scanned / photo sources.
 *
 * Phase 1 (this file): NO real CV runs here.
 *   - If the caller supplies `mockDetector`, we delegate entity production
 *     to it. This is the contract used by the test suite and by upstream
 *     AI-orchestrators that already have their own detector (e.g. a LLM
 *     vision call that hands us a coordinates blob).
 *   - If `realDetector` is supplied (async), we use it instead — this is the
 *     Phase 2 plumbing pre-installed so the public API surface doesn't change
 *     when OpenCV-WASM lands.
 *   - If neither is supplied, we emit a deterministic 4-point fallback
 *     (unit-square corners) plus a warning. The fallback is intentionally
 *     trivial: enough to flow downstream pipelines (constraints, solver,
 *     extrude) end-to-end without forcing every dev to set up a CV stack
 *     just to exercise the import codepath.
 *
 * Phase 2 wishlist (documented for the eventual implementation):
 *   - `opencv-wasm` (or `@techstark/opencv-js`): load lazily, single shared
 *     instance keyed in module scope to amortize ~10 MB wasm init cost.
 *   - Pipeline: decode → grayscale → Gaussian blur (5×5, σ≈1.4) → Canny
 *     (low=50, high=150) → HoughLinesP (rho=1, theta=π/180, threshold=80
 *     default, configurable via `lineThreshold`) for lines, HoughCircles
 *     (HOUGH_GRADIENT, dp=1.5, minDist=20, minRadius via `minCircleRadius`)
 *     for circles.
 *   - Arc detection is non-trivial in OCV (no first-class Hough arc);
 *     candidates: (a) detect circles then prune by chord-coverage, (b) EDLines
 *     port, or (c) hand off to a small CNN regressor. Defer until Phase 2.B.
 *   - Coordinate frame: OCV pixels are +Y-down. Caller (or this module after
 *     decoding image height) MUST flip to sketch +Y-up before yielding
 *     entities — otherwise round-trip with sketchSvgImport will mirror.
 *   - Test rig: golden-image fixtures under `src/lib/ai/__fixtures__/sketch/`,
 *     deterministic seeds.
 *
 * No exceptions: the public API never throws — all failure modes surface
 * via `{ok: false, error}` so caller routes / UI can render inline.
 *
 * DO NOT add direct opencv / sharp / canvas imports to this module: keep
 * Phase 1 dep-free so the file can run in any JS environment (Node, browser,
 * Cf-worker, web-worker). When Phase 2 lands, isolate the wasm loader in a
 * sibling file (`sketchInferenceCv.ts`) and inject via `realDetector`.
 */

import type { SketchEntities } from '../sketch/sketchSvgExport';

export interface ImageInferenceResult {
  /** True when inference completed (mock or fallback). False on input/decoder error. */
  ok: boolean;
  /** Detected sketch entities in sketch space (+Y up). Undefined on hard error. */
  entities?: SketchEntities;
  /** Non-fatal issues: fallback used, low-confidence detection, etc. */
  warnings: string[];
  /** Hard error description. Set iff `ok === false`. */
  error?: string;
  /**
   * Per-shape detection metadata (Phase 2 will populate from CV pipeline;
   * Phase 1 mocks may supply it directly or leave empty).
   */
  detectedShapes?: ReadonlyArray<{ kind: string; confidence: number }>;
}

export interface ImageInferenceOptions {
  /** Mock detector for Phase 1 testing — receives the raw source string. */
  mockDetector?: (imageData: string) => SketchEntities;
  /** Real OpenCV-style detector (Phase 2) — receives decoded byte buffer. */
  realDetector?: (imageData: Uint8Array) => Promise<SketchEntities>;
  /** Hough transform threshold (Phase 2 wishlist — recorded for future use). */
  lineThreshold?: number;
  /** Min circle radius in pixels (Phase 2 wishlist). */
  minCircleRadius?: number;
  /**
   * Pre-computed shape metadata to surface in the result. Useful for mocks
   * that want to assert confidence flow downstream without re-implementing
   * the CV pipeline.
   */
  detectedShapes?: ReadonlyArray<{ kind: string; confidence: number }>;
}

/**
 * Maximum decoded source size (bytes / characters of base64). 8 MB ceiling
 * keeps us safely under typical Cf-worker request body limits AND prevents
 * pathological mock inputs from holding tokens in memory.
 */
export const IMAGE_INFERENCE_MAX_SIZE = 8 * 1024 * 1024;

// ─── public API ──────────────────────────────────────────────────────────

/**
 * Run sketch inference over an image source.
 *
 * Source accepted as either:
 *   - `string`: base64 / data URL ("data:image/png;base64,..." or raw base64).
 *     Passed through to `mockDetector` verbatim.
 *   - `Uint8Array`: raw encoded image bytes. Passed to `realDetector`.
 *     For mocks, we synthesize a short ASCII tag (`"<bytes:N>"`) so the
 *     mock signature stays `(string) => entities`.
 *
 * Returns `{ok: true, entities}` on success (including when fallback is
 * used). Returns `{ok: false, error}` only for hard errors: empty source,
 * oversized source, detector exception.
 */
export async function inferSketchFromImage(
  source: string | Uint8Array,
  opts: ImageInferenceOptions = {},
): Promise<ImageInferenceResult> {
  const warnings: string[] = [];

  // ----- input validation -----
  if (source === null || source === undefined) {
    return { ok: false, warnings, error: 'source is null/undefined' };
  }

  if (typeof source === 'string') {
    if (source.length === 0) {
      return { ok: false, warnings, error: 'empty source string' };
    }
    if (source.length > IMAGE_INFERENCE_MAX_SIZE) {
      return {
        ok: false,
        warnings,
        error: `source string exceeds max size (${source.length} > ${IMAGE_INFERENCE_MAX_SIZE})`,
      };
    }
  } else if (source instanceof Uint8Array) {
    if (source.byteLength === 0) {
      return { ok: false, warnings, error: 'empty source bytes' };
    }
    if (source.byteLength > IMAGE_INFERENCE_MAX_SIZE) {
      return {
        ok: false,
        warnings,
        error: `source bytes exceed max size (${source.byteLength} > ${IMAGE_INFERENCE_MAX_SIZE})`,
      };
    }
  } else {
    return {
      ok: false,
      warnings,
      error: 'source must be string (base64) or Uint8Array',
    };
  }

  // ----- detector selection -----
  // Priority: realDetector (Phase 2) > mockDetector (Phase 1 testing) > fallback.
  // realDetector wins because once a caller wires up real CV they almost
  // never want to fall back to mocked output silently.
  if (opts.realDetector) {
    try {
      const bytes =
        typeof source === 'string'
          ? stringToBytes(source)
          : source;
      const entities = await opts.realDetector(bytes);
      return finalize(entities, warnings, opts);
    } catch (err) {
      return {
        ok: false,
        warnings,
        error: `realDetector threw: ${errMsg(err)}`,
      };
    }
  }

  if (opts.mockDetector) {
    try {
      const tag =
        typeof source === 'string'
          ? source
          : `<bytes:${source.byteLength}>`;
      const entities = opts.mockDetector(tag);
      return finalize(entities, warnings, opts);
    } catch (err) {
      return {
        ok: false,
        warnings,
        error: `mockDetector threw: ${errMsg(err)}`,
      };
    }
  }

  // ----- fallback: deterministic 4-corner grid -----
  // Phase 1 default. A 10×10 mm square: enough geometry to drive a
  // round-trip through constraints/extrude in dev tooling without forcing
  // a CV setup. Caller gets a warning so this never silently masquerades
  // as real detection.
  warnings.push(
    'no detector supplied — using fallback 4-corner grid (Phase 2 wishlist: opencv-wasm)',
  );

  const entities: SketchEntities = {
    points: [
      { id: 'fb_p1', x: 0, y: 0 },
      { id: 'fb_p2', x: 10, y: 0 },
      { id: 'fb_p3', x: 10, y: 10 },
      { id: 'fb_p4', x: 0, y: 10 },
    ],
    lines: [],
    circles: [],
    arcs: [],
  };

  return finalize(entities, warnings, opts);
}

// ─── internals ───────────────────────────────────────────────────────────

/**
 * Normalize a detector's return value into a `SketchEntities` and assemble
 * the final result object. Centralized so all detector branches share the
 * same defaulting / validation rules.
 */
function finalize(
  entities: SketchEntities | null | undefined,
  warnings: string[],
  opts: ImageInferenceOptions,
): ImageInferenceResult {
  // Treat null/undefined detector output as "empty sketch" rather than a
  // hard error. Detectors that genuinely failed should throw; returning
  // null is interpreted as "image contained no detectable geometry".
  const safe: SketchEntities = entities ?? {
    points: [],
    lines: [],
    circles: [],
    arcs: [],
  };

  // Defensive: detectors written in plain JS may omit one of the four
  // array slots. Fill missing arrays with `[]` so downstream consumers
  // (solver, overlays) can assume the shape is complete.
  const normalized: SketchEntities = {
    points: safe.points ?? [],
    lines: safe.lines ?? [],
    circles: safe.circles ?? [],
    arcs: safe.arcs ?? [],
  };

  const result: ImageInferenceResult = {
    ok: true,
    entities: normalized,
    warnings,
  };

  if (opts.detectedShapes && opts.detectedShapes.length > 0) {
    result.detectedShapes = opts.detectedShapes;
  } else {
    // Auto-derive a minimal shapes summary from the normalized entities
    // so callers that didn't pre-compute one still get a useful view.
    // Confidence is fixed at 1.0 in Phase 1 (mock/fallback are deterministic);
    // Phase 2 will populate from CV scores.
    const derived: Array<{ kind: string; confidence: number }> = [];
    if (normalized.points.length > 0) {
      derived.push({ kind: 'point', confidence: 1.0 });
    }
    if (normalized.lines.length > 0) {
      derived.push({ kind: 'line', confidence: 1.0 });
    }
    if (normalized.circles.length > 0) {
      derived.push({ kind: 'circle', confidence: 1.0 });
    }
    if (normalized.arcs.length > 0) {
      derived.push({ kind: 'arc', confidence: 1.0 });
    }
    result.detectedShapes = derived;
  }

  return result;
}

/**
 * Encode a string source (data URL / base64 / arbitrary) to Uint8Array
 * for handoff to a `realDetector`. We don't try to base64-decode here:
 * Phase 2 real detectors will own their own decoding (PNG/JPEG header
 * parse, etc.) and we only need to deliver the bytes faithfully.
 */
function stringToBytes(s: string): Uint8Array {
  // Prefer TextEncoder when available (browser, modern Node, workers).
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(s);
  }
  // Fallback for ancient environments: hand-roll a UTF-8 encoder.
  // Unreachable in any supported runtime, but cheap insurance against
  // surprise compatibility regressions.
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return new Uint8Array(out);
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
