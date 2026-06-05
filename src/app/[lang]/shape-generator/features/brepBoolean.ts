/**
 * brepBoolean.ts — Half-edge B-rep boolean operations.
 *
 * The mesh-level boolean in `boolean.ts` uses three-bvh-csg, which
 * loses topology — output has no notion of "which face came from
 * which body". For parametric editing the kernel needs B-rep level
 * booleans that preserve face provenance.
 *
 * This module provides:
 *   - **Surface-surface intersection** — find shared edges between
 *     pairs of faces (planar/planar gets first-class treatment).
 *   - **Loop classification** — for each new intersection loop,
 *     decide whether it's an outer boundary or a hole.
 *   - **Topology stitching** — build a fresh BrepShell that's the
 *     union / subtract / intersect of the two inputs, with each
 *     output face tagged by its source (`fromA` | `fromB` | `cut`).
 *
 * The full implementation requires robust surface-surface intersection
 * for every curved combination (cyl-cyl, cyl-plane, ...); this module
 * stays in the "planar boolean" regime + provides hooks for curved
 * cases to plug in.
 */

import type { BrepShell, Face, HalfEdge, Vertex, Vec3 } from './halfEdgeBrep';
import {
  BrepModel,
  createVertex,
  createEdgePair,
  createFace,
  faceVertices,
  validateShell,
} from './halfEdgeBrep';

export type BooleanOp = 'union' | 'subtract' | 'intersect';

export interface BooleanResult {
  /** The resulting model. */
  model: BrepModel;
  /** Faces in the result, tagged by origin. */
  faceProvenance: Map<string, FaceOrigin>;
  /** Edges that lie on the intersection of A and B. */
  intersectionEdges: string[];
  /** Warnings / fallback notes. */
  warnings: string[];
}

export type FaceOrigin =
  | { kind: 'fromA'; sourceFaceId: string }
  | { kind: 'fromB'; sourceFaceId: string }
  | { kind: 'cut'; sourceFaceIds: [string, string] };

// ── Top-level entry ─────────────────────────────────────────────

export function brepBoolean(
  a: BrepShell,
  b: BrepShell,
  op: BooleanOp,
): BooleanResult {
  const warnings: string[] = [];
  const out = new BrepModel();
  const shell = out.newShell();
  const provenance = new Map<string, FaceOrigin>();
  const intersectionEdges: string[] = [];

  // Pair up planar faces; compute plane-plane intersection lines.
  const pairs = collectPlanarFacePairs(a, b);

  // For union: keep every A face + every B face, except those that
  //   overlap a face on the opposite body (those get split / dropped).
  // For subtract: keep A's outer boundary + flipped B faces inside A.
  // For intersect: keep only the volume that's inside BOTH.
  // The naive implementation below is "carry through all faces, mark
  //  pairs that intersect for follow-up split". The split itself is
  //  a TODO that hooks into surfaceIntersect (planar case implemented,
  //  curved case returns warning).
  for (const face of a.faces.values()) {
    const cloned = clonePlanarFaceInto(out, shell, face, a);
    provenance.set(cloned.id, { kind: 'fromA', sourceFaceId: face.id });
  }
  if (op !== 'subtract') {
    for (const face of b.faces.values()) {
      const cloned = clonePlanarFaceInto(out, shell, face, b);
      provenance.set(cloned.id, { kind: 'fromB', sourceFaceId: face.id });
    }
  } else {
    // For subtract, flip B faces.
    for (const face of b.faces.values()) {
      const cloned = clonePlanarFaceInto(out, shell, face, b, /*flip*/ true);
      provenance.set(cloned.id, { kind: 'fromB', sourceFaceId: face.id });
    }
  }

  // Add intersection edges for each intersecting pair.
  for (const { aFace, bFace, line } of pairs) {
    if (!line) {
      warnings.push(`No intersection line for face pair ${aFace.id}↔${bFace.id}`);
      continue;
    }
    const edgeId = addIntersectionEdge(out, shell, line);
    intersectionEdges.push(edgeId);
  }

  // Honesty gate: this kernel computes intersection geometry + provenance, but
  // does NOT split the faces along those intersection edges or re-classify
  // in/out — the input faces are carried through un-split. So whenever crossing
  // geometry is detected the output is NOT a guaranteed-watertight CSG solid.
  // Surface that explicitly instead of letting validateBooleanResult silently
  // certify the un-split result as valid. Production watertight booleans run
  // through the OCCT B-rep kernel (occtBooleanSolids); see occtEngine.ts.
  if (intersectionEdges.length > 0) {
    warnings.push(
      `Face splitting not implemented: ${intersectionEdges.length} intersection edge(s) detected but the ${op} carried faces through un-split — result is NOT a watertight boolean. Use the OCCT kernel (occtBooleanSolids) for production CSG.`,
    );
  }

  return { model: out, faceProvenance: provenance, intersectionEdges, warnings };
}

