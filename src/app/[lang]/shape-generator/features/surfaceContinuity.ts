// NURBS / mesh surface continuity analysis.
// Reports G0 (position), G1 (tangent), G2 (curvature) match across a shared
// boundary curve. Used by Class A surfacing workflows to verify that two
// patches blend smoothly enough for visual fidelity.
//
// Implementation samples both surfaces along the boundary and compares
// numerically — works for any geometry (NURBS, mesh, swept) since we only
// touch the discretized boundary samples.

import * as THREE from 'three';

export type ContinuityLevel = 'G0' | 'G1' | 'G2';

export interface ContinuityResult {
  level: ContinuityLevel;
  /** Worst position gap along the boundary (mm). */
  maxPositionGapMm: number;
  /** Worst tangent angle mismatch (degrees). */
  maxTangentAngleDeg: number;
  /** Worst curvature ratio mismatch (unitless; 1 = perfect match). */
  maxCurvatureRatio: number;
  /** Per-sample diagnostic (length = samples). */
  samples: {
    t: number;
    posGap: number;
    tangentAngle: number;
    curvatureRatio: number;
  }[];
}

export interface BoundarySampler {
  /** Position on the boundary at parameter t ∈ [0, 1]. */
  position(t: number): THREE.Vector3;
  /** Tangent direction at t (unit-length). */
  tangent(t: number): THREE.Vector3;
  /** Curvature magnitude at t (1/mm). 0 for flat samples. */
  curvature(t: number): number;
}

const POSITION_TOL_MM = 0.05;
const TANGENT_TOL_DEG = 1.0;
const CURVATURE_TOL_RATIO = 0.05; // 5% mismatch tolerance

/**
 * Sample two boundary curves at N points and classify continuity. The two
 * samplers should evaluate the SAME physical boundary curve as seen from
 * each adjacent surface.
 */
export function evaluateContinuity(
  a: BoundarySampler,
  b: BoundarySampler,
  samples = 32,
): ContinuityResult {
  let maxPosGap = 0;
  let maxTanDeg = 0;
  let maxCurvRatio = 1;
  const samplesOut: ContinuityResult['samples'] = [];

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const pa = a.position(t);
    const pb = b.position(t);
    const posGap = pa.distanceTo(pb);

    const ta = a.tangent(t).normalize();
    const tb = b.tangent(t).normalize();
    const dot = Math.max(-1, Math.min(1, ta.dot(tb)));
    const tanRad = Math.acos(Math.abs(dot));
    const tanDeg = (tanRad * 180) / Math.PI;

    const ka = a.curvature(t);
    const kb = b.curvature(t);
    const curvRatio = ka > 1e-6 && kb > 1e-6
      ? Math.abs(ka - kb) / Math.max(ka, kb)
      : Math.abs(ka - kb) < 1e-6 ? 0 : 1;

    maxPosGap = Math.max(maxPosGap, posGap);
    maxTanDeg = Math.max(maxTanDeg, tanDeg);
    maxCurvRatio = Math.max(maxCurvRatio, curvRatio);
    samplesOut.push({ t, posGap, tangentAngle: tanDeg, curvatureRatio: curvRatio });
  }

  let level: ContinuityLevel;
  if (maxPosGap > POSITION_TOL_MM) {
    level = 'G0';
  } else if (maxTanDeg > TANGENT_TOL_DEG) {
    level = 'G0';
  } else if (maxCurvRatio > CURVATURE_TOL_RATIO) {
    level = 'G1';
  } else {
    level = 'G2';
  }

  return {
    level,
    maxPositionGapMm: maxPosGap,
    maxTangentAngleDeg: maxTanDeg,
    maxCurvatureRatio: maxCurvRatio,
    samples: samplesOut,
  };
}

// ─── Convenience adapter — polyline boundary ──────────────────────────────

/**
 * Build a BoundarySampler from a discretized polyline. Tangents come from
 * finite differences; curvature uses the 2nd derivative approximation.
 * Useful for mesh-derived boundaries where no analytic curve exists.
 */
export function polylineSampler(points: THREE.Vector3[]): BoundarySampler {
  if (points.length < 2) {
    throw new Error('Polyline sampler needs ≥ 2 points');
  }
  return {
    position(t: number) {
      const u = Math.max(0, Math.min(1, t)) * (points.length - 1);
      const i = Math.floor(u);
      const f = u - i;
      const a = points[i];
      const b = points[Math.min(i + 1, points.length - 1)];
      return a.clone().lerp(b, f);
    },
    tangent(t: number) {
      const u = Math.max(0, Math.min(1, t)) * (points.length - 1);
      const i = Math.max(0, Math.min(points.length - 2, Math.floor(u)));
      const a = points[i];
      const b = points[i + 1];
      return b.clone().sub(a).normalize();
    },
    curvature(t: number) {
      const u = Math.max(0.01, Math.min(0.99, t)) * (points.length - 1);
      const i = Math.max(1, Math.min(points.length - 2, Math.floor(u)));
      const p0 = points[i - 1];
      const p1 = points[i];
      const p2 = points[i + 1];
      const v1 = p1.clone().sub(p0);
      const v2 = p2.clone().sub(p1);
      const cross = new THREE.Vector3().crossVectors(v1, v2);
      const area = cross.length();
      const denom = v1.length() * v2.length() * p2.clone().sub(p0).length();
      if (denom < 1e-9) return 0;
      return (2 * area) / denom;
    },
  };
}
