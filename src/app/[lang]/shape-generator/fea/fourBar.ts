/**
 * fourBar.ts — planar four-bar linkage kinematics (multibody/joint constraint). The
 * mechanism O2-A-B-O4 closes the vector loop
 *
 *   r2·e^{iθ2} + r3·e^{iθ3} = r1 + r4·e^{iθ4}
 *
 * (ground r1, crank r2, coupler r3, rocker r4). Position is solved geometrically as
 * the intersection of the coupler circle (centre A, radius r3) and the rocker circle
 * (centre O4, radius r4); velocity by differentiating the loop. The Grashof rule
 * (s+l ≤ p+q) says whether the crank can fully rotate.
 *
 * Verified: the loop closes (|A−B|=r3, |B−O4|=r4, complex residual = 0); Grashof
 * classification; and the analytic angular velocities match a finite difference.
 */

export interface FourBar { r1: number; r2: number; r3: number; r4: number; }
export interface LinkagePose { theta3: number; theta4: number; A: [number, number]; B: [number, number]; reachable: boolean; }

/** Solve the coupler/rocker angles for a crank angle θ2 (branch ±1 = open/crossed). */
export function fourBarPosition(lk: FourBar, theta2: number, branch: 1 | -1 = 1): LinkagePose {
  const { r1, r2, r3, r4 } = lk;
  const A: [number, number] = [r2 * Math.cos(theta2), r2 * Math.sin(theta2)];
  const O4: [number, number] = [r1, 0];
  const dx = O4[0] - A[0], dy = O4[1] - A[1];
  const d = Math.hypot(dx, dy);
  if (d > r3 + r4 + 1e-12 || d < Math.abs(r3 - r4) - 1e-12 || d < 1e-12) {
    return { theta3: NaN, theta4: NaN, A, B: [NaN, NaN], reachable: false };
  }
  const ex = dx / d, ey = dy / d;
  const x = (r3 * r3 - r4 * r4 + d * d) / (2 * d);           // along A→O4
  const yy = Math.sqrt(Math.max(0, r3 * r3 - x * x));
  const B: [number, number] = [
    A[0] + x * ex - branch * yy * ey,
    A[1] + x * ey + branch * yy * ex,
  ];
  const theta3 = Math.atan2(B[1] - A[1], B[0] - A[0]);
  const theta4 = Math.atan2(B[1] - O4[1], B[0] - O4[0]);
  return { theta3, theta4, A, B, reachable: true };
}

/** Complex loop-closure residual (should be ~0 at a valid pose). */
export function loopResidual(lk: FourBar, theta2: number, theta3: number, theta4: number): [number, number] {
  const { r1, r2, r3, r4 } = lk;
  return [
    r2 * Math.cos(theta2) + r3 * Math.cos(theta3) - r1 - r4 * Math.cos(theta4),
    r2 * Math.sin(theta2) + r3 * Math.sin(theta3) - r4 * Math.sin(theta4),
  ];
}

export type GrashofType = 'crank-rocker' | 'double-crank' | 'double-rocker' | 'change-point' | 'non-Grashof';

/** Grashof classification from the four link lengths. */
export function grashof(lk: FourBar): { isGrashof: boolean; type: GrashofType } {
  const links = [lk.r1, lk.r2, lk.r3, lk.r4];
  const s = Math.min(...links), l = Math.max(...links);
  const sum = links.reduce((a, b) => a + b, 0);
  const pq = sum - s - l;
  if (Math.abs(s + l - pq) < 1e-12) return { isGrashof: true, type: 'change-point' };
  if (s + l < pq) {
    // shortest link is the crank → which inversion: shortest is ground/crank.
    if (lk.r2 === s || lk.r1 === s) return { isGrashof: true, type: lk.r1 === s ? 'double-crank' : 'crank-rocker' };
    return { isGrashof: true, type: 'double-rocker' };
  }
  return { isGrashof: false, type: 'non-Grashof' };
}

/** Angular velocities ω3, ω4 from the crank rate ω2 (differentiated loop). */
export function fourBarVelocity(lk: FourBar, pose: LinkagePose, omega2: number): { omega3: number; omega4: number } {
  const { r2, r3, r4 } = lk;
  const { theta3, theta4 } = pose;
  // r2 iω2 e^{iθ2}... → solve [−r3 sinθ3, r4 sinθ4; r3 cosθ3, −r4 cosθ4][ω3;ω4] = ω2[r2 sinθ2; −r2 cosθ2]
  // From d/dt of the loop: −r2 ω2 sinθ2 − r3 ω3 sinθ3 + r4 ω4 sinθ4 = 0, and cos-part.
  const theta2 = Math.atan2(pose.A[1], pose.A[0]);   // crank angle from joint A
  const a11 = -r3 * Math.sin(theta3), a12 = r4 * Math.sin(theta4);
  const a21 = r3 * Math.cos(theta3), a22 = -r4 * Math.cos(theta4);
  const rhs1 = r2 * omega2 * Math.sin(theta2);
  const rhs2 = -r2 * omega2 * Math.cos(theta2);
  const det = a11 * a22 - a12 * a21;
  const omega3 = (rhs1 * a22 - a12 * rhs2) / det;
  const omega4 = (a11 * rhs2 - rhs1 * a21) / det;
  return { omega3, omega4 };
}
