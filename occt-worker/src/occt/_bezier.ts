/**
 * Bezier curve flattening — W14 D1-2 (ADR-007).
 *
 * Converts SVG cubic / quadratic Bezier segments into a polyline whose
 * chord-height error stays below the supplied tolerance. Used by the
 * SVG path parser so real Fusion / SolidWorks 2D exports (which lean
 * heavily on C and Q commands for fillets, slots, lettering) survive
 * the trip into our polygon profile pipeline.
 *
 * Algorithm: recursive de Casteljau subdivision at t=0.5. Stop when
 * the maximum distance from inner control points to the chord falls
 * below tolerance. This is the standard error metric for adaptive
 * flattening (Sederberg / Lyche '83 onwards).
 *
 * Each call APPENDS the resulting vertices to `output` EXCLUDING the
 * starting endpoint — the caller pushed p0 (either as the initial M
 * vertex or as the previous segment's last point) before invoking
 * the flattener, so duplicating p0 would emit a zero-length edge that
 * OCCT rejects.
 *
 * Recursion is capped at MAX_DEPTH so a degenerate input (cusp, very
 * tight loop) doesn't stack-overflow; in practice 16 levels gives
 * 2^16 = 65k subsegments which is plenty.
 */

const MAX_DEPTH = 16;

export type Point = [number, number];

function midpoint(a: Point, b: Point): Point {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/** Max perpendicular distance from p1, p2 to the chord p0→p3. */
function chordHeight(p0: Point, p1: Point, p2: Point, p3: Point): number {
  const a = p3[1] - p0[1];
  const b = p0[0] - p3[0];
  const c = p3[0] * p0[1] - p0[0] * p3[1];
  const denom = Math.sqrt(a * a + b * b);
  if (denom < 1e-12) {
    // p0 ≈ p3 — degenerate chord. Fall back to straight-line distance
    // from p1, p2 to p0; otherwise zero-length chord would always
    // report height 0 and we'd stop subdividing prematurely.
    return Math.max(
      Math.hypot(p1[0] - p0[0], p1[1] - p0[1]),
      Math.hypot(p2[0] - p0[0], p2[1] - p0[1]),
    );
  }
  const d1 = Math.abs(a * p1[0] + b * p1[1] + c) / denom;
  const d2 = Math.abs(a * p2[0] + b * p2[1] + c) / denom;
  return Math.max(d1, d2);
}

/** Cubic Bezier flattener. Caller must have pushed p0 already. */
export function flattenCubic(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  tolerance: number,
  output: Point[],
  depth = 0,
): void {
  if (depth >= MAX_DEPTH || chordHeight(p0, p1, p2, p3) < tolerance) {
    output.push(p3);
    return;
  }
  // de Casteljau split at t=0.5.
  const m01 = midpoint(p0, p1);
  const m12 = midpoint(p1, p2);
  const m23 = midpoint(p2, p3);
  const m012 = midpoint(m01, m12);
  const m123 = midpoint(m12, m23);
  const m0123 = midpoint(m012, m123);
  flattenCubic(p0, m01, m012, m0123, tolerance, output, depth + 1);
  flattenCubic(m0123, m123, m23, p3, tolerance, output, depth + 1);
}

/** Quadratic Bezier flattener — degree-raised to cubic so the same
 *  subdivision logic applies. Caller must have pushed p0 already. */
export function flattenQuadratic(
  p0: Point,
  q1: Point,
  q2: Point,
  tolerance: number,
  output: Point[],
): void {
  // Q → C via degree elevation:
  //   C0 = Q0
  //   C1 = Q0 + 2/3 * (Q1 - Q0)
  //   C2 = Q2 + 2/3 * (Q1 - Q2)
  //   C3 = Q2
  const c1: Point = [
    p0[0] + (2 / 3) * (q1[0] - p0[0]),
    p0[1] + (2 / 3) * (q1[1] - p0[1]),
  ];
  const c2: Point = [
    q2[0] + (2 / 3) * (q1[0] - q2[0]),
    q2[1] + (2 / 3) * (q1[1] - q2[1]),
  ];
  flattenCubic(p0, c1, c2, q2, tolerance, output);
}

/** Reflect a control point across an anchor. Used for SVG S/T smooth
 *  commands where the omitted first control point is the reflection
 *  of the previous segment's last control point. */
export function reflect(anchor: Point, control: Point): Point {
  return [2 * anchor[0] - control[0], 2 * anchor[1] - control[1]];
}
