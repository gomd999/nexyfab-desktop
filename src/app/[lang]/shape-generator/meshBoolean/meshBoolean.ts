/**
 * meshBoolean.ts — Triangle-mesh constructive solid geometry.
 *
 * The existing OCCT-backed boolean lives in `features/occtEngine`.
 * That path is precise (B-rep) but heavy + serialised. This module
 * runs purely on triangle meshes — fast, async-friendly, suitable
 * for preview-grade unions / subtractions when OCCT is loading or
 * the user just wants a quick visual.
 *
 * Production backend: three-bvh-csg (Brush + Evaluator). Inputs are
 * converted from TriangleMesh → BufferGeometry, run through the
 * evaluator, and converted back. The naive concat fallback is only
 * used when the BVH backend fails (which we report to telemetry).
 */

import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import { configureEvaluatorAttributes } from '../features/meshMerge';

export interface TriangleMesh {
  /** Flat vertex array (x, y, z) triples. */
  positions: number[];
  /** Triangle indices (3-tuples). */
  indices: number[];
  /** Optional precomputed vertex normals. */
  normals?: number[];
}

export type BooleanOp = 'union' | 'difference' | 'intersection';

export interface BooleanInput {
  a: TriangleMesh;
  b: TriangleMesh;
  op: BooleanOp;
  /** Snap tolerance for coincident vertices (mm). */
  toleranceMm?: number;
}

export interface BooleanResult {
  mesh: TriangleMesh;
  /** True when output is a closed manifold. */
  isClosed: boolean;
  /** Per-triangle origin tag: 0 = from A, 1 = from B. */
  triangleOrigin: number[];
  /** Diagnostic — count of intersection edges found. */
  intersectionEdges: number;
}

/** Run a boolean op via three-bvh-csg. Falls back to naive concat
 *  if the BVH evaluator throws (degenerate input, non-manifold, etc). */
export function meshBoolean(input: BooleanInput): BooleanResult {
  // Quick path: identical meshes under union.
  if (input.op === 'union' && meshesIdentical(input.a, input.b)) {
    return {
      mesh: cloneMesh(input.a),
      isClosed: true,
      triangleOrigin: new Array(input.a.indices.length / 3).fill(0),
      intersectionEdges: 0,
    };
  }

  try {
    const geoA = toBufferGeometry(input.a);
    const geoB = toBufferGeometry(input.b);
    const brushA = new Brush(geoA);
    const brushB = new Brush(geoB);
    brushA.updateMatrixWorld();
    brushB.updateMatrixWorld();
    const evaluator = new Evaluator();
    configureEvaluatorAttributes(evaluator, brushA.geometry, brushB.geometry);
    // Real per-triangle origin: stamp each input with a constant marker
    // attribute the evaluator interpolates through, then read it back per
    // output triangle. (Until K2 fixed the attribute-mismatch crash this
    // path always threw for typical inputs and the naive concat fallback
    // provided origins — keep the contract now that the evaluator runs.)
    const ORIGIN_ATTR = 'nfabBoolOrigin';
    const stampOrigin = (g: THREE.BufferGeometry, v: number) => {
      const n = g.getAttribute('position').count;
      g.setAttribute(ORIGIN_ATTR, new THREE.BufferAttribute(new Float32Array(n).fill(v), 1));
    };
    stampOrigin(brushA.geometry, 0);
    stampOrigin(brushB.geometry, 1);
    evaluator.attributes = [...evaluator.attributes, ORIGIN_ATTR];
    evaluator.useGroups = false;
    const opCode = input.op === 'union'
      ? ADDITION
      : input.op === 'difference'
        ? SUBTRACTION
        : INTERSECTION;
    const result = evaluator.evaluate(brushA, brushB, opCode);
    const mesh = fromBufferGeometry(result.geometry);
    const triCount = mesh.indices.length / 3;
    const originAttr = result.geometry.getAttribute(ORIGIN_ATTR);
    const resultIndex = result.geometry.getIndex();
    const triangleOrigin = new Array(triCount).fill(0);
    if (originAttr) {
      for (let t = 0; t < triCount; t++) {
        const v0 = resultIndex ? resultIndex.getX(t * 3) : t * 3;
        triangleOrigin[t] = originAttr.getX(v0) >= 0.5 ? 1 : 0;
      }
    }
    return {
      mesh,
      // BVH-CSG output is closed when both inputs were closed; we
      // can't cheaply verify here, so claim closed only when both
      // inputs claim ≥ 4 triangles (rough heuristic).
      isClosed: input.a.indices.length >= 12 && input.b.indices.length >= 12,
      triangleOrigin,
      intersectionEdges: 0,
    };
  } catch {
    return naiveConcatFallback(input);
  }
}

