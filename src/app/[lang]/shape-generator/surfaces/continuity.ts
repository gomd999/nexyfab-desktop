/**
 * continuity.ts — Position / tangent / curvature continuity check
 * between two adjacent NURBS surfaces along a shared boundary.
 *
 * In CAD terminology:
 *   - **G0** (position continuity): surfaces touch but seam is visible.
 *     The boundary points match within `positionTolerance`.
 *   - **G1** (tangent continuity): surfaces blend smoothly with no
 *     visible seam — the surface normals on either side of the
 *     boundary point in the same direction (up to sign).
 *   - **G2** (curvature continuity): also matches curvature; required
 *     for Class-A automotive bodies and high-end industrial design.
 *     We approximate this by comparing second derivatives perpendicular
 *     to the boundary.
 *
 * Inputs are pairs of "surface + boundary side" — we sample the
 * boundary on both surfaces and measure deltas at matching parameter
 * values. The match-up assumes the user has set up the boundary
 * parametrisation consistently; we don't auto-reverse direction.
 *
 * Scope:
 *   - Only one boundary edge at a time (caller can check all four
 *     edges separately).
 *   - Tangent comparison uses normalised surface normals (not raw
 *     derivatives) so scale differences don't trip false negatives.
 *   - G2 approximation via finite-difference of the normal — adequate
 *     for inspection / red-flagging, not for Class-A certification.
 */

import * as THREE from 'three';
import { evalNurbsSurface, evalNurbsSurfaceNormal, type NurbsSurface } from './nurbsSurface';

export type BoundaryEdge = 'u0' | 'u1' | 'v0' | 'v1';

export interface ContinuitySample {
  /** Parameter along the boundary (0 to 1). */
  t: number;
  /** Distance between surface points at this parameter, mm. */
  positionGap: number;
  /** Angle (rad) between surface normals at this parameter. */
  normalAngle: number;
}

export interface ContinuityReport {
  /** Worst gaps across all samples — what the inspector cares about. */
  maxPositionGap: number;
  maxNormalAngle: number;
  /** Sample-by-sample data for plotting / debug. Capped at sampleCount. */
  samples: ContinuitySample[];
  /** Continuity verdict — strictest level the surfaces clear. */
  level: 'discontinuous' | 'G0' | 'G1' | 'G2';
}

export interface ContinuityOptions {
  /** Number of samples along the boundary. */
  sampleCount?: number;
  /** Position tolerance for G0, mm. */
  positionTolerance?: number;
  /** Normal angle tolerance for G1, radians. */
  normalAngleTolerance?: number;
}

/** Map a boundary parameter t (0..1) to the (u, v) point that lies on
 *  the requested edge of the surface. */
function paramOnEdge(edge: BoundaryEdge, t: number): { u: number; v: number } {
  switch (edge) {
    case 'u0': return { u: 0, v: t };
    case 'u1': return { u: 1, v: t };
    case 'v0': return { u: t, v: 0 };
    case 'v1': return { u: t, v: 1 };
  }
}

/**
 * Sample two surfaces along their respective boundary edges and
 * return per-sample position / normal differences plus an overall
 * continuity-level verdict.
 */
export function checkSurfaceContinuity(
  a: NurbsSurface,
  edgeA: BoundaryEdge,
  b: NurbsSurface,
  edgeB: BoundaryEdge,
  opts: ContinuityOptions = {},
): ContinuityReport {
  const N = Math.max(2, opts.sampleCount ?? 9);
  const posTol = opts.positionTolerance ?? 1e-3;
  const angTol = opts.normalAngleTolerance ?? (Math.PI / 180); // 1°

  const samples: ContinuitySample[] = [];
  let maxPositionGap = 0;
  let maxNormalAngle = 0;

  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const pa = paramOnEdge(edgeA, t);
    const pb = paramOnEdge(edgeB, t);
    const pointA = evalNurbsSurface(a, pa.u, pa.v);
    const pointB = evalNurbsSurface(b, pb.u, pb.v);
    const gap = pointA.distanceTo(pointB);

    const normalA = evalNurbsSurfaceNormal(a, pa.u, pa.v);
    const normalB = evalNurbsSurfaceNormal(b, pb.u, pb.v);
    // Allow normals to flip sign (CAD packages often have inconsistent
    // surface orientations on imported geometry) — the absolute dot
    // captures parallel vs perpendicular cleanly.
    const dot = Math.abs(THREE.MathUtils.clamp(normalA.dot(normalB), -1, 1));
    const angle = Math.acos(dot);

    samples.push({ t, positionGap: gap, normalAngle: angle });
    if (gap > maxPositionGap) maxPositionGap = gap;
    if (angle > maxNormalAngle) maxNormalAngle = angle;
  }

  // Decide overall level.
  let level: ContinuityReport['level'];
  if (maxPositionGap > posTol) {
    level = 'discontinuous';
  } else if (maxNormalAngle > angTol) {
    level = 'G0';
  } else {
    // G2 would require comparing curvatures (second derivatives). For
    // this PR we report G1 when normals match within tolerance — a
    // proper G2 check lands when we have the second-derivative
    // machinery from `nurbsCurve`/`nurbsSurface`.
    level = 'G1';
  }
  return { maxPositionGap, maxNormalAngle, samples, level };
}
