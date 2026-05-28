/**
 * Circular pattern helper for the Hole Wizard (Phase 2 W5 — Track C5).
 *
 * Two enhancements over the C2 inline `expandCircular`:
 *
 *  - **partialAngle (degrees, optional)** — sweep angle of the arc the
 *    positions occupy. When omitted (the C2-compatible path), the helper
 *    uses a full 360° sweep, producing positions every `2π / count`. When
 *    set, the positions cover only `partialAngle` degrees with even spacing
 *    `partialAngle / (count - 1)` (or `partialAngle / count` if a single
 *    rotation isn't intended — see below).
 *
 *  - **direction ('cw' | 'ccw', optional, default 'ccw')** — sign of the
 *    angular step. 'ccw' (right-handed XY) matches the C2 behavior; 'cw'
 *    negates the step for clockwise sweeps.
 *
 * Spec ambiguities resolved:
 *
 *  - **Partial-arc spacing convention.** For a full circle the wrap-around
 *    makes the "count" the number of *gaps*; for a partial arc the user
 *    expects the first and last positions to land on the arc's endpoints
 *    (this is what every CAD tool does). So:
 *        full sweep (no partialAngle) → step = 2π / count       (gaps)
 *        partial arc (partialAngle set) → step = sweep / (count - 1)  (count > 1)
 *        partial arc with count = 1   → single position at startAngle
 *
 *  - **partialAngle sign.** Always interpreted as a positive magnitude
 *    (degrees). The `direction` field carries the sign — negating
 *    partialAngle has no effect (we take `Math.abs`). A 360° partialAngle
 *    behaves identically to the full-sweep path.
 *
 *  - **direction default.** 'ccw' (counter-clockwise) — matches the C2
 *    behavior and the right-handed XY convention used throughout the
 *    feature graph. The CW path simply negates the angular step.
 */

import type { HolePosition } from '../holeArray';

export interface CircularPatternParams {
  kind: 'circular';
  centerX: number;
  centerY: number;
  radius: number;
  count: number;
  /** Angle (radians) of position 0. */
  startAngle: number;
  /**
   * Optional sweep angle (degrees). When omitted the arc is the full 360°.
   * Always treated as |partialAngle|; direction is the `direction` field.
   */
  partialAngle?: number;
  /** Direction of the angular step. Default 'ccw'. */
  direction?: 'cw' | 'ccw';
}

const DEG_TO_RAD = Math.PI / 180;

/**
 * Expand a circular pattern. Returns `[]` for non-positive/non-integer
 * count or invalid radius (the validator surfaces the friendlier message).
 */
export function expandCircularPattern(
  arrayId: string,
  p: CircularPatternParams,
): HolePosition[] {
  const out: HolePosition[] = [];
  if (!Number.isInteger(p.count) || p.count <= 0) return out;
  // Radius of zero is technically degenerate (all positions stack at the
  // center) but expansion stays pure — caller's validator can flag it.
  if (!Number.isFinite(p.radius)) return out;

  const dir = p.direction === 'cw' ? -1 : 1;
  const hasPartial =
    typeof p.partialAngle === 'number' &&
    Number.isFinite(p.partialAngle) &&
    Math.abs(p.partialAngle) > 0 &&
    Math.abs(p.partialAngle) < 360;

  let step: number;
  if (!hasPartial) {
    step = dir * ((2 * Math.PI) / p.count);
  } else if (p.count === 1) {
    step = 0;
  } else {
    // Partial arc: first + last position land on the arc endpoints.
    const sweepRad = Math.abs(p.partialAngle as number) * DEG_TO_RAD;
    step = (dir * sweepRad) / (p.count - 1);
  }

  for (let i = 0; i < p.count; i++) {
    const theta = p.startAngle + i * step;
    out.push({
      id: `${arrayId}#circ-${i}`,
      x: p.centerX + p.radius * Math.cos(theta),
      y: p.centerY + p.radius * Math.sin(theta),
      source: 'circular',
    });
  }
  return out;
}
