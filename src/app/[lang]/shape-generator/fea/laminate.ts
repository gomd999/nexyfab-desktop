/**
 * laminate.ts — Classical Lamination Theory (CLT) for fibre-composite laminates.
 * Each orthotropic ply's reduced stiffness Q is transformed to the laminate axes
 * (Q̄) and stacked through the thickness into the ABD stiffness:
 *
 *   [N]   [A B][ε⁰]        A_ij = Σ Q̄_ij (z_k − z_{k−1})       (extensional)
 *   [M] = [B D][κ ]        B_ij = ½ Σ Q̄_ij (z_k² − z_{k−1}²)   (extension–bending coupling)
 *                          D_ij = ⅓ Σ Q̄_ij (z_k³ − z_{k−1}³)   (bending)
 *
 * Verified against the standard CLT results: a symmetric layup has B = 0; isotropic
 * plies give an angle-independent A and D = E t³/(12(1−ν²)); a balanced angle-ply
 * has A16 = A26 = 0; effective in-plane modulus recovers E for isotropic.
 *
 * Engineering convention, in-plane Voigt [11, 22, 12] (γ engineering shear).
 */

export interface Ply {
  E1: number; E2: number; G12: number; nu12: number;
  thickness: number;
  /** Fibre orientation θ (radians) from the laminate x-axis. */
  angle: number;
}

export interface ABD {
  A: number[][]; B: number[][]; D: number[][];   // each 3×3
}

/** Reduced stiffness Q (3×3) in the ply's material axes. */
export function reducedStiffness(p: Ply): number[][] {
  const nu21 = (p.nu12 * p.E2) / p.E1;
  const den = 1 - p.nu12 * nu21;
  const Q11 = p.E1 / den, Q22 = p.E2 / den, Q12 = (p.nu12 * p.E2) / den, Q66 = p.G12;
  return [[Q11, Q12, 0], [Q12, Q22, 0], [0, 0, Q66]];
}

/** Transformed reduced stiffness Q̄ (3×3) in the laminate axes for a ply at angle θ. */
export function transformedStiffness(p: Ply): number[][] {
  const Q = reducedStiffness(p);
  const Q11 = Q[0][0], Q12 = Q[0][1], Q22 = Q[1][1], Q66 = Q[2][2];
  const c = Math.cos(p.angle), s = Math.sin(p.angle);
  const c2 = c * c, s2 = s * s, c4 = c2 * c2, s4 = s2 * s2, s2c2 = s2 * c2;
  const Qb11 = Q11 * c4 + 2 * (Q12 + 2 * Q66) * s2c2 + Q22 * s4;
  const Qb22 = Q11 * s4 + 2 * (Q12 + 2 * Q66) * s2c2 + Q22 * c4;
  const Qb12 = (Q11 + Q22 - 4 * Q66) * s2c2 + Q12 * (c4 + s4);
  const Qb66 = (Q11 + Q22 - 2 * Q12 - 2 * Q66) * s2c2 + Q66 * (s4 + c4);
  const Qb16 = (Q11 - Q12 - 2 * Q66) * s * c * c2 + (Q12 - Q22 + 2 * Q66) * s * s2 * c;
  const Qb26 = (Q11 - Q12 - 2 * Q66) * s * s2 * c + (Q12 - Q22 + 2 * Q66) * s * c * c2;
  return [[Qb11, Qb12, Qb16], [Qb12, Qb22, Qb26], [Qb16, Qb26, Qb66]];
}

/** Assemble the ABD stiffness of a stacked laminate (plies listed bottom → top). */
export function computeABD(plies: Ply[]): ABD {
  const h = plies.reduce((t, p) => t + p.thickness, 0);
  let z = -h / 2;
  const A = Array.from({ length: 3 }, () => new Array<number>(3).fill(0));
  const B = Array.from({ length: 3 }, () => new Array<number>(3).fill(0));
  const D = Array.from({ length: 3 }, () => new Array<number>(3).fill(0));
  for (const p of plies) {
    const zk = z + p.thickness;
    const Qb = transformedStiffness(p);
    const dA = zk - z, dB = (zk * zk - z * z) / 2, dD = (zk ** 3 - z ** 3) / 3;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      A[i][j] += Qb[i][j] * dA; B[i][j] += Qb[i][j] * dB; D[i][j] += Qb[i][j] * dD;
    }
    z = zk;
  }
  return { A, B, D };
}

/** Effective in-plane engineering constants of a symmetric laminate (B ≈ 0). */
export function effectiveInPlane(plies: Ply[]): { Ex: number; Ey: number; Gxy: number; nuxy: number } {
  const { A } = computeABD(plies);
  const h = plies.reduce((t, p) => t + p.thickness, 0);
  const det = A[0][0] * A[1][1] - A[0][1] * A[0][1];
  return {
    Ex: det / (A[1][1] * h),
    Ey: det / (A[0][0] * h),
    Gxy: A[2][2] / h,
    nuxy: A[0][1] / A[1][1],
  };
}
