/**
 * projectView — orthographic projection of a polyhedron to a 2D drawing view
 * with hidden-line removal (HLR). Pure TS, no OCCT.
 *
 * Phase 4.1.2 of NexyFab Pro own-CAD (ADR-013). Consumes the polyhedron from
 * lib/cad/featureMesh and produces the visible (solid) + hidden (dashed) edge
 * segments that SheetRenderer draws inside a viewport — replacing the
 * placeholder boxes.
 *
 * HLR algorithm (correct for planar-faced solids, convex or non-convex):
 *   1. Build an orthonormal screen basis (right, up, viewDir) per view.
 *   2. Project every vertex: (u, v) = (·right, ·up); depth = ·viewDir
 *      (larger depth = farther from the camera).
 *   3. Classify each edge from its adjacent faces' front/back facing:
 *      - both adjacent faces back-facing → hidden,
 *      - otherwise (silhouette / ≥1 front face / boundary) → candidate visible.
 *   4. Occlusion: a candidate-visible edge is demoted to hidden if its 2D
 *      midpoint lies inside the 2D projection of some non-adjacent front face
 *      whose plane is strictly nearer at that point (exact plane-depth solve).
 */

import type { Vec3 } from '@/lib/sketch/sketchPlane';
import { sub, cross, dot, lengthOf, scale } from '@/lib/sketch/sketchPlane';
import type { Polyhedron } from '@/lib/cad/featureMesh';
import { polyhedronEdges } from '@/lib/cad/featureMesh';

// ─── types ───────────────────────────────────────────────────────────────

export type ProjectionView =
  | 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right' | 'iso';

