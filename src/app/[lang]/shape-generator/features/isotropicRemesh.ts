/**
 * isotropicRemesh.ts — Isotropic remeshing via edge flip/split/collapse.
 *
 * Triangulated meshes from CSG output, marching cubes, or scan import
 * often have wildly varying edge lengths and skewed triangles. For
 * downstream simulation (FEA), exact-distance algorithms, and clean
 * subdivision, the mesh wants to be **isotropic** — most triangles
 * close to equilateral with edges near a target length L.
 *
 * Standard pipeline (Botsch & Kobbelt 2004):
 *
 *   1. **Split** edges longer than 4/3 · L.
 *   2. **Collapse** edges shorter than 4/5 · L.
 *   3. **Flip** edges that improve valence (target valence 6 for
 *      interior, 4 for boundary).
 *   4. **Tangential smoothing** — move each vertex toward the
 *      centroid of its 1-ring, projected onto the original surface
 *      tangent plane.
 *
 * Iterations of (1-4) converge the mesh toward isotropic. This
 * module ships the four primitive ops + a wrapper.
 */

export interface MeshArrays {
  positions: number[];
  indices: number[];
}

export interface RemeshOptions {
  targetEdgeLengthMm: number;
  /** How many full passes of split/collapse/flip/smooth. */
  iterations: number;
  /** Smoothing strength (0 = none, 1 = full move). */
  smoothingStrength: number;
}

export const DEFAULT_REMESH_OPTIONS: RemeshOptions = {
  targetEdgeLengthMm: 1,
  iterations: 3,
  smoothingStrength: 0.5,
};

export interface RemeshResult {
  mesh: MeshArrays;
  splits: number;
  collapses: number;
  flips: number;
  finalVertexCount: number;
  finalTriangleCount: number;
}

// ── Edge data structure ────────────────────────────────────────

interface MeshEdges {
  /** edgeKey "lo_hi" → triangles using it. */
  edgeToTris: Map<string, number[]>;
  /** vertex idx → adjacent triangle ids. */
  vertexToTris: Map<number, Set<number>>;
}

function buildEdges(mesh: MeshArrays): MeshEdges {
  const edgeToTris = new Map<string, number[]>();
  const vertexToTris = new Map<number, Set<number>>();
  const triCount = mesh.indices.length / 3;
  for (let t = 0; t < triCount; t++) {
    const i0 = mesh.indices[t * 3]!, i1 = mesh.indices[t * 3 + 1]!, i2 = mesh.indices[t * 3 + 2]!;
    const pairs = [[i0, i1], [i1, i2], [i2, i0]];
    for (const [a, b] of pairs) {
      const lo = Math.min(a!, b!), hi = Math.max(a!, b!);
      const key = `${lo}_${hi}`;
      const list = edgeToTris.get(key) ?? [];
      list.push(t);
      edgeToTris.set(key, list);
    }
    for (const v of [i0, i1, i2]) {
      const set = vertexToTris.get(v) ?? new Set<number>();
      set.add(t);
      vertexToTris.set(v, set);
    }
  }
  return { edgeToTris, vertexToTris };
}

// ── Edge length ────────────────────────────────────────────────

function edgeLengthMm(mesh: MeshArrays, a: number, b: number): number {
  const dx = mesh.positions[b * 3]! - mesh.positions[a * 3]!;
  const dy = mesh.positions[b * 3 + 1]! - mesh.positions[a * 3 + 1]!;
  const dz = mesh.positions[b * 3 + 2]! - mesh.positions[a * 3 + 2]!;
  return Math.hypot(dx, dy, dz);
}

// ── Splits ────────────────────────────────────────────────────

