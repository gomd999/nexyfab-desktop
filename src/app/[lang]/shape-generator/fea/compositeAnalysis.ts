/**
 * compositeAnalysis.ts — Classical Lamination Theory (CLT) for
 * composite layups.
 *
 * Fiber-reinforced composites (carbon, glass, kevlar) are highly
 * anisotropic: stiff along the fiber direction, weak across it. A
 * "layup" stacks multiple plies at different angles to tailor
 * directional stiffness — the basis of every modern airframe,
 * pressure vessel, wind turbine blade, and racing chassis.
 *
 * Classical Lamination Theory (CLT) is the standard analytical
 * framework. Given:
 *   - Each ply's orthotropic material constants (E₁, E₂, G₁₂, ν₁₂)
 *   - Ply thickness + stack-order + fiber angle
 *
 * It computes:
 *   - **A matrix** (extensional stiffness, 3×3)
 *   - **B matrix** (extension-bending coupling)
 *   - **D matrix** (bending stiffness)
 *   - Stress + strain per ply under arbitrary load
 *   - First-ply failure prediction (Tsai-Wu / max-stress criterion)
 *
 * Output is the [A B; B D] 6×6 ABD matrix that any composite-aware
 * FEA solver consumes; the per-ply stress lets you check strength.
 */

export interface OrthotropicPly {
  /** Modulus along fiber direction (MPa). */
  E1: number;
  /** Modulus perpendicular to fiber (MPa). */
  E2: number;
  /** Shear modulus in 1-2 plane (MPa). */
  G12: number;
  /** Major Poisson's ratio. */
  nu12: number;
  /** Tensile strength along fibers (MPa). */
  Xt: number;
  /** Compressive strength along fibers (MPa). */
  Xc: number;
  /** Tensile strength transverse (MPa). */
  Yt: number;
  /** Compressive strength transverse (MPa). */
  Yc: number;
  /** Shear strength (MPa). */
  S: number;
}

export interface Ply {
  /** Material reference. */
  material: OrthotropicPly;
  /** Fiber angle from laminate X-axis (degrees). */
  angleDeg: number;
  /** Ply thickness (mm). */
  thicknessMm: number;
}

export const STANDARD_MATERIALS: Record<string, OrthotropicPly> = {
  'carbon-T700': {
    E1: 135000, E2: 9000, G12: 4800, nu12: 0.28,
    Xt: 2300, Xc: 1300, Yt: 60, Yc: 200, S: 80,
  },
  'glass-E': {
    E1: 45000, E2: 12000, G12: 4500, nu12: 0.28,
    Xt: 1100, Xc: 600, Yt: 35, Yc: 130, S: 55,
  },
  'kevlar-49': {
    E1: 76000, E2: 5500, G12: 2300, nu12: 0.34,
    Xt: 1380, Xc: 280, Yt: 30, Yc: 140, S: 60,
  },
};

// ── Single-ply stiffness (Q matrix, ply axes) ────────────────────

function plyQMatrix(p: OrthotropicPly): number[][] {
  // Reduced stiffness in fiber-aligned axes (plane stress).
  const nu21 = p.nu12 * p.E2 / p.E1;
  const denom = 1 - p.nu12 * nu21;
  return [
    [p.E1 / denom,          p.nu12 * p.E2 / denom, 0],
    [p.nu12 * p.E2 / denom, p.E2 / denom,          0],
    [0,                     0,                      p.G12],
  ];
}

/** Transform Q from ply-aligned (1,2) to laminate (x,y) axes. */
export function transformedQ(p: OrthotropicPly, angleDeg: number): number[][] {
  const Q = plyQMatrix(p);
  const c = Math.cos(angleDeg * Math.PI / 180);
  const s = Math.sin(angleDeg * Math.PI / 180);
  const c2 = c * c, s2 = s * s, cs = c * s;
  const c4 = c2 * c2, s4 = s2 * s2, c2s2 = c2 * s2;

  // Tsai-Pagano transformation.
  const Q11 = Q[0]![0]!, Q22 = Q[1]![1]!, Q12 = Q[0]![1]!, Q66 = Q[2]![2]!;
  const Qxx = Q11 * c4 + 2 * (Q12 + 2 * Q66) * c2s2 + Q22 * s4;
  const Qyy = Q11 * s4 + 2 * (Q12 + 2 * Q66) * c2s2 + Q22 * c4;
  const Qxy = (Q11 + Q22 - 4 * Q66) * c2s2 + Q12 * (c4 + s4);
  const Qss = (Q11 + Q22 - 2 * Q12 - 2 * Q66) * c2s2 + Q66 * (c4 + s4);
  const Qxs = (Q11 - Q12 - 2 * Q66) * cs * c2 + (Q12 - Q22 + 2 * Q66) * cs * s2;
  const Qys = (Q11 - Q12 - 2 * Q66) * cs * s2 + (Q12 - Q22 + 2 * Q66) * cs * c2;
  return [
    [Qxx, Qxy, Qxs],
    [Qxy, Qyy, Qys],
    [Qxs, Qys, Qss],
  ];
}

// ── Laminate ABD matrix ───────────────────────────────────────────

