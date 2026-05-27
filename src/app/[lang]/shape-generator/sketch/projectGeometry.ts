/**
 * projectGeometry.ts — Project 3D edges / vertices / faces onto a
 * 2D sketch plane.
 *
 * SolidWorks "Convert Entities" / Inventor "Project Geometry": pick
 * one or more 3D edges on the part, hit the button, and they appear
 * as construction lines in the active sketch. The projection is
 * **live** — if the source edge moves, the sketch line follows.
 *
 * This module:
 *
 *   - Projects 3D points / edges / face boundaries onto a plane.
 *   - Computes the 2D representation in the plane's local frame.
 *   - Tracks the source-id ↔ projected-entity-id mapping so updates
 *     can rebuild the projection.
 *   - Supports parallel projection (orthographic, default) and
 *     perspective projection (rare in CAD but used for some preview
 *     overlays).
 *
 * Sketch plane convention: defined by a point (origin) and a normal
 * (unit). The plane's u-axis and v-axis follow a default convention
 * (u perpendicular to world Y, then v = normal × u) — caller can
 * override.
 */

export type Vec3 = [number, number, number];

export interface SketchPlane {
  /** Plane origin in world coords (mm). */
  originMm: Vec3;
  /** Plane normal (unit). */
  normal: Vec3;
  /** Optional u-axis (otherwise auto-picked). */
  uAxis?: Vec3;
}

export interface PlaneFrame {
  origin: Vec3;
  normal: Vec3;
  uAxis: Vec3;
  vAxis: Vec3;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface ProjectedVertex {
  /** Source 3D vertex id. */
  sourceId: string;
  /** 2D position in plane local frame (mm). */
  point2D: Point2D;
  /** True if the source was already on the plane (within tolerance). */
  onPlane: boolean;
}

export interface ProjectedEdge {
  sourceId: string;
  /** 2D segments. A curved edge may produce multiple segments. */
  segments2D: Array<{ start: Point2D; end: Point2D }>;
  /** Kind hint: line / arc / spline. */
  edgeKind?: 'line' | 'arc' | 'spline';
}

// ── Frame construction ─────────────────────────────────────────

export function buildFrame(plane: SketchPlane): PlaneFrame {
  const normal = normalize(plane.normal);
  const u = plane.uAxis ? normalize(plane.uAxis) : pickPerpendicular(normal);
  const v = cross(normal, u);
  return { origin: plane.originMm, normal, uAxis: u, vAxis: v };
}

// ── Projection of a single point ───────────────────────────────

export interface ProjectionOptions {
  /** Maximum distance to count a point as "on plane" before projecting. */
  onPlaneToleranceMm: number;
  /** Parallel along plane normal (default) or perspective from a center. */
  projection: 'parallel' | { center: Vec3 };
}

export const DEFAULT_PROJECTION_OPTIONS: ProjectionOptions = {
  onPlaneToleranceMm: 1e-3,
  projection: 'parallel',
};

/** Compute the 2D plane coordinates of a 3D point. */
export function projectPoint(
  point: Vec3,
  frame: PlaneFrame,
  options: Partial<ProjectionOptions> = {},
): { point2D: Point2D; onPlane: boolean; signedDistance: number } {
  const opts = { ...DEFAULT_PROJECTION_OPTIONS, ...options };
  const r: Vec3 = [
    point[0] - frame.origin[0],
    point[1] - frame.origin[1],
    point[2] - frame.origin[2],
  ];
  const signed = r[0] * frame.normal[0] + r[1] * frame.normal[1] + r[2] * frame.normal[2];

  let projected: Vec3;
  if (opts.projection === 'parallel') {
    projected = [
      point[0] - signed * frame.normal[0],
      point[1] - signed * frame.normal[1],
      point[2] - signed * frame.normal[2],
    ];
  } else {
    // Perspective: line from `center` through `point` until it hits the plane.
    const center = opts.projection.center;
    const direction: Vec3 = [point[0] - center[0], point[1] - center[1], point[2] - center[2]];
    const denom = direction[0] * frame.normal[0] + direction[1] * frame.normal[1] + direction[2] * frame.normal[2];
    if (Math.abs(denom) < 1e-9) {
      projected = point;
    } else {
      const num = (frame.origin[0] - center[0]) * frame.normal[0] +
                  (frame.origin[1] - center[1]) * frame.normal[1] +
                  (frame.origin[2] - center[2]) * frame.normal[2];
      const t = num / denom;
      projected = [
        center[0] + direction[0] * t,
        center[1] + direction[1] * t,
        center[2] + direction[2] * t,
      ];
    }
  }
  const localR: Vec3 = [
    projected[0] - frame.origin[0],
    projected[1] - frame.origin[1],
    projected[2] - frame.origin[2],
  ];
  return {
    point2D: {
      x: localR[0] * frame.uAxis[0] + localR[1] * frame.uAxis[1] + localR[2] * frame.uAxis[2],
      y: localR[0] * frame.vAxis[0] + localR[1] * frame.vAxis[1] + localR[2] * frame.vAxis[2],
    },
    onPlane: Math.abs(signed) <= opts.onPlaneToleranceMm,
    signedDistance: signed,
  };
}

// ── Edge projection ─────────────────────────────────────────────

export interface Edge3D {
  id: string;
  /** Sampled points along the edge. */
  points: Vec3[];
  kind?: 'line' | 'arc' | 'spline';
}

export function projectEdge(
  edge: Edge3D,
  frame: PlaneFrame,
  options: Partial<ProjectionOptions> = {},
): ProjectedEdge {
  const opts = { ...DEFAULT_PROJECTION_OPTIONS, ...options };
  const samples2D = edge.points.map(p => projectPoint(p, frame, opts).point2D);
  const segments: Array<{ start: Point2D; end: Point2D }> = [];
  for (let i = 0; i < samples2D.length - 1; i++) {
    segments.push({ start: samples2D[i]!, end: samples2D[i + 1]! });
  }
  return {
    sourceId: edge.id,
    segments2D: segments,
    ...(edge.kind ? { edgeKind: edge.kind } : {}),
  };
}

// ── Face boundary projection ────────────────────────────────────

export interface Face3D {
  id: string;
  /** Outer loop sample points. */
  outerBoundary: Vec3[];
  /** Optional inner loops (holes). */
  innerLoops?: Vec3[][];
}

export function projectFaceBoundary(face: Face3D, frame: PlaneFrame): {
  outer: Point2D[];
  inner: Point2D[][];
} {
  const opts = DEFAULT_PROJECTION_OPTIONS;
  const outer = face.outerBoundary.map(p => projectPoint(p, frame, opts).point2D);
  const inner = (face.innerLoops ?? []).map(loop => loop.map(p => projectPoint(p, frame, opts).point2D));
  return { outer, inner };
}

// ── Source→projection mapping ───────────────────────────────────

export class ProjectionRegistry {
  private vertexMap = new Map<string, ProjectedVertex>();
  private edgeMap = new Map<string, ProjectedEdge>();

