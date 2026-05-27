/**
 * pocketStrategy.ts — CAM 2.5D pocket toolpath strategy picker.
 *
 * NexyFab Stage-1 emits a single fixed "spiral" pattern for every
 * pocket. Real CAM picks one of three strategies based on geometry:
 *
 *   - **Spiral-in**: tool starts at boundary, spirals inward. Best
 *     for round/oval pockets. Constant engagement → predictable
 *     chip load.
 *   - **Raster (zig-zag)**: parallel lines + step-over. Best for
 *     rectangular pockets and large flat regions. Easy to
 *     finish-pass.
 *   - **Trochoidal**: small circles drifting along centerline. Best
 *     for slots narrower than 2× cutter diameter — avoids full
 *     engagement that shortens tool life.
 *
 * This module emits the strategy *decision* + entry / exit moves.
 * Actual G-code sits in `gcodeEmitter` and is invoked downstream.
 */

export type PocketStrategy = 'spiral' | 'raster' | 'trochoidal';

export interface PocketInput {
  /** Pocket footprint bounding box (mm). */
  bboxWidthMm: number;
  bboxLengthMm: number;
  /** Pocket depth (mm). Negative or 0 → no cutting plan. */
  depthMm: number;
  /** Tool diameter (mm). */
  toolDiamMm: number;
  /** Pocket shape hint — "round" prefers spiral, "rect" prefers raster. */
  geometryKind?: 'round' | 'rect' | 'irregular';
  /** Stepover as fraction of tool diameter (default 40%). */
  stepoverRatio?: number;
}

export interface PocketPlan {
  strategy: PocketStrategy;
  rationale: string;
  /** Number of passes (depth / depthOfCut). */
  passes: number;
  /** Estimated cutting length, mm. */
  estimatedToolPathMm: number;
  /** Recommended axial depth of cut (mm) — 50% diameter is conservative. */
  depthOfCutMm: number;
  /** Recommended stepover (mm). */
  stepoverMm: number;
}

const FALLBACK_DOC_FRACTION = 0.5;

export function planPocket(input: PocketInput): PocketPlan {
  const D = input.toolDiamMm;
  const stepRatio = input.stepoverRatio ?? 0.4;
  const stepover = D * stepRatio;
  const doc = D * FALLBACK_DOC_FRACTION;
  const passes = input.depthMm > 0 ? Math.max(1, Math.ceil(input.depthMm / doc)) : 0;
  const minDim = Math.min(input.bboxWidthMm, input.bboxLengthMm);
  const maxDim = Math.max(input.bboxWidthMm, input.bboxLengthMm);

  let strategy: PocketStrategy = 'raster';
  let rationale = 'rect fallback';

  // Narrow slot → trochoidal.
  if (minDim < 2 * D) {
    strategy = 'trochoidal';
    rationale = `slot (minDim ${minDim.toFixed(1)} < 2D)`;
  }
  // Round / circular pocket → spiral.
  else if (input.geometryKind === 'round') {
    strategy = 'spiral';
    rationale = 'round pocket prefers spiral';
  }
  // Wide aspect ratio rectangle → raster.
  else if (maxDim / minDim > 3) {
    strategy = 'raster';
    rationale = `high aspect ratio (${(maxDim / minDim).toFixed(1)}) → raster`;
  }
  // Square-ish pocket — spiral wins for round-ish tool engagement.
  else if (maxDim / minDim < 1.5 && input.geometryKind !== 'rect') {
    strategy = 'spiral';
    rationale = `square-ish pocket → spiral`;
  }

  // Toolpath length estimate (rough):
  //   spiral:    π × avgRadius × spiralTurns
  //   raster:    bboxArea / stepover
  //   trochoidal: pocket length × 1.5 (circle overlap)
  const area = input.bboxWidthMm * input.bboxLengthMm;
  let length = 0;
  switch (strategy) {
    case 'spiral': {
      const turns = Math.ceil((minDim / 2) / stepover);
      const avgR = minDim / 4;
      length = Math.PI * avgR * turns * 2;
      break;
    }
    case 'raster':
      length = area / stepover;
      break;
    case 'trochoidal':
      length = maxDim * 1.5;
      break;
  }

  return {
    strategy,
    rationale,
    passes,
    estimatedToolPathMm: Math.round(length * passes * 100) / 100,
    depthOfCutMm: Math.round(doc * 1000) / 1000,
    stepoverMm: Math.round(stepover * 1000) / 1000,
  };
}
