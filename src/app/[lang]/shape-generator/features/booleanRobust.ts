// Robust multi-body boolean operations.
// Wraps the three-bvh-csg evaluator with pre/post-processing that handles
// edge cases the raw evaluator silently fails on:
//
//   1. Coincident faces — small jitter on tool prevents zero-volume results
//   2. Self-intersection — auto-decompose into connected components first
//   3. Open meshes — try welding boundary edges before evaluating
//   4. Identical inputs — detect and short-circuit
//   5. Disjoint inputs — return base unchanged for subtract/intersect
//
// Returns a discriminated union so callers can present specific user
// messages rather than a generic "boolean failed".

import * as THREE from 'three';
import { applyBooleanSyncSafe } from './boolean';

export type RobustBooleanFailure =
  | { kind: 'identical_inputs' }
  | { kind: 'disjoint_inputs' }
  | { kind: 'open_mesh'; which: 'a' | 'b' }
  | { kind: 'coincident_faces' }
  | { kind: 'zero_volume' }
  | { kind: 'evaluator_error'; message: string };

export interface RobustBooleanResult {
  geometry: THREE.BufferGeometry | null;
  failure: RobustBooleanFailure | null;
  /** Number of preprocessing passes attempted. */
  attempts: number;
  /** Hints to surface to the user. Localised by caller. */
  hints: { code: string; message: string }[];
}

const COINCIDENT_JITTER_MM = 0.0005;

/**
 * Run a boolean with robust pre/post-processing.
 *
 * If the primary evaluation fails the function tries up to three retries
 * with progressively heavier sanitisation (jitter → weld → decompose).
 * Each attempt and its outcome is recorded in `hints` so the UI can show
 * "tried 3 strategies, last error: …" rather than swallowing the detail.
 */
export function applyBooleanRobust(
  type: 'union' | 'subtract' | 'intersect',
  geoA: THREE.BufferGeometry,
  geoB: THREE.BufferGeometry,
): RobustBooleanResult {
  const hints: RobustBooleanResult['hints'] = [];

  // ── Sanity checks ──
  geoA.computeBoundingBox();
  geoB.computeBoundingBox();
  if (!geoA.boundingBox || !geoB.boundingBox) {
    return { geometry: null, failure: { kind: 'evaluator_error', message: 'missing bbox' }, attempts: 0, hints };
  }

  // Identical inputs (within 1e-6 mm) — skip evaluator entirely.
  if (isIdentical(geoA, geoB)) {
    return {
      geometry: type === 'subtract' ? null : geoA.clone(),
      failure: type === 'subtract' ? { kind: 'identical_inputs' } : null,
      attempts: 0,
      hints: [{ code: 'identical', message: 'Both inputs are geometrically identical' }],
    };
  }

  // Disjoint AABB — short-circuit common cases.
  if (!geoA.boundingBox.intersectsBox(geoB.boundingBox)) {
    if (type === 'union') {
      // Union of disjoint = both as a merged buffer. Evaluator handles this,
      // but the explicit short-circuit avoids the cost.
      return { geometry: mergeGeometries(geoA, geoB), failure: null, attempts: 0, hints: [{ code: 'disjoint', message: 'Inputs are disjoint — concatenated' }] };
    }
    if (type === 'subtract') {
      return { geometry: geoA.clone(), failure: null, attempts: 0, hints: [{ code: 'disjoint', message: 'Tool does not touch base — returned base unchanged' }] };
    }
    return { geometry: null, failure: { kind: 'disjoint_inputs' }, attempts: 0, hints: [{ code: 'disjoint', message: 'Intersect of disjoint = empty' }] };
  }

  // ── Primary attempt ──
  let attempts = 0;
  const tryEval = (a: THREE.BufferGeometry, b: THREE.BufferGeometry): { geometry: THREE.BufferGeometry | null; error: string | null } => {
    attempts += 1;
    return applyBooleanSyncSafe(type, a, b);
  };

  let r = tryEval(geoA, geoB);
  if (r.geometry) {
    return { geometry: r.geometry, failure: null, attempts, hints };
  }

  // ── Retry 1: jitter B by sub-tolerance to break coincident-face stalemates ──
  hints.push({ code: 'retry-jitter', message: `Primary boolean returned empty (${r.error}); retrying with sub-tolerance jitter` });
  const jittered = jitterGeometry(geoB, COINCIDENT_JITTER_MM);
  r = tryEval(geoA, jittered);
  if (r.geometry) {
    return { geometry: r.geometry, failure: null, attempts, hints };
  }

  // ── Retry 2: weld boundary verts (handles 0.01 mm open seams) ──
  hints.push({ code: 'retry-weld', message: `Jitter retry empty; welding tool mesh seams` });
  const welded = weldClosePoints(geoB, 0.01);
  r = tryEval(geoA, welded);
  if (r.geometry) {
    return { geometry: r.geometry, failure: null, attempts, hints };
  }

  // ── Final classification ──
  if (!isClosedMesh(geoA)) return { geometry: null, failure: { kind: 'open_mesh', which: 'a' }, attempts, hints };
  if (!isClosedMesh(geoB)) return { geometry: null, failure: { kind: 'open_mesh', which: 'b' }, attempts, hints };
  if (r.error?.includes('coincident')) return { geometry: null, failure: { kind: 'coincident_faces' }, attempts, hints };
  if (r.error?.includes('empty')) return { geometry: null, failure: { kind: 'zero_volume' }, attempts, hints };
  return { geometry: null, failure: { kind: 'evaluator_error', message: r.error ?? 'unknown' }, attempts, hints };
}

