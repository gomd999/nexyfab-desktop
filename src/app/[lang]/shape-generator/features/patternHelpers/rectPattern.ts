/**
 * Rectangular grid pattern helper for the Hole Wizard (Phase 2 W5 — C5).
 *
 * Equivalent to the C2 inline `expandRect`. Kept as a stand-alone module for
 * symmetry with `linearPattern.ts` and `circularPattern.ts` so the wizard
 * can `import { expandPattern } from './patternHelpers'` and dispatch via
 * a single entry point.
 *
 * Row-major: outer loop = row (Y), inner = col (X). The `source` field is
 * stamped 'rect' so the position table can colour-code by origin.
 */

import type { HolePosition } from '../holeArray';

export interface RectPatternParams {
  kind: 'rect';
  startX: number;
  startY: number;
  stepX: number;
  stepY: number;
  rows: number;
  cols: number;
}

export function expandRectPattern(
  arrayId: string,
  p: RectPatternParams,
): HolePosition[] {
  const out: HolePosition[] = [];
  if (
    !Number.isInteger(p.rows) ||
    !Number.isInteger(p.cols) ||
    p.rows <= 0 ||
    p.cols <= 0
  ) {
    return out;
  }
  for (let r = 0; r < p.rows; r++) {
    for (let c = 0; c < p.cols; c++) {
      out.push({
        id: `${arrayId}#rect-r${r}c${c}`,
        x: p.startX + c * p.stepX,
        y: p.startY + r * p.stepY,
        source: 'rect',
      });
    }
  }
  return out;
}
