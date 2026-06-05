/**
 * timoshenkoBeam.ts — 2-node Timoshenko beam element (shear-deformable), the beam
 * counterpart of the Mindlin plate. Unlike Euler-Bernoulli it lets the cross-section
 * shear, so the cantilever tip deflection is
 *
 *   δ = P·L³/(3EI)  +  P·L/(κ·G·A)        (bending + shear)
 *
 * Shear (transverse) energy is integrated with ONE reduced Gauss point to avoid shear
 * locking, so the element converges to Euler-Bernoulli as the beam gets slender.
 *
 * DOF per node: (w, θ). κ = shear-correction factor (5/6 for a rectangle). Verified
 * against the analytic tip deflection, the slender (Euler) limit, and the growing
 * shear fraction for stubby beams.
 */

export interface BeamProps { E: number; I: number; G: number; A: number; kappa: number; }

/** Analytic cantilever tip deflection under an end load P (bending + shear). */
export function analyticTipDeflection(P: number, L: number, b: BeamProps): number {
  return (P * L ** 3) / (3 * b.E * b.I) + (P * L) / (b.kappa * b.G * b.A);
}

function solveDense(A: number[][], rhs: number[]): number[] {
  const n = rhs.length, M = A.map((r, i) => [...r, rhs[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-300; for (let j = c; j <= n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j]; }
  }
  return M.map((r) => r[n]);
}

/** FEM cantilever (fixed at x=0, end load P at the tip) tip deflection. */
export function cantileverTip(P: number, L: number, b: BeamProps, nElems: number): number {
  const le = L / nElems, nNodes = nElems + 1, nDof = nNodes * 2; // (w,θ) per node
  const K = Array.from({ length: nDof }, () => new Array<number>(nDof).fill(0));
  const EI = b.E * b.I, kGA = b.kappa * b.G * b.A;

  for (let e = 0; e < nElems; e++) {
    // DOF map: [w_e, θ_e, w_{e+1}, θ_{e+1}]
    const map = [e * 2, e * 2 + 1, (e + 1) * 2, (e + 1) * 2 + 1];
    // bending: Bb = dθ/dx = [0,-1/le,0,1/le] (constant) ⇒ Kb = EI·le·BbᵀBb
    const Bb = [0, -1 / le, 0, 1 / le];
    // shear (reduced, 1-pt at centre): Bs = dw/dx − θ = [-1/le, -1/2, 1/le, -1/2]
    const Bs = [-1 / le, -0.5, 1 / le, -0.5];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      K[map[i]][map[j]] += EI * le * Bb[i] * Bb[j] + kGA * le * Bs[i] * Bs[j];
    }
  }
  // fix node 0 (w0, θ0); load P on the tip w-DOF.
  const fixed = new Set([0, 1]);
  const free: number[] = [];
  for (let d = 0; d < nDof; d++) if (!fixed.has(d)) free.push(d);
  const Kf = free.map((r) => free.map((c) => K[r][c]));
  const f = free.map((d) => (d === (nNodes - 1) * 2 ? P : 0));
  const uf = solveDense(Kf, f);
  const tipDof = (nNodes - 1) * 2;
  return uf[free.indexOf(tipDof)];
}

/** Shear fraction of the tip deflection (shear / total) — grows for stubby beams. */
export function shearFraction(P: number, L: number, b: BeamProps): number {
  const bend = (P * L ** 3) / (3 * b.E * b.I);
  const shear = (P * L) / (b.kappa * b.G * b.A);
  return shear / (bend + shear);
}
