/**
 * NURBS Freeform Surface Feature
 *
 * Creates a freeform surface from a parametric control-point grid using a
 * genuine **tensor-product B-spline surface**:
 *
 *   S(u,v) = Σ_i Σ_j  N_{i,p}(u) · M_{j,q}(v) · P_{i,j}
 *
 * where N_{i,p} / M_{j,q} are the Cox-de Boor B-spline basis functions in the
 * u / v directions (degrees p / q) evaluated over clamped uniform knot vectors.
 * Rational (NURBS) evaluation is supported when per-control weights are given:
 *
 *   S(u,v) = [Σ_i Σ_j N M w_{i,j} P_{i,j}] / [Σ_i Σ_j N M w_{i,j}]
 *
 * The basis evaluation is reused from `curveFitting` (`basisFunction`, the same
 * Cox-de Boor recurrence that drives the interpolation/approximation solvers),
 * so this is a real basis evaluation — not a Catmull-Rom or loft stand-in.
 *
 * With clamped knot vectors (degree+1 repeated end knots) the surface
 * interpolates the four corner control points exactly, which the tests assert.
 */

import * as THREE from 'three';
import type { FeatureDefinition } from './types';
import { basisFunction } from './curveFitting';

// ─── Control point helpers ────────────────────────────────────────────────────

/** Encode a control point position key into params */
export function cpKey(i: number, j: number, axis: 0 | 1 | 2): string {
  return `cp_${i}_${j}_${axis}`;
}

/** Encode a control point rational weight key into params (NURBS). */
export function cpWeightKey(i: number, j: number): string {
  return `cpw_${i}_${j}`;
}

/** Build the CP grid from params. Uses custom CPs if encoded, else default sinusoidal. */
export function buildCpGrid(
  params: Record<string, number>,
  uCount: number,
  vCount: number,
): [number, number, number][][] {
  const amplitude = params.amplitude ?? 20;
  const width = params.width ?? 100;
  const depth = params.depth ?? 100;
  const hasCustom = params[cpKey(0, 0, 0)] !== undefined;

  const cp: [number, number, number][][] = [];
  for (let i = 0; i < uCount; i++) {
    cp[i] = [];
    for (let j = 0; j < vCount; j++) {
      if (hasCustom) {
        cp[i][j] = [
          params[cpKey(i, j, 0)] ?? 0,
          params[cpKey(i, j, 1)] ?? 0,
          params[cpKey(i, j, 2)] ?? 0,
        ];
      } else {
        const u = i / (uCount - 1);
        const v = j / (vCount - 1);
        const h = Math.sin(u * Math.PI * 2) * Math.cos(v * Math.PI * 2) * amplitude;
        cp[i][j] = [(u - 0.5) * width, h, (v - 0.5) * depth];
      }
    }
  }
  return cp;
}

/** Build the per-control weight grid. Absent keys default to 1 (non-rational). */
export function buildWeightGrid(
  params: Record<string, number>,
  uCount: number,
  vCount: number,
): number[][] {
  const w: number[][] = [];
  for (let i = 0; i < uCount; i++) {
    w[i] = [];
    for (let j = 0; j < vCount; j++) {
      const raw = params[cpWeightKey(i, j)];
      w[i][j] = raw !== undefined && raw > 0 ? raw : 1;
    }
  }
  return w;
}

// ─── Tensor-product B-spline surface core ─────────────────────────────────────

export interface BSplineSurface {
  /** Control net, indexed [i][j] → [x,y,z]. i spans u, j spans v. */
  controlPoints: [number, number, number][][];
  /** Per-control rational weights, same shape as controlPoints. */
  weights: number[][];
  degreeU: number;
  degreeV: number;
  /** Clamped knot vector, length = uCount + degreeU + 1. */
  knotsU: number[];
  /** Clamped knot vector, length = vCount + degreeV + 1. */
  knotsV: number[];
}

/**
 * Clamped uniform knot vector for `n` control points at the given `degree`.
 * The first and last `degree+1` knots are repeated so the curve/surface is
 * clamped (interpolates the boundary control points); interior knots are
 * evenly spaced over [0,1].
 */
export function clampedUniformKnotVector(n: number, degree: number): number[] {
  const m = n + degree + 1;
  const knots: number[] = [];
  for (let i = 0; i < m; i++) {
    if (i <= degree) knots.push(0);
    else if (i >= m - degree - 1) knots.push(1);
    else knots.push((i - degree) / (n - degree));
  }
  return knots;
}

/**
 * Assemble a tensor-product B-spline surface over a control net with clamped
 * uniform knot vectors. Degrees are clamped to (count - 1) so the surface is
 * always well-formed even for small grids.
 */
export function makeUniformBSplineSurface(
  controlPoints: [number, number, number][][],
  degreeU: number,
  degreeV: number,
  weights?: number[][],
): BSplineSurface {
  const uCount = controlPoints.length;
  const vCount = controlPoints[0]?.length ?? 0;
  const pU = Math.max(1, Math.min(degreeU, uCount - 1));
  const pV = Math.max(1, Math.min(degreeV, vCount - 1));
  const w = weights ?? controlPoints.map(row => row.map(() => 1));
  return {
    controlPoints,
    weights: w,
    degreeU: pU,
    degreeV: pV,
    knotsU: clampedUniformKnotVector(uCount, pU),
    knotsV: clampedUniformKnotVector(vCount, pV),
  };
}

