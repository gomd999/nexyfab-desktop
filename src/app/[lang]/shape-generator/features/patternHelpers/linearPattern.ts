/**
 * Linear pattern helper for the Hole Wizard (Phase 2 W5 — Track C5).
 *
 * Two kinds:
 *  - `linear`   : 1D row of N positions along a single (dx, dy) step.
 *                 Backwards-compatible with the C2 linear array params.
 *  - `linear2D` : 2D grid driven by independent row + column step vectors
 *                 (not necessarily axis-aligned — supports a sheared/rotated
 *                 grid). Total count = rows × cols. Distinct from `rect`,
 *                 which is the axis-aligned 1-step-per-axis case.
 *
 * Both kinds are pure helpers: no DOM, no three.js, no I/O. The caller owns
 * id assignment for the parent array; this module produces deterministic
 * suffixes (`#lin-i` for 1D, `#lin2d-rXcY` for 2D) so re-expansion is
 * idempotent — important for the `positions[].depthOverride` tombstone
 * carry-over described in the Hole Wizard spec §7.3.
 *
 * Spec ambiguity resolved:
 *  - When count <= 0 or the rows/cols product is <= 0, expand to `[]` rather
 *    than throwing. The wizard's validator (`validateHoleArray`) is the
 *    authoritative gate; this helper stays pure so it can be unit-tested
 *    against degenerate input without try/catch wrappers.
 */

import type { HolePosition } from '../holeArray';

/** Linear (1D) pattern params — same shape as C2's LinearArrayParams. */
export interface LinearPatternParams {
  kind: 'linear';
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  count: number;
}

/**
 * Linear 2D pattern params — independent row + column step vectors.
 *
 * The position at (r, c) is:
 *   x = startX + c * dxCol + r * dxRow
 *   y = startY + c * dyCol + r * dyRow
 *
 * Setting (dxRow, dyRow) = (0, stepY) and (dxCol, dyCol) = (stepX, 0)
 * reproduces the axis-aligned `rect` case; richer combinations let the
 * caller author sheared / rotated grids without baking a rotation into the
 * surrounding feature graph.
 */
export interface Linear2DPatternParams {
  kind: 'linear2D';
  startX: number;
  startY: number;
  /** Step vector applied per row advance. */
  dxRow: number;
  dyRow: number;
  /** Step vector applied per column advance. */
  dxCol: number;
  dyCol: number;
  rows: number;
  cols: number;
}

function isNonNegativeInteger(n: number): boolean {
  return Number.isFinite(n) && Number.isInteger(n) && n >= 0;
}

/**
 * Expand a 1D linear pattern. Returns `[]` for non-positive or non-integer
 * count (defensive — validator catches the case separately).
 */
export function expandLinearPattern(
  arrayId: string,
  p: LinearPatternParams,
): HolePosition[] {
  const out: HolePosition[] = [];
  if (!Number.isInteger(p.count) || p.count <= 0) return out;
  for (let i = 0; i < p.count; i++) {
    out.push({
      id: `${arrayId}#lin-${i}`,
      x: p.startX + i * p.dx,
      y: p.startY + i * p.dy,
      source: 'linear',
    });
  }
  return out;
}

/**
 * Expand a 2D linear (row × col) pattern. Row-major order, matches the
 * existing `rect` layout so `linear2D` and `rect` results are comparable
 * when the step vectors are axis-aligned.
 *
 * Returns `[]` for any non-integer/<=0 rows or cols.
 */
export function expandLinear2DPattern(
  arrayId: string,
  p: Linear2DPatternParams,
): HolePosition[] {
  const out: HolePosition[] = [];
  if (
    !isNonNegativeInteger(p.rows) ||
    !isNonNegativeInteger(p.cols) ||
    p.rows === 0 ||
    p.cols === 0
  ) {
    return out;
  }
  for (let r = 0; r < p.rows; r++) {
    for (let c = 0; c < p.cols; c++) {
      out.push({
        id: `${arrayId}#lin2d-r${r}c${c}`,
        x: p.startX + c * p.dxCol + r * p.dxRow,
        y: p.startY + c * p.dyCol + r * p.dyRow,
        // Surface as 'linear' so legacy consumers don't see a new source value.
        source: 'linear',
      });
    }
  }
  return out;
}
