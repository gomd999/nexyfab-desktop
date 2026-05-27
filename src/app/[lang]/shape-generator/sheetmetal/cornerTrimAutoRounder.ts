/**
 * cornerTrimAutoRounder.ts — Auto-round sharp corners on a sheet
 * metal blank outline.
 *
 * Sharp corners on a flat blank cause:
 *
 *   - Stress concentration during forming (cracking at 90°).
 *   - Burr / safety issues on the finished part.
 *   - Tool wear at the punch / laser path corners.
 *
 * The module:
 *   - Walks the outer polyline.
 *   - For every internal/external angle below a threshold, inserts
 *     a tangent arc of radius r (≥ 0.5 × thickness preferred).
 *   - Trims the original polyline edges back to the new tangent
 *     points.
 *   - Returns the rewritten polyline + a list of rounded corners.
 *
 * Inner concave corners cannot be rounded by the punch — flagged
 * with a warning recommending a drilled relief.
 */

export interface Vec2 { x: number; y: number }

export interface RoundOptions {
  /** Default fillet radius (mm). */
  defaultRadiusMm: number;
  /** Sheet thickness for floor checks. */
  thicknessMm: number;
  /** Only round corners whose angle < threshold (degrees). */
  angleThresholdDeg: number;
  /** Min radius enforced (≥ 0.5·t recommended). */
  minRadiusMm: number;
}

export const DEFAULT_OPTIONS: RoundOptions = {
  defaultRadiusMm: 1.0,
  thicknessMm: 1.0,
  angleThresholdDeg: 100,
  minRadiusMm: 0.5,
};

export interface RoundedCorner {
  index: number;
  /** Original vertex position. */
  vertex: Vec2;
  /** Interior angle measured at the vertex (degrees). */
  angleDeg: number;
  radiusMm: number;
  /** Tangent points (start, end). */
  tangentStart: Vec2;
  tangentEnd: Vec2;
  /** Arc centre. */
  arcCentre: Vec2;
  /** Whether the corner was actually rounded (false → flagged). */
  applied: boolean;
  notes?: string;
}

export interface RoundResult {
  /** New polyline (closed). */
  newPolyline: Vec2[];
  rounded: RoundedCorner[];
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function roundCorners(polyline: Vec2[], options: Partial<RoundOptions> = {}): RoundResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const warnings: string[] = [];
  const corners: RoundedCorner[] = [];

  if (polyline.length < 3) {
    return { newPolyline: polyline.slice(), rounded: [], warnings: ['Polyline too short to round.'] };
  }

