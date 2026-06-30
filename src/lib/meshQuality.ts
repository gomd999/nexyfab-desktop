// Mesh quality assessment for the Design Review. Imported STL/STEP meshes are
// often non-watertight (open edges) or carry degenerate (zero-area) triangles —
// DFM analysis on such "triangle soup" produces false positives (phantom
// "0.00 mm walls", inflated undercut counts). We measure quality up front so the
// UI + AI can caveat the result instead of presenting noise as fact.

import * as THREE from 'three';

export interface MeshQuality {
  watertight: boolean;
  openEdgeRatio: number;   // 0..1 — fraction of edges not shared by exactly 2 tris
  degenerateRatio: number; // 0..1 — fraction of zero-area triangles
  triangleCount: number;
  reliable: boolean;       // true → DFM results can be trusted
}

export function assessMeshQuality(geometry: THREE.BufferGeometry): MeshQuality {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.getAttribute('position');
  if (!pos) return { watertight: false, openEdgeRatio: 1, degenerateRatio: 1, triangleCount: 0, reliable: false };
  const triCount = Math.floor(pos.count / 3);

  // Quantize vertex positions so coincident-but-not-shared verts (common in STL)
  // still register as the same edge endpoint.
  const q = (v: number) => Math.round(v * 1000);
  const vkey = (i: number) => `${q(pos.getX(i))},${q(pos.getY(i))},${q(pos.getZ(i))}`;
  const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  const edges = new Map<string, number>();
  let degenerate = 0;
  for (let t = 0; t < triCount; t++) {
    const i = t * 3;
    const ax = pos.getX(i), ay = pos.getY(i), az = pos.getZ(i);
    const bx = pos.getX(i + 1), by = pos.getY(i + 1), bz = pos.getZ(i + 1);
    const cx = pos.getX(i + 2), cy = pos.getY(i + 2), cz = pos.getZ(i + 2);
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const crx = aby * acz - abz * acy, cry = abz * acx - abx * acz, crz = abx * acy - aby * acx;
    if (Math.hypot(crx, cry, crz) / 2 < 1e-6) { degenerate++; continue; }
    const ka = vkey(i), kb = vkey(i + 1), kc = vkey(i + 2);
    for (const k of [edgeKey(ka, kb), edgeKey(kb, kc), edgeKey(kc, ka)]) {
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }

  let open = 0;
  let total = 0;
  for (const c of edges.values()) { total++; if (c !== 2) open++; }

  const openEdgeRatio = total > 0 ? open / total : 1;
  const degenerateRatio = triCount > 0 ? degenerate / triCount : 1;
  const watertight = total > 0 && openEdgeRatio < 0.02;
  // Below these thresholds, wall-thickness / undercut DFM is meaningful.
  const reliable = openEdgeRatio < 0.05 && degenerateRatio < 0.02 && triCount >= 12;

  return { watertight, openEdgeRatio, degenerateRatio, triangleCount: triCount, reliable };
}
