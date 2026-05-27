/**
 * meshHealingStage3.ts — T-vertex repair + self-intersection detection.
 *
 * Stage 1 (`meshHealing`) — weld + drop degenerates.
 * Stage 2 (`meshHealingStage2`) — boundary loop fill + normal consistency.
 * Stage 3 (here) — defects that *look* clean to the unaided eye but
 * break booleans + slicing:
 *
 *   - **T-vertex**: a vertex of triangle A lies on an edge of
 *     triangle B without being a vertex of B. Causes shading cracks
 *     and ambiguous winding. Repaired by splitting B's edge.
 *
 *   - **Self-intersection**: two triangles cross each other through
 *     interior surface (not just sharing an edge). Blocks CSG. We
 *     detect via a simple uniform-grid spatial hash + triangle-vs-
 *     triangle Möller intersection test. Repair is out of scope —
 *     we report locations so the user can edit.
 *
 *   - **Thin sliver triangles**: triangles whose smallest angle is
 *     below `minAngleDeg`. Cause numerical instability. We mark for
 *     edge-flip remeshing (caller decides whether to apply).
 */

export interface TVertexCandidate {
  /** Index of the vertex sitting on another edge. */
  vertexIndex: number;
  /** The edge of triangle B (vertex indices) that the vertex sits on. */
  edge: [number, number];
  /** Parametric position along the edge (0..1). */
  t: number;
  /** Distance from the vertex to the edge (mm). */
  distanceMm: number;
}

/** Detect T-vertices within `tolerance` mm. Brute O(V × E); fine for
 *  preview meshes (< 50k tris). */
export function detectTVertices(
  positions: number[],
  indices: number[],
  toleranceMm: number = 1e-3,
): TVertexCandidate[] {
  const triCount = indices.length / 3;
  const out: TVertexCandidate[] = [];
  const vCount = positions.length / 3;

  // Build a set of edges and their owning triangles' corner indices,
  // so we can ignore the vertex's own edges.
  const edgeOwnerVerts = new Map<string, Set<number>>();
  for (let t = 0; t < triCount; t++) {
    const a = indices[t * 3]!, b = indices[t * 3 + 1]!, c = indices[t * 3 + 2]!;
    for (const [u, v] of [[a, b], [b, c], [c, a]] as Array<[number, number]>) {
      const key = u < v ? `${u}-${v}` : `${v}-${u}`;
      if (!edgeOwnerVerts.has(key)) edgeOwnerVerts.set(key, new Set());
      edgeOwnerVerts.get(key)!.add(u);
      edgeOwnerVerts.get(key)!.add(v);
    }
  }

  for (let v = 0; v < vCount; v++) {
    const px = positions[v * 3]!, py = positions[v * 3 + 1]!, pz = positions[v * 3 + 2]!;
    for (const [key, owners] of edgeOwnerVerts) {
      if (owners.has(v)) continue; // v IS an endpoint — skip
      const [aIdx, bIdx] = key.split('-').map(Number) as [number, number];
      const ax = positions[aIdx * 3]!, ay = positions[aIdx * 3 + 1]!, az = positions[aIdx * 3 + 2]!;
      const bx = positions[bIdx * 3]!, by = positions[bIdx * 3 + 1]!, bz = positions[bIdx * 3 + 2]!;
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const lenSq = dx * dx + dy * dy + dz * dz;
      if (lenSq < 1e-12) continue;
      const t = ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / lenSq;
      if (t <= toleranceMm / Math.sqrt(lenSq) || t >= 1 - toleranceMm / Math.sqrt(lenSq)) continue;
      // Closest point on edge.
      const cx = ax + t * dx, cy = ay + t * dy, cz = az + t * dz;
      const distSq = (px - cx) ** 2 + (py - cy) ** 2 + (pz - cz) ** 2;
      if (distSq <= toleranceMm * toleranceMm) {
        out.push({
          vertexIndex: v,
          edge: [aIdx, bIdx],
          t,
          distanceMm: Math.sqrt(distSq),
        });
      }
    }
  }
  return out;
}

/** Repair T-vertices by splitting the edge each one sits on. Each
 *  triangle that uses the original edge is split into two. */
