/**
 * nurbsSurface.ts — Tensor-product NURBS surface evaluation.
 *
 * A NURBS surface S(u,v) is the bidirectional generalisation of the
 * curve: a 2-D grid of control points (with weights and two knot
 * vectors) evaluated as
 *
 *     S(u,v) = Σᵢ Σⱼ Nᵢ,ₚ(u) · Nⱼ,ᵩ(v) · wᵢⱼ · Pᵢⱼ
 *              ────────────────────────────────────
 *              Σᵢ Σⱼ Nᵢ,ₚ(u) · Nⱼ,ᵩ(v) · wᵢⱼ
 *
 * In practice we collapse one axis first (de Boor across rows at
 * parameter u → intermediate control-row of `n+1` points along v),
 * then evaluate that 1-D curve at v. Same numerical result, half the
 * basis-function work for batch tessellation.
 *
 * Exports the surface struct plus three operations the downstream
 * features (boundary surface, loft, sweep, continuity check) need:
 *   - point evaluation at (u, v)
 *   - normal vector at (u, v) — cross product of u/v tangents
 *   - tessellation into a THREE.BufferGeometry grid for the viewport
 */

import * as THREE from 'three';
import { evalNurbsCurve3D, type NurbsCurve3D } from './nurbsCurve';

/** Triangle mesh struct used by surface modeling helpers (knit/trim/offset).
 *  Flat arrays for positions/normals/uvs (length = 3·n / 3·n / 2·n) plus
 *  triangle indices (length = 3·triangleCount). */
