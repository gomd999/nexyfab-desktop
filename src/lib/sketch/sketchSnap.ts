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
 *        - arc snaps           → endpoints / center / quadrants / midpoint /
 *                                nearest-point-on-arc (Phase 2)
 *        - perpendicular foot  → cursor → line / circle (Phase 2)
 *        - intersection        → line/line, line/circle, circle/circle (Phase 2)
 *        - grid                → cursor rounded to nearest grid node
 *   2. Filter candidates whose distance exceeds threshold (grid excepted —
 *      grid is unbounded and acts as the always-available fallback).
 *   3. Sort by (distance asc, priority asc) and return the head.
 *
 * Priority (lower = stronger; matters when distances tie):
 *      point < intersection < line_endpoint = arc_endpoint
 *           < line_midpoint < circle_center = arc_center
 *           < grid
 *      (Phase 2 additions: arc_quadrant / arc_midpoint = 3,
 *       arc_nearest = 6, line_perpendicular = circle_perpendicular = 7)
 *
 * Phase 2 implementation notes:
 *   - Arc convention: a planar arc swept counter-clockwise from `start`
 *     vertex to `end` vertex around `center`, on the circle of given
 *     `radius`. The vertex positions are authoritative; the arc's swept
 *     angles are derived as θ_start = atan2(start-center), θ_end =
 *     atan2(end-center). The sweep is the CCW range from θ_start to θ_end
 *     (normalised to [0, 2π)).
 *   - Quadrant snaps: cardinal points at angles 0, π/2, π, 3π/2 around
 *     the center are candidates iff their angle lies within the arc's
 *     swept range.
 *   - Perpendicular foot:
 *       line:   foot = p1 + clamp(t,0,1) · (p2-p1), where
 *                t = ((c-p1)·(p2-p1)) / |p2-p1|²   (c = cursor)
 *               Endpoints/midpoint already cover the special cases, but
 *               this candidate provides the on-line drop for the body.
 *       circle: foot = center + r · normalise(cursor-center)
 *               (closest point on the circumference; ambiguous only when
 *                cursor sits exactly on the center, which we guard).
 *       arc:    same as circle, then accepted iff the foot's angle lies
 *               in the arc's swept range; otherwise the nearer of the
 *               two arc endpoints is taken as `arc_nearest`.
 *   - Line ↔ circle intersection: substitute the line's parametric form
 *     into |P-c|² = r² → quadratic in t. Discriminant Δ < 0 → none,
 *     Δ ≈ 0 → tangent (one root), Δ > 0 → two roots; keep those with
 *     t ∈ [0,1] (on-segment).
 *   - Circle ↔ circle intersection: classical radical-line method —
 *     a = (d² - r₂² + r₁²) / (2d) gives the midpoint along the
 *     center-to-center axis; h = √(r₁² - a²) the perpendicular offset.
 *     Pre-check d > |r₁-r₂| and d < r₁+r₂ (with epsilon for tangent).
 *
 * Cost: arc / perpendicular scans are O(A + L + C). Mixed-intersection
 * scans (LC + CC + AA etc.) are O(L·C + C² + L·A + …). For typical
 * sketches (< 50 entities each) this is well under a microsecond.
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
  | 'intersection'
  // Phase 2 additions ↓
  | 'arc_endpoint'
  | 'arc_center'
  | 'arc_quadrant'
  | 'arc_midpoint'
  | 'arc_nearest'
  | 'line_perpendicular'
  | 'circle_perpendicular';

export interface SnapTarget {
  /** Snap position in sketch coordinates. */
  pos: Vec2;
  kind: SnapKind;
  /**
   * Optional reference to the entity that produced the candidate.
   * - point               → point id
   * - line_endpoint       → line id  (which endpoint is encoded in `pos`)
   * - line_midpoint       → line id
   * - circle_center       → circle id
   * - intersection        → "idA|idB" (sorted lex) for stability
   * - arc_endpoint        → arc id   (which endpoint is encoded in `pos`)
   * - arc_center          → arc id
   * - arc_quadrant        → arc id   (which cardinal is encoded in `pos`)
   * - arc_midpoint        → arc id
   * - arc_nearest         → arc id
   * - line_perpendicular  → line id
   * - circle_perpendicular→ circle id
   * - grid                → undefined
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
  /** When true, line/line, line/circle, circle/circle intersection points are candidates. Default true. */
  enableIntersection?: boolean;
  /** When true, arc endpoints / center / quadrants / midpoint / nearest-on-arc are candidates. Default true. */
  enableArc?: boolean;
  /** When true, perpendicular-foot candidates (line + circle) are emitted. Default true. */
  enablePerpendicular?: boolean;
}

