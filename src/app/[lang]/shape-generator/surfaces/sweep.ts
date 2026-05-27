/**
 * sweep.ts — Sweep a 2-D profile along a 3-D path with frame
 * propagation. The output is a tube-like surface that wraps the
 * profile around the path's tangent direction at every sample.
 *
 * Frame strategy: **parallel-transport frame** (Hanson & Ma 1995),
 * NOT the textbook Frenet frame. Frenet flips at inflection points
 * — at any straight section of the path the binormal is undefined
 * and the surface twists by 180° when curvature crosses zero. The
 * parallel-transport frame avoids the flip by rotating the previous
 * frame minimally onto the new tangent.
 *
 * Math per step:
 *   1. T_i  = unit tangent at path sample i
 *   2. q_i  = rotation that maps T_{i-1} to T_i
 *   3. N_i  = q_i · N_{i-1}    (parallel-transported normal)
 *   4. B_i  = T_i × N_i        (binormal)
 *
 * The profile is supplied as a 2-D polyline; at each path sample we
 * place it in the (N_i, B_i) plane centred on the path point.
 *
 * Out of scope for this PR: twist driver (user-controlled rotation
 * around path), multiple guide curves, variable-scale profile.
 */

import * as THREE from 'three';
import { sampleNurbsCurve3D, evalNurbsCurve3DDerivative, type NurbsCurve3D } from './nurbsCurve';

export interface SweepOptions {
  /** Number of samples along the path. Higher = smoother sweep, more triangles. */
  pathSampleCount: number;
}

export interface SweepReport {
  pathSampleCount: number;
  profileVertexCount: number;
  totalVertices: number;
  totalTriangles: number;
}

export interface SweepResult {
  geometry: THREE.BufferGeometry;
  report: SweepReport;
}

/** Sweep a 2-D profile along a 3-D path. Profile points are in the
 *  (x, y) plane and are placed in the (N, B) plane at each path
 *  sample, with x ↦ N and y ↦ B. */
export function buildSweep(
  path: NurbsCurve3D,
  profile: { x: number; y: number }[],
  opts: SweepOptions,
): SweepResult {
  const M = Math.max(2, Math.floor(opts.pathSampleCount));
  const profCount = profile.length;
  if (profCount < 2) {
    return {
      geometry: new THREE.BufferGeometry(),
      report: { pathSampleCount: M, profileVertexCount: profCount, totalVertices: 0, totalTriangles: 0 },
    };
  }

  // Sample path positions + tangents at M parameter values.
  const pathPoints: THREE.Vector3[] = sampleNurbsCurve3D(path, M);
  const tangents: THREE.Vector3[] = [];
  for (let i = 0; i < M; i++) {
    const t = i / (M - 1);
    const uStart = path.knots[path.degree];
    const uEnd = path.knots[path.knots.length - path.degree - 1];
    const u = uStart + (uEnd - uStart) * t;
    const tan = evalNurbsCurve3DDerivative(path, u);
    if (tan.lengthSq() < 1e-12) {
      // Degenerate tangent — reuse the previous one or default to +X.
      tangents.push(i > 0 ? tangents[i - 1].clone() : new THREE.Vector3(1, 0, 0));
    } else {
      tangents.push(tan.normalize());
    }
  }

  // Parallel-transport frame: seed N₀ as any unit vector perpendicular
  // to T₀. Use world-up as the seed direction unless T₀ is nearly
  // parallel to it (in which case use world-forward).
  const seed = Math.abs(tangents[0].y) < 0.9
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(0, 0, 1);
  let N = new THREE.Vector3().crossVectors(tangents[0], seed).normalize();
  if (N.lengthSq() < 1e-12) N.set(0, 0, 1);
  let B = new THREE.Vector3().crossVectors(tangents[0], N).normalize();

  const frames: { N: THREE.Vector3; B: THREE.Vector3 }[] = [{ N: N.clone(), B: B.clone() }];

  for (let i = 1; i < M; i++) {
    const t0 = tangents[i - 1];
    const t1 = tangents[i];
    // Rotation that maps t0 to t1.
    const axis = new THREE.Vector3().crossVectors(t0, t1);
    const axisLen = axis.length();
    if (axisLen < 1e-9) {
      // Tangent didn't change — keep frame as-is.
      frames.push({ N: N.clone(), B: B.clone() });
      continue;
    }
    axis.divideScalar(axisLen);
    const dot = THREE.MathUtils.clamp(t0.dot(t1), -1, 1);
    const angle = Math.acos(dot);
    const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    N = N.clone().applyQuaternion(q).normalize();
    B = new THREE.Vector3().crossVectors(t1, N).normalize();
    frames.push({ N: N.clone(), B: B.clone() });
  }

  // Build vertex grid: each path sample × each profile point.
  const positions: number[] = [];
  for (let i = 0; i < M; i++) {
    const p = pathPoints[i];
    const { N: Ni, B: Bi } = frames[i];
    for (const pp of profile) {
      const wx = p.x + Ni.x * pp.x + Bi.x * pp.y;
      const wy = p.y + Ni.y * pp.x + Bi.y * pp.y;
      const wz = p.z + Ni.z * pp.x + Bi.z * pp.y;
      positions.push(wx, wy, wz);
    }
  }

  // Quad strip indices: connect rings.
  const indices: number[] = [];
  for (let i = 0; i < M - 1; i++) {
    for (let j = 0; j < profCount - 1; j++) {
      const a = i * profCount + j;
      const b = a + 1;
      const c = a + profCount;
      const d = c + 1;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return {
    geometry: geo,
    report: {
      pathSampleCount: M,
      profileVertexCount: profCount,
      totalVertices: positions.length / 3,
      totalTriangles: indices.length / 3,
    },
  };
}
