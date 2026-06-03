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
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

interface Basis {
  right: Vec3;
  up: Vec3;
  /** Direction the camera looks (into the scene). */
  viewDir: Vec3;
}

const EPS = 1e-7;

// ─── view bases ──────────────────────────────────────────────────────────

function normalize(v: Vec3): Vec3 {
  const l = lengthOf(v);
  return l < 1e-12 ? { x: 0, y: 0, z: 0 } : scale(v, 1 / l);
}

/** Build an orthonormal (right, up, viewDir) basis for a standard view. */
function viewBasis(view: ProjectionView): Basis {
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
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const e of edges) {
    const a = uv[e.a];
    const b = uv[e.b];
    minX = Math.min(minX, a.x, b.x); maxX = Math.max(maxX, a.x, b.x);
    minY = Math.min(minY, a.y, b.y); maxY = Math.max(maxY, a.y, b.y);

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
  return { visible, hidden, bbox: { minX, minY, maxX, maxY } };
}
