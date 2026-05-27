/**
 * cornerRoundingPath.ts — Insert blend arcs at sharp toolpath corners so
 * the machine doesn't have to decelerate to a stop. A sharp interior
 * corner forces v→0 (infinite curvature); rounding it with a small arc
 * of radius r lets the machine hold a cornering feed limited by the
 * lateral acceleration:
 *
 *   v_corner = √( a_lateral · r )
 *
 * Given a polyline of toolpath vertices and a max corner deviation
 * tolerance (how far the rounded path may stray from the sharp corner),
 * we compute the largest arc that fits each corner within tolerance and
 * the cornering feed it permits.
 *
 * deviation δ relates to arc radius r and half-angle of the corner φ:
 *   r = δ · sin(φ) / (1 − sin(φ))      (φ = half the interior angle)
 */

export interface Point2D { x: number; y: number }

export interface CornerRoundingInput {
  path: Point2D[];
  maxDeviationMm: number;     // chord tolerance
  lateralAccelMmPerS2: number; // machine cornering accel limit
  maxFeedMmMin: number;        // commanded feed (cap)
}

export interface RoundedCorner {
  vertexIndex: number;
  arcRadiusMm: number;
  corneringFeedMmMin: number;
  interiorAngleDeg: number;
  arcCentre: Point2D;
}

export interface CornerRoundingResult {
  corners: RoundedCorner[];
  minCorneringFeedMmMin: number;
  sharpCornerCount: number; // corners too sharp to round usefully
  warnings: string[];
}

export function roundCorners(input: CornerRoundingInput): CornerRoundingResult {
  const warnings: string[] = [];
  if (input.path.length < 3) warnings.push('Path needs at least 3 points to have a corner.');
  if (input.maxDeviationMm <= 0) warnings.push('Max deviation must be positive.');

  const corners: RoundedCorner[] = [];
  let sharp = 0;
  let minFeed = input.maxFeedMmMin;

  for (let i = 1; i < input.path.length - 1; i++) {
    const prev = input.path[i - 1]!;
    const curr = input.path[i]!;
    const next = input.path[i + 1]!;

    const v1 = normalize(prev.x - curr.x, prev.y - curr.y);
    const v2 = normalize(next.x - curr.x, next.y - curr.y);
    const dot = Math.max(-1, Math.min(1, v1.x * v2.x + v1.y * v2.y));
    const interiorAngle = Math.acos(dot); // angle between the two legs at the vertex
    const interiorDeg = interiorAngle * 180 / Math.PI;

    // Nearly straight (interior ≈ 180°) → no rounding needed.
    if (interiorDeg > 178) continue;
    // Very sharp (interior ≈ 0°) → can't round usefully.
    if (interiorDeg < 5) { sharp++; continue; }

    const halfAngle = interiorAngle / 2;
    const sinHalf = Math.sin(halfAngle);
    const r = input.maxDeviationMm * sinHalf / Math.max(1e-6, 1 - sinHalf);

    const feed = Math.min(input.maxFeedMmMin, Math.sqrt(input.lateralAccelMmPerS2 * r) * 60);
    minFeed = Math.min(minFeed, feed);

    // Arc centre lies along the angle bisector at distance r/sin(halfAngle).
    const bx = normalize(v1.x + v2.x, v1.y + v2.y);
    const dCentre = r / Math.max(1e-6, sinHalf);
    const arcCentre = { x: curr.x + bx.x * dCentre, y: curr.y + bx.y * dCentre };

    corners.push({
      vertexIndex: i,
      arcRadiusMm: r,
      corneringFeedMmMin: feed,
      interiorAngleDeg: interiorDeg,
      arcCentre,
    });
  }

  if (corners.length === 0 && input.path.length >= 3) {
    // no roundable corners — feed stays at commanded max
    minFeed = input.maxFeedMmMin;
  }

  return {
    corners,
    minCorneringFeedMmMin: minFeed,
    sharpCornerCount: sharp,
    warnings,
  };
}

function normalize(x: number, y: number): Point2D {
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

/** Estimated time saved (s) vs stop-at-every-corner, given accel/decel. */
export function timeSaved(result: CornerRoundingResult, accelMmPerS2: number): number {
  // Each rounded corner avoids one decel-to-zero + reaccel. Rough: t ≈ 2·v/a per corner.
  let saved = 0;
  for (const c of result.corners) {
    const v = c.corneringFeedMmMin / 60; // mm/s
    saved += (2 * v) / Math.max(1e-6, accelMmPerS2);
  }
  return saved;
}

export function summarize(r: CornerRoundingResult): { roundedCorners: number; minCorneringFeedMmMin: number; sharpCornerCount: number } {
  return { roundedCorners: r.corners.length, minCorneringFeedMmMin: r.minCorneringFeedMmMin, sharpCornerCount: r.sharpCornerCount };
}