  const orient = signedArea(polyline);
  // For CCW polygons (orient > 0), convex corners have cross(v1, v2) < 0.
  // For CW polygons (orient < 0), convex corners have cross > 0.
  // Hence expected sign of cross at convex = -sign(orient).
  const convexSign = orient === 0 ? 0 : (orient > 0 ? -1 : 1);
  const newPts: Vec2[] = [];
  const n = polyline.length;
  for (let i = 0; i < n; i++) {
    const prev = polyline[(i - 1 + n) % n]!;
    const cur = polyline[i]!;
    const next = polyline[(i + 1) % n]!;
    const angle = interiorAngle(prev, cur, next);
    if (angle >= opts.angleThresholdDeg) {
      // Not sharp enough — keep as-is.
      newPts.push(cur);
      continue;
    }

    const radius = Math.max(opts.defaultRadiusMm, opts.minRadiusMm);
    if (radius < opts.thicknessMm * 0.5) {
      warnings.push(`Corner ${i} radius ${radius.toFixed(2)} < 0.5·t (${(opts.thicknessMm * 0.5).toFixed(2)}); may concentrate stress.`);
    }

    // Compute tangent offsets.
    const v1 = normalize(sub(prev, cur));
    const v2 = normalize(sub(next, cur));
    const halfAngle = (angle / 2) * Math.PI / 180;
    if (halfAngle <= 0) {
      newPts.push(cur);
      continue;
    }
    const setback = radius / Math.tan(halfAngle);
    if (setback >= distance(cur, prev) || setback >= distance(cur, next)) {
      // Radius too large for available edge length — skip.
      corners.push({
        index: i,
        vertex: cur,
        angleDeg: angle,
        radiusMm: radius,
        tangentStart: cur,
        tangentEnd: cur,
        arcCentre: cur,
        applied: false,
        notes: 'Radius too large for adjacent edge length.',
      });
      newPts.push(cur);
      continue;
    }

    const tStart: Vec2 = { x: cur.x + v1.x * setback, y: cur.y + v1.y * setback };
    const tEnd: Vec2 = { x: cur.x + v2.x * setback, y: cur.y + v2.y * setback };
    // Arc centre along the bisector at distance = radius / sin(halfAngle).
    const bisector = normalize(add(v1, v2));
    const centreDist = radius / Math.sin(halfAngle);
    const centre: Vec2 = { x: cur.x + bisector.x * centreDist, y: cur.y + bisector.y * centreDist };

    // Detect concave corner using polygon winding.
    const cross = v1.x * v2.y - v1.y * v2.x;
    if (convexSign !== 0 && Math.sign(cross) !== convexSign && Math.sign(cross) !== 0) {
      warnings.push(`Corner ${i} is concave; punch cannot follow inside fillet. Add drilled relief.`);
      corners.push({
        index: i,
        vertex: cur,
        angleDeg: angle,
        radiusMm: radius,
        tangentStart: cur,
        tangentEnd: cur,
        arcCentre: cur,
        applied: false,
        notes: 'Concave corner.',
      });
      newPts.push(cur);
      continue;
    }
    // Adjust arc centre to lie on the *interior* side (away from convex bisector pushing out).
    // For convex outer corners, the bisector from the vertex points INTO the polygon interior;
    // we placed centre at +bisector, which is interior. Good.

    corners.push({
      index: i,
      vertex: cur,
      angleDeg: angle,
      radiusMm: radius,
      tangentStart: tStart,
      tangentEnd: tEnd,
      arcCentre: centre,
      applied: true,
    });
    // Replace the sharp vertex with the two tangent points (arc reconstructed elsewhere).
    newPts.push(tStart);
    newPts.push(tEnd);
  }

  return { newPolyline: newPts, rounded: corners, warnings };
}

// ── Geometry helpers ──────────────────────────────────────────

function sub(a: Vec2, b: Vec2): Vec2 { return { x: a.x - b.x, y: a.y - b.y }; }
function add(a: Vec2, b: Vec2): Vec2 { return { x: a.x + b.x, y: a.y + b.y }; }
function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  if (len === 0) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}
function distance(a: Vec2, b: Vec2): number { return Math.hypot(a.x - b.x, a.y - b.y); }

function signedArea(poly: Vec2[]): number {
  let a = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % n]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function interiorAngle(prev: Vec2, cur: Vec2, next: Vec2): number {
  const v1 = sub(prev, cur);
  const v2 = sub(next, cur);
  const dot = v1.x * v2.x + v1.y * v2.y;
  const mag1 = Math.hypot(v1.x, v1.y);
  const mag2 = Math.hypot(v2.x, v2.y);
  if (mag1 === 0 || mag2 === 0) return 180;
  const cos = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
  return Math.acos(cos) * 180 / Math.PI;
}

// ── Summary ────────────────────────────────────────────────────

export interface RoundSummary {
  vertexCount: number;
  cornersFound: number;
  cornersApplied: number;
  averageRadius: number;
  warningCount: number;
}

export function summarize(result: RoundResult): RoundSummary {
  let sumR = 0;
  let applied = 0;
  for (const c of result.rounded) {
    if (c.applied) {
      applied++;
      sumR += c.radiusMm;
    }
  }
  return {
    vertexCount: result.newPolyline.length,
    cornersFound: result.rounded.length,
    cornersApplied: applied,
    averageRadius: applied === 0 ? 0 : sumR / applied,
    warningCount: result.warnings.length,
  };
}
