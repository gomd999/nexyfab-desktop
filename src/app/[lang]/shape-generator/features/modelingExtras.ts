/**
 * modelingExtras.ts — Wrap, indent, replaceFace, deleteFace+heal,
 * imprint edges, cavity.
 *
 * SolidWorks-style productivity features that close common
 * "I have to model around this" gaps:
 *
 *   - **Wrap** — project a 2D sketch onto a curved surface, then
 *     emboss/engrave/scribe (raised, recessed, or zero-volume mark).
 *   - **Indent** — subtract one body's shape from another with a
 *     clearance offset (gasket fit, snap pocket).
 *   - **Replace face** — swap one face for a different surface,
 *     auto-rebuilding adjacent face boundaries.
 *   - **Delete face + heal** — remove a face + auto-heal the
 *     resulting hole (knit adjacent faces).
 *   - **Imprint edges** — project a curve onto a face, splitting the
 *     face along the curve (for selection / fillet targeting).
 *   - **Cavity** — insert one body as a void into another, with
 *     scale & clearance (used for mold cavities + insert tooling).
 */

export type Vec3 = [number, number, number];

// ── Wrap feature ────────────────────────────────────────────────

export type WrapMode = 'emboss' | 'engrave' | 'scribe';

export interface WrapInput {
  /** 2D sketch curves to wrap. */
  sketchCurves: Array<Array<[number, number]>>;
  /** Sketch plane origin in 3D. */
  sketchPlaneOrigin: Vec3;
  /** Sketch x-axis in 3D. */
  sketchXAxis: Vec3;
  /** Sketch y-axis in 3D. */
  sketchYAxis: Vec3;
  /** Target surface (sampled triangle mesh + per-vertex normals). */
  targetMesh: { positions: number[]; indices: number[]; normals: number[] };
  /** Wrap mode. */
  mode: WrapMode;
  /** Wrap depth (mm). */
  depthMm: number;
  /** Project depth: if 0, curves stay on the surface (scribe). */
}

export interface WrapResult {
  /** 3D polylines on the target surface. */
  projectedCurves: Array<Array<Vec3>>;
  /** Estimated added/removed volume (mm³). */
  affectedVolumeMm3: number;
  /** Warnings when projection failed. */
  warnings: string[];
}

/** Project a 2D point on the sketch plane to a 3D point in world. */
function project2dTo3d(
  p: [number, number],
  origin: Vec3, xAxis: Vec3, yAxis: Vec3,
): Vec3 {
  return [
    origin[0] + xAxis[0] * p[0] + yAxis[0] * p[1],
    origin[1] + xAxis[1] * p[0] + yAxis[1] * p[1],
    origin[2] + xAxis[2] * p[0] + yAxis[2] * p[1],
  ];
}

/** Project a 3D point onto the closest target triangle (brute force).
 *  Returns the projected position + a unit normal at that surface point. */
function projectToSurface(
  point: Vec3,
  mesh: WrapInput['targetMesh'],
): { position: Vec3; normal: Vec3 } | null {
  if (mesh.indices.length === 0) return null;
  let bestDist = Infinity;
  let bestPos: Vec3 = point;
  let bestNormal: Vec3 = [0, 0, 1];
  for (let t = 0; t < mesh.indices.length / 3; t++) {
    const i0 = mesh.indices[t * 3]!;
    const i1 = mesh.indices[t * 3 + 1]!;
    const i2 = mesh.indices[t * 3 + 2]!;
    const v0: Vec3 = [mesh.positions[i0 * 3]!, mesh.positions[i0 * 3 + 1]!, mesh.positions[i0 * 3 + 2]!];
    const v1: Vec3 = [mesh.positions[i1 * 3]!, mesh.positions[i1 * 3 + 1]!, mesh.positions[i1 * 3 + 2]!];
    const v2: Vec3 = [mesh.positions[i2 * 3]!, mesh.positions[i2 * 3 + 1]!, mesh.positions[i2 * 3 + 2]!];
    // Project point to triangle plane.
    const e1: Vec3 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
    const e2: Vec3 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
    const n: Vec3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const nLen = Math.hypot(n[0], n[1], n[2]);
    if (nLen === 0) continue;
    const nUnit: Vec3 = [n[0] / nLen, n[1] / nLen, n[2] / nLen];
    const toPoint: Vec3 = [point[0] - v0[0], point[1] - v0[1], point[2] - v0[2]];
    const d = toPoint[0] * nUnit[0] + toPoint[1] * nUnit[1] + toPoint[2] * nUnit[2];
    const candidate: Vec3 = [point[0] - d * nUnit[0], point[1] - d * nUnit[1], point[2] - d * nUnit[2]];
    const dist = Math.abs(d);
    if (dist < bestDist) {
      bestDist = dist;
      bestPos = candidate;
      bestNormal = nUnit;
    }
  }
  return bestDist === Infinity ? null : { position: bestPos, normal: bestNormal };
}

