/**
 * holeFill.ts — Detect + fill small boundary loops in open meshes.
 *
 * A boundary edge (referenced by exactly one triangle) traces the
 * perimeter of a hole. Closing all boundary loops turns an open
 * surface mesh into a closed solid — required for OCCT boolean ops
 * and watertight 3D-print slicing.
 *
 * Strategy:
 *   1. Collect all boundary edges (via `detectNonManifoldEdges`'s
 *      classification, but re-implemented here to keep this module
 *      standalone for testing).
 *   2. Walk each boundary edge into a closed loop by chaining
 *      shared-vertex successors.
 *   3. Triangulate small loops with a triangle fan from the centroid.
 *      Large/non-planar loops are left alone (would need CDT).
 *
 * Bias is toward conservative fill — small holes only (≤ `maxLoopSize`).
 * Files like leaked-mesh imports usually have many tiny holes that fan
 * fill handles fine; large open surfaces need user judgment about
 * which edges should remain open.
 */

import * as THREE from 'three';

export interface HoleFillOptions {
  /** Maximum loop length (vertex count) the auto-fill will close. */
  maxLoopSize?: number;
}

export interface HoleFillReport {
  loopsFound: number;
  loopsFilled: number;
  trianglesAdded: number;
  skippedLarge: number;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function collectBoundaryEdges(geo: THREE.BufferGeometry): Array<[number, number]> {
  const idx = geo.index;
  if (!idx) throw new Error('holeFill requires indexed geometry');
  const triCount = idx.count / 3;
  const useCount = new Map<string, number>();
  const dirEdges = new Map<string, [number, number]>();
  for (let t = 0; t < triCount; t++) {
    const a = idx.getX(t * 3);
    const b = idx.getX(t * 3 + 1);
    const c = idx.getX(t * 3 + 2);
    for (const [u, v] of [[a, b], [b, c], [c, a]] as Array<[number, number]>) {
      const k = edgeKey(u, v);
      useCount.set(k, (useCount.get(k) ?? 0) + 1);
      if (!dirEdges.has(k)) dirEdges.set(k, [u, v]);
    }
  }
  const boundary: Array<[number, number]> = [];
  for (const [k, count] of useCount) {
    if (count === 1) boundary.push(dirEdges.get(k)!);
  }
  return boundary;
}

/** Chain boundary edges into closed loops. Each loop is a list of
 *  vertex indices, last vertex connects back to first. */
function chainLoops(edges: Array<[number, number]>): number[][] {
  // For each vertex, record which edge-endpoint pairs touch it.
  const incident = new Map<number, Array<{ other: number; used: boolean }>>();
  for (const [a, b] of edges) {
    if (!incident.has(a)) incident.set(a, []);
    if (!incident.has(b)) incident.set(b, []);
    incident.get(a)!.push({ other: b, used: false });
    incident.get(b)!.push({ other: a, used: false });
  }
  const loops: number[][] = [];
  for (const startVertex of incident.keys()) {
    const startList = incident.get(startVertex)!;
    const firstEdge = startList.find(e => !e.used);
    if (!firstEdge) continue;
    firstEdge.used = true;
    // Mark reverse direction used.
    const back = incident.get(firstEdge.other)!.find(e => e.other === startVertex && !e.used);
    if (back) back.used = true;

    const loop = [startVertex, firstEdge.other];
    let safety = 0;
    while (loop[loop.length - 1] !== startVertex && safety++ < 10000) {
      const cur = loop[loop.length - 1]!;
      const candidates = incident.get(cur) ?? [];
      const next = candidates.find(e => !e.used);
      if (!next) break;
      next.used = true;
      const r = incident.get(next.other)!.find(e => e.other === cur && !e.used);
      if (r) r.used = true;
      if (next.other === startVertex) break;
      loop.push(next.other);
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

export function detectHoles(geo: THREE.BufferGeometry): {
  loops: number[][];
  totalBoundaryEdges: number;
} {
  const edges = collectBoundaryEdges(geo);
  const loops = chainLoops(edges);
  return { loops, totalBoundaryEdges: edges.length };
}

export function fillHoles(
  geo: THREE.BufferGeometry,
  opts: HoleFillOptions = {},
): { geometry: THREE.BufferGeometry; report: HoleFillReport } {
  const maxLoop = opts.maxLoopSize ?? 12;
  const idx = geo.index;
  if (!idx) throw new Error('holeFill requires indexed geometry');
  const pos = geo.attributes.position;
  const { loops } = detectHoles(geo);
  const newIdx = Array.from({ length: idx.count }, (_, i) => idx.getX(i));
  const newPositions: number[] = [];
  const vertCount = pos.count;
  let trianglesAdded = 0;
  let filled = 0;
  let skipped = 0;

  for (const loop of loops) {
    if (loop.length > maxLoop) { skipped++; continue; }
    // Centroid as new vertex.
    let cx = 0, cy = 0, cz = 0;
    for (const v of loop) {
      cx += pos.getX(v);
      cy += pos.getY(v);
      cz += pos.getZ(v);
    }
    cx /= loop.length;
    cy /= loop.length;
    cz /= loop.length;
    const newCenterIdx = vertCount + newPositions.length / 3;
    newPositions.push(cx, cy, cz);
    // Triangle fan — winding direction inherited from boundary order.
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!;
      const b = loop[(i + 1) % loop.length]!;
      newIdx.push(a, b, newCenterIdx);
      trianglesAdded++;
    }
    filled++;
  }

  const cloned = geo.clone();
  if (newPositions.length > 0) {
    const oldPos = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      oldPos[i * 3]     = pos.getX(i);
      oldPos[i * 3 + 1] = pos.getY(i);
      oldPos[i * 3 + 2] = pos.getZ(i);
    }
    const combined = new Float32Array(oldPos.length + newPositions.length);
    combined.set(oldPos);
    combined.set(newPositions, oldPos.length);
    cloned.setAttribute('position', new THREE.BufferAttribute(combined, 3));
  }
  cloned.setIndex(newIdx);

  return {
    geometry: cloned,
    report: {
      loopsFound: loops.length,
      loopsFilled: filled,
      trianglesAdded,
      skippedLarge: skipped,
    },
  };
}