export interface Segment2D {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ProjectedView {
  visible: Segment2D[];
  hidden: Segment2D[];
  /**
   * Smooth (tangent) edges — the boundary between two faces that meet below
   * the sharp-edge dihedral threshold (e.g. a fillet blending into a flat
   * wall). These are suppressed from `visible`/`hidden` for a clean drawing,
   * but emitted here so the UI can optionally show them as thin phantom
   * lines (a standard CAD "tangent edges" toggle). Front-facing only.
   */
  tangent: Segment2D[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface Basis {
  right: Vec3;
  up: Vec3;
  /** Direction the camera looks (into the scene). */
  viewDir: Vec3;
}

const EPS = 1e-7;
/**
 * Edges between two like-facing faces that meet at a dihedral shallower than
 * this are treated as smooth tessellation artifacts and suppressed (a faceted
 * cylinder then reads as a clean silhouette, not N facet lines). cos(25°).
 * Sharp feature edges (e.g. a prism's 90° corners) are well above this and
 * always drawn; silhouette edges (front-vs-back) are always drawn regardless.
 */
const SMOOTH_DIHEDRAL_COS = Math.cos((25 * Math.PI) / 180);

// ─── view bases ──────────────────────────────────────────────────────────

function normalize(v: Vec3): Vec3 {
  const l = lengthOf(v);
  return l < 1e-12 ? { x: 0, y: 0, z: 0 } : scale(v, 1 / l);
}

/** Build an orthonormal (right, up, viewDir) basis for a standard view.
 *  Exported for `measure.ts` (W3-C) so dimension measurement projects with
 *  EXACTLY the same basis the drawn view uses — no second projection scheme. */
export function viewBasis(view: ProjectionView): Basis {
  // viewDir points INTO the scene; toCamera = -viewDir. right × up = toCamera.
  const make = (viewDir: Vec3, up: Vec3): Basis => {
    const vd = normalize(viewDir);
    const toCam = scale(vd, -1);
    // Re-orthogonalize up against the view direction.
    const u0 = sub(up, scale(vd, dot(up, vd)));
    const u = normalize(lengthOf(u0) < 1e-9 ? { x: 0, y: 0, z: 1 } : u0);
    const right = normalize(cross(u, toCam));
    return { right, up: u, viewDir: vd };
  };
  switch (view) {
    case 'front':  return make({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 });
    case 'back':   return make({ x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 });
    case 'top':    return make({ x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
    case 'bottom': return make({ x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 0 });
    case 'right':  return make({ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    case 'left':   return make({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    case 'iso':
    default:
      return make({ x: -1, y: -1, z: -1 }, { x: 0, y: 0, z: 1 });
  }
}

// ─── projection ────────────────────────────────────────────────────────────

interface Projected {
  uv: { x: number; y: number }[]; // per vertex
  depth: number[]; // per vertex (along viewDir)
}

function projectVertices(poly: Polyhedron, basis: Basis): Projected {
  const uv: { x: number; y: number }[] = [];
  const depth: number[] = [];
  for (const v of poly.vertices) {
    uv.push({ x: dot(v, basis.right), y: dot(v, basis.up) });
    depth.push(dot(v, basis.viewDir));
  }
  return { uv, depth };
}

function frontFacing(normal: Vec3, viewDir: Vec3): boolean {
  return dot(normal, viewDir) < -EPS;
}

/** Point-in-polygon (2D, ray casting) for a face's projected loop. */
function pointInPolygon(px: number, py: number, loop: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const xi = loop[i].x, yi = loop[i].y;
    const xj = loop[j].x, yj = loop[j].y;
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi + (yj === yi ? 1e-30 : 0)) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Exact depth of a face's plane at screen point (u, v): solve for t in
 * X = u·right + v·up + t·viewDir lying on the plane through p0 with normal n.
 * Returns null when the face is edge-on (no well-defined depth).
 */
function planeDepthAt(
  u: number,
  v: number,
  faceNormal: Vec3,
  facePoint: Vec3,
  basis: Basis,
): number | null {
  const denom = dot(faceNormal, basis.viewDir);
  if (Math.abs(denom) < EPS) return null;
  const nP0 = dot(faceNormal, facePoint);
  const nR = dot(faceNormal, basis.right);
  const nU = dot(faceNormal, basis.up);
  return (nP0 - u * nR - v * nU) / denom;
}

// ─── public API ──────────────────────────────────────────────────────────

/**
 * Project a polyhedron to a 2D view, returning visible + hidden edge segments
 * in view-plane coordinates (mm). The caller scales/positions these into a
 * viewport box.
 */
export function projectPolyhedron(poly: Polyhedron, view: ProjectionView): ProjectedView {
  const basis = viewBasis(view);
  const { uv, depth } = projectVertices(poly, basis);
  const faceFront = poly.faces.map((f) => frontFacing(f.normal, basis.viewDir));
  // Pre-project face loops (for occlusion tests) once.
  const faceLoops = poly.faces.map((f) => f.vertices.map((vi) => uv[vi]));
  const edges = polyhedronEdges(poly);

  const visible: Segment2D[] = [];
  const hidden: Segment2D[] = [];
  const tangent: Segment2D[] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const e of edges) {
    const a = uv[e.a];
    const b = uv[e.b];
    minX = Math.min(minX, a.x, b.x); maxX = Math.max(maxX, a.x, b.x);
    minY = Math.min(minY, a.y, b.y); maxY = Math.max(maxY, a.y, b.y);

    // Suppress smooth interior tessellation edges (keep silhouettes + sharp).
    if (e.faces.length === 2) {
      const [f0, f1] = e.faces;
      const silhouette = faceFront[f0] !== faceFront[f1];
      if (!silhouette && dot(poly.faces[f0].normal, poly.faces[f1].normal) > SMOOTH_DIHEDRAL_COS) {
        // Smooth/tangent edge — dropped from the main line work, but emitted
        // to `tangent` when on the visible side so the UI can show it as a
        // thin phantom line. (Occlusion is approximated by the front-face
        // test; back-side tangent edges are dropped to avoid clutter.)
        if (faceFront[f0] || faceFront[f1]) {
          tangent.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
        }
        continue;
      }
    }

    const anyFront = e.faces.some((fi) => faceFront[fi]);
    let isVisible = anyFront; // both-back edges are hidden

    // Occlusion: demote a candidate-visible edge if a nearer non-adjacent
    // front face covers its midpoint.
    if (isVisible) {
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const edgeDepth = (depth[e.a] + depth[e.b]) / 2;
      for (let fi = 0; fi < poly.faces.length; fi++) {
        if (!faceFront[fi] || e.faces.includes(fi)) continue;
        if (!pointInPolygon(mx, my, faceLoops[fi])) continue;
        const fd = planeDepthAt(mx, my, poly.faces[fi].normal, poly.vertices[poly.faces[fi].vertices[0]], basis);
        if (fd !== null && fd < edgeDepth - EPS) {
          isVisible = false;
          break;
        }
      }
    }

    const seg: Segment2D = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    if (isVisible) visible.push(seg);
    else hidden.push(seg);
  }

  if (!Number.isFinite(minX)) {
    minX = minY = maxX = maxY = 0;
  }
  return { visible, hidden, tangent, bbox: { minX, minY, maxX, maxY } };
}

// ─── view operations (W4-C: detail + broken views) ───────────────────────
// Pure segment-level operations on a projected view's line work, in the same
// view-plane mm frame `projectPolyhedron` emits. No fabrication: both clip
// EXACTLY (line/circle and line/band intersections solved analytically);
// nothing is approximated or resampled.

/**
 * Clip segments to the inside of a circle (a detail view's magnifier region).
 * Segments fully outside are dropped; crossing segments are cut at the exact
 * line–circle intersection parameters. Throws on a non-positive radius.
 */
export function clipSegmentsToCircle(
  segments: ReadonlyArray<Segment2D>,
  center: { x: number; y: number },
  radius: number,
): Segment2D[] {
  if (!(radius > 0) || !Number.isFinite(radius)) {
    throw new Error(`clipSegmentsToCircle: radius must be positive (got ${radius})`);
  }
  const out: Segment2D[] = [];
  for (const s of segments) {
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    const fx = s.x1 - center.x;
    const fy = s.y1 - center.y;
    // |f + t·d|² = r²  →  (d·d)t² + 2(f·d)t + (f·f − r²) = 0
    const a = dx * dx + dy * dy;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - radius * radius;
    let t0 = 0;
    let t1 = 1;
    if (a < 1e-18) {
      // Degenerate (point) segment: keep iff inside.
      if (c <= 0) out.push({ ...s });
      continue;
    }
    const disc = b * b - 4 * a * c;
    if (disc < 0) {
      // No intersection: fully inside (c<0) or fully outside (c>0).
      if (c <= 0) out.push({ ...s });
      continue;
    }
    const sq = Math.sqrt(disc);
    const tA = (-b - sq) / (2 * a);
    const tB = (-b + sq) / (2 * a);
    t0 = Math.max(0, tA);
    t1 = Math.min(1, tB);
    if (t1 <= t0) continue; // inside-circle interval misses [0,1]
    out.push({
      x1: s.x1 + t0 * dx,
      y1: s.y1 + t0 * dy,
      x2: s.x1 + t1 * dx,
      y2: s.y1 + t1 * dy,
    });
  }
  return out;
}

export interface ViewBreakOptions {
  /** Break axis in the view plane: 'x' removes a vertical band, 'y' a horizontal one. */
  axis: 'x' | 'y';
  /** Removed band [breakStart, breakEnd] in view-plane mm (breakEnd > breakStart). */
  breakStart: number;
  breakEnd: number;
  /** Visual gap left between the two halves after collapsing, in view-plane mm. */
  gap: number;
}

export interface BrokenView {
  segments: Segment2D[];
  /** Post-collapse axis positions of the two break edges (near, far). */
  nearBreakAt: number;
  farBreakAt: number;
  /** How far the far side moved toward the near side ((band width) − gap). */
  shift: number;
}

/**
 * Apply a broken-view collapse to projected segments: everything inside the
 * band is removed, everything past `breakEnd` slides toward the near side so
 * the band collapses to `gap`. Crossing segments are cut exactly at the band
 * edges. Throws (explicit refusal, no guessing) when the band is empty or the
 * gap is not smaller than the band — a "break" that removes nothing is a lie.
 */
export function applyViewBreak(
  segments: ReadonlyArray<Segment2D>,
  opts: ViewBreakOptions,
): BrokenView {
  const { axis, breakStart, breakEnd, gap } = opts;
  if (!(breakEnd > breakStart)) {
    throw new Error(`applyViewBreak: breakEnd (${breakEnd}) must exceed breakStart (${breakStart})`);
  }
  if (!(gap > 0) || !(gap < breakEnd - breakStart)) {
    throw new Error(
      `applyViewBreak: gap (${gap}) must be positive and smaller than the band (${breakEnd - breakStart})`,
    );
  }
  const shift = breakEnd - breakStart - gap;
  const coord = (x: number, y: number): number => (axis === 'x' ? x : y);
  const out: Segment2D[] = [];

  /** Emit the sub-segment of s over parameter interval [t0, t1], displaced by d along the axis. */
  const emit = (s: Segment2D, t0: number, t1: number, d: number): void => {
    if (!(t1 > t0)) return;
    const px = (t: number): number => s.x1 + t * (s.x2 - s.x1);
    const py = (t: number): number => s.y1 + t * (s.y2 - s.y1);
    const ox = axis === 'x' ? -d : 0;
    const oy = axis === 'y' ? -d : 0;
    out.push({ x1: px(t0) + ox, y1: py(t0) + oy, x2: px(t1) + ox, y2: py(t1) + oy });
  };

  for (const s of segments) {
    const a1 = coord(s.x1, s.y1);
    const a2 = coord(s.x2, s.y2);
    const da = a2 - a1;
    /** Parameter where the segment crosses axis value v (assumes da ≠ 0). */
    const tAt = (v: number): number => (v - a1) / da;
    if (Math.abs(da) < 1e-18) {
      // Axis-constant segment: entirely in one region.
      if (a1 <= breakStart) emit(s, 0, 1, 0);
      else if (a1 >= breakEnd) emit(s, 0, 1, shift);
      continue; // inside the band → removed
    }
    const lo = Math.min(a1, a2);
    const hi = Math.max(a1, a2);
    // Near-side piece (axis ≤ breakStart), kept in place.
    if (lo < breakStart) {
      const tS = hi > breakStart ? tAt(breakStart) : (a1 < a2 ? 1 : 0);
      if (a1 < a2) emit(s, 0, Math.min(1, tS), 0);
      else emit(s, Math.max(0, tS), 1, 0);
    }
    // Far-side piece (axis ≥ breakEnd), shifted toward the near side.
    if (hi > breakEnd) {
      const tE = lo < breakEnd ? tAt(breakEnd) : (a1 > a2 ? 1 : 0);
      if (a1 < a2) emit(s, Math.max(0, tE), 1, shift);
      else emit(s, 0, Math.min(1, tE), shift);
    }
  }
  return { segments: out, nearBreakAt: breakStart, farBreakAt: breakStart + gap, shift };
}