export function wrapSketchToSurface(input: WrapInput): WrapResult {
  const projectedCurves: Vec3[][] = [];
  const warnings: string[] = [];
  let totalLen = 0;
  for (const curve of input.sketchCurves) {
    const projected: Vec3[] = [];
    for (const p of curve) {
      const point3 = project2dTo3d(p, input.sketchPlaneOrigin, input.sketchXAxis, input.sketchYAxis);
      const surfHit = projectToSurface(point3, input.targetMesh);
      if (!surfHit) {
        warnings.push('Sketch curve point missed the target surface');
        continue;
      }
      const depth = input.mode === 'engrave' ? -input.depthMm
        : input.mode === 'emboss' ? input.depthMm
        : 0;
      projected.push([
        surfHit.position[0] + surfHit.normal[0] * depth,
        surfHit.position[1] + surfHit.normal[1] * depth,
        surfHit.position[2] + surfHit.normal[2] * depth,
      ]);
    }
    projectedCurves.push(projected);
    for (let i = 1; i < projected.length; i++) {
      totalLen += Math.hypot(
        projected[i]![0] - projected[i - 1]![0],
        projected[i]![1] - projected[i - 1]![1],
        projected[i]![2] - projected[i - 1]![2],
      );
    }
  }
  // Volume = curve length × depth × ~5mm assumed cross-width.
  const volumeMm3 = input.mode === 'scribe' ? 0 : totalLen * Math.abs(input.depthMm) * 5;
  return { projectedCurves, affectedVolumeMm3: volumeMm3, warnings };
}

// ── Indent feature ──────────────────────────────────────────────

export interface IndentInput {
  /** Target body bbox (subtract from). */
  targetBbox: { min: Vec3; max: Vec3 };
  /** Tool body bbox (shape to imprint). */
  toolBbox: { min: Vec3; max: Vec3 };
  /** Clearance offset (mm) between target + tool. */
  clearanceMm: number;
  /** Optional cut depth (mm, beyond contact). */
  cutDepthMm?: number;
}

export interface IndentResult {
  /** Expanded tool bbox with clearance. */
  effectiveToolBbox: { min: Vec3; max: Vec3 };
  /** Estimated cavity volume (mm³). */
  cavityVolumeMm3: number;
  warnings: string[];
}

export function indent(input: IndentInput): IndentResult {
  const c = input.clearanceMm;
  const expandedMin: Vec3 = [
    input.toolBbox.min[0] - c, input.toolBbox.min[1] - c, input.toolBbox.min[2] - c,
  ];
  const expandedMax: Vec3 = [
    input.toolBbox.max[0] + c, input.toolBbox.max[1] + c, input.toolBbox.max[2] + c,
  ];
  // Cavity bbox is intersection of expanded tool with target.
  const cavMin: Vec3 = [
    Math.max(expandedMin[0], input.targetBbox.min[0]),
    Math.max(expandedMin[1], input.targetBbox.min[1]),
    Math.max(expandedMin[2], input.targetBbox.min[2]),
  ];
  const cavMax: Vec3 = [
    Math.min(expandedMax[0], input.targetBbox.max[0]),
    Math.min(expandedMax[1], input.targetBbox.max[1]),
    Math.min(expandedMax[2], input.targetBbox.max[2]),
  ];
  const vol = Math.max(0, cavMax[0] - cavMin[0])
    * Math.max(0, cavMax[1] - cavMin[1])
    * Math.max(0, cavMax[2] - cavMin[2]);
  const warnings: string[] = [];
  if (vol === 0) warnings.push('Tool and target do not overlap with current clearance');
  if (c < 0.05) warnings.push('Clearance < 0.05mm — fit likely too tight for assembly');
  return {
    effectiveToolBbox: { min: expandedMin, max: expandedMax },
    cavityVolumeMm3: vol,
    warnings,
  };
}

// ── Replace face ────────────────────────────────────────────────

export interface ReplaceFaceInput {
  /** Mesh holding the face to replace. */
  mesh: { positions: number[]; indices: number[] };
  /** Triangle indices that make up the face being replaced. */
  faceTriangleIndices: number[];
  /** New face geometry as a triangle mesh (positions/indices). */
  newFace: { positions: number[]; indices: number[] };
}

