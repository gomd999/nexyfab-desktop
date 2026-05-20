/**
 * coonsPatch.ts — Linearly-blended Coons patch.
 *
 * A Coons patch interpolates a surface bounded by four input curves
 * P₀(u), P₁(u) (top/bottom along u) and Q₀(v), Q₁(v) (left/right
 * along v). The classical Coons surface formula:
 *
 *   C(u,v) = ruled_u + ruled_v - bilinear_corner
 *
 *   ruled_u = (1-v) P₀(u) + v P₁(u)
 *   ruled_v = (1-u) Q₀(v) + u Q₁(v)
 *   bilinear = (1-u)(1-v) P₀(0) + u(1-v) P₀(1) + (1-u)v P₁(0) + uv P₁(1)
 *
 * The patch passes through every boundary point and the corners
 * exactly. Smoothness across patch joins is C0; higher continuity
 * needs blending functions (G1 Coons / bicubic Hermite), not in
 * this Phase-3 starter.
 */

export interface PatchPoint { x: number; y: number; z: number }

export type Curve = (t: number) => PatchPoint;

export interface CoonsInput {
  /** Curve along u with v=0 (bottom edge). */
  bottom: Curve;
  /** Curve along u with v=1 (top edge). */
  top: Curve;
  /** Curve along v with u=0 (left edge). */
  left: Curve;
  /** Curve along v with u=1 (right edge). */
  right: Curve;
}

/** Evaluate a Coons patch at (u, v) where u,v ∈ [0,1]. */
export function evalCoonsPatch(input: CoonsInput, u: number, v: number): PatchPoint {
  // Boundary curves at sample positions.
  const b = input.bottom(u);
  const t = input.top(u);
  const l = input.left(v);
  const r = input.right(u === 0 ? 0 : 1); // sanity
  void r;
  const rEnd = input.right(v);

  // Corners.
  const c00 = input.bottom(0);
  const c10 = input.bottom(1);
  const c01 = input.top(0);
  const c11 = input.top(1);

  const ruledV = {
    x: (1 - v) * b.x + v * t.x,
    y: (1 - v) * b.y + v * t.y,
    z: (1 - v) * b.z + v * t.z,
  };
  const ruledU = {
    x: (1 - u) * input.left(v).x + u * rEnd.x,
    y: (1 - u) * input.left(v).y + u * rEnd.y,
    z: (1 - u) * input.left(v).z + u * rEnd.z,
  };
  const bilinear = {
    x: (1 - u) * (1 - v) * c00.x + u * (1 - v) * c10.x
     + (1 - u) * v * c01.x + u * v * c11.x,
    y: (1 - u) * (1 - v) * c00.y + u * (1 - v) * c10.y
     + (1 - u) * v * c01.y + u * v * c11.y,
    z: (1 - u) * (1 - v) * c00.z + u * (1 - v) * c10.z
     + (1 - u) * v * c01.z + u * v * c11.z,
  };

  return {
    x: ruledV.x + ruledU.x - bilinear.x,
    y: ruledV.y + ruledU.y - bilinear.y,
    z: ruledV.z + ruledU.z - bilinear.z,
  };
}

export interface CoonsMesh {
  positions: number[];
  indices: number[];
  uvs: number[];
}

/** Tessellate a Coons patch into a triangle mesh. */
export function tessellateCoonsPatch(
  input: CoonsInput,
  uSegments: number = 16,
  vSegments: number = 16,
): CoonsMesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  for (let j = 0; j <= vSegments; j++) {
    for (let i = 0; i <= uSegments; i++) {
      const u = i / uSegments;
      const v = j / vSegments;
      const p = evalCoonsPatch(input, u, v);
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

/** Helper — build a linear curve between two points. */
export function lineCurve(p0: PatchPoint, p1: PatchPoint): Curve {
  return (t: number): PatchPoint => ({
    x: p0.x + (p1.x - p0.x) * t,
    y: p0.y + (p1.y - p0.y) * t,
    z: p0.z + (p1.z - p0.z) * t,
  });
}

/** Helper — quadratic Bezier curve. */
export function bezierQuadCurve(p0: PatchPoint, p1: PatchPoint, p2: PatchPoint): Curve {
  return (t: number): PatchPoint => {
    const it = 1 - t;
    return {
      x: it * it * p0.x + 2 * it * t * p1.x + t * t * p2.x,
      y: it * it * p0.y + 2 * it * t * p1.y + t * t * p2.y,
      z: it * it * p0.z + 2 * it * t * p1.z + t * t * p2.z,
    };
  };
}