  registerVertex(v: ProjectedVertex): void {
    this.vertexMap.set(v.sourceId, v);
  }

  registerEdge(e: ProjectedEdge): void {
    this.edgeMap.set(e.sourceId, e);
  }

  getVertex(sourceId: string): ProjectedVertex | null {
    return this.vertexMap.get(sourceId) ?? null;
  }

  getEdge(sourceId: string): ProjectedEdge | null {
    return this.edgeMap.get(sourceId) ?? null;
  }

  unregisterSource(sourceId: string): void {
    this.vertexMap.delete(sourceId);
    this.edgeMap.delete(sourceId);
  }

  size(): { vertices: number; edges: number } {
    return { vertices: this.vertexMap.size, edges: this.edgeMap.size };
  }

  clear(): void {
    this.vertexMap.clear();
    this.edgeMap.clear();
  }

  list(): { vertices: ProjectedVertex[]; edges: ProjectedEdge[] } {
    return {
      vertices: [...this.vertexMap.values()],
      edges: [...this.edgeMap.values()],
    };
  }
}

// ── 2D bounding box ─────────────────────────────────────────────

export interface BBox2D {
  min: Point2D;
  max: Point2D;
}

export function projectionBoundingBox(edges: ProjectedEdge[]): BBox2D {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const edge of edges) {
    for (const seg of edge.segments2D) {
      for (const pt of [seg.start, seg.end]) {
        if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y; if (pt.y > maxY) maxY = pt.y;
      }
    }
  }
  if (!isFinite(minX)) return { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

// ── Vector helpers ──────────────────────────────────────────────

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function pickPerpendicular(n: Vec3): Vec3 {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  const seed: Vec3 = ax < ay && ax < az ? [1, 0, 0] : ay < az ? [0, 1, 0] : [0, 0, 1];
  const d = n[0] * seed[0] + n[1] * seed[1] + n[2] * seed[2];
  return normalize([seed[0] - d * n[0], seed[1] - d * n[1], seed[2] - d * n[2]]);
}
