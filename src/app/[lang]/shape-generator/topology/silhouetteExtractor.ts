/**
 * silhouetteExtractor.ts — Extract the silhouette (outline) of a 3D
 * mesh as seen from a given view direction.
 *
 * The silhouette is the closed polyline that separates *front-facing*
 * triangles (normal dotted with view > 0) from *back-facing* ones
 * (dot < 0). On a tessellated mesh it's a chain of edges where one
 * incident triangle is front-facing and the other is back-facing.
 *
 * Why we want it:
 *
 *   - **Drawing generation** — orthographic projected silhouette is
 *     the outermost stroke of the part view.
 *   - **Hidden-line removal** — silhouette + feature edges form the
 *     visible-line set; everything inside the silhouette polygon
 *     can be tested with a depth check.
 *   - **Shadow casting** — the silhouette extruded along the light
 *     direction is the shadow volume.
 *
 * The output is a list of 3D edge endpoints + a chained polyline
 * version. For projected drawings the caller multiplies by a
 * projection matrix and drops the depth component.
 */

export interface MeshArrays {
  positions: number[];
  indices: number[];
}

export interface SilhouetteEdge {
  /** Vertex indices of the two endpoints. */
  vA: number;
  vB: number;
  /** Front-facing triangle id. */
  frontTri: number;
  /** Back-facing triangle id. */
  backTri: number;
}

export interface SilhouettePolyline {
  /** Ordered point chain. */
  points: Array<[number, number, number]>;
  /** True if first and last points coincide. */
  closed: boolean;
}

export interface SilhouetteResult {
  edges: SilhouetteEdge[];
  polylines: SilhouettePolyline[];
  /** Front-facing triangle indices. */
  frontTriangles: number[];
  /** Back-facing triangle indices. */
  backTriangles: number[];
  /** Triangles perpendicular to view (silhouette-contributing). */
  edgeOnTriangles: number[];
}

export interface ExtractOptions {
  /** Below this absolute dot product, the triangle is "edge-on". */
  edgeOnTolerance: number;
}

export const DEFAULT_OPTIONS: ExtractOptions = {
  edgeOnTolerance: 1e-4,
};

// ── Top-level entry ────────────────────────────────────────────

export function extractSilhouette(
  mesh: MeshArrays,
  viewDirection: [number, number, number],
  options: Partial<ExtractOptions> = {},
): SilhouetteResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const triCount = mesh.indices.length / 3;
  if (triCount === 0) {
    return { edges: [], polylines: [], frontTriangles: [], backTriangles: [], edgeOnTriangles: [] };
  }
  const view = normalize(viewDirection);

  // Per-triangle classification.
  const classification: Array<'front' | 'back' | 'edge-on'> = [];
  const normals: Array<[number, number, number]> = [];
  for (let t = 0; t < triCount; t++) {
    const i0 = mesh.indices[t * 3]!;
    const i1 = mesh.indices[t * 3 + 1]!;
    const i2 = mesh.indices[t * 3 + 2]!;
    const p0 = vertex(mesh, i0);
    const p1 = vertex(mesh, i1);
    const p2 = vertex(mesh, i2);
    const n = triangleNormal(p0, p1, p2);
    normals.push(n);
    const dotV = dot(n, view);
    if (Math.abs(dotV) < opts.edgeOnTolerance) classification.push('edge-on');
    else if (dotV > 0) classification.push('front');
    else classification.push('back');
  }

  const frontTris: number[] = [];
  const backTris: number[] = [];
  const edgeOnTris: number[] = [];
  for (let t = 0; t < triCount; t++) {
    if (classification[t] === 'front') frontTris.push(t);
    else if (classification[t] === 'back') backTris.push(t);
    else edgeOnTris.push(t);
  }

  // Build edge-to-triangles map.
  const edgeMap = new Map<string, number[]>();
  for (let t = 0; t < triCount; t++) {
    const idx = [mesh.indices[t * 3]!, mesh.indices[t * 3 + 1]!, mesh.indices[t * 3 + 2]!];
    for (let e = 0; e < 3; e++) {
      const a = idx[e]!;
      const b = idx[(e + 1) % 3]!;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      const list = edgeMap.get(key) ?? [];
      list.push(t);
      edgeMap.set(key, list);
    }
  }

  // Silhouette edges: edges whose two incident triangles disagree on
  // visibility. Treat edge-on as a contour boundary too — for an
  // axis-aligned cube viewed straight on, side faces are edge-on and
  // their boundary with the top face IS the silhouette.
  const edges: SilhouetteEdge[] = [];
  for (const [key, tris] of edgeMap) {
    if (tris.length !== 2) continue;
    const c0 = classification[tris[0]!]!;
    const c1 = classification[tris[1]!]!;
    if (c0 === c1) continue;
    const involvesEdgeOn = c0 === 'edge-on' || c1 === 'edge-on';
    const isFrontBack = (c0 === 'front' && c1 === 'back') || (c0 === 'back' && c1 === 'front');
    if (!isFrontBack && !involvesEdgeOn) continue;
    const [aStr, bStr] = key.split('-');
    const vA = Number(aStr);
    const vB = Number(bStr);
    // Pick front + back from the pair (defaulting edge-on to the opposite side).
    let frontTri: number;
    let backTri: number;
    if (c0 === 'front') { frontTri = tris[0]!; backTri = tris[1]!; }
    else if (c1 === 'front') { frontTri = tris[1]!; backTri = tris[0]!; }
    else if (c0 === 'back') { backTri = tris[0]!; frontTri = tris[1]!; }
    else { backTri = tris[1]!; frontTri = tris[0]!; }
    edges.push({ vA, vB, frontTri, backTri });
  }

  const polylines = chainEdges(edges, mesh);
  void normals;
  return { edges, polylines, frontTriangles: frontTris, backTriangles: backTris, edgeOnTriangles: edgeOnTris };
}