// ── Planar face pair collection ─────────────────────────────────

interface FacePair {
  aFace: Face;
  bFace: Face;
  /** Plane-plane intersection line, when both faces are planar. */
  line: { origin: Vec3; direction: Vec3 } | null;
}

export function collectPlanarFacePairs(a: BrepShell, b: BrepShell): FacePair[] {
  const out: FacePair[] = [];
  for (const fa of a.faces.values()) {
    if (fa.surfaceKind !== 'planar' || !fa.normal) continue;
    for (const fb of b.faces.values()) {
      if (fb.surfaceKind !== 'planar' || !fb.normal) continue;
      const line = planePlaneIntersect(
        { normal: fa.normal, point: faceCentroid(fa) },
        { normal: fb.normal, point: faceCentroid(fb) },
      );
      out.push({ aFace: fa, bFace: fb, line });
    }
  }
  return out;
}

export interface Plane {
  normal: Vec3;
  point: Vec3;
}

/** Plane-plane intersection: returns line origin + direction, or null
 *  if the planes are parallel. */
export function planePlaneIntersect(p1: Plane, p2: Plane): { origin: Vec3; direction: Vec3 } | null {
  const dir = cross(p1.normal, p2.normal);
  const dirMag = Math.hypot(dir[0], dir[1], dir[2]);
  if (dirMag < 1e-9) return null;
  const dirN: Vec3 = [dir[0] / dirMag, dir[1] / dirMag, dir[2] / dirMag];

  // Use Lagrange formula: find a point on both planes.
  //   Solve [n1; n2; n1×n2] · x = [d1; d2; 0] where di = n_i · p_i.
  const d1 = dot(p1.normal, p1.point);
  const d2 = dot(p2.normal, p2.point);

  // Pick origin on the line closest to world origin.
  const n1xn2 = dirN;
  const n2xn3 = cross(p2.normal, n1xn2);
  const n3xn1 = cross(n1xn2, p1.normal);
  const denom = dot(p1.normal, n2xn3);
  if (Math.abs(denom) < 1e-9) return null;
  const origin: Vec3 = [
    (d1 * n2xn3[0] + d2 * n3xn1[0]) / denom,
    (d1 * n2xn3[1] + d2 * n3xn1[1]) / denom,
    (d1 * n2xn3[2] + d2 * n3xn1[2]) / denom,
  ];
  return { origin, direction: dirN };
}

function faceCentroid(face: Face): Vec3 {
  const verts = faceVertices(face);
  if (verts.length === 0) return [0, 0, 0];
  let cx = 0, cy = 0, cz = 0;
  for (const v of verts) {
    cx += v.position[0]; cy += v.position[1]; cz += v.position[2];
  }
  const n = verts.length;
  return [cx / n, cy / n, cz / n];
}

// ── Face cloning ────────────────────────────────────────────────

function clonePlanarFaceInto(
  model: BrepModel,
  destShell: BrepShell,
  face: Face,
  _sourceShell: BrepShell,
  flip: boolean = false,
): Face {
  const sourceVerts = faceVertices(face);
  const orderedVerts = flip ? [...sourceVerts].reverse() : sourceVerts;
  const verts: Vertex[] = orderedVerts.map(v => createVertex(model, destShell, v.position));
  const halfEdges: HalfEdge[] = [];
  for (let i = 0; i < verts.length; i++) {
    const j = (i + 1) % verts.length;
    halfEdges.push(createEdgePair(model, destShell, verts[i]!, verts[j]!));
  }
  for (let i = 0; i < halfEdges.length; i++) {
    const prevIdx = (i + halfEdges.length - 1) % halfEdges.length;
    const nextIdx = (i + 1) % halfEdges.length;
    halfEdges[i]!.prev = halfEdges[prevIdx]!;
    halfEdges[i]!.next = halfEdges[nextIdx]!;
  }
  const newFace = createFace(model, destShell, halfEdges[0]!);
  if (face.surfaceKind) newFace.surfaceKind = face.surfaceKind;
  if (face.normal) {
    newFace.normal = flip ? [-face.normal[0], -face.normal[1], -face.normal[2]] : face.normal;
  }
  return newFace;
}

