/**
 * imprintByPlane.ts — Imprint a 3D plane onto a triangle mesh, producing
 * the resulting edge polylines (planar slice curves).
 *
 * "Imprint" in CAD slang means: take a part and an auxiliary geometry
 * (here, a plane), and split the part's faces along the intersection
 * so the part now carries the intersection as new edges. It is the
 * core of many manufacturing prep steps:
 *
 *   - Parting line preview before mold split.
 *   - Spline of constant Z (for CAM stepover).
 *   - Defining a region for paint mask / decal.
 *
 * Algorithm (per triangle):
 *
 *   1. Compute signed plane-distance for each of the three vertices.
 *   2. Three cases:
 *        - All same sign → triangle is on one side, skip.
 *        - Two on one side, one on the other → exactly one
 *          intersection segment (linear interp on the two crossing edges).
 *        - One vertex exactly on the plane (distance ≈ 0) and the
 *          other two on opposite sides → segment from the vertex to
 *          the other edge crossing.
 *   3. Collect all segments, then chain them into ordered polylines
 *      by connecting endpoints that coincide within EPS.
 */

export interface Plane {
  /** Point on the plane. */
  origin: [number, number, number];
  /** Unit normal. */
  normal: [number, number, number];
}

export interface MeshArrays {
  positions: number[];
  indices: number[];
}

export interface ImprintSegment {
  /** Two endpoints of the segment. */
  a: [number, number, number];
  b: [number, number, number];
  /** Source triangle id. */
  triangleId: number;
}

export interface ImprintPolyline {
  /** Ordered point chain. */
  points: Array<[number, number, number]>;
  /** Closed loop? */
  closed: boolean;
}

export interface ImprintResult {
  /** Raw per-triangle segments. */
  segments: ImprintSegment[];
  /** Chained polylines (one per connected slice loop). */
  polylines: ImprintPolyline[];
  /** Count of skipped triangles (no intersection). */
  skippedTriangles: number;
}

// ── Top-level entry ─────────────────────────────────────────────

const EPS = 1e-6;

export function imprintByPlane(mesh: MeshArrays, plane: Plane): ImprintResult {
  const segments: ImprintSegment[] = [];
  let skipped = 0;
  const triangleCount = mesh.indices.length / 3;
  const n = normalizeVec3(plane.normal);
  const planeD = -dot(n, plane.origin);

  for (let t = 0; t < triangleCount; t++) {
    const i0 = mesh.indices[t * 3]!;
    const i1 = mesh.indices[t * 3 + 1]!;
    const i2 = mesh.indices[t * 3 + 2]!;
    const p0 = vertex(mesh, i0);
    const p1 = vertex(mesh, i1);
    const p2 = vertex(mesh, i2);
    const seg = intersectTriangle(p0, p1, p2, n, planeD, t);
    if (seg) segments.push(seg);
    else skipped++;
  }

  const polylines = chainSegments(segments);
  return { segments, polylines, skippedTriangles: skipped };
}

// ── Triangle-plane intersection ────────────────────────────────

export function intersectTriangle(
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  n: [number, number, number],
  planeD: number,
  triangleId: number,
): ImprintSegment | null {
  const d0 = dot(n, p0) + planeD;
  const d1 = dot(n, p1) + planeD;
  const d2 = dot(n, p2) + planeD;

  const s0 = Math.sign(d0);
  const s1 = Math.sign(d1);
  const s2 = Math.sign(d2);

  // All same sign and non-zero → no intersection.
  if (Math.abs(d0) < EPS && Math.abs(d1) < EPS && Math.abs(d2) < EPS) {
    return null;
  }
  if (s0 === s1 && s1 === s2 && s0 !== 0) return null;

  const crossings: Array<[number, number, number]> = [];
  addEdgeCrossing(p0, p1, d0, d1, crossings);
  addEdgeCrossing(p1, p2, d1, d2, crossings);
  addEdgeCrossing(p2, p0, d2, d0, crossings);

  if (crossings.length < 2) return null;
  // Deduplicate (vertex on plane can produce duplicate crossings).
  const a = crossings[0]!;
  let b = crossings[1]!;
  if (vec3Eq(a, b) && crossings.length >= 3) b = crossings[2]!;
  if (vec3Eq(a, b)) return null;
  return { a, b, triangleId };
}