/**
 * Evaluate the u-direction basis row [N_{0,p}(u) … N_{n-1,p}(u)] via the same
 * Cox-de Boor recurrence used by the curve fitter. Sums to 1 (partition of
 * unity) for any u inside the knot domain.
 */
function basisRow(u: number, degree: number, knots: number[], n: number): number[] {
  const row = new Array<number>(n);
  for (let i = 0; i < n; i++) row[i] = basisFunction(i, degree, u, knots);
  return row;
}

/**
 * Evaluate the surface point S(u,v) for u,v ∈ [0,1]. Rational when any weight
 * ≠ 1; reduces exactly to the polynomial B-spline surface when all weights = 1.
 */
export function evalBSplineSurface(
  surf: BSplineSurface,
  u: number,
  v: number,
): [number, number, number] {
  const uCount = surf.controlPoints.length;
  const vCount = surf.controlPoints[0]!.length;
  const nu = basisRow(u, surf.degreeU, surf.knotsU, uCount);
  const nv = basisRow(v, surf.degreeV, surf.knotsV, vCount);

  let x = 0, y = 0, z = 0, wsum = 0;
  for (let i = 0; i < uCount; i++) {
    const ni = nu[i]!;
    if (ni === 0) continue;
    const row = surf.controlPoints[i]!;
    const wrow = surf.weights[i]!;
    for (let j = 0; j < vCount; j++) {
      const b = ni * nv[j]!;
      if (b === 0) continue;
      const wb = b * wrow[j]!;
      const p = row[j]!;
      x += wb * p[0];
      y += wb * p[1];
      z += wb * p[2];
      wsum += wb;
    }
  }
  if (wsum === 0) return [0, 0, 0];
  return [x / wsum, y / wsum, z / wsum];
}

// ─── Mesh construction ────────────────────────────────────────────────────────

function buildBSplineSurfaceGeometry(params: Record<string, number>): THREE.BufferGeometry {
  const uCount = Math.max(2, Math.round(params.uCount ?? 5));
  const vCount = Math.max(2, Math.round(params.vCount ?? 5));
  const seg = Math.max(8, Math.round(params.tessellation ?? 32));
  const degree = Math.max(1, Math.round(params.degree ?? 3));

  const cp = buildCpGrid(params, uCount, vCount);
  const weights = buildWeightGrid(params, uCount, vCount);
  const surf = makeUniformBSplineSurface(cp, degree, degree, weights);

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const eps = 1e-4;

  const evalAt = (u: number, v: number): [number, number, number] =>
    evalBSplineSurface(surf, u, v);

  for (let i = 0; i <= seg; i++) {
    for (let j = 0; j <= seg; j++) {
      const u = i / seg;
      const v = j / seg;
      const [x, y, z] = evalAt(u, v);
      positions.push(x, y, z);
      uvs.push(u, v);

      // Central/one-sided finite differences of the analytic surface for normals.
      const [xu, yu, zu] = evalAt(Math.min(u + eps, 1), v);
      const [xu0, yu0, zu0] = evalAt(Math.max(u - eps, 0), v);
      const [xv, yv, zv] = evalAt(u, Math.min(v + eps, 1));
      const [xv0, yv0, zv0] = evalAt(u, Math.max(v - eps, 0));
      const du = new THREE.Vector3(xu - xu0, yu - yu0, zu - zu0);
      const dv = new THREE.Vector3(xv - xv0, yv - yv0, zv - zv0);
      const n = du.cross(dv);
      if (n.lengthSq() < 1e-20) n.set(0, 1, 0);
      else n.normalize();
      normals.push(n.x, n.y, n.z);
    }
  }

  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j;
      const b = a + 1;
      const c = (i + 1) * (seg + 1) + j;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

// ─── Feature definition ───────────────────────────────────────────────────────

export const nurbsSurfaceFeature: FeatureDefinition = {
  type: 'nurbsSurface',
  icon: '〜',
  params: [
    { key: 'width',        labelKey: 'paramNurbsWidth',        default: 100, min: 10,  max: 500, step: 5,   unit: 'mm' },
    { key: 'depth',        labelKey: 'paramNurbsDepth',        default: 100, min: 10,  max: 500, step: 5,   unit: 'mm' },
    { key: 'amplitude',    labelKey: 'paramNurbsAmplitude',    default: 20,  min: 0,   max: 100, step: 1,   unit: 'mm' },
    { key: 'uCount',       labelKey: 'paramNurbsUCount',       default: 5,   min: 3,   max: 12,  step: 1,   unit: '' },
    { key: 'vCount',       labelKey: 'paramNurbsVCount',       default: 5,   min: 3,   max: 12,  step: 1,   unit: '' },
    { key: 'degree',       labelKey: 'paramNurbsDegree',       default: 3,   min: 1,   max: 5,   step: 1,   unit: '' },
    { key: 'tessellation', labelKey: 'paramNurbsTessellation', default: 32,  min: 8,   max: 128, step: 8,   unit: '' },
    { key: 'thickness',    labelKey: 'paramNurbsThickness',    default: 2,   min: 0,   max: 20,  step: 0.5, unit: 'mm' },
  ],

  apply(_geometry, params) {
    return buildBSplineSurfaceGeometry(params);
  },
};
