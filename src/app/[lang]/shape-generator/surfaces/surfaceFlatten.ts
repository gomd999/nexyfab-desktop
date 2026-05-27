/**
 * surfaceFlatten.ts — Develop a doubly-curved surface to a flat
 * pattern (a.k.a. unfold / unroll / develop).
 *
 * SolidWorks "Surface Flatten" takes a non-developable surface (NURBS
 * with both directions curved) and produces an approximate flat
 * pattern, used for:
 *
 *   - Sheet metal forming (compound bends + dimples).
 *   - Composite ply layup — develop each ply onto flat fabric.
 *   - Architectural cladding — unroll the surface for fabrication.
 *
 * The math: a surface is *developable* (zero Gaussian curvature) iff
 * it can be unrolled flat without distortion. For doubly-curved
 * (non-zero K), we approximate by:
 *
 *   1. Tessellate the surface into triangles.
 *   2. Map each triangle to the plane preserving edge lengths
 *      (least-squares conformal map — LSCM).
 *   3. Solve for 2D coordinates that minimize stretch energy across
 *      shared edges.
 *
 * For preview, we ship a simpler **propagating planar unfold**:
 *   - Pick a seed triangle, lay it flat.
 *   - Walk neighbours via shared edges, unfold each preserving edge
 *     length but allowing angular distortion.
 *   - Report per-triangle stretch ratio as a quality metric.
 */

export interface SurfaceMesh {
  /** Flat positions array (3·N). */
  positions: number[];
  /** Triangle indices (3·M). */
  indices: number[];
}

export interface FlatPattern {
  /** 2D coordinates per vertex (2·N). */
  positions2D: number[];
  /** Per-triangle stretch ratio: 1 = ideal, > 1 = stretched. */
  stretchPerTriangle: number[];
  /** Maximum stretch (max over all triangles). */
  maxStretch: number;
  /** Per-triangle area ratio: 1 = preserved, > 1 = expanded. */
  areaRatioPerTriangle: number[];
  /** Bounding box of the flat pattern (mm). */
  bbox2D: { minX: number; minY: number; maxX: number; maxY: number };
}

// ── Triangle helpers ────────────────────────────────────────────

function triangleEdgeLengths(positions: number[], i0: number, i1: number, i2: number): [number, number, number] {
  const a = i0 * 3, b = i1 * 3, c = i2 * 3;
  const lab = Math.hypot(
    positions[a]! - positions[b]!,
    positions[a + 1]! - positions[b + 1]!,
    positions[a + 2]! - positions[b + 2]!,
  );
  const lbc = Math.hypot(
    positions[b]! - positions[c]!,
    positions[b + 1]! - positions[c + 1]!,
    positions[b + 2]! - positions[c + 2]!,
  );
  const lca = Math.hypot(
    positions[c]! - positions[a]!,
    positions[c + 1]! - positions[a + 1]!,
    positions[c + 2]! - positions[a + 2]!,
  );
  return [lab, lbc, lca];
}

function triangleArea3D(positions: number[], i0: number, i1: number, i2: number): number {
  const a = i0 * 3, b = i1 * 3, c = i2 * 3;
  const ax = positions[b]! - positions[a]!;
  const ay = positions[b + 1]! - positions[a + 1]!;
  const az = positions[b + 2]! - positions[a + 2]!;
  const bx = positions[c]! - positions[a]!;
  const by = positions[c + 1]! - positions[a + 1]!;
  const bz = positions[c + 2]! - positions[a + 2]!;
  return Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) / 2;
}

function triangleArea2D(positions2D: number[], i0: number, i1: number, i2: number): number {
  const a = i0 * 2, b = i1 * 2, c = i2 * 2;
  return Math.abs(
    (positions2D[b]! - positions2D[a]!) * (positions2D[c + 1]! - positions2D[a + 1]!)
    - (positions2D[c]! - positions2D[a]!) * (positions2D[b + 1]! - positions2D[a + 1]!),
  ) / 2;
}

// ── Propagating unfold ──────────────────────────────────────────

/** Place a triangle in 2D given its 3 edge lengths.
 *  Vertex A at origin, B along +x, C in upper half-plane. */
function placeTriangleByEdges(
  edgeLengths: [number, number, number],
): { a: [number, number]; b: [number, number]; c: [number, number] } {
  const [lab, lbc, lca] = edgeLengths;
  const a: [number, number] = [0, 0];
  const b: [number, number] = [lab, 0];
  // Triangle inequality: |lab - lca| ≤ lbc ≤ lab + lca.
  const cosA = (lab * lab + lca * lca - lbc * lbc) / (2 * lab * lca);
  const cosAClamped = Math.max(-1, Math.min(1, cosA));
  const angleA = Math.acos(cosAClamped);
  const c: [number, number] = [lca * Math.cos(angleA), lca * Math.sin(angleA)];
  return { a, b, c };
}

