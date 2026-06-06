/**
 * nurbsSurfaceCurvature.ts — ANALYTIC differential geometry of a NURBS surface.
 *
 * evalNurbsSurfaceNormal (and the G2 continuity check) used finite differences;
 * this computes the surface partials ∂P/∂u, ∂P/∂v, ∂²P/∂u², ∂²P/∂u∂v, ∂²P/∂v²
 * EXACTLY from the basis-function derivatives, then the first/second fundamental
 * forms and the Gaussian / mean / principal curvatures. This is the foundation
 * for class-A inspection (curvature combs, zebra, exact G2).
 *
 * Algorithms follow Piegl & Tiller, "The NURBS Book": A2.3 (basis-function
 * derivatives), the tensor-product surface derivative, and A4.4 (rational
 * surface derivatives via the quotient rule on homogeneous coordinates).
 */

import * as THREE from 'three';
import type { NurbsSurface } from './nurbsSurface';

/** Knot span k with knots[k] ≤ u < knots[k+1] (clamped at the ends). */
function findSpan(n: number, p: number, u: number, U: number[]): number {
  if (u >= U[n + 1]!) return n;
  if (u <= U[p]!) return p;
  let low = p, high = n + 1, mid = (low + high) >> 1;
  while (u < U[mid]! || u >= U[mid + 1]!) {
    if (u < U[mid]!) high = mid; else low = mid;
    mid = (low + high) >> 1;
  }
  return mid;
}

/** Basis functions and their derivatives (NURBS Book A2.3). ders[k][j] is the
 *  k-th derivative of the j-th non-zero basis function over [span−p, span]. */
function basisFunsDers(span: number, u: number, p: number, n: number, U: number[]): number[][] {
  const ndu: number[][] = Array.from({ length: p + 1 }, () => new Array(p + 1).fill(0));
  const left = new Array(p + 1).fill(0);
  const right = new Array(p + 1).fill(0);
  ndu[0]![0] = 1;
  for (let j = 1; j <= p; j++) {
    left[j] = u - U[span + 1 - j]!;
    right[j] = U[span + j]! - u;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      ndu[j]![r] = right[r + 1] + left[j - r];
      const temp = ndu[r]![j - 1]! / ndu[j]![r]!;
      ndu[r]![j] = saved + right[r + 1]! * temp;
      saved = left[j - r]! * temp;
    }
    ndu[j]![j] = saved;
  }
  const ders: number[][] = Array.from({ length: n + 1 }, () => new Array(p + 1).fill(0));
  for (let j = 0; j <= p; j++) ders[0]![j] = ndu[j]![p]!;
  for (let r = 0; r <= p; r++) {
    let s1 = 0, s2 = 1;
    const a: number[][] = [new Array(p + 1).fill(0), new Array(p + 1).fill(0)];
    a[0]![0] = 1;
    for (let k = 1; k <= n; k++) {
      let d = 0;
      const rk = r - k, pk = p - k;
      if (r >= k) { a[s2]![0] = a[s1]![0]! / ndu[pk + 1]![rk]!; d = a[s2]![0]! * ndu[rk]![pk]!; }
      const j1 = rk >= -1 ? 1 : -rk;
      const j2 = r - 1 <= pk ? k - 1 : p - r;
      for (let j = j1; j <= j2; j++) {
        a[s2]![j] = (a[s1]![j]! - a[s1]![j - 1]!) / ndu[pk + 1]![rk + j]!;
        d += a[s2]![j]! * ndu[rk + j]![pk]!;
      }
      if (r <= pk) { a[s2]![k] = -a[s1]![k - 1]! / ndu[pk + 1]![r]!; d += a[s2]![k]! * ndu[r]![pk]!; }
      ders[k]![r] = d;
      const t = s1; s1 = s2; s2 = t;
    }
  }
  let r = p;
  for (let k = 1; k <= n; k++) {
    for (let j = 0; j <= p; j++) ders[k]![j]! *= r;
    r *= (p - k);
  }
  return ders;
}

export interface SurfaceCurvature {
  /** Gaussian curvature K = κ1·κ2 (1/mm²). */
  gaussian: number;
  /** Mean curvature H = (κ1+κ2)/2 (1/mm). */
  mean: number;
  /** Principal curvatures (1/mm), κ1 ≥ κ2. */
  k1: number;
  k2: number;
  /** Unit surface normal. */
  normal: THREE.Vector3;
}

type Hom = [number, number, number, number]; // (w·x, w·y, w·z, w)

/** Homogeneous surface derivatives SKL[k][l] up to order 2 in each parameter,
 *  computed analytically from the basis-function derivatives. Plain 4-component
 *  arithmetic — no Vector4 methods — so the weight (4th) component is scaled
 *  exactly like the spatial ones. */