// ─── priority ordering (lower wins ties) ──────────────────────────────────

const PRIORITY: Record<SnapKind, number> = {
  point: 0,
  intersection: 1,
  line_endpoint: 2,
  arc_endpoint: 2,
  line_midpoint: 3,
  arc_quadrant: 3,
  arc_midpoint: 3,
  circle_center: 4,
  arc_center: 4,
  grid: 5,
  arc_nearest: 6,
  line_perpendicular: 7,
  circle_perpendicular: 7,
};

// ─── helpers ──────────────────────────────────────────────────────────────

const TAU = Math.PI * 2;

function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function roundTo(v: number, step: number): number {
  return Math.round(v / step) * step;
}

function normalizeAngle(a: number): number {
  let x = a % TAU;
  if (x < 0) x += TAU;
  return x;
}

/**
 * Is `theta` inside the CCW arc that sweeps from `start` to `end`?
 * All inputs in radians, will be normalised to [0, 2π). An epsilon is
 * applied so points sitting exactly on the boundary are accepted.
 *
 * Full circle (end === start, no degenerate flag) is treated as a
 * non-arc and rejected — callers shouldn't construct such arcs, but
 * we guard rather than report false positives.
 */
function angleInArc(theta: number, start: number, end: number): boolean {
  const eps = 1e-9;
  const t = normalizeAngle(theta);
  const s = normalizeAngle(start);
  const e = normalizeAngle(end);
  // Sweep length CCW from s to e (in [0, 2π); a 0-sweep means "no arc").
  let sweep = e - s;
  if (sweep < 0) sweep += TAU;
  if (sweep < eps) return false;
  let delta = t - s;
  if (delta < 0) delta += TAU;
  return delta <= sweep + eps;
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

/**
 * Intersection of a finite line segment with a circle. Returns 0/1/2
 * points whose segment parameter t lies in [0, 1].
 *
 * Substitute P(t) = p1 + t·d (d = p2-p1) into |P - c|² = r²:
 *   |d|² · t² + 2(d · (p1-c)) · t + (|p1-c|² - r²) = 0
 * Solve the quadratic; discriminant decides 0 / 1-tangent / 2-secant.
 */
function segmentCircleIntersection(
  p1: Vec2, p2: Vec2,
  center: Vec2, radius: number,
): Vec2[] {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const fx = p1.x - center.x;
  const fy = p1.y - center.y;
  const A = dx * dx + dy * dy;
  if (A < 1e-18) return []; // degenerate segment
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - radius * radius;
  const disc = B * B - 4 * A * C;
  if (disc < -1e-9) return [];
  const eps = 1e-9;
  const out: Vec2[] = [];
  if (disc <= 0) {
    // Tangent — single root.
    const t = -B / (2 * A);
    if (t >= -eps && t <= 1 + eps) {
      out.push({ x: p1.x + t * dx, y: p1.y + t * dy });
    }
    return out;
  }
  const s = Math.sqrt(disc);
  const t1 = (-B - s) / (2 * A);
  const t2 = (-B + s) / (2 * A);
  if (t1 >= -eps && t1 <= 1 + eps) {
    out.push({ x: p1.x + t1 * dx, y: p1.y + t1 * dy });
  }
  if (t2 >= -eps && t2 <= 1 + eps) {
    out.push({ x: p1.x + t2 * dx, y: p1.y + t2 * dy });
  }
  return out;
}

/**
 * Intersection of two circles via the radical-line method.
 *
 * Let d = |c2 - c1|. The two intersections sit symmetric about the
 * point P0 = c1 + a·(c2-c1)/d, where a = (d² + r1² - r2²)/(2d).
 * The perpendicular offset is h = √(r1² - a²).
 *
 * Edge cases:
 *   - d > r1+r2  → circles disjoint, 0 points.
 *   - d < |r1-r2| → one contains the other, 0 points.
 *   - d ≈ r1+r2 → external tangent, 1 point.
 *   - d ≈ |r1-r2| → internal tangent, 1 point.
 *   - d ≈ 0 with r1 ≈ r2 → coincident; we return [] (ill-defined).
 */
function circleCircleIntersection(
  c1: Vec2, r1: number,
  c2: Vec2, r2: number,
): Vec2[] {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const d2 = dx * dx + dy * dy;
  const d = Math.sqrt(d2);
  const eps = 1e-9;
  if (d < eps) return []; // concentric (incl. coincident)
  const sum = r1 + r2;
  const diff = Math.abs(r1 - r2);
  if (d > sum + eps) return [];
  if (d < diff - eps) return [];
  const a = (d2 + r1 * r1 - r2 * r2) / (2 * d);
  const h2 = r1 * r1 - a * a;
  const h = h2 > 0 ? Math.sqrt(h2) : 0;
  const px = c1.x + (a * dx) / d;
  const py = c1.y + (a * dy) / d;
  if (h < eps) {
    // Tangent — single point.
    return [{ x: px, y: py }];
  }
  const rx = (-dy * h) / d;
  const ry = (dx * h) / d;
  return [
    { x: px + rx, y: py + ry },
    { x: px - rx, y: py - ry },
  ];
}

/**
 * Perpendicular foot of `cursor` onto the segment p1-p2.
 *
 *   t = (cursor - p1) · (p2 - p1) / |p2 - p1|²
 *
 * t is clamped to [0,1] so the result always lies on the segment. The
 * endpoints (t=0/t=1) are also covered by the endpoint candidates; the
 * line_perpendicular candidate matters for the segment body where the
 * cursor's nearest line point is interior.
 */
function lineFoot(cursor: Vec2, p1: Vec2, p2: Vec2): Vec2 {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) return { x: p1.x, y: p1.y };
  let t = ((cursor.x - p1.x) * dx + (cursor.y - p1.y) * dy) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return { x: p1.x + t * dx, y: p1.y + t * dy };
}