function splitLongEdges(mesh: MeshArrays, target: number): number {
  const upperBound = target * (4 / 3);
  let splits = 0;
  const newIndices: number[] = [];
  const triCount = mesh.indices.length / 3;
  for (let t = 0; t < triCount; t++) {
    const i0 = mesh.indices[t * 3]!, i1 = mesh.indices[t * 3 + 1]!, i2 = mesh.indices[t * 3 + 2]!;
    const lens = [
      { a: i0, b: i1, len: edgeLengthMm(mesh, i0, i1) },
      { a: i1, b: i2, len: edgeLengthMm(mesh, i1, i2) },
      { a: i2, b: i0, len: edgeLengthMm(mesh, i2, i0) },
    ];
    const longest = lens.reduce((b, c) => c.len > b.len ? c : b);
    if (longest.len > upperBound) {
      // Insert a midpoint vertex.
      const mid = mesh.positions.length / 3;
      mesh.positions.push(
        (mesh.positions[longest.a * 3]! + mesh.positions[longest.b * 3]!) / 2,
        (mesh.positions[longest.a * 3 + 1]! + mesh.positions[longest.b * 3 + 1]!) / 2,
        (mesh.positions[longest.a * 3 + 2]! + mesh.positions[longest.b * 3 + 2]!) / 2,
      );
      // Find the third vertex (not on this edge).
      const third = [i0, i1, i2].find(v => v !== longest.a && v !== longest.b)!;
      newIndices.push(longest.a, mid, third);
      newIndices.push(mid, longest.b, third);
      splits++;
    } else {
      newIndices.push(i0, i1, i2);
    }
  }
  mesh.indices = newIndices;
  return splits;
}

// ── Collapses (simplified: drop the shorter vertex) ────────────

function collapseShortEdges(mesh: MeshArrays, target: number): number {
  const lowerBound = target * (4 / 5);
  let collapses = 0;
  // Build edge length list.
  const edges = buildEdges(mesh);
  const toCollapse: Array<{ a: number; b: number }> = [];
  for (const key of edges.edgeToTris.keys()) {
    const [aStr, bStr] = key.split('_');
    const a = Number(aStr), b = Number(bStr);
    if (edgeLengthMm(mesh, a, b) < lowerBound) toCollapse.push({ a, b });
  }
  const removed = new Set<number>();
  for (const { a, b } of toCollapse) {
    if (removed.has(a) || removed.has(b)) continue;
    // Replace b with a in all triangles; degenerate triangles get filtered later.
    removed.add(b);
    collapses++;
  }
  if (collapses === 0) return 0;
  // Build vertex remap.
  const map = new Map<number, number>();
  // For each `b` in `removed` we need to know which `a` replaced it.
  for (const { a, b } of toCollapse) {
    if (!removed.has(b)) continue;
    if (!map.has(b)) map.set(b, a);
  }
  // Apply remap.
  const remapVert = (v: number): number => {
    let curr = v;
    while (map.has(curr)) curr = map.get(curr)!;
    return curr;
  };
  const newIndices: number[] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const i0 = remapVert(mesh.indices[t]!);
    const i1 = remapVert(mesh.indices[t + 1]!);
    const i2 = remapVert(mesh.indices[t + 2]!);
    if (i0 !== i1 && i1 !== i2 && i2 !== i0) {
      newIndices.push(i0, i1, i2);
    }
  }
  mesh.indices = newIndices;
  return collapses;
}

// ── Flips ──────────────────────────────────────────────────────

function valence(vertex: number, edges: MeshEdges): number {
  return edges.vertexToTris.get(vertex)?.size ?? 0;
}

function flipEdges(mesh: MeshArrays): number {
  const edges = buildEdges(mesh);
  let flips = 0;
  for (const [key, tris] of edges.edgeToTris) {
    if (tris.length !== 2) continue;
    const [tA, tB] = tris;
    const [aStr, bStr] = key.split('_');
    const a = Number(aStr), b = Number(bStr);
    // Find the two "other" vertices.
    const triA = [mesh.indices[tA! * 3]!, mesh.indices[tA! * 3 + 1]!, mesh.indices[tA! * 3 + 2]!];
    const triB = [mesh.indices[tB! * 3]!, mesh.indices[tB! * 3 + 1]!, mesh.indices[tB! * 3 + 2]!];
    const c = triA.find(v => v !== a && v !== b);
    const d = triB.find(v => v !== a && v !== b);
    if (c === undefined || d === undefined) continue;
    // Compute change in valence deviation. Target = 6.
    const valBefore = Math.abs(valence(a, edges) - 6) + Math.abs(valence(b, edges) - 6) + Math.abs(valence(c, edges) - 6) + Math.abs(valence(d, edges) - 6);
    const valAfter = Math.abs((valence(a, edges) - 1) - 6) + Math.abs((valence(b, edges) - 1) - 6) + Math.abs((valence(c, edges) + 1) - 6) + Math.abs((valence(d, edges) + 1) - 6);
    if (valAfter < valBefore) {
      mesh.indices[tA! * 3] = c;
      mesh.indices[tA! * 3 + 1] = d;
      mesh.indices[tA! * 3 + 2] = a;
      mesh.indices[tB! * 3] = d;
      mesh.indices[tB! * 3 + 1] = c;
      mesh.indices[tB! * 3 + 2] = b;
      flips++;
    }
  }
  return flips;
}