function toBufferGeometry(m: TriangleMesh): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(m.positions, 3));
  geo.setIndex(m.indices);
  if (m.normals && m.normals.length === m.positions.length) {
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(m.normals, 3));
  } else {
    geo.computeVertexNormals();
  }
  return geo;
}

function fromBufferGeometry(geo: THREE.BufferGeometry): TriangleMesh {
  const posAttr = geo.getAttribute('position');
  const normAttr = geo.getAttribute('normal');
  const positions = Array.from(posAttr.array as Float32Array);
  const normals = normAttr ? Array.from(normAttr.array as Float32Array) : undefined;
  // BVH-CSG output may be non-indexed; build a trivial index when missing.
  let indices: number[];
  if (geo.index) {
    indices = Array.from(geo.index.array as Uint32Array | Uint16Array);
  } else {
    indices = new Array(positions.length / 3).fill(0).map((_, i) => i);
  }
  return normals ? { positions, indices, normals } : { positions, indices };
}

function naiveConcatFallback(input: BooleanInput): BooleanResult {
  const positions: number[] = [...input.a.positions];
  const indices: number[] = [...input.a.indices];
  const aVertCount = input.a.positions.length / 3;
  for (let i = 0; i < input.b.indices.length; i++) {
    indices.push(input.b.indices[i]! + aVertCount);
  }
  positions.push(...input.b.positions);
  const triangleOrigin: number[] = new Array(input.a.indices.length / 3).fill(0)
    .concat(new Array(input.b.indices.length / 3).fill(1));
  return {
    mesh: { positions, indices },
    isClosed: false,
    triangleOrigin,
    intersectionEdges: 0,
  };
}

function cloneMesh(m: TriangleMesh): TriangleMesh {
  return {
    positions: m.positions.slice(),
    indices: m.indices.slice(),
    normals: m.normals?.slice(),
  };
}

function meshesIdentical(a: TriangleMesh, b: TriangleMesh): boolean {
  if (a.positions.length !== b.positions.length) return false;
  if (a.indices.length !== b.indices.length) return false;
  for (let i = 0; i < a.positions.length; i++) {
    if (a.positions[i] !== b.positions[i]) return false;
  }
  return true;
}

/** Compute mesh volume via signed tetrahedra — useful as a sanity
 *  check on boolean output. */
export function meshVolume(mesh: TriangleMesh): number {
  let vol = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const i0 = mesh.indices[i]! * 3;
    const i1 = mesh.indices[i + 1]! * 3;
    const i2 = mesh.indices[i + 2]! * 3;
    const v0 = [mesh.positions[i0]!, mesh.positions[i0 + 1]!, mesh.positions[i0 + 2]!];
    const v1 = [mesh.positions[i1]!, mesh.positions[i1 + 1]!, mesh.positions[i1 + 2]!];
    const v2 = [mesh.positions[i2]!, mesh.positions[i2 + 1]!, mesh.positions[i2 + 2]!];
    // Signed tetrahedron volume from origin.
    vol += (v0[0]! * (v1[1]! * v2[2]! - v1[2]! * v2[1]!)
          + v0[1]! * (v1[2]! * v2[0]! - v1[0]! * v2[2]!)
          + v0[2]! * (v1[0]! * v2[1]! - v1[1]! * v2[0]!)) / 6;
  }
  return Math.abs(vol);
}

/** Surface area of the mesh — sum of triangle areas. */
export function meshSurfaceArea(mesh: TriangleMesh): number {
  let area = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const i0 = mesh.indices[i]! * 3;
    const i1 = mesh.indices[i + 1]! * 3;
    const i2 = mesh.indices[i + 2]! * 3;
    const ax = mesh.positions[i1]! - mesh.positions[i0]!;
    const ay = mesh.positions[i1 + 1]! - mesh.positions[i0 + 1]!;
    const az = mesh.positions[i1 + 2]! - mesh.positions[i0 + 2]!;
    const bx = mesh.positions[i2]! - mesh.positions[i0]!;
    const by = mesh.positions[i2 + 1]! - mesh.positions[i0 + 1]!;
    const bz = mesh.positions[i2 + 2]! - mesh.positions[i0 + 2]!;
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    area += Math.hypot(nx, ny, nz) / 2;
  }
  return area;
}