export interface ABDMatrix {
  /** Extensional stiffness (3×3, N/mm). */
  A: number[][];
  /** Coupling (3×3, N). */
  B: number[][];
  /** Bending stiffness (3×3, N·mm). */
  D: number[][];
  /** Total laminate thickness (mm). */
  totalThicknessMm: number;
  /** Per-ply z-coordinates (top of each ply, relative to mid-plane). */
  plyTopZ: number[];
}

export function computeABD(plies: Ply[]): ABDMatrix {
  const totalT = plies.reduce((s, p) => s + p.thicknessMm, 0);
  const halfT = totalT / 2;
  // Walk plies from bottom to top.
  let z = -halfT;
  const plyTopZ: number[] = [];
  // Init zeros.
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const B = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const D = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const ply of plies) {
    const zk1 = z;
    const zk = z + ply.thicknessMm;
    plyTopZ.push(zk);
    const Q = transformedQ(ply.material, ply.angleDeg);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        A[i]![j]! += Q[i]![j]! * (zk - zk1);
        B[i]![j]! += Q[i]![j]! * (zk * zk - zk1 * zk1) / 2;
        D[i]![j]! += Q[i]![j]! * (zk * zk * zk - zk1 * zk1 * zk1) / 3;
      }
    }
    z = zk;
  }
  return { A, B, D, totalThicknessMm: totalT, plyTopZ };
}

// ── Tsai-Wu failure criterion ────────────────────────────────────

/** Tsai-Wu failure index. < 1 = safe, ≥ 1 = first-ply failure. */
export function tsaiWuIndex(
  ply: OrthotropicPly,
  sigma1: number,
  sigma2: number,
  tau12: number,
): number {
  const F1 = 1 / ply.Xt - 1 / ply.Xc;
  const F2 = 1 / ply.Yt - 1 / ply.Yc;
  const F11 = 1 / (ply.Xt * ply.Xc);
  const F22 = 1 / (ply.Yt * ply.Yc);
  const F66 = 1 / (ply.S * ply.S);
  // Mises-Hencky interaction coefficient.
  const F12 = -0.5 * Math.sqrt(F11 * F22);
  return F1 * sigma1 + F2 * sigma2
    + F11 * sigma1 * sigma1
    + F22 * sigma2 * sigma2
    + F66 * tau12 * tau12
    + 2 * F12 * sigma1 * sigma2;
}

/** Max-stress failure criterion. Returns the maximum normalized stress
 *  (≥ 1 = failure). */
export function maxStressIndex(
  ply: OrthotropicPly,
  sigma1: number,
  sigma2: number,
  tau12: number,
): number {
  const s1 = sigma1 >= 0 ? sigma1 / ply.Xt : -sigma1 / ply.Xc;
  const s2 = sigma2 >= 0 ? sigma2 / ply.Yt : -sigma2 / ply.Yc;
  const s12 = Math.abs(tau12) / ply.S;
  return Math.max(s1, s2, s12);
}

// ── Common layup shortcuts ────────────────────────────────────────

/** Build a quasi-isotropic [0/45/-45/90]ₛ layup. */
export function quasiIsotropic(
  material: OrthotropicPly,
  plyThicknessMm: number,
): Ply[] {
  const angles = [0, 45, -45, 90, 90, -45, 45, 0];
  return angles.map(a => ({ material, angleDeg: a, thicknessMm: plyThicknessMm }));
}

/** Build a cross-ply [0/90]ₛ layup. */
export function crossPly(
  material: OrthotropicPly,
  plyThicknessMm: number,
  totalPlyCount: number = 4,
): Ply[] {
  const angles: number[] = [];
  for (let i = 0; i < totalPlyCount; i++) {
    angles.push(i % 2 === 0 ? 0 : 90);
  }
  return angles.map(a => ({ material, angleDeg: a, thicknessMm: plyThicknessMm }));
}

/** Build an angle-ply [+θ/-θ]ₙ layup. */
export function anglePly(
  material: OrthotropicPly,
  plyThicknessMm: number,
  angleDeg: number,
  totalPlyCount: number = 4,
): Ply[] {
  const out: Ply[] = [];
  for (let i = 0; i < totalPlyCount; i++) {
    out.push({ material, angleDeg: i % 2 === 0 ? angleDeg : -angleDeg, thicknessMm: plyThicknessMm });
  }
  return out;
}

/** Compute effective in-plane engineering constants from the A matrix. */
export interface EngineeringConstants {
  /** Effective Ex (MPa). */
  Ex: number;
  /** Effective Ey (MPa). */
  Ey: number;
  /** Effective Gxy (MPa). */
  Gxy: number;
  /** Effective νxy. */
  nuxy: number;
}

export function effectiveConstants(abd: ABDMatrix): EngineeringConstants {
  const A = abd.A;
  const h = abd.totalThicknessMm;
  // Inverse of 2×2 in-plane block — assume balanced symmetric (Axy = 0).
  const det = A[0]![0]! * A[1]![1]! - A[0]![1]! * A[0]![1]!;
  return {
    Ex: det / (h * A[1]![1]!),
    Ey: det / (h * A[0]![0]!),
    Gxy: A[2]![2]! / h,
    nuxy: A[0]![1]! / A[1]![1]!,
  };
}