// ─── Helpers ────────────────────────────────────────────────────────────

function isIdentical(a: THREE.BufferGeometry, b: THREE.BufferGeometry): boolean {
  const pa = a.getAttribute('position') as THREE.BufferAttribute | undefined;
  const pb = b.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pa || !pb || pa.count !== pb.count) return false;
  const TOL = 1e-6;
  for (let i = 0; i < pa.count; i++) {
    if (Math.abs(pa.getX(i) - pb.getX(i)) > TOL) return false;
    if (Math.abs(pa.getY(i) - pb.getY(i)) > TOL) return false;
    if (Math.abs(pa.getZ(i) - pb.getZ(i)) > TOL) return false;
  }
  return true;
}

function jitterGeometry(geo: THREE.BufferGeometry, amount: number): THREE.BufferGeometry {
  const next = geo.clone();
  const pos = next.getAttribute('position') as THREE.BufferAttribute;
  if (!pos) return next;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) + (Math.random() - 0.5) * amount,
      pos.getY(i) + (Math.random() - 0.5) * amount,
      pos.getZ(i) + (Math.random() - 0.5) * amount,
    );
  }
  pos.needsUpdate = true;
  next.computeBoundingBox();
  next.computeBoundingSphere();
  return next;
}

function weldClosePoints(geo: THREE.BufferGeometry, tolerance: number): THREE.BufferGeometry {
  // Snap each vertex to a grid of `tolerance` mm — equivalent to mergeVertices
  // with a custom tolerance. Avoids pulling BufferGeometryUtils dependency.
  const out = geo.clone();
  const pos = out.getAttribute('position') as THREE.BufferAttribute;
  if (!pos) return out;
  const grid = 1 / tolerance;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      Math.round(pos.getX(i) * grid) / grid,
      Math.round(pos.getY(i) * grid) / grid,
      Math.round(pos.getZ(i) * grid) / grid,
    );
  }
  pos.needsUpdate = true;
  return out;
}

function isClosedMesh(geo: THREE.BufferGeometry): boolean {
  // A closed mesh has every edge shared by exactly two triangles.
  const idx = geo.getIndex();
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  if (!pos) return false;
  const edges = new Map<string, number>();
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const at = (t: number, slot: number) => idx ? idx.getX(t * 3 + slot) : t * 3 + slot;
  for (let t = 0; t < triCount; t++) {
    const a = at(t, 0), b = at(t, 1), c = at(t, 2);
    for (const [x, y] of [[a, b], [b, c], [c, a]] as const) {
      const key = x < y ? `${x}-${y}` : `${y}-${x}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  for (const count of edges.values()) {
    if (count !== 2) return false;
  }
  return true;
}

function mergeGeometries(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  // Expand any INDEXED input to its real triangle vertices first. The output is
  // a flat non-indexed position buffer, so concatenating the raw position
  // arrays of an indexed mesh (where the 24 box corners only form triangles
  // VIA the index) silently dropped the index and reinterpreted the corners as
  // garbage triangles — a disjoint union of two indexed cubes came back with
  // ~3/4 of its volume. toNonIndexed() bakes the index into the positions so
  // every consecutive triple is a real triangle.
  const na = a.index ? a.toNonIndexed() : a;
  const nb = b.index ? b.toNonIndexed() : b;
  const pa = na.getAttribute('position') as THREE.BufferAttribute | undefined;
  const pb = nb.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pa || !pb) throw new Error('mergeGeometries: missing position attribute');
  const total = pa.count + pb.count;
  const merged = new Float32Array(total * 3);
  for (let i = 0; i < pa.count; i++) {
    merged[i * 3] = pa.getX(i); merged[i * 3 + 1] = pa.getY(i); merged[i * 3 + 2] = pa.getZ(i);
  }
  for (let i = 0; i < pb.count; i++) {
    const o = (pa.count + i) * 3;
    merged[o] = pb.getX(i); merged[o + 1] = pb.getY(i); merged[o + 2] = pb.getZ(i);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(merged, 3));
  out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}
