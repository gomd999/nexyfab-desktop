/**
 * planarSliceAndCap.ts — Slice a triangle mesh with a plane and
 * cap the open boundary with triangulated faces.
 *
 * Mesh boolean libraries (BVH-CSG, OCCT) are heavy. For *preview*
 * sectioning the user just needs:
 *
 *   1. Discard triangles on one side of a plane.
 *   2. Split straddling triangles, keeping only the kept-side piece.
 *   3. Triangulate the open boundary (a closed polyline on the
 *      cutting plane) with a fan around its centroid → "cap".
 *
 * This module does that. It's geometric only (no topology/B-rep);
 * good enough for section views, "shrink-wrap" stops, and
 * additive-manufacturing flat-bottom previews.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface MeshArrays {
  positions: number[];
  indices: number[];
}

export interface Plane {
  /** Point on the plane. */
  origin: Vec3;
  /** Unit normal — kept side is the positive half-space. */
  normal: Vec3;
}

export interface SliceResult {
  /** Mesh after slicing (with cap). */
  mesh: MeshArrays;
  /** Triangles entirely discarded. */
  discardedTriangleCount: number;
  /** Triangles split. */
  splitTriangleCount: number;
  /** Cap triangles added. */
  capTriangleCount: number;
  /** Length of the cap boundary polyline. */
  capPerimeterMm: number;
}

export interface SliceOptions {
  /** Keep triangles in the positive half-space. */
  keepPositive: boolean;
  /** Add a triangulated cap on the cut. */
  capCut: boolean;
}

export const DEFAULT_OPTIONS: SliceOptions = {
  keepPositive: true,
  capCut: true,
};

// ── Top-level entry ────────────────────────────────────────────

export function sliceAndCap(mesh: MeshArrays, plane: Plane, options: Partial<SliceOptions> = {}): SliceResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (mesh.indices.length === 0) {
    return { mesh: { positions: [], indices: [] }, discardedTriangleCount: 0, splitTriangleCount: 0, capTriangleCount: 0, capPerimeterMm: 0 };
  }
  const newPositions: number[] = [];
  const newIndices: number[] = [];
  const boundarySegments: Array<{ a: Vec3; b: Vec3 }> = [];

  const sign = opts.keepPositive ? 1 : -1;
  const normal = normalize(plane.normal);
  const planeD = -dot(normal, plane.origin);

  let discarded = 0;
  let split = 0;

  // Map old → new vertex index when we copy a vertex unchanged.
  const vertMap = new Map<number, number>();
  function copyVertex(oldIdx: number): number {
    const existing = vertMap.get(oldIdx);
    if (existing !== undefined) return existing;
    const ni = newPositions.length / 3;
    newPositions.push(
      mesh.positions[oldIdx * 3]!,
      mesh.positions[oldIdx * 3 + 1]!,
      mesh.positions[oldIdx * 3 + 2]!,
    );
    vertMap.set(oldIdx, ni);
    return ni;
  }

  function addCutVertex(p: Vec3): number {
    const ni = newPositions.length / 3;
    newPositions.push(p.x, p.y, p.z);
    return ni;
  }

  const triCount = mesh.indices.length / 3;
  for (let t = 0; t < triCount; t++) {
    const i0 = mesh.indices[t * 3]!;
    const i1 = mesh.indices[t * 3 + 1]!;
    const i2 = mesh.indices[t * 3 + 2]!;
    const p = [vertex(mesh, i0), vertex(mesh, i1), vertex(mesh, i2)] as const;
    const d = p.map(v => (dot(normal, v) + planeD) * sign);

    const insides = d.map(x => x >= 0);
    const insideCount = insides.filter(Boolean).length;

    if (insideCount === 0) {
      discarded++;
      continue;
    }
    if (insideCount === 3) {
      newIndices.push(copyVertex(i0), copyVertex(i1), copyVertex(i2));
      continue;
    }

    split++;
    // Find which vertex is on the "alone" side.
    const aloneSide = insideCount === 1; // one inside, two outside
    // Index of the lone vertex relative to triangle.
    const lone = insides.findIndex(x => x === aloneSide);
    const others = [0, 1, 2].filter(x => x !== lone) as [number, number];
    const loneIdx = [i0, i1, i2][lone]!;
    const otherIdx = [others[0], others[1]].map(k => [i0, i1, i2][k]!) as [number, number];
    const lp = p[lone]!;
    const op = [p[others[0]]!, p[others[1]]!];
    const ld = d[lone]!;
    const od = [d[others[0]]!, d[others[1]]!];

    // Intersection points of lone→other1 and lone→other2 with the plane.
    const t1 = ld / (ld - od[0]!);
    const t2 = ld / (ld - od[1]!);
    const cut1: Vec3 = lerpVec(lp, op[0]!, t1);
    const cut2: Vec3 = lerpVec(lp, op[1]!, t2);
    boundarySegments.push({ a: cut1, b: cut2 });

    if (aloneSide) {
      // Lone is inside; keep triangle (lone, cut1, cut2).
      newIndices.push(copyVertex(loneIdx), addCutVertex(cut1), addCutVertex(cut2));
    } else {
      // Two others are inside; keep quad (cut1, other0, other1, cut2) split as 2 triangles.
      const c1 = addCutVertex(cut1);
      const c2 = addCutVertex(cut2);
      const o0 = copyVertex(otherIdx[0]!);
      const o1 = copyVertex(otherIdx[1]!);
      newIndices.push(c1, o0, o1);
      newIndices.push(c1, o1, c2);
    }
  }

  // Cap.
  let capTriangles = 0;
  let capPerimeter = 0;
  if (opts.capCut && boundarySegments.length > 0) {
    const polylines = chainBoundary(boundarySegments);
    for (const loop of polylines) {
      capPerimeter += polylineLength(loop);
      if (loop.length < 3) continue;
      // Fan around centroid.
      const cx = loop.reduce((s, p) => s + p.x, 0) / loop.length;
      const cy = loop.reduce((s, p) => s + p.y, 0) / loop.length;
      const cz = loop.reduce((s, p) => s + p.z, 0) / loop.length;
      const centerIdx = newPositions.length / 3;
      newPositions.push(cx, cy, cz);
      const ringIndices: number[] = [];
      for (const v of loop) {
        ringIndices.push(addCutVertex(v));
      }
      for (let i = 0; i < ringIndices.length; i++) {
        const a = ringIndices[i]!;
        const b = ringIndices[(i + 1) % ringIndices.length]!;
        newIndices.push(centerIdx, a, b);
        capTriangles++;
      }
    }
  }

  return {
    mesh: { positions: newPositions, indices: newIndices },
    discardedTriangleCount: discarded,
    splitTriangleCount: split,
    capTriangleCount: capTriangles,
    capPerimeterMm: capPerimeter,
  };
}

