/**
 * meshTopology.ts — Detailed topology analysis beyond what
 * `meshValidation` summarises. Where validation answers "is this
 * mesh OCCT-ready?", this module answers "what's structurally wrong
 * with the mesh and where?"
 *
 * Outputs are structured so callers (DFM panels, burn-in cron) can
 * highlight problem regions in the viewport or attach precise
 * locations to bug reports.
 *
 * Checks:
 *   - Edge-face count per edge (1 = boundary, 2 = manifold,
 *     3+ = non-manifold).
 *   - Boundary edges → if non-zero, mesh is "open" (not a closed
 *     solid). OCCT booleans require closed meshes.
 *   - Edge orientation consistency on shared edges → flips indicate
 *     reversed face winding, which breaks normal-aware operations.
 *   - Isolated vertices with their coordinates.
 *
 * Self-intersection detection is intentionally NOT in this module —
 * it's O(n²) worst-case and lands in a separate cron-only suite.
 */

import * as THREE from 'three';

export type EdgeKind = 'boundary' | 'manifold' | 'non-manifold';

export interface EdgeReport {
  /** Lower vertex index of the edge endpoints. */
  v0: number;
  /** Higher vertex index of the edge endpoints. */
  v1: number;
  /** How many triangles share this edge. */
  faceCount: number;
  kind: EdgeKind;
  /** True when the two adjacent faces traverse this edge in the same
   *  direction (winding flip — bad). Always false for boundary edges
   *  and indeterminate (false) for non-manifold edges. */
  windingFlip: boolean;
}

export interface IsolatedVertexReport {
  index: number;
  position: [number, number, number];
}

export interface TopologyReport {
  /** Total triangles + vertices in the mesh. */
  triangleCount: number;
  vertexCount: number;
  /** Per-kind tallies for the UI badge. */
  boundaryEdgeCount: number;
  manifoldEdgeCount: number;
  nonManifoldEdgeCount: number;
  /** Edges classified as non-boundary / non-manifold / winding-flipped.
   *  Empty arrays when the mesh is clean. Capped at `sampleLimit` so
   *  pathological inputs don't blow up the report size. */
  nonManifoldEdges: EdgeReport[];
  boundaryEdges: EdgeReport[];
  windingFlipEdges: EdgeReport[];
  /** Vertices not referenced by any triangle. */
  isolatedVertices: IsolatedVertexReport[];
  /** True when the mesh is closed (no boundary edges) and manifold
   *  (every edge shared by exactly 2 faces with consistent winding). */
  isClosedManifold: boolean;
}

export interface TopologyOptions {
  /** Cap on each reported edge / vertex list. Default 100. */
  sampleLimit?: number;
}

const DEFAULT_LIMIT = 100;

/**
 * Build a full topology report. Single linear pass over triangles
 * (O(F)) plus one pass over the edge map (O(E)) — runs in ms even on
 * 100k-tri meshes.
 */
