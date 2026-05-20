/**
 * draftAnalysis.ts — Per-face draft angle classification.
 *
 * In injection molding, every face must have at least a small
 * draft angle (typically 0.5–3°) to release from the mold cavity.
 * Faces parallel to the pull direction (zero draft) snag and
 * either tear the part or damage the mold.
 *
 * Classification (relative to pull direction):
 *   - **positive**: face draws cleanly out (angle ≥ minDraft)
 *   - **zero**: face is parallel to pull (must add draft)
 *   - **negative**: face has reverse draft (undercut — slide needed)
 *
 * Output is a per-triangle classification + summary so the UI can
 * heat-map the model.
 */

import type { MoldMesh } from './partingLine';

export type DraftClass = 'positive' | 'zero' | 'negative';

export interface DraftAnalysisResult {
  /** Per-triangle classification. */
  classes: DraftClass[];
  /** Per-triangle draft angle (degrees from pull direction). */
  angles: number[];
  /** Summary counts. */
  summary: {
    positive: number;
    zero: number;
    negative: number;
    totalTriangles: number;
  };
}

export interface DraftOptions {
  /** Minimum acceptable draft (degrees). Default 0.5. */
  minDraftDeg?: number;
  /** Angle from pull direction below which the face is "zero". Default 0.5. */
  zeroToleranceDeg?: number;
}

function dot3(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Analyze every triangle's draft relative to a pull direction. */
export function analyzeDraft(
  mesh: MoldMesh,
  pullDirection: [number, number, number] = [0, 0, 1],
  opts: DraftOptions = {},
): DraftAnalysisResult {
  const minDraft = opts.minDraftDeg ?? 0.5;
  const zeroTol = opts.zeroToleranceDeg ?? 0.5;
  const pullLen = Math.hypot(...pullDirection) || 1;
  const pullUnit: [number, number, number] = [
    pullDirection[0] / pullLen,
    pullDirection[1] / pullLen,
    pullDirection[2] / pullLen,
  ];

  const classes: DraftClass[] = [];
  const angles: number[] = [];
  let positive = 0, zero = 0, negative = 0;

  for (const tri of mesh.triangles) {
    const dotP = dot3(tri.normal, pullUnit);
    // Angle BETWEEN face normal and pull direction.
    const angBetween = Math.acos(Math.max(-1, Math.min(1, dotP))) * 180 / Math.PI;
    // "Draft angle" measured from the pull axis to the face plane;
    // a face perpendicular to pull (vertical wall) is 0° draft.
    // A face inclined outward (away from pull) gives positive draft.
    const draftAng = 90 - angBetween;
    angles.push(draftAng);
    if (Math.abs(draftAng) <= zeroTol) {
      classes.push('zero');
      zero++;
    } else if (draftAng < -minDraft + zeroTol) {
      // Face tilts back into the mold — undercut / reverse draft.
      classes.push('negative');
      negative++;
    } else if (draftAng < minDraft) {
      // Insufficient positive draft, still marked zero (warning).
      classes.push('zero');
      zero++;
    } else {
      classes.push('positive');
      positive++;
    }
  }

  return {
    classes,
    angles,
    summary: {
      positive, zero, negative,
      totalTriangles: mesh.triangles.length,
    },
  };
}

/** Heat-map color for a draft class (used by the renderer). */
export function draftColor(c: DraftClass): string {
  switch (c) {
    case 'positive': return '#16a34a';
    case 'zero':     return '#f59e0b';
    case 'negative': return '#dc2626';
  }
}

/** True when the part is moldable from the given pull direction
 *  without slides / lifters (no negative draft, no zero draft). */
export function isMoldableFromDirection(result: DraftAnalysisResult): boolean {
  return result.summary.negative === 0;
}

/** Suggest a better pull direction by trying 6 cardinal axes
 *  and picking the one with fewest negatives. */
export function suggestPullDirection(mesh: MoldMesh): {
  bestDirection: [number, number, number];
  scores: Array<{ direction: [number, number, number]; negativeCount: number }>;
} {
  const cardinals: Array<[number, number, number]> = [
    [ 0,  0,  1], [ 0,  0, -1],
    [ 1,  0,  0], [-1,  0,  0],
    [ 0,  1,  0], [ 0, -1,  0],
  ];
  const scores = cardinals.map(d => {
    const r = analyzeDraft(mesh, d);
    return { direction: d, negativeCount: r.summary.negative };
  });
  scores.sort((a, b) => a.negativeCount - b.negativeCount);
  return { bestDirection: scores[0]!.direction, scores };
}