function homogeneousDerivs(s: NurbsSurface, u: number, v: number): Hom[][] {
  const nU = s.controlPoints.length - 1, pU = s.degreeU;
  const nV = s.controlPoints[0]!.length - 1, pV = s.degreeV;
  const su = findSpan(nU, pU, u, s.knotsU);
  const sv = findSpan(nV, pV, v, s.knotsV);
  const du = basisFunsDers(su, u, pU, 2, s.knotsU);
  const dv = basisFunsDers(sv, v, pV, 2, s.knotsV);

  const SKL: Hom[][] = [];
  for (let k = 0; k <= 2; k++) {
    SKL.push([]);
    for (let l = 0; l <= 2; l++) {
      let ax = 0, ay = 0, az = 0, aw = 0;
      for (let i = 0; i <= pU; i++) {
        const ci = su - pU + i;
        let tx = 0, ty = 0, tz = 0, tw = 0;
        for (let j = 0; j <= pV; j++) {
          const cj = sv - pV + j;
          const cp = s.controlPoints[ci]![cj]!;
          const w = s.weights ? s.weights[ci]![cj]! : 1;
          const b = dv[l]![j]!;
          tx += cp.x * w * b; ty += cp.y * w * b; tz += cp.z * w * b; tw += w * b;
        }
        const a = du[k]![i]!;
        ax += tx * a; ay += ty * a; az += tz * a; aw += tw * a;
      }
      SKL[k]!.push([ax, ay, az, aw]);
    }
  }
  return SKL;
}

/** Cartesian point + the five derivatives (Pu, Pv, Puu, Puv, Pvv) via the
 *  rational quotient rule (NURBS Book A4.4) on the homogeneous derivatives. */
function rationalDerivs(SKL: Hom[][]): {
  P: THREE.Vector3; Pu: THREE.Vector3; Pv: THREE.Vector3;
  Puu: THREE.Vector3; Puv: THREE.Vector3; Pvv: THREE.Vector3;
} {
  const A = (k: number, l: number) => new THREE.Vector3(SKL[k]![l]![0], SKL[k]![l]![1], SKL[k]![l]![2]);
  const w = (k: number, l: number) => SKL[k]![l]![3];
  const w00 = w(0, 0);
  const P = A(0, 0).clone().divideScalar(w00);
  // First derivatives: P_a = (A_a − w_a·P) / w.
  const Pu = A(1, 0).clone().sub(P.clone().multiplyScalar(w(1, 0))).divideScalar(w00);
  const Pv = A(0, 1).clone().sub(P.clone().multiplyScalar(w(0, 1))).divideScalar(w00);
  // Second derivatives (quotient rule, 2nd order).
  const Puu = A(2, 0).clone()
    .sub(Pu.clone().multiplyScalar(2 * w(1, 0)))
    .sub(P.clone().multiplyScalar(w(2, 0)))
    .divideScalar(w00);
  const Pvv = A(0, 2).clone()
    .sub(Pv.clone().multiplyScalar(2 * w(0, 1)))
    .sub(P.clone().multiplyScalar(w(0, 2)))
    .divideScalar(w00);
  const Puv = A(1, 1).clone()
    .sub(Pu.clone().multiplyScalar(w(0, 1)))
    .sub(Pv.clone().multiplyScalar(w(1, 0)))
    .sub(P.clone().multiplyScalar(w(1, 1)))
    .divideScalar(w00);
  return { P, Pu, Pv, Puu, Puv, Pvv };
}

/**
 * Analytic Gaussian / mean / principal curvature of the surface at (u, v) via
 * the first and second fundamental forms.
 */
export function nurbsSurfaceCurvature(s: NurbsSurface, u: number, v: number): SurfaceCurvature {
  const { Pu, Pv, Puu, Puv, Pvv } = rationalDerivs(homogeneousDerivs(s, u, v));
  const nVec = new THREE.Vector3().crossVectors(Pu, Pv);
  const nLen = nVec.length();
  const N = nLen > 1e-12 ? nVec.clone().divideScalar(nLen) : new THREE.Vector3(0, 0, 1);
  // First fundamental form.
  const E = Pu.dot(Pu), F = Pu.dot(Pv), G = Pv.dot(Pv);
  // Second fundamental form.
  const L = Puu.dot(N), M = Puv.dot(N), Nf = Pvv.dot(N);
  const denom = E * G - F * F;
  if (Math.abs(denom) < 1e-12) {
    return { gaussian: 0, mean: 0, k1: 0, k2: 0, normal: N };
  }
  const K = (L * Nf - M * M) / denom;
  const H = (E * Nf - 2 * F * M + G * L) / (2 * denom);
  const disc = Math.max(0, H * H - K);
  const root = Math.sqrt(disc);
  return { gaussian: K, mean: H, k1: H + root, k2: H - root, normal: N };
}
