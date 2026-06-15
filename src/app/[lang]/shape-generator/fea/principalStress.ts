/**
 * principalStress.ts — principal stresses, Mohr's circle and stress invariants.
 *
 *   2-D:  σ1,2 = (σx+σy)/2 ± R,  R = √(((σx−σy)/2)² + τxy²) = τ_max,  tan2θp = 2τxy/(σx−σy)
 *   3-D:  eigenvalues of the symmetric stress tensor (σ1≥σ2≥σ3), invariants I1,I2,I3,
 *         von Mises √(½[(σ1−σ2)²+(σ2−σ3)²+(σ3−σ1)²]),  τ_max = (σ1−σ3)/2
 *
 * Verified: the 2-D principal stresses/Mohr circle (shear vanishes on the principal
 * planes), and the 3-D eigenvalues/invariants/von Mises for uniaxial, pure-shear and
 * hydrostatic states.
 */

export interface Principal2D { s1: number; s2: number; tauMax: number; thetaP: number; }

/** 2-D principal stresses, max shear and principal angle (radians). */
export function principalStress2D(sx: number, sy: number, txy: number): Principal2D {
  const avg = (sx + sy) / 2, R = Math.hypot((sx - sy) / 2, txy);
  return { s1: avg + R, s2: avg - R, tauMax: R, thetaP: 0.5 * Math.atan2(2 * txy, sx - sy) };
}

/** Rotate a 2-D stress state by angle θ (radians). */
export function transformStress2D(sx: number, sy: number, txy: number, theta: number): { sx: number; sy: number; txy: number } {
  const c = Math.cos(2 * theta), s = Math.sin(2 * theta), avg = (sx + sy) / 2, dif = (sx - sy) / 2;
  return {
    sx: avg + dif * c + txy * s,
    sy: avg - dif * c - txy * s,
    txy: -dif * s + txy * c,
  };
}

export interface Principal3D { s1: number; s2: number; s3: number; I1: number; I2: number; I3: number; vonMises: number; tauMax: number; }

/** 3-D principal stresses (eigenvalues of the symmetric tensor) + invariants. Voigt [xx,yy,zz,xy,yz,zx]. */
export function principalStress3D(s: ArrayLike<number>): Principal3D {
  const sx = s[0], sy = s[1], sz = s[2], sxy = s[3], syz = s[4], szx = s[5];
  const I1 = sx + sy + sz;
  const I2 = sx * sy + sy * sz + sz * sx - sxy * sxy - syz * syz - szx * szx;
  const I3 = sx * (sy * sz - syz * syz) - sxy * (sxy * sz - syz * szx) + szx * (sxy * syz - sy * szx);

  // eigenvalues of the symmetric 3×3 by the trigonometric (Cardano) method.
  const p1 = sxy * sxy + syz * syz + szx * szx;
  let e1: number, e2: number, e3: number;
  if (p1 < 1e-300) {
    [e3, e2, e1] = [sx, sy, sz].sort((a, b) => a - b);
  } else {
    const q = I1 / 3;
    const p2 = (sx - q) ** 2 + (sy - q) ** 2 + (sz - q) ** 2 + 2 * p1;
    const p = Math.sqrt(p2 / 6);
    // B = (A − qI)/p
    const b = [(sx - q) / p, (sy - q) / p, (sz - q) / p, sxy / p, syz / p, szx / p];
    const detB = b[0] * (b[1] * b[2] - b[4] * b[4]) - b[3] * (b[3] * b[2] - b[4] * b[5]) + b[5] * (b[3] * b[4] - b[1] * b[5]);
    const phi = Math.acos(Math.max(-1, Math.min(1, detB / 2))) / 3;
    e1 = q + 2 * p * Math.cos(phi);
    e3 = q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3);
    e2 = 3 * q - e1 - e3;
  }
  const vonMises = Math.sqrt(0.5 * ((e1 - e2) ** 2 + (e2 - e3) ** 2 + (e3 - e1) ** 2));
  return { s1: e1, s2: e2, s3: e3, I1, I2, I3, vonMises, tauMax: (e1 - e3) / 2 };
}
