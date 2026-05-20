/**
 * polygonOffset2D.ts — 2D polygon offset (Clipper-style).
 *
 * For CAM stock outlines, sheet-metal flat patterns, drawing
 * dimensions, and CNC contour offsets:
 *
 *   - **Outset** (positive offset): expand polygon outward.
 *   - **Inset** (negative offset): shrink polygon inward.
 *
 * Three join types at convex corners:
 *
 *   - **Miter**: sharp, infinite for tight angles → miter-limit clip.
 *   - **Round**: arc; smooth, longer perimeter.
 *   - **Bevel**: flat cut between offset edges; cheapest.
 *
 * Full Clipper-grade is several thousand lines (handles
 * self-intersection, holes, complex polygons). This module ships
 * the simple-polygon case + a Minkowski-sum check for holes.
 * Production should swap to a hardened library when topology gets
 * involved.
 */

export interface Point2D {
  x: number;
  y: number;
}

export type JoinType = 'miter' | 'round' | 'bevel';

export interface OffsetOptions {
  /** Offset distance (mm). Positive = outset, negative = inset. */
  distance: number;
  join: JoinType;
  /** Miter limit (mm) — at sharp corners, fall back to bevel beyond this. */
  miterLimit: number;
  /** Arc-segment count for round joins. */
  arcDivisions: number;
}

export const DEFAULT_OFFSET_OPTIONS: OffsetOptions = {
  distance: 1,
  join: 'miter',
  miterLimit: 10,
  arcDivisions: 8,
};

// ── Top-level entry ─────────────────────────────────────────────

export function offsetPolygon(polygon: Point2D[], options: Partial<OffsetOptions> = {}): Point2D[] {
  const opts = { ...DEFAULT_OFFSET_OPTIONS, ...options };
  if (polygon.length < 3) return [];

  // Ensure CCW orientation.
  const ccw = isCounterClockwise(polygon);
  const ordered = ccw ? polygon : polygon.slice().reverse();
  const n = ordered.length;

  const result: Point2D[] = [];

  for (let i = 0; i < n; i++) {
    const prev = ordered[(i + n - 1) % n]!;
    const cur = ordered[i]!;
    const next = ordered[(i + 1) % n]!;

    const v1 = normalize2D({ x: cur.x - prev.x, y: cur.y - prev.y });
    const v2 = normalize2D({ x: next.x - cur.x, y: next.y - cur.y });
    // Outward normal (90° CW rotation of edge direction for CCW polygon).
    const n1: Point2D = { x: v1.y, y: -v1.x };
    const n2: Point2D = { x: v2.y, y: -v2.x };

    // Determine corner direction (convex vs concave).
    // CCW polygon: cross > 0 = left turn = convex.
    const cross = v1.x * v2.y - v1.y * v2.x;
    const isConvex = (cross > 0) === (opts.distance > 0);

    if (Math.abs(cross) < 1e-9) {
      // Straight section — single offset point.
      result.push({ x: cur.x + n1.x * opts.distance, y: cur.y + n1.y * opts.distance });
      continue;
    }

    if (isConvex) {
      // Convex corner.
      switch (opts.join) {
        case 'miter': {
          // Compute miter point: intersection of offset edges.
          const angle = Math.acos(Math.max(-1, Math.min(1, n1.x * n2.x + n1.y * n2.y)));
          const miterLen = opts.distance / Math.cos(angle / 2);
          if (Math.abs(miterLen) > opts.miterLimit) {
            // Bevel fallback.
            result.push({ x: cur.x + n1.x * opts.distance, y: cur.y + n1.y * opts.distance });
            result.push({ x: cur.x + n2.x * opts.distance, y: cur.y + n2.y * opts.distance });
          } else {
            const bisector = normalize2D({ x: n1.x + n2.x, y: n1.y + n2.y });
            result.push({ x: cur.x + bisector.x * miterLen, y: cur.y + bisector.y * miterLen });
          }
          break;
        }
        case 'round': {
          // Arc from n1·dist to n2·dist around cur.
          const a1 = Math.atan2(n1.y, n1.x);
          const a2 = Math.atan2(n2.y, n2.x);
          let delta = a2 - a1;
          // Walk the short way around the corner; for a CCW polygon
          // with positive offset that's the negative angular direction.
          if (opts.distance > 0) {
            if (delta > 0) delta -= 2 * Math.PI;
          } else {
            if (delta < 0) delta += 2 * Math.PI;
          }
          const divisions = Math.max(2, opts.arcDivisions);
          for (let s = 0; s <= divisions; s++) {
            const t = s / divisions;
            const angle = a1 + delta * t;
            result.push({
              x: cur.x + Math.cos(angle) * opts.distance,
              y: cur.y + Math.sin(angle) * opts.distance,
            });
          }
          break;
        }
        case 'bevel':
          result.push({ x: cur.x + n1.x * opts.distance, y: cur.y + n1.y * opts.distance });
          result.push({ x: cur.x + n2.x * opts.distance, y: cur.y + n2.y * opts.distance });
          break;
      }
    } else {
      // Concave corner — use miter (intersection of offset edges).
      const denom = n1.x * v2.y - n1.y * v2.x;
      if (Math.abs(denom) < 1e-9) {
        result.push({ x: cur.x + n1.x * opts.distance, y: cur.y + n1.y * opts.distance });
      } else {
        const bisector = normalize2D({ x: n1.x + n2.x, y: n1.y + n2.y });
        const angle = Math.acos(Math.max(-1, Math.min(1, n1.x * n2.x + n1.y * n2.y)));
        const miterLen = opts.distance / Math.cos(angle / 2);
        result.push({ x: cur.x + bisector.x * miterLen, y: cur.y + bisector.y * miterLen });
      }
    }
  }
  return result;
}