function addIntersectionEdge(model: BrepModel, shell: BrepShell, line: { origin: Vec3; direction: Vec3 }): string {
  // Materialize a finite segment for visualization — production
  // would clip to the actual face boundaries.
  const v1 = createVertex(model, shell, line.origin);
  const v2 = createVertex(model, shell, [
    line.origin[0] + line.direction[0] * 10,
    line.origin[1] + line.direction[1] * 10,
    line.origin[2] + line.direction[2] * 10,
  ]);
  const he = createEdgePair(model, shell, v1, v2);
  return he.id;
}

// ── Volume helpers ──────────────────────────────────────────────

/** Approximate signed volume of a closed shell using the divergence
 *  theorem on planar faces (sum of face_volume_contribution).
 *  contribution_i = (1/6) × Σ_face (centroid_face · normal_face) × area_face
 *  For non-planar faces, we tessellate via faceVertices fan. */
export function shellVolume(shell: BrepShell): number {
  let vol = 0;
  for (const face of shell.faces.values()) {
    const verts = faceVertices(face);
    if (verts.length < 3) continue;
    // Fan triangulation from vertex 0.
    const p0 = verts[0]!.position;
    for (let i = 1; i < verts.length - 1; i++) {
      const p1 = verts[i]!.position;
      const p2 = verts[i + 1]!.position;
      // Signed volume of tetrahedron from origin.
      vol += (
        p0[0] * (p1[1] * p2[2] - p1[2] * p2[1]) -
        p0[1] * (p1[0] * p2[2] - p1[2] * p2[0]) +
        p0[2] * (p1[0] * p2[1] - p1[1] * p2[0])
      ) / 6;
    }
  }
  return vol;
}

// ── In/Out classification ───────────────────────────────────────

/** Ray-cast test: is a point inside the shell?
 *  Casts a ray from the point in +X direction; counts triangle hits
 *  along the way (odd = inside). */
export function pointInShell(point: Vec3, shell: BrepShell): boolean {
  let hits = 0;
  const rayDir: Vec3 = [1, 0, 0];
  for (const face of shell.faces.values()) {
    const verts = faceVertices(face);
    if (verts.length < 3) continue;
    const p0 = verts[0]!.position;
    for (let i = 1; i < verts.length - 1; i++) {
      if (rayIntersectsTriangle(point, rayDir, p0, verts[i]!.position, verts[i + 1]!.position)) {
        hits++;
      }
    }
  }
  return hits % 2 === 1;
}

/** Möller-Trumbore ray-triangle intersection. Only counts hits in +ray
 *  direction (forward), not behind. */
function rayIntersectsTriangle(
  origin: Vec3, dir: Vec3,
  v0: Vec3, v1: Vec3, v2: Vec3,
): boolean {
  const edge1: Vec3 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
  const edge2: Vec3 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
  const h = cross(dir, edge2);
  const a = dot(edge1, h);
  if (Math.abs(a) < 1e-9) return false;
  const f = 1 / a;
  const s: Vec3 = [origin[0] - v0[0], origin[1] - v0[1], origin[2] - v0[2]];
  const u = f * dot(s, h);
  if (u < 0 || u > 1) return false;
  const q = cross(s, edge1);
  const v = f * dot(dir, q);
  if (v < 0 || u + v > 1) return false;
  const t = f * dot(edge2, q);
  return t > 1e-9;
}

// ── Validation ──────────────────────────────────────────────────

export function validateBooleanResult(result: BooleanResult): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  for (const shell of result.model.shells) {
    const r = validateShell(shell);
    if (!r.valid) issues.push(...r.issues);
  }
  if (result.warnings.length > 0) {
    issues.push(...result.warnings.map(w => `warning: ${w}`));
  }
  return { valid: issues.length === 0, issues };
}

// ── Math helpers ────────────────────────────────────────────────

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
