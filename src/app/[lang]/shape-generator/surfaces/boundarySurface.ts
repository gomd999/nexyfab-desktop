/**
 * boundarySurface.ts — Coons patch construction from 4 boundary curves.
 *
 * Given four NURBS curves forming a closed loop (c0/c1 along U at v=0
 * and v=1, d0/d1 along V at u=0 and u=1), the Coons patch fills the
 * interior using the standard bilinear blend formula:
 *
 *   S(u,v) = (1-v)·c0(u) + v·c1(u) + (1-u)·d0(v) + u·d1(v)
 *          - (1-u)(1-v)·c0(0) - (1-u)v·c1(0)
 *          - u(1-v)·c0(1)     - uv·c1(1)
 *
 * The construction requires the boundary curves to share endpoints
 * (a quadrilateral topology). We don't enforce that explicitly — the
 * caller is responsible — but `validateCoonsBoundary` reports the
 * worst endpoint mismatch so the user knows when the patch is
 * geometrically inconsistent.
 *
 * Coons patches are widely used as the "fill a hole" operation in
 * mid-tier CAD (SolidWorks `Boundary Surface`, Fusion `Patch`). For
 * Class-A surfaces you'd want a Gordon patch or a full bicubic
 * Hermite (with cross-derivatives), but Coons is the right starting
 * point: simple, always defined, robust against curve degeneracies.
 */

import * as THREE from 'three';
import { evalNurbsCurve3D, type NurbsCurve3D } from './nurbsCurve';

export interface CoonsBoundary {
  /** Bottom edge (v=0), parameterised u ∈ knot range of c0. */
  c0: NurbsCurve3D;
  /** Top edge (v=1). */
  c1: NurbsCurve3D;
  /** Left edge (u=0). */
  d0: NurbsCurve3D;
  /** Right edge (u=1). */
  d1: NurbsCurve3D;
}

/** Map (0..1) into a curve's knot range [knots[degree], knots[end-degree-1]]. */
function curveParam(curve: NurbsCurve3D, t: number): number {
  const lo = curve.knots[curve.degree];
  const hi = curve.knots[curve.knots.length - curve.degree - 1];
  return lo + (hi - lo) * t;
}

/** Evaluate the Coons patch at (u, v) ∈ [0, 1]². */
export function evalCoonsPatch(b: CoonsBoundary, u: number, v: number): THREE.Vector3 {
  const c0u = evalNurbsCurve3D(b.c0, curveParam(b.c0, u));
  const c1u = evalNurbsCurve3D(b.c1, curveParam(b.c1, u));
  const d0v = evalNurbsCurve3D(b.d0, curveParam(b.d0, v));
  const d1v = evalNurbsCurve3D(b.d1, curveParam(b.d1, v));

  const c00 = evalNurbsCurve3D(b.c0, curveParam(b.c0, 0));
  const c01 = evalNurbsCurve3D(b.c0, curveParam(b.c0, 1));
  const c10 = evalNurbsCurve3D(b.c1, curveParam(b.c1, 0));
  const c11 = evalNurbsCurve3D(b.c1, curveParam(b.c1, 1));

  // S = (1-v)c0 + v c1 + (1-u)d0 + u d1
  //   - (1-u)(1-v)c00 - (1-u)v c10 - u(1-v)c01 - uv c11
  const mu = 1 - u;
  const mv = 1 - v;
  const x =
    mv * c0u.x + v * c1u.x + mu * d0v.x + u * d1v.x
    - mu * mv * c00.x - mu * v * c10.x - u * mv * c01.x - u * v * c11.x;
  const y =
    mv * c0u.y + v * c1u.y + mu * d0v.y + u * d1v.y
    - mu * mv * c00.y - mu * v * c10.y - u * mv * c01.y - u * v * c11.y;
  const z =
    mv * c0u.z + v * c1u.z + mu * d0v.z + u * d1v.z
    - mu * mv * c00.z - mu * v * c10.z - u * mv * c01.z - u * v * c11.z;
  return new THREE.Vector3(x, y, z);
}

export interface CoonsValidation {
  /** Worst endpoint mismatch found between adjacent boundary curves, mm. */
  maxCornerGap: number;
  /** Per-corner gaps (4 corners), mm — useful for debug. */
  cornerGaps: { tl: number; tr: number; bl: number; br: number };
  /** True when every corner gap is below `tolerance` (default 1e-3 mm). */
  ok: boolean;
}

/** Quick sanity check on the boundary loop: each corner should be the
 *  shared endpoint of two curves. Gaps larger than the tolerance mean
 *  the patch's corners will visibly tear. */
export function validateCoonsBoundary(b: CoonsBoundary, tolerance = 1e-3): CoonsValidation {
  const c00 = evalNurbsCurve3D(b.c0, curveParam(b.c0, 0));
  const c01 = evalNurbsCurve3D(b.c0, curveParam(b.c0, 1));
  const c10 = evalNurbsCurve3D(b.c1, curveParam(b.c1, 0));
  const c11 = evalNurbsCurve3D(b.c1, curveParam(b.c1, 1));
  const d00 = evalNurbsCurve3D(b.d0, curveParam(b.d0, 0));
  const d01 = evalNurbsCurve3D(b.d0, curveParam(b.d0, 1));
  const d10 = evalNurbsCurve3D(b.d1, curveParam(b.d1, 0));
  const d11 = evalNurbsCurve3D(b.d1, curveParam(b.d1, 1));

  // The bottom-left corner sits at u=0, v=0: should be c0(0) == d0(0).
  const bl = c00.distanceTo(d00);
  const br = c01.distanceTo(d10);
  const tl = c10.distanceTo(d01);
  const tr = c11.distanceTo(d11);
  const maxCornerGap = Math.max(bl, br, tl, tr);
  return {
    maxCornerGap,
    cornerGaps: { tl, tr, bl, br },
    ok: maxCornerGap <= tolerance,
  };
}

/** Tessellate the Coons patch into a BufferGeometry — same conventions
 *  as `tessellateNurbsSurface`. Normals computed via finite difference. */
export function tessellateCoonsPatch(
  b: CoonsBoundary,
  uSegments = 16,
  vSegments = 16,
): THREE.BufferGeometry {
  const positions: number[] = [];
  for (let i = 0; i <= uSegments; i++) {
    const u = i / uSegments;
    for (let j = 0; j <= vSegments; j++) {
      const v = j / vSegments;
      const p = evalCoonsPatch(b, u, v);
      positions.push(p.x, p.y, p.z);
    }
  }
  const indices: number[] = [];
  const stride = vSegments + 1;
  for (let i = 0; i < uSegments; i++) {
    for (let j = 0; j < vSegments; j++) {
      const a = i * stride + j;
      const next = a + stride;
      indices.push(a, next, a + 1);
      indices.push(a + 1, next, next + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
