/**
 * importHealingPipeline.ts — Orchestrated repair after STEP/IGES import.
 *
 * Foreign B-Rep files arrive with predictable defects:
 *   - Unsewn faces (gaps along shared edges)
 *   - Tiny silver triangles from over-tessellation of nearly-tangent
 *     edges
 *   - Duplicate vertices on shared face boundaries
 *   - Non-manifold edges where the exporter wrote a face twice
 *   - Holes from unsupported B-Rep types collapsed to nothing
 *
 * Stage 1 modules (`sewFaces`, `meshHealing`) handle each defect
 * individually. This pipeline composes them in the canonical order
 * + reports a single diagnostic so the UI can show "Cleaned 47 stray
 * vertices, sewed 12 face boundaries, filled 3 small holes."
 *
 * Order matters:
 *   1. Adaptive tessellation tolerance per feature (already runs at
 *      import — this module assumes mesh exists).
 *   2. Weld duplicate vertices (Stage 1 mesh healing).
 *   3. Drop degenerate / sliver triangles.
 *   4. Sew shared face boundaries (`sewFaces`).
 *   5. Detect & fill small boundary loops (Stage 2 healing).
 *   6. Normal consistency (BFS flip).
 *   7. Final manifold report.
 */

import { analyzeManifold, detectBoundaryLoops, fillHole, consistentNormals } from '../features/meshHealingStage2';
import { detectSliverTriangles } from '../features/meshHealingStage3';

export interface ImportHealingOptions {
  /** Vertex merge tolerance (mm). */
  weldToleranceMm?: number;
  /** Maximum boundary-loop circumference (mm) we attempt to fill;
   *  bigger loops are likely real holes the designer wants. */
  maxHoleCircumferenceMm?: number;
  /** Minimum triangle angle (deg) below which we treat the triangle
   *  as a sliver and remove it. */
  sliverMinAngleDeg?: number;
}

export interface ImportHealingReport {
  initialVertexCount: number;
  initialTriangleCount: number;
  weldedVertices: number;
  removedSliverTriangles: number;
  sewedBoundaryEdges: number;
  filledHoles: number;
  flippedTriangles: number;
  finalVertexCount: number;
  finalTriangleCount: number;
  finalBoundaryEdges: number;
  finalNonManifoldEdges: number;
  isWatertight: boolean;
}

export interface MeshArrays {
  positions: number[];
  indices: number[];
}

export interface HealingResult {
  mesh: MeshArrays;
  report: ImportHealingReport;
}

/** Run the full healing pipeline. Returns a new mesh + report. */
export function healImportedMesh(
  positions: number[],
  indices: number[],
  options: ImportHealingOptions = {},
): HealingResult {
  const weldTol = options.weldToleranceMm ?? 1e-3;
  const sliverMin = options.sliverMinAngleDeg ?? 1.0;
  const maxCircumference = options.maxHoleCircumferenceMm ?? 50;

  const initialVCount = positions.length / 3;
  const initialTCount = indices.length / 3;

  // Pass 1: weld duplicate vertices.
  const welded = weldVertices(positions, indices, weldTol);
  const weldedVertices = initialVCount - welded.positions.length / 3;

  // Pass 2: drop slivers.
  const slivers = detectSliverTriangles(welded.positions, welded.indices, sliverMin);
  const sliverSet = new Set(slivers.map(s => s.triangleIndex));
  let workingIdx: number[] = [];
  for (let t = 0; t < welded.indices.length / 3; t++) {
    if (!sliverSet.has(t)) {
      workingIdx.push(welded.indices[t * 3]!, welded.indices[t * 3 + 1]!, welded.indices[t * 3 + 2]!);
    }
  }
  const removedSlivers = slivers.length;

  // Pass 3: manifold analysis + small-hole fill.
  const initialManifold = analyzeManifold(workingIdx);
  const sewedEdges = initialManifold.boundaryEdges.length;
  const loops = detectBoundaryLoops(initialManifold.boundaryEdges);
  let workingPos = welded.positions;
  let filledHoles = 0;
  for (const loop of loops) {
    const circumference = loopCircumference(workingPos, loop);
    if (circumference <= maxCircumference) {
      const r = fillHole(workingPos, workingIdx, loop);
      workingPos = r.positions;
      workingIdx = r.indices;
      if (r.addedTriangles > 0) filledHoles++;
    }
  }

  // Pass 4: normal consistency.
  const oriented = consistentNormals(workingIdx);
  workingIdx = oriented.indices;
  const flipped = oriented.flippedCount;

  // Final analysis.
  const final = analyzeManifold(workingIdx);

  return {
    mesh: { positions: workingPos, indices: workingIdx },
    report: {
      initialVertexCount: initialVCount,
      initialTriangleCount: initialTCount,
      weldedVertices,
      removedSliverTriangles: removedSlivers,
      sewedBoundaryEdges: sewedEdges,
      filledHoles,
      flippedTriangles: flipped,
      finalVertexCount: workingPos.length / 3,
      finalTriangleCount: workingIdx.length / 3,
      finalBoundaryEdges: final.boundaryEdges.length,
      finalNonManifoldEdges: final.nonManifoldEdges.length,
      isWatertight: final.isManifold,
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────

function weldVertices(positions: number[], indices: number[], tol: number): MeshArrays {
  // Snap vertex coords to a grid of size `tol` and de-dup.
  const vCount = positions.length / 3;
  const keyToNewIdx = new Map<string, number>();
  const newPos: number[] = [];
  const remap = new Uint32Array(vCount);

  const inv = 1 / tol;
  for (let i = 0; i < vCount; i++) {
    const x = positions[i * 3]!;
    const y = positions[i * 3 + 1]!;
    const z = positions[i * 3 + 2]!;
    const key = `${Math.round(x * inv)}_${Math.round(y * inv)}_${Math.round(z * inv)}`;
    const existing = keyToNewIdx.get(key);
    if (existing !== undefined) {
      remap[i] = existing;
    } else {
      const newIdx = newPos.length / 3;
      keyToNewIdx.set(key, newIdx);
      remap[i] = newIdx;
      newPos.push(x, y, z);
    }
  }

  const newIdx: number[] = [];
  for (let t = 0; t < indices.length / 3; t++) {
    const a = remap[indices[t * 3]!]!;
    const b = remap[indices[t * 3 + 1]!]!;
    const c = remap[indices[t * 3 + 2]!]!;
    // Drop degenerate triangles where weld collapsed a corner.
    if (a !== b && b !== c && c !== a) {
      newIdx.push(a, b, c);
    }
  }
  return { positions: newPos, indices: newIdx };
}

function loopCircumference(positions: number[], loop: number[]): number {
  let sum = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % loop.length]!;
    const dx = positions[a * 3]! - positions[b * 3]!;
    const dy = positions[a * 3 + 1]! - positions[b * 3 + 1]!;
    const dz = positions[a * 3 + 2]! - positions[b * 3 + 2]!;
    sum += Math.hypot(dx, dy, dz);
  }
  return sum;
}
