/**
 * polylineSimplify.ts — Polyline simplification algorithms.
 *
 * Vector drawings and scan-derived curves come with redundant
 * vertices that hurt downstream simulation, smooth-fit, and visual
 * fidelity. Two classical algorithms:
 *
 *   - **Douglas-Peucker** — recursive: keep endpoints, drop interior
 *     points whose perpendicular distance from the chord is below ε.
 *     Preserves "important" vertices (corners) at the cost of
 *     non-uniform spacing.
 *   - **Visvalingam-Whyatt** — iterative: each step removes the
 *     vertex whose effective area (triangle with neighbours) is
 *     smallest. Preserves uniform spacing better than DP.
 *
 * Both run in O(n log n) with binary-heap priority queues; we ship
 * straightforward O(n²) for clarity. For huge polylines callers can
 * pre-segment.
 *
 * Plus a **simplification metric** so callers can compare results:
 *   - retainedFraction = output / input
 *   - maxDeviation = worst point's perpendicular distance from kept chord
 *   - totalLengthDelta = |original length − simplified length|
 */

export type Point2D = { x: number; y: number };
export type Point3D = { x: number; y: number; z: number };

// ── Douglas-Peucker ────────────────────────────────────────────

export function douglasPeucker2D(points: Point2D[], epsilon: number): Point2D[] {
  if (points.length < 3) return points.slice();
  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  dpRecurse2D(points, 0, points.length - 1, epsilon, keep);
  return points.filter((_, i) => keep[i]);
}

function dpRecurse2D(points: Point2D[], start: number, end: number, epsilon: number, keep: boolean[]): void {
  if (end - start <= 1) return;
  const a = points[start]!, b = points[end]!;
  let maxDist = 0;
  let maxIdx = start;
  for (let i = start + 1; i < end; i++) {
    const d = perpendicularDistance2D(points[i]!, a, b);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }
  if (maxDist > epsilon) {
    keep[maxIdx] = true;
    dpRecurse2D(points, start, maxIdx, epsilon, keep);
    dpRecurse2D(points, maxIdx, end, epsilon, keep);
  }
}

function perpendicularDistance2D(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lineLen = Math.hypot(dx, dy);
  if (lineLen < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dx * (a.y - p.y) - (a.x - p.x) * dy) / lineLen;
}

export function douglasPeucker3D(points: Point3D[], epsilon: number): Point3D[] {
  if (points.length < 3) return points.slice();
  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  dpRecurse3D(points, 0, points.length - 1, epsilon, keep);
  return points.filter((_, i) => keep[i]);
}

function dpRecurse3D(points: Point3D[], start: number, end: number, epsilon: number, keep: boolean[]): void {
  if (end - start <= 1) return;
  const a = points[start]!, b = points[end]!;
  let maxDist = 0;
  let maxIdx = start;
  for (let i = start + 1; i < end; i++) {
    const d = perpendicularDistance3D(points[i]!, a, b);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }
  if (maxDist > epsilon) {
    keep[maxIdx] = true;
    dpRecurse3D(points, start, maxIdx, epsilon, keep);
    dpRecurse3D(points, maxIdx, end, epsilon, keep);
  }
}

function perpendicularDistance3D(p: Point3D, a: Point3D, b: Point3D): number {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const ax = p.x - a.x, ay = p.y - a.y, az = p.z - a.z;
  const crossX = dy * az - dz * ay;
  const crossY = dz * ax - dx * az;
  const crossZ = dx * ay - dy * ax;
  const cross = Math.hypot(crossX, crossY, crossZ);
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-12) return Math.hypot(ax, ay, az);
  return cross / len;
}

// ── Visvalingam-Whyatt ─────────────────────────────────────────