// ── Boundary chaining ─────────────────────────────────────────

function chainBoundary(segments: Array<{ a: Vec3; b: Vec3 }>): Vec3[][] {
  const out: Vec3[][] = [];
  const used = new Set<number>();
  const eps = 1e-6;

  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const loop: Vec3[] = [segments[i]!.a, segments[i]!.b];
    let extended = true;
    while (extended) {
      extended = false;
      const tail = loop[loop.length - 1]!;
      for (let j = 0; j < segments.length; j++) {
        if (used.has(j)) continue;
        const s = segments[j]!;
        if (vec3Close(s.a, tail, eps)) {
          loop.push(s.b);
          used.add(j);
          extended = true;
          break;
        }
        if (vec3Close(s.b, tail, eps)) {
          loop.push(s.a);
          used.add(j);
          extended = true;
          break;
        }
      }
    }
    out.push(loop);
  }
  return out;
}

function polylineLength(points: Vec3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    total += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return total;
}

// ── Helpers ────────────────────────────────────────────────────

function vertex(mesh: MeshArrays, i: number): Vec3 {
  return { x: mesh.positions[i * 3]!, y: mesh.positions[i * 3 + 1]!, z: mesh.positions[i * 3 + 2]! };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-9) return { x: 0, y: 0, z: 1 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

function vec3Close(a: Vec3, b: Vec3, eps: number): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.z - b.z) < eps;
}

// ── Summary ────────────────────────────────────────────────────

export interface SliceSummary {
  outputTriangleCount: number;
  discardedTriangleCount: number;
  splitTriangleCount: number;
  capTriangleCount: number;
  capPerimeterMm: number;
}

export function summarize(result: SliceResult): SliceSummary {
  return {
    outputTriangleCount: result.mesh.indices.length / 3,
    discardedTriangleCount: result.discardedTriangleCount,
    splitTriangleCount: result.splitTriangleCount,
    capTriangleCount: result.capTriangleCount,
    capPerimeterMm: result.capPerimeterMm,
  };
}
