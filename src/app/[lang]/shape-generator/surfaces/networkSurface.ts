/**
 * networkSurface.ts — Surface through a grid of orthogonal curves.
 *
 * Where Coons builds from 4 boundary curves, *network* surfaces
 * accept N curves running along U and M curves running along V.
 * The surface passes through every intersection point of the
 * U/V curves and smoothly interpolates between them.
 *
 * Approach: the **Gordon surface** (Gordon 1969) —
 *     S = U(u,v) + V(u,v) − T(u,v)
 * where U interpolates the U-curves across V, V interpolates the
 * V-curves across U, and T is the bilinear tensor product of the
 * curve-intersection grid. The −T term is what makes S pass through
 * EVERY network curve exactly (not just the intersection points): on
 * any grid line V and T cancel, leaving the corresponding curve.
 * (The earlier (U+V)/2 average only hit the intersections and sagged
 * halfway to the chord between them — preview-grade. This is exact.)
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

/** Evaluate the network (Gordon) surface at (u, v). */
export function evalNetworkSurface(net: NetworkInput, u: number, v: number): PatchPoint {
  // U term: interpolate the u-curves across V.
  const [iV0, iV1, mixV] = findInterval(net.vSamples, v);
  const uBlend = lerp(net.uCurves[iV0]!(u), net.uCurves[iV1]!(u), mixV);

  // V term: interpolate the v-curves across U.
  const [iU0, iU1, mixU] = findInterval(net.uSamples, u);
  const vBlend = lerp(net.vCurves[iU0]!(v), net.vCurves[iU1]!(v), mixU);

  // T term: bilinear tensor product of the four bounding intersection points.
  // The intersection at (uSamples[a], vSamples[b]) is the b-th u-curve sampled
  // at the a-th u-position. Subtracting this is what makes the surface
  // interpolate every curve (on a grid line, vBlend − T = 0).
  const I = (a: number, b: number): PatchPoint => net.uCurves[b]!(net.uSamples[a]!);
  const t0 = lerp(I(iU0, iV0), I(iU1, iV0), mixU);
  const t1 = lerp(I(iU0, iV1), I(iU1, iV1), mixU);
  const tBlend = lerp(t0, t1, mixV);

  return {
    x: uBlend.x + vBlend.x - tBlend.x,
    y: uBlend.y + vBlend.y - tBlend.y,
    z: uBlend.z + vBlend.z - tBlend.z,
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