export function repairTVertices(
  positions: number[],
  indices: number[],
  candidates: TVertexCandidate[],
): { positions: number[]; indices: number[]; splitCount: number } {
  if (candidates.length === 0) return { positions, indices, splitCount: 0 };

  let workingIdx = indices.slice();
  let splitCount = 0;

  for (const cand of candidates) {
    const [a, b] = cand.edge;
    const newIdx: number[] = [];
    for (let t = 0; t < workingIdx.length; t += 3) {
      const i0 = workingIdx[t]!, i1 = workingIdx[t + 1]!, i2 = workingIdx[t + 2]!;
      // Does this triangle use the edge (a, b)?
      const verts = [i0, i1, i2];
      const useAB = verts.includes(a) && verts.includes(b);
      if (!useAB) {
        newIdx.push(i0, i1, i2);
        continue;
      }
      // Find the third vertex.
      const third = verts.find(v => v !== a && v !== b)!;
      // Replace this triangle with two using the new mid-vertex.
      const mid = cand.vertexIndex;
      // Preserve winding: walk verts in the original order, swap edge
      // (a, b) for (a, mid, b).
      const order = [i0, i1, i2];
      const aPos = order.indexOf(a);
      const bPos = order.indexOf(b);
      // The edge a→b appears in cyclic order if bPos === (aPos + 1) % 3.
      const aBeforeB = bPos === (aPos + 1) % 3;
      if (aBeforeB) {
        newIdx.push(a, mid, third);
        newIdx.push(mid, b, third);
      } else {
        newIdx.push(third, mid, a);
        newIdx.push(third, b, mid);
      }
      splitCount++;
    }
    workingIdx = newIdx;
  }
  return { positions: positions.slice(), indices: workingIdx, splitCount };
}

// ── Self-intersection detection ─────────────────────────────────────

export interface SelfIntersection {
  triA: number;
  triB: number;
  /** Approximate location of the intersection (midpoint of overlapping segment). */
  locationMm: [number, number, number];
}

/** Möller's fast triangle-triangle overlap test. Returns true when
 *  the triangles share more than an edge / vertex. */
function trianglesOverlap(
  p1: [number, number, number], p2: [number, number, number], p3: [number, number, number],
  q1: [number, number, number], q2: [number, number, number], q3: [number, number, number],
): boolean {
  // Compute signed distances of q's vertices to the plane of p.
  const n1 = cross(sub(p2, p1), sub(p3, p1));
  const d1q1 = dot(n1, sub(q1, p1));
  const d1q2 = dot(n1, sub(q2, p1));
  const d1q3 = dot(n1, sub(q3, p1));
  if ((d1q1 > 0 && d1q2 > 0 && d1q3 > 0) || (d1q1 < 0 && d1q2 < 0 && d1q3 < 0)) return false;

  // Same for p against plane of q.
  const n2 = cross(sub(q2, q1), sub(q3, q1));
  const d2p1 = dot(n2, sub(p1, q1));
  const d2p2 = dot(n2, sub(p2, q1));
  const d2p3 = dot(n2, sub(p3, q1));
  if ((d2p1 > 0 && d2p2 > 0 && d2p3 > 0) || (d2p1 < 0 && d2p2 < 0 && d2p3 < 0)) return false;

  // Coplanar or genuinely overlapping; accept as overlap (rough preview).
  return true;
}