function addEdgeCrossing(
  p: [number, number, number],
  q: [number, number, number],
  dp: number,
  dq: number,
  out: Array<[number, number, number]>,
): void {
  if (Math.abs(dp) < EPS) {
    out.push([p[0], p[1], p[2]]);
    return;
  }
  if (Math.abs(dq) < EPS) {
    out.push([q[0], q[1], q[2]]);
    return;
  }
  if (dp * dq < 0) {
    const t = dp / (dp - dq);
    out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
  }
}

// ── Chain segments into polylines ──────────────────────────────

export function chainSegments(segments: ImprintSegment[]): ImprintPolyline[] {
  const used = new Set<number>();
  const polylines: ImprintPolyline[] = [];

  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const seg = segments[i]!;
    const points: Array<[number, number, number]> = [seg.a, seg.b];

    // Extend forward.
    extendChain(points, segments, used, true);
    // Extend backward.
    extendChain(points, segments, used, false);

    const closed = vec3Eq(points[0]!, points[points.length - 1]!) && points.length > 2;
    polylines.push({ points, closed });
  }
  return polylines;
}

function extendChain(
  points: Array<[number, number, number]>,
  segments: ImprintSegment[],
  used: Set<number>,
  forward: boolean,
): void {
  let changed = true;
  while (changed) {
    changed = false;
    const endpoint = forward ? points[points.length - 1]! : points[0]!;
    for (let i = 0; i < segments.length; i++) {
      if (used.has(i)) continue;
      const seg = segments[i]!;
      if (vec3Eq(seg.a, endpoint)) {
        used.add(i);
        if (forward) points.push(seg.b);
        else points.unshift(seg.b);
        changed = true;
        break;
      } else if (vec3Eq(seg.b, endpoint)) {
        used.add(i);
        if (forward) points.push(seg.a);
        else points.unshift(seg.a);
        changed = true;
        break;
      }
    }
  }
}

// ── Vector helpers ─────────────────────────────────────────────

function vertex(mesh: MeshArrays, i: number): [number, number, number] {
  return [mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!];
}

function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalizeVec3(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < EPS) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function vec3Eq(a: [number, number, number], b: [number, number, number]): boolean {
  return Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS && Math.abs(a[2] - b[2]) < EPS;
}

// ── Polyline statistics ───────────────────────────────────────

export interface PolylineStats {
  pointCount: number;
  totalLength: number;
  closed: boolean;
}

export function polylineStats(poly: ImprintPolyline): PolylineStats {
  let total = 0;
  for (let i = 1; i < poly.points.length; i++) {
    const a = poly.points[i - 1]!;
    const b = poly.points[i]!;
    total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return { pointCount: poly.points.length, totalLength: total, closed: poly.closed };
}

export interface ImprintSummary {
  segmentCount: number;
  polylineCount: number;
  closedLoopCount: number;
  totalCutLength: number;
  trianglesIntersected: number;
  trianglesSkipped: number;
}

export function summarize(result: ImprintResult): ImprintSummary {
  let totalCut = 0;
  let closedCount = 0;
  for (const p of result.polylines) {
    const s = polylineStats(p);
    totalCut += s.totalLength;
    if (s.closed) closedCount++;
  }
  return {
    segmentCount: result.segments.length,
    polylineCount: result.polylines.length,
    closedLoopCount: closedCount,
    totalCutLength: totalCut,
    trianglesIntersected: result.segments.length,
    trianglesSkipped: result.skippedTriangles,
  };
}
