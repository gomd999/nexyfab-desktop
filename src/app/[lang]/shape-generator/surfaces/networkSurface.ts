/**
 * networkSurface.ts — Surface through a grid of orthogonal curves.
 *
 * Where Coons builds from 4 boundary curves, *network* surfaces
 * accept N curves running along U and M curves running along V.
 * The surface passes through every intersection point of the
 * U/V curves and smoothly interpolates between them.
 *
 * Approach: at each (u, v) sample, blend the nearest U-curves +
 * V-curves using bilinear weights. For dense curve networks this
 * converges to the right surface; sparse networks reduce to a
 * Coons-like patch.
 *
 * Implementation kept compact: real CAD's GORDON surface uses
 * 3 components (ruled U + ruled V − tensor product of intersection
 * points). This module ships the simpler bilinear-interpolation
 * variant which is preview-grade.
 */

import type { PatchPoint, Curve } from './coonsPatch';

export interface NetworkInput {
  /** Curves along U (one per V slot, parameterised u ∈ [0,1]). */
  uCurves: Curve[];
  /** Curves along V (one per U slot). */
  vCurves: Curve[];
  /** V positions at which each uCurve lives (length = uCurves.length). */
  vSamples: number[];
  /** U positions at which each vCurve lives (length = vCurves.length). */
  uSamples: number[];
}

function findInterval(samples: number[], t: number): [number, number, number] {
  // Returns [lowIdx, highIdx, mixT] for interpolation.
  if (t <= samples[0]!) return [0, 0, 0];
  if (t >= samples[samples.length - 1]!) {
    const last = samples.length - 1;
    return [last, last, 1];
  }
  for (let i = 0; i < samples.length - 1; i++) {
    if (t >= samples[i]! && t <= samples[i + 1]!) {
      const denom = samples[i + 1]! - samples[i]!;
      const mix = denom === 0 ? 0 : (t - samples[i]!) / denom;
      return [i, i + 1, mix];
    }
  }
  return [0, 0, 0];
}

function lerp(a: PatchPoint, b: PatchPoint, t: number): PatchPoint {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

/** Evaluate the network surface at (u, v). */
export function evalNetworkSurface(net: NetworkInput, u: number, v: number): PatchPoint {
  // Interpolate u along the two nearest u-curves.
  const [iV0, iV1, mixV] = findInterval(net.vSamples, v);
  const pUC0 = net.uCurves[iV0]!(u);
  const pUC1 = net.uCurves[iV1]!(u);
  const uBlend = lerp(pUC0, pUC1, mixV);

  // Interpolate v along the two nearest v-curves.
  const [iU0, iU1, mixU] = findInterval(net.uSamples, u);
  const pVC0 = net.vCurves[iU0]!(v);
  const pVC1 = net.vCurves[iU1]!(v);
  const vBlend = lerp(pVC0, pVC1, mixU);

  // Average — Gordon-like (sum) minus the bilinear of corner intersections.
  // For simplicity we average rather than full Gordon subtract.
  return {
    x: (uBlend.x + vBlend.x) * 0.5,
    y: (uBlend.y + vBlend.y) * 0.5,
    z: (uBlend.z + vBlend.z) * 0.5,
  };
}

export interface NetworkMesh {
  positions: number[];
  indices: number[];
  uvs: number[];
}

export function tessellateNetworkSurface(
  net: NetworkInput,
  uSegments: number = 16,
  vSegments: number = 16,
): NetworkMesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  for (let j = 0; j <= vSegments; j++) {
    for (let i = 0; i <= uSegments; i++) {
      const u = i / uSegments;
      const v = j / vSegments;
      const p = evalNetworkSurface(net, u, v);
      positions.push(p.x, p.y, p.z);
      uvs.push(u, v);
    }
  }
  const indices: number[] = [];
  const cols = uSegments + 1;
  for (let j = 0; j < vSegments; j++) {
    for (let i = 0; i < uSegments; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  return { positions, indices, uvs };
}
