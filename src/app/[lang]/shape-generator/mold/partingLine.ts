/**
 * partingLine.ts — Detect the parting line of a moldable part.
 *
 * The parting line is the closed loop on the surface where the
 * two mold halves meet. For a simple pull direction (+Z, say), the
 * parting line runs along the silhouette edges where the face
 * normal transitions from "up-facing" to "down-facing".
 *
 * Algorithm:
 *   1. For each triangle, compute dot(faceNormal, pullDir).
 *      Positive → faces the upper mold half; negative → lower.
 *   2. Edge between two triangles with opposite signs = parting
 *      edge.
 *   3. Chain parting edges into closed loops via shared vertices.
 *
 * Output: list of vertex polylines. A simple part has one loop;
 * complex parts may have multiple (one per protrusion).
 */

export interface MoldTriangle {
  /** 3 vertex indices into the parent vertex array. */
  indices: [number, number, number];
  /** Outward face normal (unit). */
  normal: [number, number, number];
}

export interface MoldMesh {
  vertices: ReadonlyArray<[number, number, number]>;
  triangles: ReadonlyArray<MoldTriangle>;
}

export interface PartingLineResult {
  /** Loops of vertex indices (each loop is closed). */
  loops: number[][];
  /** Total parting edge count discovered. */
  edgeCount: number;
}

function dot3(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Detect parting edges. */
export function detectPartingLine(
  mesh: MoldMesh,
  pullDirection: [number, number, number] = [0, 0, 1],
): PartingLineResult {
  // Per-triangle facing.
  const facing = mesh.triangles.map(t => Math.sign(dot3(t.normal, pullDirection)));

  // Map each edge to the triangles using it.
  const edgeToTris = new Map<string, number[]>();
  mesh.triangles.forEach((tri, idx) => {
    const [a, b, c] = tri.indices;
    for (const [u, v] of [[a, b], [b, c], [c, a]] as Array<[number, number]>) {
      const k = edgeKey(u, v);
      if (!edgeToTris.has(k)) edgeToTris.set(k, []);
      edgeToTris.get(k)!.push(idx);
    }
  });

  // Parting edges = edges between triangles whose facing differs.
  // Catches the strict sign-flip (+1 ↔ -1) AND transition-through-zero
  // (facing ↔ 0). The latter is where the parting line actually runs
  // for axis-aligned faces like a cube's silhouette.
  const partingEdges: Array<[number, number]> = [];
  for (const [key, tris] of edgeToTris) {
    if (tris.length !== 2) continue;
    const [t0, t1] = tris;
    if (facing[t0!] !== facing[t1!]) {
      const [a, b] = key.split('|').map(Number);
      partingEdges.push([a!, b!]);
    }
  }

  // Chain edges into loops.
  const loops = chainEdgesIntoLoops(partingEdges);

  return { loops, edgeCount: partingEdges.length };
}

function chainEdgesIntoLoops(edges: Array<[number, number]>): number[][] {
  if (edges.length === 0) return [];
  // Build vertex → incident edges.
  const incident = new Map<number, Array<{ otherIdx: number; edgeIdx: number; used: boolean }>>();
  edges.forEach(([a, b], i) => {
    if (!incident.has(a)) incident.set(a, []);
    if (!incident.has(b)) incident.set(b, []);
    incident.get(a)!.push({ otherIdx: b, edgeIdx: i, used: false });
    incident.get(b)!.push({ otherIdx: a, edgeIdx: i, used: false });
  });
  const loops: number[][] = [];
  for (const start of incident.keys()) {
    const firstAvail = incident.get(start)!.find(e => !e.used);
    if (!firstAvail) continue;
    firstAvail.used = true;
    const back = incident.get(firstAvail.otherIdx)!.find(e => e.edgeIdx === firstAvail.edgeIdx);
    if (back) back.used = true;
    const loop: number[] = [start, firstAvail.otherIdx];
    let safety = 0;
    while (loop[loop.length - 1] !== start && safety++ < 5000) {
      const cur = loop[loop.length - 1]!;
      const candidates = incident.get(cur) ?? [];
      const next = candidates.find(e => !e.used);
      if (!next) break;
      next.used = true;
      const rev = incident.get(next.otherIdx)!.find(e => e.edgeIdx === next.edgeIdx);
      if (rev) rev.used = true;
      if (next.otherIdx === start) break;
      loop.push(next.otherIdx);
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}