export function visvalingam2D(points: Point2D[], targetCount: number): Point2D[] {
  if (points.length <= targetCount) return points.slice();
  const linked: Array<{ point: Point2D; prev: number; next: number; area: number; removed: boolean }> = points.map(p => ({ point: p, prev: 0, next: 0, area: 0, removed: false }));
  for (let i = 0; i < linked.length; i++) {
    linked[i]!.prev = i - 1;
    linked[i]!.next = i + 1;
  }
  for (let i = 1; i < linked.length - 1; i++) {
    linked[i]!.area = triangleArea2D(points[i - 1]!, points[i]!, points[i + 1]!);
  }
  // Endpoints never get removed.
  let remaining = linked.length;
  while (remaining > targetCount) {
    let minIdx = -1;
    let minArea = Infinity;
    for (let i = 1; i < linked.length - 1; i++) {
      if (linked[i]!.removed) continue;
      if (linked[i]!.area < minArea) {
        minArea = linked[i]!.area;
        minIdx = i;
      }
    }
    if (minIdx === -1) break;
    linked[minIdx]!.removed = true;
    remaining--;
    // Re-link.
    const prev = linked[minIdx]!.prev;
    const next = linked[minIdx]!.next;
    if (prev >= 0) linked[prev]!.next = next;
    if (next < linked.length) linked[next]!.prev = prev;
    // Recompute neighbours' areas.
    if (prev > 0 && next < linked.length) {
      linked[prev]!.area = triangleArea2D(linked[linked[prev]!.prev]!.point, linked[prev]!.point, linked[next]!.point);
      if (next < linked.length - 1) {
        linked[next]!.area = triangleArea2D(linked[prev]!.point, linked[next]!.point, linked[linked[next]!.next]!.point);
      }
    }
  }
  return linked.filter(l => !l.removed).map(l => l.point);
}

function triangleArea2D(a: Point2D, b: Point2D, c: Point2D): number {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
}

// ── Adaptive epsilon (target retention) ────────────────────────

/** Find ε that yields close to target output count via binary search. */
export function douglasPeuckerToCount2D(points: Point2D[], targetCount: number, maxIterations: number = 30): { points: Point2D[]; epsilon: number } {
  if (points.length <= targetCount) return { points: points.slice(), epsilon: 0 };
  let lo = 0;
  let hi = boundingDiagonal2D(points);
  let best: Point2D[] = points;
  let bestEps = 0;
  for (let iter = 0; iter < maxIterations; iter++) {
    const mid = (lo + hi) / 2;
    const simplified = douglasPeucker2D(points, mid);
    if (simplified.length > targetCount) {
      lo = mid;
    } else if (simplified.length < targetCount) {
      hi = mid;
      best = simplified;
      bestEps = mid;
    } else {
      return { points: simplified, epsilon: mid };
    }
  }
  return { points: best, epsilon: bestEps };
}

function boundingDiagonal2D(points: Point2D[]): number {
  if (points.length === 0) return 1;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  return Math.hypot(maxX - minX, maxY - minY);
}

// ── Metrics ────────────────────────────────────────────────────

export interface SimplificationMetrics {
  inputCount: number;
  outputCount: number;
  retainedFraction: number;
  originalLength: number;
  simplifiedLength: number;
  lengthDeltaFraction: number;
  /** Worst perpendicular deviation from original polyline (mm). */
  maxDeviation: number;
}

export function measureSimplification(original: Point2D[], simplified: Point2D[]): SimplificationMetrics {
  const inputCount = original.length;
  const outputCount = simplified.length;
  const originalLength = polylineLength2D(original);
  const simplifiedLength = polylineLength2D(simplified);
  let maxDev = 0;
  // For each original point, find its distance to the simplified polyline.
  for (const p of original) {
    let best = Infinity;
    for (let i = 0; i < simplified.length - 1; i++) {
      const d = perpendicularDistance2D(p, simplified[i]!, simplified[i + 1]!);
      if (d < best) best = d;
    }
    if (best > maxDev) maxDev = best;
  }
  return {
    inputCount,
    outputCount,
    retainedFraction: inputCount > 0 ? outputCount / inputCount : 0,
    originalLength,
    simplifiedLength,
    lengthDeltaFraction: originalLength > 0 ? Math.abs(originalLength - simplifiedLength) / originalLength : 0,
    maxDeviation: maxDev,
  };
}

function polylineLength2D(points: Point2D[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  }
  return len;
}