export function flattenSurface(mesh: SurfaceMesh): FlatPattern {
  const vertCount = mesh.positions.length / 3;
  const triCount = mesh.indices.length / 3;
  const positions2D = new Array<number>(vertCount * 2).fill(NaN);
  const stretchPerTri: number[] = new Array(triCount).fill(1);
  const areaRatioPerTri: number[] = new Array(triCount).fill(1);
  const visited = new Uint8Array(triCount);

  if (triCount === 0) {
    return {
      positions2D, stretchPerTriangle: stretchPerTri,
      maxStretch: 1,
      areaRatioPerTriangle: areaRatioPerTri,
      bbox2D: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    };
  }

  // Build edge → triangles map.
  const edgeKey = (u: number, v: number): string => u < v ? `${u}-${v}` : `${v}-${u}`;
  const edgeToTris = new Map<string, number[]>();
  for (let t = 0; t < triCount; t++) {
    const i0 = mesh.indices[t * 3]!;
    const i1 = mesh.indices[t * 3 + 1]!;
    const i2 = mesh.indices[t * 3 + 2]!;
    for (const [u, v] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const k = edgeKey(u as number, v as number);
      if (!edgeToTris.has(k)) edgeToTris.set(k, []);
      edgeToTris.get(k)!.push(t);
    }
  }

  // Seed: place triangle 0 flat.
  const seedI0 = mesh.indices[0]!, seedI1 = mesh.indices[1]!, seedI2 = mesh.indices[2]!;
  const seedEdges = triangleEdgeLengths(mesh.positions, seedI0, seedI1, seedI2);
  const seedPlacement = placeTriangleByEdges(seedEdges);
  positions2D[seedI0 * 2]     = seedPlacement.a[0]; positions2D[seedI0 * 2 + 1] = seedPlacement.a[1];
  positions2D[seedI1 * 2]     = seedPlacement.b[0]; positions2D[seedI1 * 2 + 1] = seedPlacement.b[1];
  positions2D[seedI2 * 2]     = seedPlacement.c[0]; positions2D[seedI2 * 2 + 1] = seedPlacement.c[1];
  visited[0] = 1;

  // BFS — unfold each neighbour by mirroring across shared edge.
  const queue: number[] = [0];
  while (queue.length > 0) {
    const t = queue.shift()!;
    const i0 = mesh.indices[t * 3]!;
    const i1 = mesh.indices[t * 3 + 1]!;
    const i2 = mesh.indices[t * 3 + 2]!;
    for (const [u, v, third] of [[i0, i1, i2], [i1, i2, i0], [i2, i0, i1]]) {
      const k = edgeKey(u as number, v as number);
      const neighbours = edgeToTris.get(k) ?? [];
      for (const nt of neighbours) {
        if (nt === t || visited[nt]) continue;
        visited[nt] = 1;
        // Find the *other* vertex of nt (not u, not v).
        const ni0 = mesh.indices[nt * 3]!;
        const ni1 = mesh.indices[nt * 3 + 1]!;
        const ni2 = mesh.indices[nt * 3 + 2]!;
        const candidates = [ni0, ni1, ni2];
        const otherVert = candidates.find(idx => idx !== u && idx !== v);
        if (otherVert == null) continue;
        // Edge lengths for the new triangle.
        const distU = Math.hypot(
          mesh.positions[u as number * 3]! - mesh.positions[otherVert * 3]!,
          mesh.positions[u as number * 3 + 1]! - mesh.positions[otherVert * 3 + 1]!,
          mesh.positions[u as number * 3 + 2]! - mesh.positions[otherVert * 3 + 2]!,
        );
        const distV = Math.hypot(
          mesh.positions[v as number * 3]! - mesh.positions[otherVert * 3]!,
          mesh.positions[v as number * 3 + 1]! - mesh.positions[otherVert * 3 + 1]!,
          mesh.positions[v as number * 3 + 2]! - mesh.positions[otherVert * 3 + 2]!,
        );
        // Place otherVert in 2D using known positions of u, v.
        const uPos: [number, number] = [positions2D[(u as number) * 2]!, positions2D[(u as number) * 2 + 1]!];
        const vPos: [number, number] = [positions2D[(v as number) * 2]!, positions2D[(v as number) * 2 + 1]!];
        const uvLen = Math.hypot(vPos[0] - uPos[0], vPos[1] - uPos[1]);
        if (uvLen === 0) continue;
        // Project along uv from u, then perpendicular by height.
        const cosA = (uvLen * uvLen + distU * distU - distV * distV) / (2 * uvLen * distU);
        const cosAClamped = Math.max(-1, Math.min(1, cosA));
        const angleA = Math.acos(cosAClamped);
        const fwd: [number, number] = [(vPos[0] - uPos[0]) / uvLen, (vPos[1] - uPos[1]) / uvLen];
        // Perp = rotated 90° (away from existing 3rd vertex side).
        const perp: [number, number] = [-fwd[1], fwd[0]];
        const otherPos: [number, number] = [
          uPos[0] + distU * Math.cos(angleA) * fwd[0] + distU * Math.sin(angleA) * perp[0],
          uPos[1] + distU * Math.cos(angleA) * fwd[1] + distU * Math.sin(angleA) * perp[1],
        ];
        // Flip if same side as 'third' (a vertex from triangle t).
        const thirdPos: [number, number] = [positions2D[(third as number) * 2]!, positions2D[(third as number) * 2 + 1]!];
        const sideThird = (thirdPos[0] - uPos[0]) * perp[0] + (thirdPos[1] - uPos[1]) * perp[1];
        if (sideThird >= 0) {
          // Mirror — neighbour should be on the *opposite* side.
          otherPos[0] = uPos[0] + distU * Math.cos(angleA) * fwd[0] - distU * Math.sin(angleA) * perp[0];
          otherPos[1] = uPos[1] + distU * Math.cos(angleA) * fwd[1] - distU * Math.sin(angleA) * perp[1];
        }
        positions2D[otherVert * 2] = otherPos[0];
        positions2D[otherVert * 2 + 1] = otherPos[1];
        queue.push(nt);
      }
    }
  }

  // Fill any unvisited triangles' vertices that weren't placed.
  for (let i = 0; i < vertCount; i++) {
    if (Number.isNaN(positions2D[i * 2]!)) {
      positions2D[i * 2] = 0;
      positions2D[i * 2 + 1] = 0;
    }
  }

  // Compute per-triangle stretch + area ratio.
  let maxStretch = 1;
  for (let t = 0; t < triCount; t++) {
    const i0 = mesh.indices[t * 3]!;
    const i1 = mesh.indices[t * 3 + 1]!;
    const i2 = mesh.indices[t * 3 + 2]!;
    const a3d = triangleArea3D(mesh.positions, i0, i1, i2);
    const a2d = triangleArea2D(positions2D, i0, i1, i2);
    const ratio = a3d > 0 ? a2d / a3d : 1;
    areaRatioPerTri[t] = ratio;
    const stretch = Math.max(ratio, 1 / Math.max(ratio, 1e-6));
    stretchPerTri[t] = stretch;
    if (stretch > maxStretch) maxStretch = stretch;
  }

  // Bbox.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < vertCount; i++) {
    const x = positions2D[i * 2]!, y = positions2D[i * 2 + 1]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  return {
    positions2D,
    stretchPerTriangle: stretchPerTri,
    maxStretch,
    areaRatioPerTriangle: areaRatioPerTri,
    bbox2D: { minX, minY, maxX, maxY },
  };
}