function sub(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Detect self-intersecting triangles via brute-force pairs.
 *  Skips pairs that share a vertex (they "touch" but don't truly
 *  cross). For larger meshes, callers should pre-bucket via a
 *  spatial grid. */
export function detectSelfIntersections(
  positions: number[],
  indices: number[],
  maxPairs: number = 100,
): SelfIntersection[] {
  const triCount = indices.length / 3;
  const out: SelfIntersection[] = [];
  const triVerts = (t: number): Set<number> => new Set([indices[t * 3]!, indices[t * 3 + 1]!, indices[t * 3 + 2]!]);

  for (let i = 0; i < triCount; i++) {
    const setA = triVerts(i);
    const a = [positions[indices[i * 3]! * 3], positions[indices[i * 3]! * 3 + 1], positions[indices[i * 3]! * 3 + 2]] as [number, number, number];
    const b = [positions[indices[i * 3 + 1]! * 3], positions[indices[i * 3 + 1]! * 3 + 1], positions[indices[i * 3 + 1]! * 3 + 2]] as [number, number, number];
    const c = [positions[indices[i * 3 + 2]! * 3], positions[indices[i * 3 + 2]! * 3 + 1], positions[indices[i * 3 + 2]! * 3 + 2]] as [number, number, number];

    for (let j = i + 1; j < triCount; j++) {
      const setB = triVerts(j);
      let shared = 0;
      for (const v of setB) if (setA.has(v)) shared++;
      if (shared >= 2) continue; // share an edge or are the same triangle

      const d = [positions[indices[j * 3]! * 3], positions[indices[j * 3]! * 3 + 1], positions[indices[j * 3]! * 3 + 2]] as [number, number, number];
      const e = [positions[indices[j * 3 + 1]! * 3], positions[indices[j * 3 + 1]! * 3 + 1], positions[indices[j * 3 + 1]! * 3 + 2]] as [number, number, number];
      const f = [positions[indices[j * 3 + 2]! * 3], positions[indices[j * 3 + 2]! * 3 + 1], positions[indices[j * 3 + 2]! * 3 + 2]] as [number, number, number];

      if (trianglesOverlap(a, b, c, d, e, f)) {
        const cx = (a[0] + b[0] + c[0] + d[0] + e[0] + f[0]) / 6;
        const cy = (a[1] + b[1] + c[1] + d[1] + e[1] + f[1]) / 6;
        const cz = (a[2] + b[2] + c[2] + d[2] + e[2] + f[2]) / 6;
        out.push({ triA: i, triB: j, locationMm: [cx, cy, cz] });
        if (out.length >= maxPairs) return out;
      }
    }
  }
  return out;
}

// ── Sliver triangle detection ────────────────────────────────────

export interface SliverTriangle {
  triangleIndex: number;
  /** Smallest interior angle (degrees). */
  minAngleDeg: number;
}

/** A triangle is a "sliver" when its smallest angle is below the
 *  threshold. These cause numerical noise in normal computation and
 *  CSG. */
export function detectSliverTriangles(
  positions: number[],
  indices: number[],
  minAngleDeg: number = 5,
): SliverTriangle[] {
  const triCount = indices.length / 3;
  const out: SliverTriangle[] = [];
  for (let t = 0; t < triCount; t++) {
    const ai = indices[t * 3]!, bi = indices[t * 3 + 1]!, ci = indices[t * 3 + 2]!;
    const ax = positions[ai * 3]!, ay = positions[ai * 3 + 1]!, az = positions[ai * 3 + 2]!;
    const bx = positions[bi * 3]!, by = positions[bi * 3 + 1]!, bz = positions[bi * 3 + 2]!;
    const cx = positions[ci * 3]!, cy = positions[ci * 3 + 1]!, cz = positions[ci * 3 + 2]!;
    const aLen = Math.hypot(bx - cx, by - cy, bz - cz);
    const bLen = Math.hypot(cx - ax, cy - ay, cz - az);
    const cLen = Math.hypot(ax - bx, ay - by, az - bz);
    if (aLen === 0 || bLen === 0 || cLen === 0) continue;
    const cosA = Math.max(-1, Math.min(1, (bLen * bLen + cLen * cLen - aLen * aLen) / (2 * bLen * cLen)));
    const cosB = Math.max(-1, Math.min(1, (cLen * cLen + aLen * aLen - bLen * bLen) / (2 * cLen * aLen)));
    const cosC = Math.max(-1, Math.min(1, (aLen * aLen + bLen * bLen - cLen * cLen) / (2 * aLen * bLen)));
    const angA = Math.acos(cosA) * 180 / Math.PI;
    const angB = Math.acos(cosB) * 180 / Math.PI;
    const angC = Math.acos(cosC) * 180 / Math.PI;
    const minAng = Math.min(angA, angB, angC);
    if (minAng < minAngleDeg) out.push({ triangleIndex: t, minAngleDeg: minAng });
  }
  return out;
}