// ── Chain edges into polylines ─────────────────────────────────

function chainEdges(edges: SilhouetteEdge[], mesh: MeshArrays): SilhouettePolyline[] {
  const adj = new Map<number, number[]>();
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]!;
    (adj.get(e.vA) ?? adj.set(e.vA, []).get(e.vA)!).push(i);
    (adj.get(e.vB) ?? adj.set(e.vB, []).get(e.vB)!).push(i);
  }
  const used = new Set<number>();
  const polylines: SilhouettePolyline[] = [];

  for (let i = 0; i < edges.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const e = edges[i]!;
    const vertices: number[] = [e.vA, e.vB];

    let extended = true;
    while (extended) {
      extended = false;
      const tail = vertices[vertices.length - 1]!;
      for (const ci of adj.get(tail) ?? []) {
        if (used.has(ci)) continue;
        const ce = edges[ci]!;
        const next = ce.vA === tail ? ce.vB : ce.vA;
        vertices.push(next);
        used.add(ci);
        extended = true;
        break;
      }
    }
    let extendedBack = true;
    while (extendedBack) {
      extendedBack = false;
      const head = vertices[0]!;
      for (const ci of adj.get(head) ?? []) {
        if (used.has(ci)) continue;
        const ce = edges[ci]!;
        const prev = ce.vA === head ? ce.vB : ce.vA;
        vertices.unshift(prev);
        used.add(ci);
        extendedBack = true;
        break;
      }
    }
    const points = vertices.map(v => vertex(mesh, v));
    const closed = vertices.length > 2 && vertices[0]! === vertices[vertices.length - 1]!;
    polylines.push({ points, closed });
  }
  return polylines;
}

// ── Projection helper ──────────────────────────────────────────

/** Project a 3D point onto the view plane perpendicular to `viewDir`,
 *  returning 2D coordinates in (u, v) basis. */
export function projectToViewPlane(point: [number, number, number], viewDir: [number, number, number]): [number, number] {
  const view = normalize(viewDir);
  // Pick up vector roughly Z (or X if view ≈ Z).
  const up: [number, number, number] = Math.abs(view[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const right = cross(view, up);
  const rightN = normalize(right);
  const upPerp = cross(rightN, view);
  return [dot(point, rightN), dot(point, upPerp)];
}

// ── Helpers ────────────────────────────────────────────────────

function vertex(mesh: MeshArrays, i: number): [number, number, number] {
  return [mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!];
}

function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-9) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function triangleNormal(
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
): [number, number, number] {
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  const len = Math.hypot(cx, cy, cz);
  if (len < 1e-9) return [0, 0, 1];
  return [cx / len, cy / len, cz / len];
}

// ── Summary ────────────────────────────────────────────────────

export interface SilhouetteSummary {
  silhouetteEdgeCount: number;
  polylineCount: number;
  closedPolylineCount: number;
  frontFaceCount: number;
  backFaceCount: number;
  /** Total length of silhouette edges. */
  totalEdgeLengthMm: number;
}

export function summarize(mesh: MeshArrays, result: SilhouetteResult): SilhouetteSummary {
  let totalLen = 0;
  for (const e of result.edges) {
    const a = vertex(mesh, e.vA);
    const b = vertex(mesh, e.vB);
    totalLen += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return {
    silhouetteEdgeCount: result.edges.length,
    polylineCount: result.polylines.length,
    closedPolylineCount: result.polylines.filter(p => p.closed).length,
    frontFaceCount: result.frontTriangles.length,
    backFaceCount: result.backTriangles.length,
    totalEdgeLengthMm: totalLen,
  };
}