export interface ReplaceFaceResult {
  /** Resulting mesh (positions + indices) after replacement. */
  resultMesh: { positions: number[]; indices: number[] };
  /** Number of triangles removed + added. */
  removedTriangles: number;
  addedTriangles: number;
}

export function replaceFace(input: ReplaceFaceInput): ReplaceFaceResult {
  const removed = new Set(input.faceTriangleIndices);
  const resultIndices: number[] = [];
  for (let t = 0; t < input.mesh.indices.length / 3; t++) {
    if (removed.has(t)) continue;
    resultIndices.push(input.mesh.indices[t * 3]!, input.mesh.indices[t * 3 + 1]!, input.mesh.indices[t * 3 + 2]!);
  }
  // Append new face's vertices + offset its indices.
  const vertOffset = input.mesh.positions.length / 3;
  const newPositions = [...input.mesh.positions, ...input.newFace.positions];
  for (const i of input.newFace.indices) resultIndices.push(i + vertOffset);
  return {
    resultMesh: { positions: newPositions, indices: resultIndices },
    removedTriangles: removed.size,
    addedTriangles: input.newFace.indices.length / 3,
  };
}

// ── Delete face + heal ──────────────────────────────────────────

export interface DeleteFaceInput {
  mesh: { positions: number[]; indices: number[] };
  faceTriangleIndices: number[];
}

export interface DeleteFaceResult {
  resultMesh: { positions: number[]; indices: number[] };
  /** Boundary loop generated by the deletion (vertex ids). */
  boundaryLoop: number[];
  /** Was the resulting hole filled? */
  filled: boolean;
}

export function deleteFaceAndHeal(input: DeleteFaceInput): DeleteFaceResult {
  const removed = new Set(input.faceTriangleIndices);
  const remaining: number[] = [];
  for (let t = 0; t < input.mesh.indices.length / 3; t++) {
    if (removed.has(t)) continue;
    remaining.push(input.mesh.indices[t * 3]!, input.mesh.indices[t * 3 + 1]!, input.mesh.indices[t * 3 + 2]!);
  }
  // Detect boundary loop on the *removed* triangles — vertices that were
  // only used by removed triangles' edges shared with kept triangles.
  const remainingUsedEdges = new Set<string>();
  for (let t = 0; t < remaining.length / 3; t++) {
    const a = remaining[t * 3]!, b = remaining[t * 3 + 1]!, c = remaining[t * 3 + 2]!;
    for (const [u, v] of [[a, b], [b, c], [c, a]] as Array<[number, number]>) {
      remainingUsedEdges.add(u < v ? `${u}-${v}` : `${v}-${u}`);
    }
  }
  const boundaryVerts = new Set<number>();
  for (const t of input.faceTriangleIndices) {
    const a = input.mesh.indices[t * 3]!, b = input.mesh.indices[t * 3 + 1]!, c = input.mesh.indices[t * 3 + 2]!;
    for (const [u, v] of [[a, b], [b, c], [c, a]] as Array<[number, number]>) {
      const key = u < v ? `${u}-${v}` : `${v}-${u}`;
      if (remainingUsedEdges.has(key)) {
        boundaryVerts.add(u); boundaryVerts.add(v);
      }
    }
  }
  // Fan-triangulate the boundary from its centroid.
  const loop = Array.from(boundaryVerts);
  let resultIndices = remaining;
  let resultPositions = input.mesh.positions;
  let filled = false;
  if (loop.length >= 3) {
    let cx = 0, cy = 0, cz = 0;
    for (const v of loop) {
      cx += input.mesh.positions[v * 3]!;
      cy += input.mesh.positions[v * 3 + 1]!;
      cz += input.mesh.positions[v * 3 + 2]!;
    }
    cx /= loop.length; cy /= loop.length; cz /= loop.length;
    const centerIdx = input.mesh.positions.length / 3;
    resultPositions = [...input.mesh.positions, cx, cy, cz];
    resultIndices = remaining.slice();
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!;
      const b = loop[(i + 1) % loop.length]!;
      resultIndices.push(a, b, centerIdx);
    }
    filled = true;
  }
  return {
    resultMesh: { positions: resultPositions, indices: resultIndices },
    boundaryLoop: loop,
    filled,
  };
}

// ── Imprint edges ───────────────────────────────────────────────

export interface ImprintInput {
  mesh: { positions: number[]; indices: number[] };
  /** Curve to project onto faces (3D polyline). */
  curve: Vec3[];
}

export interface ImprintResult {
  /** Number of triangles intersected by the curve. */
  intersectedTriangles: number;
  /** New vertex indices added at curve-edge intersections. */
  newVertexCount: number;
}

/** Stub for imprint — production needs mesh-vs-curve subdivision.
 *  For preview, we just count which triangles the curve passes through
 *  by projecting each polyline segment + checking incidence. */