/**
 * Nearest point on the full circle (closest circumference point).
 *
 *   foot = center + r · (cursor - center) / |cursor - center|
 *
 * Returns null when the cursor is exactly at the center (ambiguous).
 */
function circleFoot(cursor: Vec2, center: Vec2, radius: number): Vec2 | null {
  const dx = cursor.x - center.x;
  const dy = cursor.y - center.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-12) return null;
  const k = radius / len;
  return { x: center.x + dx * k, y: center.y + dy * k };
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
 *   - point / endpoint / midpoint / center scan is O(P + L + C + A).
 *   - intersection scans:
 *       line/line      O(L²)
 *       line/circle    O(L·C)
 *       circle/circle  O(C²)
 *     Each quadratic / radical-line solve is O(1) — a couple dozen FLOPs.
 *     For typical sketches (< 50 entities) this is negligible; larger
 *     sketches should consider a spatial index or early-out once a
 *     near-zero distance candidate is found.
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
  const enableArc = opts.enableArc ?? true;
  const enablePerpendicular = opts.enablePerpendicular ?? true;

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

  // ----- arc snap (Phase 2) -----
  if (enableArc) {
    for (const a of entities.arcs ?? []) {
      // endpoint: start
      const dS = dist(cursorPos, a.start);
      if (dS <= threshold) {
        candidates.push({
          pos: { x: a.start.x, y: a.start.y },
          kind: 'arc_endpoint',
          refId: a.id,
          distance: dS,
        });
      }
      // endpoint: end
      const dE = dist(cursorPos, a.end);
      if (dE <= threshold) {
        candidates.push({
          pos: { x: a.end.x, y: a.end.y },
          kind: 'arc_endpoint',
          refId: a.id,
          distance: dE,
        });
      }
      // center
      const dC = dist(cursorPos, a.center);
      if (dC <= threshold) {
        candidates.push({
          pos: { x: a.center.x, y: a.center.y },
          kind: 'arc_center',
          refId: a.id,
          distance: dC,
        });
      }
      // quadrants — only the cardinal points within the arc's swept range.
      const thetaStart = Math.atan2(a.start.y - a.center.y, a.start.x - a.center.x);
      const thetaEnd = Math.atan2(a.end.y - a.center.y, a.end.x - a.center.x);
      for (const q of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
        if (!angleInArc(q, thetaStart, thetaEnd)) continue;
        const qp: Vec2 = {
          x: a.center.x + a.radius * Math.cos(q),
          y: a.center.y + a.radius * Math.sin(q),
        };
        const dq = dist(cursorPos, qp);
        if (dq <= threshold) {
          candidates.push({
            pos: qp,
            kind: 'arc_quadrant',
            refId: a.id,
            distance: dq,
          });
        }
      }
      // midpoint of the arc (CCW middle).
      let sweep = normalizeAngle(thetaEnd) - normalizeAngle(thetaStart);
      if (sweep < 0) sweep += TAU;
      const thetaMid = normalizeAngle(thetaStart) + sweep / 2;
      const midPt: Vec2 = {
        x: a.center.x + a.radius * Math.cos(thetaMid),
        y: a.center.y + a.radius * Math.sin(thetaMid),
      };
      const dMid = dist(cursorPos, midPt);
      if (dMid <= threshold) {
        candidates.push({
          pos: midPt,
          kind: 'arc_midpoint',
          refId: a.id,
          distance: dMid,
        });
      }
      // nearest-on-arc: project cursor onto the circle; if the projection
      // falls outside the arc range, take whichever endpoint is closer.
      const foot = circleFoot(cursorPos, a.center, a.radius);
      if (foot) {
        const thetaFoot = Math.atan2(foot.y - a.center.y, foot.x - a.center.x);
        let near: Vec2;
        if (angleInArc(thetaFoot, thetaStart, thetaEnd)) {
          near = foot;
        } else {
          near = dS <= dE ? { x: a.start.x, y: a.start.y } : { x: a.end.x, y: a.end.y };
        }
        const dN = dist(cursorPos, near);
        if (dN <= threshold) {
          candidates.push({
            pos: near,
            kind: 'arc_nearest',
            refId: a.id,
            distance: dN,
          });
        }
      }
    }
  }

  // ----- perpendicular foot (Phase 2) -----
  if (enablePerpendicular) {
    for (const l of entities.lines ?? []) {
      const foot = lineFoot(cursorPos, l.p1, l.p2);
      const d = dist(cursorPos, foot);
      if (d <= threshold) {
        candidates.push({
          pos: foot,
          kind: 'line_perpendicular',
          refId: l.id,
          distance: d,
        });
      }
    }
    for (const c of entities.circles ?? []) {
      const foot = circleFoot(cursorPos, c.center, c.radius);
      if (!foot) continue;
      const d = dist(cursorPos, foot);
      if (d <= threshold) {
        candidates.push({
          pos: foot,
          kind: 'circle_perpendicular',
          refId: c.id,
          distance: d,
        });
      }
    }
  }

  // ----- intersection snap (line/line, line/circle, circle/circle) -----
  if (enableIntersection) {
    const lines = entities.lines ?? [];
    const circles = entities.circles ?? [];
    // line/line
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
    // line/circle
    for (const l of lines) {
      for (const c of circles) {
        const pts = segmentCircleIntersection(l.p1, l.p2, c.center, c.radius);
        for (const ip of pts) {
          const d = dist(cursorPos, ip);
          if (d <= threshold) {
            candidates.push({
              pos: ip,
              kind: 'intersection',
              refId: pairKey(l.id, c.id),
              distance: d,
            });
          }
        }
      }
    }
    // circle/circle
    for (let i = 0; i < circles.length; i++) {
      const a = circles[i]!;
      for (let j = i + 1; j < circles.length; j++) {
        const b = circles[j]!;
        const pts = circleCircleIntersection(a.center, a.radius, b.center, b.radius);
        for (const ip of pts) {
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
