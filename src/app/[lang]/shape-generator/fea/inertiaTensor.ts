/**
 * inertiaTensor.ts — principal moments of inertia of a rigid body. The symmetric inertia
 * tensor
 *      [  Ixx  −Ixy  −Ixz ]
 *      [ −Ixy   Iyy  −Iyz ]
 *      [ −Ixz  −Iyz   Izz ]
 * has three real eigenvalues (the principal moments) along axes where the products of
 * inertia vanish.
 *
 *   trace invariant:  Ixx+Iyy+Izz = I₁+I₂+I₃
 *   parallel axis:    I = I_cm + m·d²
 *
 * Eigenvalues by the closed-form symmetric-3×3 method (Smith). Verified against a
 * diagonal tensor (eigenvalues = diagonal), the trace invariant, a block tensor whose
 * principal moments are {I±Ixy, Izz}, and the parallel-axis shift.
 */

/** Principal moments of inertia (sorted descending) of a symmetric inertia tensor. */
export function principalMomentsOfInertia(Ixx: number, Iyy: number, Izz: number, Ixy: number, Ixz: number, Iyz: number): [number, number, number] {
  // tensor entries (off-diagonals are the negative products of inertia)
  const a11 = Ixx, a22 = Iyy, a33 = Izz, a12 = -Ixy, a13 = -Ixz, a23 = -Iyz;
  const p1 = a12 * a12 + a13 * a13 + a23 * a23;
  if (p1 === 0) {
    return [Ixx, Iyy, Izz].sort((x, y) => y - x) as [number, number, number];
  }
  const q = (a11 + a22 + a33) / 3;
  const p2 = (a11 - q) ** 2 + (a22 - q) ** 2 + (a33 - q) ** 2 + 2 * p1;
  const p = Math.sqrt(p2 / 6);
  // B = (A − qI)/p
  const b11 = (a11 - q) / p, b22 = (a22 - q) / p, b33 = (a33 - q) / p;
  const b12 = a12 / p, b13 = a13 / p, b23 = a23 / p;
  const detB = b11 * (b22 * b33 - b23 * b23) - b12 * (b12 * b33 - b23 * b13) + b13 * (b12 * b23 - b22 * b13);
  let r = detB / 2;
  r = Math.max(-1, Math.min(1, r));
  const phi = Math.acos(r) / 3;
  const eig1 = q + 2 * p * Math.cos(phi);
  const eig3 = q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3);
  const eig2 = 3 * q - eig1 - eig3;
  return [eig1, eig2, eig3].sort((x, y) => y - x) as [number, number, number];
}

/** Trace of the inertia tensor Ixx+Iyy+Izz (= sum of principal moments, invariant). */
export function traceInertia(Ixx: number, Iyy: number, Izz: number): number { return Ixx + Iyy + Izz; }

/** Parallel-axis theorem (single axis) I = I_cm + m·d². */
export function parallelAxisInertia(Icm: number, m: number, d: number): number { return Icm + m * d * d; }