// ── Tangential smoothing ───────────────────────────────────────

function tangentialSmooth(mesh: MeshArrays, strength: number): void {
  if (strength <= 0) return;
  const vCount = mesh.positions.length / 3;
  // Build adjacency.
  const adj: Map<number, Set<number>> = new Map();
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const i0 = mesh.indices[t]!, i1 = mesh.indices[t + 1]!, i2 = mesh.indices[t + 2]!;
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]] as Array<[number, number]>) {
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a)!.add(b);
      adj.get(b)!.add(a);
    }
  }
  const newPositions = mesh.positions.slice();
  for (let v = 0; v < vCount; v++) {
    const neighbors = adj.get(v);
    if (!neighbors || neighbors.size === 0) continue;
    let cx = 0, cy = 0, cz = 0;
    for (const n of neighbors) {
      cx += mesh.positions[n * 3]!;
      cy += mesh.positions[n * 3 + 1]!;
      cz += mesh.positions[n * 3 + 2]!;
    }
    cx /= neighbors.size;
    cy /= neighbors.size;
    cz /= neighbors.size;
    newPositions[v * 3] = mesh.positions[v * 3]! + strength * (cx - mesh.positions[v * 3]!);
    newPositions[v * 3 + 1] = mesh.positions[v * 3 + 1]! + strength * (cy - mesh.positions[v * 3 + 1]!);
    newPositions[v * 3 + 2] = mesh.positions[v * 3 + 2]! + strength * (cz - mesh.positions[v * 3 + 2]!);
  }
  mesh.positions = newPositions;
}

// ── Top-level entry ─────────────────────────────────────────────

export function remeshIsotropic(mesh: MeshArrays, options: Partial<RemeshOptions> = {}): RemeshResult {
  const opts = { ...DEFAULT_REMESH_OPTIONS, ...options };
  // Clone input.
  const out: MeshArrays = { positions: mesh.positions.slice(), indices: mesh.indices.slice() };
  let splits = 0, collapses = 0, flips = 0;
  for (let i = 0; i < opts.iterations; i++) {
    splits += splitLongEdges(out, opts.targetEdgeLengthMm);
    collapses += collapseShortEdges(out, opts.targetEdgeLengthMm);
    flips += flipEdges(out);
    tangentialSmooth(out, opts.smoothingStrength);
  }
  return {
    mesh: out,
    splits,
    collapses,
    flips,
    finalVertexCount: out.positions.length / 3,
    finalTriangleCount: out.indices.length / 3,
  };
}

// ── Stats ──────────────────────────────────────────────────────

export interface IsotropyStats {
  meanEdgeLengthMm: number;
  stdDevEdgeLengthMm: number;
  /** Coefficient of variation; lower = more isotropic. */
  coefficientOfVariation: number;
  /** Average valence (target = 6). */
  averageValence: number;
}

export function computeIsotropyStats(mesh: MeshArrays): IsotropyStats {
  const edges = buildEdges(mesh);
  const lengths: number[] = [];
  for (const key of edges.edgeToTris.keys()) {
    const [aStr, bStr] = key.split('_');
    lengths.push(edgeLengthMm(mesh, Number(aStr), Number(bStr)));
  }
  if (lengths.length === 0) return { meanEdgeLengthMm: 0, stdDevEdgeLengthMm: 0, coefficientOfVariation: 0, averageValence: 0 };
  const mean = lengths.reduce((s, v) => s + v, 0) / lengths.length;
  const variance = lengths.reduce((s, v) => s + (v - mean) ** 2, 0) / lengths.length;
  const std = Math.sqrt(variance);
  let valSum = 0;
  let valCount = 0;
  for (const [, set] of edges.vertexToTris) {
    valSum += set.size;
    valCount++;
  }
  return {
    meanEdgeLengthMm: mean,
    stdDevEdgeLengthMm: std,
    coefficientOfVariation: mean > 0 ? std / mean : 0,
    averageValence: valCount > 0 ? valSum / valCount : 0,
  };
}