export function analyzeTopology(
  geometry: THREE.BufferGeometry,
  opts: TopologyOptions = {},
): TopologyReport {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  const idx = geometry.index;
  const limit = opts.sampleLimit ?? DEFAULT_LIMIT;

  if (!pos) {
    return {
      triangleCount: 0, vertexCount: 0,
      boundaryEdgeCount: 0, manifoldEdgeCount: 0, nonManifoldEdgeCount: 0,
      nonManifoldEdges: [], boundaryEdges: [], windingFlipEdges: [],
      isolatedVertices: [],
      isClosedManifold: false,
    };
  }

  const vertexCount = pos.count;
  const triCount = idx ? idx.count / 3 : pos.count / 3;

  // Weld coincident vertices by quantised position. THREE primitives (and STL
  // imports) duplicate face-corner vertices — a BoxGeometry has 24 positions,
  // not 8 — so two faces meeting at an edge reference DIFFERENT indices for the
  // same point. Keying edges by raw index would then read every shared edge as
  // two boundary edges, falsely classifying every closed solid as "open". We
  // map each vertex to a canonical index by position and key edges on that, so
  // manifold/boundary classification reflects real geometry. (Isolated-vertex
  // reporting below still uses raw indices.)
  const QUANT = 1e5; // 1e-5 mm buckets
  const canon = new Int32Array(vertexCount);
  const posKeyToCanon = new Map<string, number>();
  for (let i = 0; i < vertexCount; i++) {
    const pk = `${Math.round(pos.getX(i) * QUANT)},${Math.round(pos.getY(i) * QUANT)},${Math.round(pos.getZ(i) * QUANT)}`;
    const existing = posKeyToCanon.get(pk);
    if (existing === undefined) { posKeyToCanon.set(pk, i); canon[i] = i; }
    else canon[i] = existing;
  }

  // Edge map: key = `v0|v1` (sorted canonical indices), value = list of
  // (face, fromV, toV) tuples. Tracking from→to lets us detect winding flips.
  interface EdgeOccurrence { face: number; from: number; to: number; }
  const edgeMap = new Map<string, EdgeOccurrence[]>();
  const referenced = new Set<number>();

  const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    referenced.add(i0); referenced.add(i1); referenced.add(i2);
    const c0 = canon[i0], c1 = canon[i1], c2 = canon[i2];
    const edges: Array<[number, number]> = [[c0, c1], [c1, c2], [c2, c0]];
    for (const [from, to] of edges) {
      if (from === to) continue; // degenerate (welded-collapsed) edge
      const k = key(from, to);
      const occs = edgeMap.get(k);
      const occ: EdgeOccurrence = { face: t, from, to };
      if (occs) occs.push(occ);
      else edgeMap.set(k, [occ]);
    }
  }

  const nonManifoldEdges: EdgeReport[] = [];
  const boundaryEdges: EdgeReport[] = [];
  const windingFlipEdges: EdgeReport[] = [];
  let boundaryCount = 0;
  let manifoldCount = 0;
  let nonManifoldCount = 0;

  for (const [k, occs] of edgeMap) {
    const [v0Str, v1Str] = k.split('|');
    const v0 = Number(v0Str);
    const v1 = Number(v1Str);
    const faceCount = occs.length;

    if (faceCount === 1) {
      boundaryCount++;
      if (boundaryEdges.length < limit) {
        boundaryEdges.push({ v0, v1, faceCount, kind: 'boundary', windingFlip: false });
      }
    } else if (faceCount === 2) {
      manifoldCount++;
      // Winding consistency: in a closed manifold the two adjacent
      // faces should traverse the shared edge in OPPOSITE directions
      // (one face goes from→to, the other to→from). Same direction
      // both sides = winding flip → breaks normal computation.
      const [a, b] = occs;
      const sameDir = a.from === b.from && a.to === b.to;
      if (sameDir && windingFlipEdges.length < limit) {
        windingFlipEdges.push({ v0, v1, faceCount, kind: 'manifold', windingFlip: true });
      }
    } else {
      nonManifoldCount++;
      if (nonManifoldEdges.length < limit) {
        nonManifoldEdges.push({ v0, v1, faceCount, kind: 'non-manifold', windingFlip: false });
      }
    }
  }

  const isolatedVertices: IsolatedVertexReport[] = [];
  for (let i = 0; i < vertexCount; i++) {
    if (!referenced.has(i)) {
      if (isolatedVertices.length < limit) {
        isolatedVertices.push({
          index: i,
          position: [pos.getX(i), pos.getY(i), pos.getZ(i)],
        });
      }
    }
  }

  const isClosedManifold =
    boundaryCount === 0 &&
    nonManifoldCount === 0 &&
    windingFlipEdges.length === 0;

  return {
    triangleCount: triCount,
    vertexCount,
    boundaryEdgeCount: boundaryCount,
    manifoldEdgeCount: manifoldCount,
    nonManifoldEdgeCount: nonManifoldCount,
    nonManifoldEdges,
    boundaryEdges,
    windingFlipEdges,
    isolatedVertices,
    isClosedManifold,
  };
}