export interface SurfaceMesh {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

export interface NurbsSurface {
  /** Control point grid. `controlPoints[i][j]` is the (i,j)th point —
   *  i indexes the U direction, j the V direction. Sizes:
   *    controlPoints.length         = nU + 1
   *    controlPoints[i].length      = nV + 1   for all i. */
  controlPoints: THREE.Vector3[][];
  /** Degree along U. */
  degreeU: number;
  /** Degree along V. */
  degreeV: number;
  /** Knot vector along U, length = nU + degreeU + 2. */
  knotsU: number[];
  /** Knot vector along V, length = nV + degreeV + 2. */
  knotsV: number[];
  /** Optional weights `[i][j]`; defaults to 1 for every control point. */
  weights?: number[][];
}

/** Pluck the j-th column of control points as a NURBS curve along U.
 *  Used by the row-then-column evaluation strategy. */
function columnCurve(surface: NurbsSurface, j: number): NurbsCurve3D {
  const controlPoints: THREE.Vector3[] = [];
  const weights: number[] = [];
  for (let i = 0; i < surface.controlPoints.length; i++) {
    controlPoints.push(surface.controlPoints[i][j]);
    weights.push(surface.weights ? surface.weights[i][j] : 1);
  }
  return {
    controlPoints,
    degree: surface.degreeU,
    knots: surface.knotsU,
    weights,
  };
}

/** Pluck a row of control points as a NURBS curve along V. */
function rowCurveFromPoints(
  pts: THREE.Vector3[],
  weights: number[],
  degreeV: number,
  knotsV: number[],
): NurbsCurve3D {
  return { controlPoints: pts, weights, degree: degreeV, knots: knotsV };
}

/**
 * Evaluate the surface at parameters (u, v). The knot vectors run
 * from `knots[degree]` to `knots[knots.length - degree - 1]`; with
 * clamped-uniform knots this is [0, 1] on each axis.
 */
export function evalNurbsSurface(surface: NurbsSurface, u: number, v: number): THREE.Vector3 {
  // Row-then-column: evaluate the U direction first at each control row
  // (collapses the grid to a 1-D column of points), then evaluate that
  // column as a NURBS curve in V at parameter v.
  const nVCols = surface.controlPoints[0].length;
  const collapsedPoints: THREE.Vector3[] = [];
  const collapsedWeights: number[] = [];
  const hasWeights = !!surface.weights;
  for (let j = 0; j < nVCols; j++) {
    const colCurve = columnCurve(surface, j);
    const pt = evalNurbsCurve3D(colCurve, u);
    collapsedPoints.push(pt);
    // Track the interpolated weight W_j(u) = Σᵢ Nᵢ(u)·wᵢⱼ through the
    // homogeneous form so varying U-weights survive the U→V collapse. We get
    // it by evaluating a NON-rational B-spline of the scalar weights along U:
    // with uniform weights the basis is a partition of unity, so the x-coord
    // of that curve IS Σᵢ Nᵢ(u)·wᵢⱼ. (Uniform-weight surfaces give Wⱼ≡1, so
    // the V pass is byte-identical to the old behaviour.)
    if (hasWeights) {
      const wPts: THREE.Vector3[] = [];
      for (let i = 0; i < surface.controlPoints.length; i++) {
        wPts.push(new THREE.Vector3(surface.weights![i][j], 0, 0));
      }
      const wCurve: NurbsCurve3D = {
        controlPoints: wPts,
        weights: wPts.map(() => 1),
        degree: surface.degreeU,
        knots: surface.knotsU,
      };
      collapsedWeights.push(evalNurbsCurve3D(wCurve, u).x);
    } else {
      collapsedWeights.push(1);
    }
  }
  const rowCurve = rowCurveFromPoints(
    collapsedPoints,
    collapsedWeights,
    surface.degreeV,
    surface.knotsV,
  );
  return evalNurbsCurve3D(rowCurve, v);
}

/** Approximate the surface normal at (u, v) via finite-difference of
 *  the two parametric tangents. Returns a unit vector. */
export function evalNurbsSurfaceNormal(surface: NurbsSurface, u: number, v: number): THREE.Vector3 {
  const eps = 1e-4;
  const uLo = Math.max(surface.knotsU[surface.degreeU], u - eps);
  const uHi = Math.min(surface.knotsU[surface.knotsU.length - surface.degreeU - 1], u + eps);
  const vLo = Math.max(surface.knotsV[surface.degreeV], v - eps);
  const vHi = Math.min(surface.knotsV[surface.knotsV.length - surface.degreeV - 1], v + eps);

  const pUHi = evalNurbsSurface(surface, uHi, v);
  const pULo = evalNurbsSurface(surface, uLo, v);
  const pVHi = evalNurbsSurface(surface, u, vHi);
  const pVLo = evalNurbsSurface(surface, u, vLo);

  const tu = new THREE.Vector3().subVectors(pUHi, pULo);
  const tv = new THREE.Vector3().subVectors(pVHi, pVLo);
  const n = new THREE.Vector3().crossVectors(tu, tv);
  if (n.lengthSq() < 1e-12) return new THREE.Vector3(0, 0, 1);
  return n.normalize();
}

/** Tessellate the surface into an indexed BufferGeometry grid of
 *  `(uSegments+1) × (vSegments+1)` vertices. Normals are computed via
 *  finite difference so they're correct even at degenerate corners. */
export function tessellateNurbsSurface(
  surface: NurbsSurface,
  uSegments = 16,
  vSegments = 16,
): THREE.BufferGeometry {
  const uStart = surface.knotsU[surface.degreeU];
  const uEnd = surface.knotsU[surface.knotsU.length - surface.degreeU - 1];
  const vStart = surface.knotsV[surface.degreeV];
  const vEnd = surface.knotsV[surface.knotsV.length - surface.degreeV - 1];

  const positions: number[] = [];
  const normals: number[] = [];
  for (let i = 0; i <= uSegments; i++) {
    const u = uStart + ((uEnd - uStart) * i) / uSegments;
    for (let j = 0; j <= vSegments; j++) {
      const v = vStart + ((vEnd - vStart) * j) / vSegments;
      const p = evalNurbsSurface(surface, u, v);
      const n = evalNurbsSurfaceNormal(surface, u, v);
      positions.push(p.x, p.y, p.z);
      normals.push(n.x, n.y, n.z);
    }
  }

  const indices: number[] = [];
  const stride = vSegments + 1;
  for (let i = 0; i < uSegments; i++) {
    for (let j = 0; j < vSegments; j++) {
      const a = i * stride + j;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}
