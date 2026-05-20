/**
 * invertedNormalFix.ts — Flip winding-inconsistent triangles.
 *
 * A consistent mesh has all triangles wound in the same direction
 * (CCW from outside the solid). Imported meshes often have isolated
 * triangles flipped — exporters from SketchUp / Blender / some FreeCAD
 * variants are notorious for this. Symptoms: lighting goes black on
 * one face; transparency renders backwards; FEA gets confused about
 * the outward normal.
 *
 * Algorithm: BFS across the dual graph (triangles connected by shared
 * edges). For each adjacent pair, the shared edge should be traversed
 * in *opposite* directions when the windings are consistent. If a
 * neighbor traverses it in the *same* direction, that neighbor is
 * flipped. Conflicts (non-manifold regions) skip.
 *
 * This is a topological fix — it doesn't change vertex positions,
 * only the triangle index winding order.
 */

import * as THREE from 'three';

export interface InvertedNormalReport {
  flipped: number;
  conflictsSkipped: number;
  componentsVisited: number;
}

function edgeDir(a: number, b: number): { a: number; b: number; key: string } {
  return { a, b, key: a < b ? `${a}|${b}` : `${b}|${a}` };
}

/** Returns true if the two edges traverse the same vertex pair in
 *  the *opposite* direction, which is the consistent-winding case. */
function consistentEdge(e1: { a: number; b: number }, e2: { a: number; b: number }): boolean {
  return (e1.a === e2.b && e1.b === e2.a);
}

export function fixInvertedNormals(
  geo: THREE.BufferGeometry,
): { geometry: THREE.BufferGeometry; report: InvertedNormalReport } {
  const idx = geo.index;
  if (!idx) {
    throw new Error('invertedNormalFix requires indexed geometry');
  }
  const triCount = idx.count / 3;
  // Map each edge key → triangles touching it, with their oriented edge.
  const edgeOwners = new Map<string, Array<{ tri: number; oriented: { a: number; b: number } }>>();

  const triEdges: Array<Array<{ a: number; b: number; key: string }>> = [];
  for (let t = 0; t < triCount; t++) {
    const a = idx.getX(t * 3);
    const b = idx.getX(t * 3 + 1);
    const c = idx.getX(t * 3 + 2);
    const es = [edgeDir(a, b), edgeDir(b, c), edgeDir(c, a)];
    triEdges.push(es);
    for (const e of es) {
      const list = edgeOwners.get(e.key) ?? [];
      list.push({ tri: t, oriented: { a: e.a, b: e.b } });
      edgeOwners.set(e.key, list);
    }
  }

  const newIdx = Array.from({ length: triCount * 3 }, (_, i) => idx.getX(i));
  const flipTri = (t: number): void => {
    const a = newIdx[t * 3 + 1]!;
    newIdx[t * 3 + 1] = newIdx[t * 3 + 2]!;
    newIdx[t * 3 + 2] = a;
    // Also rebuild oriented edges for that triangle.
    const i0 = newIdx[t * 3]!;
    const i1 = newIdx[t * 3 + 1]!;
    const i2 = newIdx[t * 3 + 2]!;
    triEdges[t] = [edgeDir(i0, i1), edgeDir(i1, i2), edgeDir(i2, i0)];
  };

  const visited = new Set<number>();
  let flipped = 0;
  let conflicts = 0;
  let components = 0;

  for (let seed = 0; seed < triCount; seed++) {
    if (visited.has(seed)) continue;
    components++;
    const queue = [seed];
    visited.add(seed);
    while (queue.length > 0) {
      const t = queue.shift()!;
      for (const e of triEdges[t]!) {
        const owners = edgeOwners.get(e.key) ?? [];
        if (owners.length > 2) { conflicts++; continue; }
        for (const o of owners) {
          if (o.tri === t || visited.has(o.tri)) continue;
          const myEdge = { a: e.a, b: e.b };
          const nbrEdge = o.oriented;
          if (!consistentEdge(myEdge, nbrEdge)) {
            flipTri(o.tri);
            flipped++;
            // After flip update the edge owner's oriented edge to its new dir.
            // Find which of the 3 new edges of o.tri corresponds to this key.
            for (const ne of triEdges[o.tri]!) {
              if (ne.key === e.key) {
                o.oriented = { a: ne.a, b: ne.b };
                break;
              }
            }
          }
          visited.add(o.tri);
          queue.push(o.tri);
        }
      }
    }
  }

  const cloned = geo.clone();
  cloned.setIndex(newIdx);
  return {
    geometry: cloned,
    report: { flipped, conflictsSkipped: conflicts, componentsVisited: components },
  };
}