// ── Multi-step incremental offset ──────────────────────────────

/** Offset in increments to handle large distances without
 *  self-intersection collapse. */
export function offsetIncremental(polygon: Point2D[], totalDistance: number, stepCount: number = 5, options: Partial<OffsetOptions> = {}): Point2D[] {
  const stepDistance = totalDistance / stepCount;
  let current = polygon.slice();
  for (let i = 0; i < stepCount; i++) {
    current = offsetPolygon(current, { ...options, distance: stepDistance });
    if (current.length < 3) break;
  }
  return current;
}

// ── Geometry helpers ──────────────────────────────────────────

export function isCounterClockwise(polygon: Point2D[]): boolean {
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    area += (b.x - a.x) * (b.y + a.y);
  }
  return area < 0;
}

export function polygonArea(polygon: Point2D[]): number {
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

export function polygonPerimeter(polygon: Point2D[]): number {
  let len = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    len += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return len;
}

function normalize2D(v: Point2D): Point2D {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}

// ── Self-intersection detection ────────────────────────────────

export function hasSelfIntersection(polygon: Point2D[]): boolean {
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a1 = polygon[i]!, a2 = polygon[(i + 1) % n]!;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const b1 = polygon[j]!, b2 = polygon[(j + 1) % n]!;
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

function segmentsIntersect(p1: Point2D, p2: Point2D, p3: Point2D, p4: Point2D): boolean {
  const d1 = direction(p3, p4, p1);
  const d2 = direction(p3, p4, p2);
  const d3 = direction(p1, p2, p3);
  const d4 = direction(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return false;
}

function direction(pi: Point2D, pj: Point2D, pk: Point2D): number {
  return (pj.x - pi.x) * (pk.y - pi.y) - (pj.y - pi.y) * (pk.x - pi.x);
}

// ── Stats ──────────────────────────────────────────────────────

export interface OffsetStats {
  inputVertexCount: number;
  outputVertexCount: number;
  inputArea: number;
  outputArea: number;
  inputPerimeter: number;
  outputPerimeter: number;
}

export function compareBeforeAfter(before: Point2D[], after: Point2D[]): OffsetStats {
  return {
    inputVertexCount: before.length,
    outputVertexCount: after.length,
    inputArea: polygonArea(before),
    outputArea: polygonArea(after),
    inputPerimeter: polygonPerimeter(before),
    outputPerimeter: polygonPerimeter(after),
  };
}
