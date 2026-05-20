/**
 * nonManifoldRepair.ts — Detect + (optionally) remove non-manifold edges.
 *
 * A manifold mesh has every edge shared by **exactly two** triangles.
 * Real-world STL / OBJ imports commonly contain:
 *
 *   - **Boundary edges** (count = 1) → expected at holes / surfaces, but
 *     a *closed* solid shouldn't have any.
 *   - **Non-manifold edges** (count ≥ 3) → T-junctions, internal walls
 *     leaking into the model. OCCT boolean / fillet refuses these.
 *
 * Repair strategy here is conservative: identify the extra triangles
 * around each non-manifold edge and either (a) remove the
 * smallest-area one or (b) just report and leave for the user. We
 * default to "report only" — auto-removing triangles can silently
 * change the user's geometry.
 */

import * as THREE from 'three';

export interface EdgeUseRecord {
  /** Canonical edge key (smaller vertex idx first). */
  key: string;
  /** Triangle indices that reference this edge. */
  triangles: number[];
}

export interface NonManifoldReport {
  boundaryEdges: EdgeUseRecord[];
  nonManifoldEdges: EdgeUseRecord[];
  totalEdges: number;
  isClosedManifold: boolean;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function buildEdgeMap(geo: THREE.BufferGeometry): Map<string, EdgeUseRecord> {
  const idx = geo.index;
  if (!idx) {
    throw new Error('nonManifoldRepair requires indexed geometry');
  }
  const triCount = idx.count / 3;
  const edges = new Map<string, EdgeUseRecord>();
  for (let t = 0; t < triCount; t++) {
    const a = idx.getX(t * 3);
    const b = idx.getX(t * 3 + 1);
    const c = idx.getX(t * 3 + 2);
    for (const [u, v] of [[a, b], [b, c], [c, a]] as Array<[number, number]>) {
      const k = edgeKey(u, v);
      const rec = edges.get(k);
      if (rec) rec.triangles.push(t);
      else edges.set(k, { key: k, triangles: [t] });
    }
  }
  return edges;
}

export function detectNonManifoldEdges(geo: THREE.BufferGeometry): NonManifoldReport {
  const edges = buildEdgeMap(geo);
  const boundary: EdgeUseRecord[] = [];
  const nonManifold: EdgeUseRecord[] = [];
  for (const rec of edges.values()) {
    if (rec.triangles.length === 1) boundary.push(rec);
    else if (rec.triangles.length > 2) nonManifold.push(rec);
  }
  return {
    boundaryEdges: boundary,
    nonManifoldEdges: nonManifold,
    totalEdges: edges.size,
    isClosedManifold: boundary.length === 0 && nonManifold.length === 0,
  };
}

/** For each non-manifold edge, keep the two triangles that yield the
 *  smoothest dihedral angle (most likely the "real" surface) and
 *  drop the rest. Conservative — leaves boundary edges alone. */
export function repairNonManifoldEdges(
  geo: THREE.BufferGeometry,
): { geometry: THREE.BufferGeometry; removed: number; remaining: NonManifoldReport } {
  const idx = geo.index;
  if (!idx) throw new Error('nonManifoldRepair requires indexed geometry');
  const pos = geo.attributes.position;
  const before = detectNonManifoldEdges(geo);
  const skip = new Set<number>();

  const triNormal = (t: number): THREE.Vector3 => {
    const a = idx.getX(t * 3);
    const b = idx.getX(t * 3 + 1);
    const c = idx.getX(t * 3 + 2);
    const va = new THREE.Vector3(pos.getX(a), pos.getY(a), pos.getZ(a));
    const vb = new THREE.Vector3(pos.getX(b), pos.getY(b), pos.getZ(b));
    const vc = new THREE.Vector3(pos.getX(c), pos.getY(c), pos.getZ(c));
    return new THREE.Vector3().subVectors(vb, va).cross(new THREE.Vector3().subVectors(vc, va)).normalize();
  };

  for (const edge of before.nonManifoldEdges) {
    // Pair-score: pick the two triangles whose normals are most aligned.
    const tris = edge.triangles;
    let best: [number, number] = [tris[0]!, tris[1]!];
    let bestDot = -2;
    for (let i = 0; i < tris.length; i++) {
      for (let j = i + 1; j < tris.length; j++) {
        const ni = triNormal(tris[i]!);
        const nj = triNormal(tris[j]!);
        const dot = Math.abs(ni.dot(nj));
        if (dot > bestDot) {
          bestDot = dot;
          best = [tris[i]!, tris[j]!];
        }
      }
    }
    const keep = new Set(best);
    for (const t of tris) {
      if (!keep.has(t)) skip.add(t);
    }
  }

  const triCount = idx.count / 3;
  const out: number[] = [];
  for (let t = 0; t < triCount; t++) {
    if (skip.has(t)) continue;
    out.push(idx.getX(t * 3), idx.getX(t * 3 + 1), idx.getX(t * 3 + 2));
  }
  const cloned = geo.clone();
  cloned.setIndex(out);
  const after = detectNonManifoldEdges(cloned);
  return { geometry: cloned, removed: skip.size, remaining: after };
}
