/**
 * sliverRemoval.ts — Identify + collapse sliver triangles.
 *
 * A "sliver" is a triangle whose minimum interior angle falls below
 * a threshold (default 5°). Slivers pass the area-threshold check
 * because total area can be respectable (long + skinny = 0.1×100 mm²),
 * but they break FEA mesh generators, slow down ray tracers, and
 * degrade rendered shading near silhouette edges.
 *
 * Repair: collapse the shortest edge. This is the simplest topology
 * change — pick the two short-edge endpoints and merge them into
 * their midpoint. Adjacent triangles either lose a vertex (become
 * thinner) or degenerate (caller should re-run the basic
 * minTriangleArea cleanup after sliver removal).
 *
 * Conservative defaults: only collapse edges shorter than
 * `maxCollapseLength` so we don't merge a long sliver's two
 * far-apart vertices and ruin geometry.
 */

import * as THREE from 'three';

export interface SliverOptions {
  minAngleDeg?: number;
  maxCollapseLength?: number;
}

export interface SliverReport {
  slivers: number;
  edgesCollapsed: number;
  finalTriangleCount: number;
}

function vertVec(pos: THREE.BufferAttribute, i: number): THREE.Vector3 {
  return new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
}

function triangleMinAngleRad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
  const ab = new THREE.Vector3().subVectors(b, a);
  const ac = new THREE.Vector3().subVectors(c, a);
  const ba = new THREE.Vector3().subVectors(a, b);
  const bc = new THREE.Vector3().subVectors(c, b);
  const ca = new THREE.Vector3().subVectors(a, c);
  const cb = new THREE.Vector3().subVectors(b, c);
  const lenAB = ab.length(), lenAC = ac.length();
  const lenBA = ba.length(), lenBC = bc.length();
  const lenCA = ca.length(), lenCB = cb.length();
  if (lenAB < 1e-9 || lenAC < 1e-9 || lenBC < 1e-9) return 0;
  const angA = Math.acos(Math.max(-1, Math.min(1, ab.dot(ac) / (lenAB * lenAC))));
  const angB = Math.acos(Math.max(-1, Math.min(1, ba.dot(bc) / (lenBA * lenBC))));
  const angC = Math.acos(Math.max(-1, Math.min(1, ca.dot(cb) / (lenCA * lenCB))));
  return Math.min(angA, angB, angC);
}

/** Detect-only pass — returns the indices of sliver triangles. */
export function detectSlivers(
  geo: THREE.BufferGeometry,
  opts: SliverOptions = {},
): number[] {
  const minAngleRad = (opts.minAngleDeg ?? 5) * Math.PI / 180;
  const idx = geo.index;
  if (!idx) throw new Error('sliverRemoval requires indexed geometry');
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const triCount = idx.count / 3;
  const out: number[] = [];
  for (let t = 0; t < triCount; t++) {
    const a = vertVec(pos, idx.getX(t * 3));
    const b = vertVec(pos, idx.getX(t * 3 + 1));
    const c = vertVec(pos, idx.getX(t * 3 + 2));
    if (triangleMinAngleRad(a, b, c) < minAngleRad) out.push(t);
  }
  return out;
}

/** Collapse the shortest edge of each sliver. Returns a new geometry. */
export function removeSlivers(
  geo: THREE.BufferGeometry,
  opts: SliverOptions = {},
): { geometry: THREE.BufferGeometry; report: SliverReport } {
  const minAngleRad = (opts.minAngleDeg ?? 5) * Math.PI / 180;
  const maxCollapse = opts.maxCollapseLength ?? 0.5;
  const idx = geo.index;
  if (!idx) throw new Error('sliverRemoval requires indexed geometry');
  const posOrig = geo.attributes.position as THREE.BufferAttribute;
  const triCount = idx.count / 3;
  // Use union-find to track collapsed vertex identities.
  const parent: number[] = Array.from({ length: posOrig.count }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const union = (i: number, j: number): void => {
    const ri = find(i), rj = find(j);
    if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj);
  };

  let slivers = 0;
  let collapses = 0;
  for (let t = 0; t < triCount; t++) {
    const a = idx.getX(t * 3);
    const b = idx.getX(t * 3 + 1);
    const c = idx.getX(t * 3 + 2);
    const va = vertVec(posOrig, a);
    const vb = vertVec(posOrig, b);
    const vc = vertVec(posOrig, c);
    if (triangleMinAngleRad(va, vb, vc) >= minAngleRad) continue;
    slivers++;
    const lenAB = va.distanceTo(vb);
    const lenBC = vb.distanceTo(vc);
    const lenCA = vc.distanceTo(va);
    const minLen = Math.min(lenAB, lenBC, lenCA);
    if (minLen > maxCollapse) continue;
    if (minLen === lenAB) union(a, b);
    else if (minLen === lenBC) union(b, c);
    else union(c, a);
    collapses++;
  }

  // Compact vertices: only positions at roots are kept.
  const rootToNew = new Map<number, number>();
  const newPositions: number[] = [];
  for (let i = 0; i < posOrig.count; i++) {
    const r = find(i);
    if (!rootToNew.has(r)) {
      rootToNew.set(r, newPositions.length / 3);
      newPositions.push(posOrig.getX(r), posOrig.getY(r), posOrig.getZ(r));
    }
  }
  // Rewrite indices, skip degenerate triangles.
  const newIdx: number[] = [];
  let finalTris = 0;
  for (let t = 0; t < triCount; t++) {
    const a = rootToNew.get(find(idx.getX(t * 3)))!;
    const b = rootToNew.get(find(idx.getX(t * 3 + 1)))!;
    const c = rootToNew.get(find(idx.getX(t * 3 + 2)))!;
    if (a === b || b === c || a === c) continue;
    newIdx.push(a, b, c);
    finalTris++;
  }
  const cloned = new THREE.BufferGeometry();
  cloned.setAttribute('position', new THREE.BufferAttribute(new Float32Array(newPositions), 3));
  cloned.setIndex(newIdx);
  return {
    geometry: cloned,
    report: { slivers, edgesCollapsed: collapses, finalTriangleCount: finalTris },
  };
}
