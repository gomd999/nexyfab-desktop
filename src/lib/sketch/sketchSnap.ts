/**
 * sketchSnap — cursor snap target detection for the sketch editor.
 *
 * Phase 1.4 of NexyFab Pro own-CAD (ADR-013).
 *
 * Pure-math helper that, given a cursor position in sketch coordinates
 * and a snapshot of the current sketch entities, returns the best snap
 * target (existing point, line endpoint/midpoint, circle center, grid
 * point, or intersection) within a configurable pixel-distance threshold.
 *
 * Design intent:
 *   - DOM-free, solver-free, side-effect-free. Trivially testable.
 *   - Hosts (SolverSketchEditor) decide when to call it and what threshold
 *     to pass; this module just ranks candidates and returns the winner.
 *   - Distance threshold (`pointRadius`) is interpreted in the same units
 *     as the input cursor/entity positions. The caller is responsible for
 *     converting from pixel-radius to world-units if the canvas is zoomed.
 *
 * Algorithm summary:
 *   1. Collect candidates from each enabled source:
 *        - point snap          → every entity point within threshold
 *        - line endpoint/mid   → endpoint + midpoint of every line
 *        - circle center       → center point of every circle
 *        - intersection        → line/line crossing points (Phase 1)
 *        - grid                → cursor rounded to nearest grid node
 *   2. Filter candidates whose distance exceeds threshold (grid excepted —
 *      grid is unbounded and acts as the always-available fallback).
 *   3. Sort by (distance asc, priority asc) and return the head.
 *
 * Priority (lower = stronger; matters when distances tie):
 *      point < intersection < line_endpoint < line_midpoint
 *           < circle_center < grid
 *
 * Phase 2 wishlist:
 *   - line ↔ circle and circle ↔ circle intersections
 *   - arc support (endpoints, midpoint-on-arc, intersections)
 *   - perpendicular-foot / nearest-on-curve targets
 *   - quadrant snaps for circles (N/E/S/W)
 *   - tangent-from-cursor snap
 */

// ─── public types ─────────────────────────────────────────────────────────

export interface Vec2 {
  x: number;
  y: number;
}

export type SnapKind =
  | 'grid'
  | 'point'
  | 'line_endpoint'
  | 'line_midpoint'
  | 'circle_center'
  | 'intersection';

export interface SnapTarget {
  /** Snap position in sketch coordinates. */
  pos: Vec2;
  kind: SnapKind;
  /**
   * Optional reference to the entity that produced the candidate.
   * - point         → point id
   * - line_endpoint → line id  (which endpoint is encoded in `pos`)
   * - line_midpoint → line id
   * - circle_center → circle id
   * - intersection  → "lineA|lineB" (sorted lex) for stability
   * - grid          → undefined
   */
  refId?: string;
  /** Euclidean distance from the cursor (same units as input). */
  distance: number;
}

export interface SnapEntities {
  points?: ReadonlyArray<{ id: string; x: number; y: number }>;
  lines?: ReadonlyArray<{
    id: string;
    p1: { x: number; y: number };
    p2: { x: number; y: number };
  }>;
  circles?: ReadonlyArray<{
    id: string;
    center: { x: number; y: number };
    radius: number;
  }>;
  arcs?: ReadonlyArray<{
    id: string;
    center: { x: number; y: number };
    start: { x: number; y: number };
    end: { x: number; y: number };
    radius: number;
  }>;
}

export interface SnapOptions {
  /** Spacing between grid nodes. Default 5. */
  gridSpacing?: number;
  /** Distance threshold for non-grid candidates. Default 5. */
  pointRadius?: number;
  /** When true, the cursor rounded to the nearest grid node is a candidate. Default true. */
  enableGrid?: boolean;
  /** When true, existing points / line endpoints / midpoints / circle centers are candidates. Default true. */
  enablePointSnap?: boolean;
  /** When true, line/line intersection points are candidates. Default true. */
  enableIntersection?: boolean;
}

// ─── priority ordering (lower wins ties) ──────────────────────────────────

const PRIORITY: Record<SnapKind, number> = {
  point: 0,
  intersection: 1,
  line_endpoint: 2,
  line_midpoint: 3,
  circle_center: 4,
  grid: 5,
};

// ─── helpers ──────────────────────────────────────────────────────────────

function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function roundTo(v: number, step: number): number {
  return Math.round(v / step) * step;
}

/**
 * Intersection of two finite line segments. Returns the crossing point if
 * it lies strictly within both segments (epsilon-tolerant), else null.
 *
 * Uses the standard parametric form: P = p1 + t*(p2-p1) on segment A,
 * P = p3 + u*(p4-p3) on segment B. The system is non-singular iff the
 * segments aren't parallel; t,u ∈ [0,1] keeps the intersection inside.
 */