// ── Gaussian curvature estimate ─────────────────────────────────

/** Per-vertex Gaussian curvature from angle defect:
 *  K_v ≈ (2π - Σ θ_i) / A_v, A_v = 1/3 sum of incident triangle areas.
 *  Output is per-vertex. Sum is 2π·χ for closed surface (Gauss-Bonnet). */
export function gaussianCurvature(mesh: SurfaceMesh): number[] {
  const vertCount = mesh.positions.length / 3;
  const angleSum = new Array(vertCount).fill(0);
  const areaSum = new Array(vertCount).fill(0);
  for (let t = 0; t < mesh.indices.length / 3; t++) {
    const i0 = mesh.indices[t * 3]!;
    const i1 = mesh.indices[t * 3 + 1]!;
    const i2 = mesh.indices[t * 3 + 2]!;
    const [lab, lbc, lca] = triangleEdgeLengths(mesh.positions, i0, i1, i2);
    // Cosine rule for each angle.
    const cosA = clampUnit((lab * lab + lca * lca - lbc * lbc) / (2 * lab * lca));
    const cosB = clampUnit((lab * lab + lbc * lbc - lca * lca) / (2 * lab * lbc));
    const cosC = clampUnit((lbc * lbc + lca * lca - lab * lab) / (2 * lbc * lca));
    angleSum[i0] += Math.acos(cosA);
    angleSum[i1] += Math.acos(cosB);
    angleSum[i2] += Math.acos(cosC);
    const area = triangleArea3D(mesh.positions, i0, i1, i2);
    areaSum[i0] += area / 3;
    areaSum[i1] += area / 3;
    areaSum[i2] += area / 3;
  }
  const k: number[] = new Array(vertCount);
  for (let i = 0; i < vertCount; i++) {
    k[i] = areaSum[i] > 0 ? (2 * Math.PI - angleSum[i]) / areaSum[i] : 0;
  }
  return k;
}

function clampUnit(x: number): number { return Math.max(-1, Math.min(1, x)); }

/** True developable surface has K ≈ 0 everywhere. */
export function isDevelopable(mesh: SurfaceMesh, threshold: number = 1e-3): boolean {
  const k = gaussianCurvature(mesh);
  return k.every(v => Math.abs(v) < threshold);
}
