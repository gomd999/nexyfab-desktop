/**
 * leaderLineRouter.ts — Auto-route leader lines for drawing annotations.
 *
 * On a 2D drawing every dimension / note / balloon has a leader line
 * that points from the text box to the geometry it annotates. When
 * the drawing has many annotations the leaders cross each other,
 * cross the geometry, or overlap with other text. A good router:
 *
 *   - Picks a side of the text box (top/bottom/left/right) whose
 *     leader exits in the rough direction of the target.
 *   - Avoids passing the leader through bounding boxes of OTHER
 *     annotations (`obstacleBoxes`).
 *   - Adds 1-2 elbow bends when a straight line would cross an
 *     obstacle.
 *   - Reports any leader that still crosses an obstacle, so the UI
 *     can flag it visually.
 *
 * Algorithm: for each annotation, try 4 exits × 2 elbow-orientations
 * = 8 candidate paths. Score each (length + crossings + matches
 * preferred-side bias). Return the cheapest.
 */

export interface Vec2 { x: number; y: number }

export interface BBox {
  min: Vec2;
  max: Vec2;
}

export interface AnnotationRequest {
  id: string;
  /** Bounding box of the text/balloon. */
  textBox: BBox;
  /** Target point (the geometry feature being labeled). */
  target: Vec2;
  /** Side bias: if set, prefer to exit from this side. */
  preferredSide?: 'top' | 'bottom' | 'left' | 'right';
}

export interface LeaderPath {
  annotationId: string;
  /** Ordered polyline points: text-exit → optional elbow(s) → target. */
  points: Vec2[];
  /** Score of the chosen route (lower = better). */
  score: number;
  /** Bbox crossings remaining (non-zero = visual flag). */
  crossings: number;
}

export interface RouteResult {
  paths: LeaderPath[];
  /** Total cost (sum of scores). */
  totalScore: number;
  /** Count of paths with any unresolved crossings. */
  crossingCount: number;
}

export interface RouteOptions {
  /** Padding (mm) added around obstacle bboxes for clearance. */
  paddingMm: number;
  /** Cost added per crossing. */
  crossingPenalty: number;
  /** Cost added when not exiting from preferred side. */
  preferenceMismatchPenalty: number;
}

export const DEFAULT_OPTIONS: RouteOptions = {
  paddingMm: 1.0,
  crossingPenalty: 100,
  preferenceMismatchPenalty: 20,
};

// ── Top-level entry ────────────────────────────────────────────

export function routeLeaders(
  annotations: AnnotationRequest[],
  obstacles: BBox[],
  options: Partial<RouteOptions> = {},
): RouteResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const paddedObstacles = obstacles.map(b => padBBox(b, opts.paddingMm));
  const paths: LeaderPath[] = [];
  for (const ann of annotations) {
    const path = routeOne(ann, paddedObstacles, opts);
    paths.push(path);
  }
  return {
    paths,
    totalScore: paths.reduce((s, p) => s + p.score, 0),
    crossingCount: paths.filter(p => p.crossings > 0).length,
  };
}

// ── Single annotation routing ──────────────────────────────────

function routeOne(ann: AnnotationRequest, obstacles: BBox[], opts: RouteOptions): LeaderPath {
  const exits: Array<{ side: 'top' | 'bottom' | 'left' | 'right'; point: Vec2 }> = [
    { side: 'top', point: { x: (ann.textBox.min.x + ann.textBox.max.x) / 2, y: ann.textBox.max.y } },
    { side: 'bottom', point: { x: (ann.textBox.min.x + ann.textBox.max.x) / 2, y: ann.textBox.min.y } },
    { side: 'left', point: { x: ann.textBox.min.x, y: (ann.textBox.min.y + ann.textBox.max.y) / 2 } },
    { side: 'right', point: { x: ann.textBox.max.x, y: (ann.textBox.min.y + ann.textBox.max.y) / 2 } },
  ];

  let bestPath: LeaderPath = {
    annotationId: ann.id,
    points: [exits[0]!.point, ann.target],
    score: Infinity,
    crossings: 0,
  };
  for (const exit of exits) {
    for (const elbow of [false, true]) {
      const points = elbow
        ? [exit.point, { x: ann.target.x, y: exit.point.y }, ann.target]
        : [exit.point, ann.target];
      const crossings = countCrossings(points, ann.textBox, obstacles);
      const length = polylineLength(points);
      const sidePenalty = ann.preferredSide && ann.preferredSide !== exit.side ? opts.preferenceMismatchPenalty : 0;
      const score = length + crossings * opts.crossingPenalty + sidePenalty + (elbow ? 5 : 0);
      if (score < bestPath.score) {
        bestPath = { annotationId: ann.id, points, score, crossings };
      }
    }
  }
  return bestPath;
}