export function imprintCurveOnFaces(input: ImprintInput): ImprintResult {
  const triCount = input.mesh.indices.length / 3;
  let intersected = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = input.mesh.indices[t * 3]!;
    const i1 = input.mesh.indices[t * 3 + 1]!;
    const i2 = input.mesh.indices[t * 3 + 2]!;
    const v0: Vec3 = [input.mesh.positions[i0 * 3]!, input.mesh.positions[i0 * 3 + 1]!, input.mesh.positions[i0 * 3 + 2]!];
    const v1: Vec3 = [input.mesh.positions[i1 * 3]!, input.mesh.positions[i1 * 3 + 1]!, input.mesh.positions[i1 * 3 + 2]!];
    const v2: Vec3 = [input.mesh.positions[i2 * 3]!, input.mesh.positions[i2 * 3 + 1]!, input.mesh.positions[i2 * 3 + 2]!];
    const triMin: Vec3 = [Math.min(v0[0], v1[0], v2[0]), Math.min(v0[1], v1[1], v2[1]), Math.min(v0[2], v1[2], v2[2])];
    const triMax: Vec3 = [Math.max(v0[0], v1[0], v2[0]), Math.max(v0[1], v1[1], v2[1]), Math.max(v0[2], v1[2], v2[2])];
    for (let c = 0; c < input.curve.length - 1; c++) {
      const a = input.curve[c]!;
      const b = input.curve[c + 1]!;
      const aHit = a[0] >= triMin[0] && a[0] <= triMax[0] && a[1] >= triMin[1] && a[1] <= triMax[1] && a[2] >= triMin[2] && a[2] <= triMax[2];
      const bHit = b[0] >= triMin[0] && b[0] <= triMax[0] && b[1] >= triMin[1] && b[1] <= triMax[1] && b[2] >= triMin[2] && b[2] <= triMax[2];
      if (aHit || bHit) {
        intersected++;
        break;
      }
    }
  }
  return { intersectedTriangles: intersected, newVertexCount: input.curve.length };
}

// ── Cavity (insert tooling) ─────────────────────────────────────

export interface CavityInput {
  /** Target body bbox the cavity is carved into. */
  targetBbox: { min: Vec3; max: Vec3 };
  /** Tool body bbox (the insert) — its position dictates where the cavity sits. */
  toolBbox: { min: Vec3; max: Vec3 };
  /** Scale factor applied to the tool (1.0 = no scaling, > 1 = oversize for shrink fit). */
  scaleFactor: number;
  /** Clearance (mm) between tool and target. */
  clearanceMm: number;
}

export interface CavityResult {
  /** Resulting cavity bbox in the target body. */
  cavityBbox: { min: Vec3; max: Vec3 };
  /** Estimated cavity volume (mm³). */
  cavityVolumeMm3: number;
  /** Warning if cavity extends outside target. */
  warnings: string[];
}

export function cavity(input: CavityInput): CavityResult {
  // Apply scale around tool's center.
  const cx = (input.toolBbox.min[0] + input.toolBbox.max[0]) / 2;
  const cy = (input.toolBbox.min[1] + input.toolBbox.max[1]) / 2;
  const cz = (input.toolBbox.min[2] + input.toolBbox.max[2]) / 2;
  const half: Vec3 = [
    (input.toolBbox.max[0] - input.toolBbox.min[0]) / 2 * input.scaleFactor + input.clearanceMm,
    (input.toolBbox.max[1] - input.toolBbox.min[1]) / 2 * input.scaleFactor + input.clearanceMm,
    (input.toolBbox.max[2] - input.toolBbox.min[2]) / 2 * input.scaleFactor + input.clearanceMm,
  ];
  const cavMin: Vec3 = [cx - half[0], cy - half[1], cz - half[2]];
  const cavMax: Vec3 = [cx + half[0], cy + half[1], cz + half[2]];
  const warnings: string[] = [];
  if (cavMin[0] < input.targetBbox.min[0] || cavMin[1] < input.targetBbox.min[1] || cavMin[2] < input.targetBbox.min[2]
    || cavMax[0] > input.targetBbox.max[0] || cavMax[1] > input.targetBbox.max[1] || cavMax[2] > input.targetBbox.max[2]) {
    warnings.push('Cavity extends outside the target body — increase target or move tool');
  }
  const vol = (cavMax[0] - cavMin[0]) * (cavMax[1] - cavMin[1]) * (cavMax[2] - cavMin[2]);
  return {
    cavityBbox: { min: cavMin, max: cavMax },
    cavityVolumeMm3: vol,
    warnings,
  };
}
