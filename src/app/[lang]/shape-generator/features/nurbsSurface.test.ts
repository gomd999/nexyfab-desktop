import { describe, it, expect } from 'vitest';
import { basisFunction } from './curveFitting';
import {
  cpKey,
  cpWeightKey,
  buildCpGrid,
  buildWeightGrid,
  clampedUniformKnotVector,
  makeUniformBSplineSurface,
  evalBSplineSurface,
  nurbsSurfaceFeature,
  type BSplineSurface,
} from './nurbsSurface';

/** A non-trivial 5x5 control net (a wavy grid) for exercising the surface. */
function wavyNet(uCount = 5, vCount = 5): [number, number, number][][] {
  const cp: [number, number, number][][] = [];
  for (let i = 0; i < uCount; i++) {
    cp[i] = [];
    for (let j = 0; j < vCount; j++) {
      const u = i / (uCount - 1);
      const v = j / (vCount - 1);
      const h = Math.sin(u * Math.PI) * Math.cos(v * Math.PI) * 20;
      cp[i][j] = [(u - 0.5) * 100, h, (v - 0.5) * 100];
    }
  }
  return cp;
}

function dist(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

describe('clampedUniformKnotVector', () => {
  it('has correct length n + degree + 1', () => {
    expect(clampedUniformKnotVector(5, 3)).toHaveLength(5 + 3 + 1);
    expect(clampedUniformKnotVector(7, 2)).toHaveLength(7 + 2 + 1);
  });

  it('clamps degree+1 zeros at the start and ones at the end', () => {
    const k = clampedUniformKnotVector(6, 3);
    expect(k.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(k.slice(-4)).toEqual([1, 1, 1, 1]);
  });

  it('interior knots are non-decreasing across [0,1]', () => {
    const k = clampedUniformKnotVector(8, 3);
    for (let i = 1; i < k.length; i++) expect(k[i]!).toBeGreaterThanOrEqual(k[i - 1]!);
    expect(k[0]).toBe(0);
    expect(k[k.length - 1]).toBe(1);
  });
});

describe('tensor-product B-spline basis — partition of unity', () => {
  it('the 2D basis sums to 1 across the parameter domain', () => {
    const surf = makeUniformBSplineSurface(wavyNet(6, 5), 3, 3);
    const uCount = surf.controlPoints.length;
    const vCount = surf.controlPoints[0]!.length;
    for (const u of [0, 0.13, 0.37, 0.5, 0.82, 1]) {
      for (const v of [0, 0.2, 0.41, 0.66, 0.99, 1]) {
        let sum = 0;
        for (let i = 0; i < uCount; i++) {
          for (let j = 0; j < vCount; j++) {
            sum += basisFunction(i, surf.degreeU, u, surf.knotsU) *
                   basisFunction(j, surf.degreeV, v, surf.knotsV);
          }
        }
        expect(sum).toBeCloseTo(1, 6);
      }
    }
  });

  it('each direction basis is non-negative (convex-hull property precondition)', () => {
    const knots = clampedUniformKnotVector(6, 3);
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      for (let i = 0; i < 6; i++) {
        expect(basisFunction(i, 3, u, knots)).toBeGreaterThanOrEqual(-1e-12);
      }
    }
  });
});

describe('evalBSplineSurface — corner interpolation', () => {
  it('interpolates the four corner control points exactly (clamped knots)', () => {
    const cp = wavyNet(5, 5);
    const surf = makeUniformBSplineSurface(cp, 3, 3);
    const uMax = cp.length - 1;
    const vMax = cp[0]!.length - 1;
    expect(dist(evalBSplineSurface(surf, 0, 0), cp[0]![0]!)).toBeLessThan(1e-9);
    expect(dist(evalBSplineSurface(surf, 1, 0), cp[uMax]![0]!)).toBeLessThan(1e-9);
    expect(dist(evalBSplineSurface(surf, 0, 1), cp[0]![vMax]!)).toBeLessThan(1e-9);
    expect(dist(evalBSplineSurface(surf, 1, 1), cp[uMax]![vMax]!)).toBeLessThan(1e-9);
  });

  it('boundary isocurve S(u,0) equals the 1D B-spline through the first CP column', () => {
    const cp = wavyNet(6, 4);
    const surf = makeUniformBSplineSurface(cp, 3, 3);
    // S(u,0) must equal Σ_i N_i(u) · P[i][0]  (v-basis collapses to M_0(0)=1).
    for (const u of [0.1, 0.35, 0.6, 0.9]) {
      let x = 0, y = 0, z = 0;
      for (let i = 0; i < cp.length; i++) {
        const b = basisFunction(i, surf.degreeU, u, surf.knotsU);
        x += b * cp[i]![0]![0];
        y += b * cp[i]![0]![1];
        z += b * cp[i]![0]![2];
      }
      const s = evalBSplineSurface(surf, u, 0);
      expect(dist(s, [x, y, z])).toBeLessThan(1e-9);
    }
  });
});

describe('evalBSplineSurface — smoothness', () => {
  it('is continuous: adjacent fine samples stay close with no kinks', () => {
    const surf = makeUniformBSplineSurface(wavyNet(6, 6), 3, 3);
    const N = 60;
    // Walk the diagonal and bound the second difference (curvature proxy).
    const pts: [number, number, number][] = [];
    for (let k = 0; k <= N; k++) pts.push(evalBSplineSurface(surf, k / N, k / N));
    let maxFirst = 0;
    let maxSecond = 0;
    for (let k = 1; k < pts.length; k++) maxFirst = Math.max(maxFirst, dist(pts[k]!, pts[k - 1]!));
    for (let k = 1; k < pts.length - 1; k++) {
      const dx = pts[k + 1]![0] - 2 * pts[k]![0] + pts[k - 1]![0];
      const dy = pts[k + 1]![1] - 2 * pts[k]![1] + pts[k - 1]![1];
      const dz = pts[k + 1]![2] - 2 * pts[k]![2] + pts[k - 1]![2];
      maxSecond = Math.max(maxSecond, Math.hypot(dx, dy, dz));
    }
    // For a smooth degree-3 surface the second difference is an order of
    // magnitude below the step size — no C0 kinks along the path.
    expect(maxSecond).toBeLessThan(maxFirst * 0.5);
  });

  it('degree-3 surface is C² at interior knots (bounded jump in 2nd difference)', () => {
    const surf = makeUniformBSplineSurface(wavyNet(8, 8), 3, 3);
    const N = 200;
    const f = (t: number) => evalBSplineSurface(surf, t, 0.5)[1]; // height along u
    let maxCurvatureJump = 0;
    let prevSecond = 0;
    const h = 1 / N;
    for (let k = 1; k < N; k++) {
      const t = k / N;
      const second = (f(t + h) - 2 * f(t) + f(t - h)) / (h * h);
      if (k > 1) maxCurvatureJump = Math.max(maxCurvatureJump, Math.abs(second - prevSecond));
      prevSecond = second;
    }
    // C² ⇒ second derivative is continuous ⇒ its discrete jumps stay bounded.
    expect(Number.isFinite(maxCurvatureJump)).toBe(true);
    expect(maxCurvatureJump).toBeLessThan(50);
  });
});

describe('evalBSplineSurface — rational (NURBS) support', () => {
  it('reduces to the polynomial surface when all weights = 1', () => {
    const cp = wavyNet(5, 5);
    const poly = makeUniformBSplineSurface(cp, 3, 3);
    const rational = makeUniformBSplineSurface(cp, 3, 3, cp.map(r => r.map(() => 1)));
    for (const [u, v] of [[0.2, 0.3], [0.5, 0.5], [0.77, 0.11]] as const) {
      expect(dist(evalBSplineSurface(poly, u, v), evalBSplineSurface(rational, u, v))).toBeLessThan(1e-12);
    }
  });

  it('a heavier interior weight pulls the surface toward that control point', () => {
    // Flat base net so the pull direction is unambiguous.
    const uCount = 5, vCount = 5;
    const cp: [number, number, number][][] = [];
    for (let i = 0; i < uCount; i++) {
      cp[i] = [];
      for (let j = 0; j < vCount; j++) cp[i][j] = [(i - 2) * 25, 0, (j - 2) * 25];
    }
    // Lift the centre control point out of plane.
    cp[2]![2] = [0, 40, 0];
    const w = cp.map(r => r.map(() => 1));
    const base = evalBSplineSurface(makeUniformBSplineSurface(cp, 3, 3, w), 0.5, 0.5);
    w[2]![2] = 6; // rational emphasis on the lifted centre CP
    const pulled = evalBSplineSurface(makeUniformBSplineSurface(cp, 3, 3, w), 0.5, 0.5);
    // The surface point should rise toward the emphasised (y=40) control point.
    expect(pulled[1]).toBeGreaterThan(base[1]);
    expect(pulled[1]).toBeLessThanOrEqual(40 + 1e-9);
  });
});

describe('nurbsSurfaceFeature.apply', () => {
  it('produces a well-formed BufferGeometry mesh', () => {
    const params: Record<string, number> = {
      uCount: 5, vCount: 5, amplitude: 20, width: 100, depth: 100, tessellation: 16, degree: 3,
    };
    const geo = nurbsSurfaceFeature.apply(undefined as never, params);
    const pos = geo.getAttribute('position');
    const nrm = geo.getAttribute('normal');
    const idx = geo.getIndex();
    expect(pos.count).toBe(17 * 17); // (seg+1)^2
    expect(nrm.count).toBe(pos.count);
    expect(idx).not.toBeNull();
    expect(idx!.count).toBe(16 * 16 * 6);
    // Positions must be finite.
    for (let i = 0; i < pos.count * 3; i++) expect(Number.isFinite(pos.array[i]!)).toBe(true);
    // Corner mesh vertices interpolate the corner control points.
    const cp = buildCpGrid(params, 5, 5);
    const corner00 = [pos.getX(0), pos.getY(0), pos.getZ(0)] as [number, number, number];
    expect(dist(corner00, cp[0]![0]!)).toBeLessThan(1e-3);
  });

  it('respects custom control points encoded in params', () => {
    const params: Record<string, number> = { uCount: 3, vCount: 3, tessellation: 8, degree: 2 };
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        params[cpKey(i, j, 0)] = i * 10;
        params[cpKey(i, j, 1)] = (i === 1 && j === 1) ? 30 : 0;
        params[cpKey(i, j, 2)] = j * 10;
      }
    }
    const surf = makeUniformBSplineSurface(buildCpGrid(params, 3, 3), 2, 2, buildWeightGrid(params, 3, 3));
    // Centre CP is lifted; with degree 2 over a 3x3 net the surface centre rises.
    expect(evalBSplineSurface(surf, 0.5, 0.5)[1]).toBeGreaterThan(0);
    // buildWeightGrid defaults absent weights to 1.
    const w = buildWeightGrid(params, 3, 3);
    expect(w[0]![0]).toBe(1);
    params[cpWeightKey(0, 0)] = 3;
    expect(buildWeightGrid(params, 3, 3)[0]![0]).toBe(3);
  });
});

// Type-only sanity: the exported surface interface is structurally usable.
const _typeCheck: BSplineSurface = makeUniformBSplineSurface(wavyNet(3, 3), 2, 2);
void _typeCheck;