// ── Crossing test ──────────────────────────────────────────────

function countCrossings(polyline: Vec2[], skipBox: BBox, obstacles: BBox[]): number {
  let total = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i]!;
    const b = polyline[i + 1]!;
    for (const ob of obstacles) {
      if (boxesEqual(ob, skipBox)) continue;
      if (segmentCrossesBox(a, b, ob)) total++;
    }
  }
  return total;
}

export function segmentCrossesBox(a: Vec2, b: Vec2, box: BBox): boolean {
  // If both endpoints are strictly outside the same side, no cross.
  if (a.x < box.min.x && b.x < box.min.x) return false;
  if (a.x > box.max.x && b.x > box.max.x) return false;
  if (a.y < box.min.y && b.y < box.min.y) return false;
  if (a.y > box.max.y && b.y > box.max.y) return false;
  // If either endpoint is strictly inside, cross.
  if (pointInBox(a, box) || pointInBox(b, box)) return true;
  // Otherwise test against each side as segment-segment.
  const corners = [
    { x: box.min.x, y: box.min.y },
    { x: box.max.x, y: box.min.y },
    { x: box.max.x, y: box.max.y },
    { x: box.min.x, y: box.max.y },
  ];
  for (let i = 0; i < 4; i++) {
    const c = corners[i]!;
    const d = corners[(i + 1) % 4]!;
    if (segmentsIntersect(a, b, c, d)) return true;
  }
  return false;
}

function pointInBox(p: Vec2, box: BBox): boolean {
  return p.x >= box.min.x && p.x <= box.max.x && p.y >= box.min.y && p.y <= box.max.y;
}

function segmentsIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const o1 = orient(p1, p2, p3);
  const o2 = orient(p1, p2, p4);
  const o3 = orient(p3, p4, p1);
  const o4 = orient(p3, p4, p2);
  return o1 !== o2 && o3 !== o4;
}

function orient(a: Vec2, b: Vec2, c: Vec2): number {
  const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

function polylineLength(points: Vec2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

// ── BBox helpers ───────────────────────────────────────────────

function padBBox(b: BBox, pad: number): BBox {
  return {
    min: { x: b.min.x - pad, y: b.min.y - pad },
    max: { x: b.max.x + pad, y: b.max.y + pad },
  };
}

function boxesEqual(a: BBox, b: BBox): boolean {
  return (
    Math.abs(a.min.x - b.min.x) < 1e-6 &&
    Math.abs(a.min.y - b.min.y) < 1e-6 &&
    Math.abs(a.max.x - b.max.x) < 1e-6 &&
    Math.abs(a.max.y - b.max.y) < 1e-6
  );
}

// ── Summary ────────────────────────────────────────────────────

export interface RouteSummary {
  annotationCount: number;
  averageLengthMm: number;
  crossingCount: number;
  cleanFraction: number;
}

export function summarize(result: RouteResult): RouteSummary {
  if (result.paths.length === 0) {
    return { annotationCount: 0, averageLengthMm: 0, crossingCount: 0, cleanFraction: 1 };
  }
  const totalLen = result.paths.reduce((s, p) => s + polylineLength(p.points), 0);
  return {
    annotationCount: result.paths.length,
    averageLengthMm: totalLen / result.paths.length,
    crossingCount: result.crossingCount,
    cleanFraction: 1 - result.crossingCount / result.paths.length,
  };
}