function segmentIntersection(
  p1: Vec2, p2: Vec2,
  p3: Vec2, p4: Vec2,
): Vec2 | null {
  const x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;
  const x3 = p3.x, y3 = p3.y, x4 = p4.x, y4 = p4.y;
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-12) return null; // parallel / coincident
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
  const eps = 1e-9;
  if (t < -eps || t > 1 + eps) return null;
  if (u < -eps || u > 1 + eps) return null;
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// ─── main API ─────────────────────────────────────────────────────────────

/**
 * Find the best snap target for the given cursor position. Returns null
 * if nothing qualifies under the supplied options.
 *
 * Cost notes:
 *   - point / endpoint / midpoint / center scan is O(P + L + C).
 *   - intersection scan is O(L^2) — line/line only in Phase 1. For typical
 *     sketches (< 50 lines) this is negligible; larger sketches should
 *     consider a spatial index or short-circuiting once a near-zero
 *     distance candidate is found.
 *   - grid candidate is O(1).
 */
export function findSnapTarget(
  cursorPos: Vec2,
  entities: SnapEntities,
  opts: SnapOptions = {},
): SnapTarget | null {
  const gridSpacing = opts.gridSpacing ?? 5;
  const threshold = opts.pointRadius ?? 5;
  const enableGrid = opts.enableGrid ?? true;
  const enablePointSnap = opts.enablePointSnap ?? true;
  const enableIntersection = opts.enableIntersection ?? true;

  const candidates: SnapTarget[] = [];

  // ----- point / endpoint / midpoint / center snap -----
  if (enablePointSnap) {
    for (const p of entities.points ?? []) {
      const d = dist(cursorPos, p);
      if (d <= threshold) {
        candidates.push({
          pos: { x: p.x, y: p.y },
          kind: 'point',
          refId: p.id,
          distance: d,
        });
      }
    }
    for (const l of entities.lines ?? []) {
      const dE1 = dist(cursorPos, l.p1);
      if (dE1 <= threshold) {
        candidates.push({
          pos: { x: l.p1.x, y: l.p1.y },
          kind: 'line_endpoint',
          refId: l.id,
          distance: dE1,
        });
      }
      const dE2 = dist(cursorPos, l.p2);
      if (dE2 <= threshold) {
        candidates.push({
          pos: { x: l.p2.x, y: l.p2.y },
          kind: 'line_endpoint',
          refId: l.id,
          distance: dE2,
        });
      }
      const mid: Vec2 = {
        x: (l.p1.x + l.p2.x) / 2,
        y: (l.p1.y + l.p2.y) / 2,
      };
      const dM = dist(cursorPos, mid);
      if (dM <= threshold) {
        candidates.push({
          pos: mid,
          kind: 'line_midpoint',
          refId: l.id,
          distance: dM,
        });
      }
    }
    for (const c of entities.circles ?? []) {
      const d = dist(cursorPos, c.center);
      if (d <= threshold) {
        candidates.push({
          pos: { x: c.center.x, y: c.center.y },
          kind: 'circle_center',
          refId: c.id,
          distance: d,
        });
      }
    }
  }

  // ----- line/line intersection snap (Phase 1) -----
  if (enableIntersection) {
    const lines = entities.lines ?? [];
    for (let i = 0; i < lines.length; i++) {
      const a = lines[i]!;
      for (let j = i + 1; j < lines.length; j++) {
        const b = lines[j]!;
        const ip = segmentIntersection(a.p1, a.p2, b.p1, b.p2);
        if (!ip) continue;
        const d = dist(cursorPos, ip);
        if (d <= threshold) {
          candidates.push({
            pos: ip,
            kind: 'intersection',
            refId: pairKey(a.id, b.id),
            distance: d,
          });
        }
      }
    }
  }

  // ----- grid snap (always within threshold of itself) -----
  if (enableGrid && gridSpacing > 0) {
    const gx = roundTo(cursorPos.x, gridSpacing);
    const gy = roundTo(cursorPos.y, gridSpacing);
    const g: Vec2 = { x: gx, y: gy };
    const d = dist(cursorPos, g);
    if (d <= threshold) {
      candidates.push({
        pos: g,
        kind: 'grid',
        distance: d,
      });
    }
  }

  if (candidates.length === 0) return null;

  // Sort by distance asc, then by priority asc (lower priority value wins).
  candidates.sort((a, b) => {
    const dd = a.distance - b.distance;
    if (Math.abs(dd) > 1e-9) return dd;
    return PRIORITY[a.kind] - PRIORITY[b.kind];
  });

  return candidates[0] ?? null;
}
