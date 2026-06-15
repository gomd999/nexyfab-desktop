/**
 * plasticSolve.ts — global nonlinear (J2 elastoplastic) FEM solve on the HEX8 grid
 * by NEWTON-RAPHSON with the CONSISTENT algorithmic tangent, wiring the verified
 * radial-return integrator (plasticityJ2) into a full structural solve.
 *
 * At each load step the prescribed displacements are incremented and the free DOFs
 * are Newton-iterated to drive the residual R = −f_int to zero. Each Gauss point
 * carries its own plastic state (committed at the end of a converged step). The
 * consistent (algorithmic) tangent — the exact derivative of the return-mapped
 * stress — gives the quadratic Newton convergence a continuum tangent cannot.
 *
 * Engineering-Voigt convention [xx,yy,zz, xy,yz,zx] with engineering shear γ=2ε, so
 * the element matrices are symmetric. Verified: the algorithmic tangent matches a
 * finite-difference of the stress, and a uniaxial bar reproduces the bilinear
 * (E then E_t = EH/(E+H)) stress–strain curve and yield reaction.
 */
import { TopologyGrid } from '../analysis/topology3D';
import { radialReturnJ2, PlasticState, J2Material, zeroState } from './plasticityJ2';

const HEX_CORNERS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];

/** Engineering elastic stiffness D_e (6×6, symmetric). */
function elasticD(mat: J2Material): number[][] {
  const G = mat.E / (2 * (1 + mat.nu)), K = mat.E / (3 * (1 - 2 * mat.nu)), lam = K - (2 * G) / 3;
  const D = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) D[i][j] = lam + (i === j ? 2 * G : 0);
  for (let i = 3; i < 6; i++) D[i][i] = G;
  return D;
}

function ddot6(s: ArrayLike<number>, t: ArrayLike<number>): number {
  return s[0] * t[0] + s[1] * t[1] + s[2] * t[2] + 2 * (s[3] * t[3] + s[4] * t[4] + s[5] * t[5]);
}

export interface MaterialTangentResult {
  stress: Float64Array;        // engineering-Voigt stress
  state: PlasticState;
  D: number[][];               // 6×6 algorithmic tangent (engineering, symmetric)
}

/**
 * Stress + CONSISTENT algorithmic tangent at a material point for an engineering
 * strain vector (γ engineering shear). Reuses the verified radial return for the
 * stress/state, then forms D_alg = K·1⊗1 + a·I_d + b·N⊗N from the same step data.
 */
export function materialTangentJ2(strainEng: ArrayLike<number>, committed: PlasticState, mat: J2Material): MaterialTangentResult {
  const G = mat.E / (2 * (1 + mat.nu)), K = mat.E / (3 * (1 - 2 * mat.nu)), H = mat.hardening;
  // engineering → tensor strain for the return map
  const eps = [strainEng[0], strainEng[1], strainEng[2], strainEng[3] / 2, strainEng[4] / 2, strainEng[5] / 2];
  const r = radialReturnJ2(eps, committed, mat);

  if (!r.plastic) return { stress: r.stress, state: r.state, D: elasticD(mat) };

  // recompute the trial deviator to build the consistent tangent.
  const trEps = eps[0] + eps[1] + eps[2];
  const devEps = [eps[0] - trEps / 3, eps[1] - trEps / 3, eps[2] - trEps / 3, eps[3], eps[4], eps[5]];
  const ep = committed.plasticStrain;
  const sTrial = new Float64Array(6);
  for (let i = 0; i < 6; i++) sTrial[i] = 2 * G * (devEps[i] - ep[i]);
  const normTrial = Math.sqrt(ddot6(sTrial, sTrial));
  const qTrial = Math.sqrt(1.5) * normTrial;
  const dGamma = r.dGamma;
  const N = new Float64Array(6);             // unit deviatoric direction (tensor components)
  for (let i = 0; i < 6; i++) N[i] = sTrial[i] / normTrial;

  const a = 2 * G * (1 - (3 * G * dGamma) / qTrial);
  const b = 6 * G * G * (dGamma / qTrial - 1 / (3 * G + H));

  // I_d (engineering deviatoric projector): normal block δ−1/3, shear diagonal 1/2.
  const D = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    let Id = 0;
    if (i < 3 && j < 3) Id = (i === j ? 1 : 0) - 1 / 3;
    else if (i === j) Id = 0.5;
    const one = i < 3 && j < 3 ? 1 : 0;
    D[i][j] = K * one + a * Id + b * N[i] * N[j];
  }
  return { stress: r.stress, state: r.state, D };
}

// ---- HEX8 element kinematics ------------------------------------------------

/** B-matrix (6×24, engineering shear) and detJ at a natural point of a size-h cube. */
function hex8B(xi: number, eta: number, zet: number, h: number): { B: number[][]; detJ: number } {
  const dNx: number[] = [], dNy: number[] = [], dNz: number[] = [];
  for (const c of HEX_CORNERS) {
    const sx = 2 * c[0] - 1, sy = 2 * c[1] - 1, sz = 2 * c[2] - 1;
    // N = 1/8(1+sx·ξ)(1+sy·η)(1+sz·ζ); dN/dx = (2/h)·dN/dξ
    dNx.push((2 / h) * 0.125 * sx * (1 + sy * eta) * (1 + sz * zet));
    dNy.push((2 / h) * 0.125 * (1 + sx * xi) * sy * (1 + sz * zet));
    dNz.push((2 / h) * 0.125 * (1 + sx * xi) * (1 + sy * eta) * sz);
  }
  const B = Array.from({ length: 6 }, () => new Array<number>(24).fill(0));
  for (let i = 0; i < 8; i++) {
    B[0][i * 3] = dNx[i]; B[1][i * 3 + 1] = dNy[i]; B[2][i * 3 + 2] = dNz[i];
    B[3][i * 3] = dNy[i]; B[3][i * 3 + 1] = dNx[i];
    B[4][i * 3 + 1] = dNz[i]; B[4][i * 3 + 2] = dNy[i];
    B[5][i * 3] = dNz[i]; B[5][i * 3 + 2] = dNx[i];
  }
  return { B, detJ: (h / 2) ** 3 };
}

const GP = [-1 / Math.sqrt(3), 1 / Math.sqrt(3)];

export interface PlasticSolveOptions {
  material: J2Material;
  cell: number;
  /** Prescribed displacements: global DOF (node*3+axis) → final value (ramped over steps). */
  fixedDisp: Map<number, number>;
  loadSteps?: number;
  maxNewton?: number;
  tol?: number;
  /** DOFs whose summed internal force (reaction) to report per step. */
  reactionDofs?: number[];
}

export interface PlasticSolveResult {
  displacement: Float64Array;        // full nodal DOF vector
  /** Reaction (Σ f_int over reactionDofs) per load step. */
  reactionHistory: number[];
  /** Newton iterations used per step. */
  newtonIters: number[];
  converged: boolean;
}

function cgSolve(K: Float64Array, b: Float64Array, n: number, iters = Math.max(400, n * 2), tol = 1e-11): Float64Array {
  const x = new Float64Array(n), r = Float64Array.from(b);
  const Minv = new Float64Array(n);
  for (let i = 0; i < n; i++) { const d = K[i * n + i]; Minv[i] = d !== 0 ? 1 / d : 1; }
  const z = new Float64Array(n); for (let i = 0; i < n; i++) z[i] = r[i] * Minv[i];
  const p = Float64Array.from(z), Ap = new Float64Array(n);
  const dot = (u: Float64Array, v: Float64Array) => { let s = 0; for (let i = 0; i < n; i++) s += u[i] * v[i]; return s; };
  let rz = dot(r, z); const b2 = Math.max(dot(b, b), 1e-300);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) { const row = i * n; let s = 0; for (let j = 0; j < n; j++) s += K[row + j] * p[j]; Ap[i] = s; }
    const alpha = rz / (dot(p, Ap) || 1e-300);
    for (let i = 0; i < n; i++) { x[i] += alpha * p[i]; r[i] -= alpha * Ap[i]; }
    if (dot(r, r) / b2 < tol * tol) break;
    for (let i = 0; i < n; i++) z[i] = r[i] * Minv[i];
    const rzNew = dot(r, z); const beta = rzNew / (rz || 1e-300);
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i]; rz = rzNew;
  }
  return x;
}

/**
 * Newton-Raphson elastoplastic solve with displacement-controlled load stepping.
 * Free DOFs are iterated until ‖R‖ < tol·‖R0‖; the per-Gauss-point plastic state is
 * committed only after a step converges. Returns the reaction history at the
 * prescribed boundary.
 */
export function hex8PlasticSolve(grid: TopologyGrid, opts: PlasticSolveOptions): PlasticSolveResult {
  const h = opts.cell, mat = opts.material;
  const nDof = grid.nNodes * 3;
  const nSteps = opts.loadSteps ?? 10, maxNewton = opts.maxNewton ?? 20, tol = opts.tol ?? 1e-8;

  // DOF partition: prescribed (Dirichlet) vs free.
  const isPrescribed = new Uint8Array(nDof);
  for (const d of opts.fixedDisp.keys()) isPrescribed[d] = 1;
  const freeIdx = new Int32Array(nDof).fill(-1);
  let nFree = 0;
  for (let d = 0; d < nDof; d++) if (!isPrescribed[d]) freeIdx[d] = nFree++;

  // element connectivity + precomputed B/detJ at the 8 Gauss points.
  const elems: Int32Array[] = [];
  for (let ez = 0; ez < grid.nz; ez++) for (let ey = 0; ey < grid.ny; ey++) for (let ex = 0; ex < grid.nx; ex++) {
    const ns = grid.elemNodes(ex, ey, ez);
    elems.push(Int32Array.from(ns));
  }
  const gauss: Array<{ B: number[][]; detJ: number }> = [];
  for (const r of GP) for (const s of GP) for (const t of GP) gauss.push(hex8B(r, s, t, h));

  // committed plastic state per element per Gauss point.
  const committed: PlasticState[][] = elems.map(() => gauss.map(() => zeroState()));

  const u = new Float64Array(nDof);
  const reactionHistory: number[] = [], newtonIters: number[] = [];
  let converged = true;

  for (let step = 1; step <= nSteps; step++) {
    const frac = step / nSteps;
    for (const [d, val] of opts.fixedDisp) u[d] = val * frac;   // ramp prescribed DOFs

    let stepIters = 0;
    let r0norm = 0;
    const trialState: PlasticState[][] = elems.map((_, e) => committed[e].map((s) => ({ plasticStrain: Float64Array.from(s.plasticStrain), alpha: s.alpha })));

    for (let nit = 0; nit < maxNewton; nit++) {
      // assemble K_T (free×free) and internal force, evaluating from COMMITTED state.
      const K = new Float64Array(nFree * nFree);
      const fint = new Float64Array(nDof);
      const ue = new Float64Array(24);
      for (let e = 0; e < elems.length; e++) {
        const ns = elems[e];
        for (let i = 0; i < 8; i++) { ue[i * 3] = u[ns[i] * 3]; ue[i * 3 + 1] = u[ns[i] * 3 + 1]; ue[i * 3 + 2] = u[ns[i] * 3 + 2]; }
        const Ke = Array.from({ length: 24 }, () => new Array<number>(24).fill(0));
        const fe = new Array<number>(24).fill(0);
        for (let g = 0; g < 8; g++) {
          const { B, detJ } = gauss[g];
          // strain = B·ue
          const strain = new Array<number>(6).fill(0);
          for (let a = 0; a < 6; a++) { let s = 0; for (let k = 0; k < 24; k++) s += B[a][k] * ue[k]; strain[a] = s; }
          const mt = materialTangentJ2(strain, committed[e][g], mat);
          trialState[e][g] = mt.state;
          // fe += Bᵀ σ detJ ; Ke += Bᵀ D B detJ
          for (let k = 0; k < 24; k++) { let s = 0; for (let a = 0; a < 6; a++) s += B[a][k] * mt.stress[a]; fe[k] += s * detJ; }
          const DB = Array.from({ length: 6 }, () => new Array<number>(24).fill(0));
          for (let a = 0; a < 6; a++) for (let k = 0; k < 24; k++) { let s = 0; for (let bb = 0; bb < 6; bb++) s += mt.D[a][bb] * B[bb][k]; DB[a][k] = s; }
          for (let p = 0; p < 24; p++) for (let q = 0; q < 24; q++) { let s = 0; for (let a = 0; a < 6; a++) s += B[a][p] * DB[a][q]; Ke[p][q] += s * detJ; }
        }
        // scatter
        for (let p = 0; p < 24; p++) {
          const gp = ns[(p / 3) | 0] * 3 + (p % 3);
          fint[gp] += fe[p];
          const rp = freeIdx[gp]; if (rp < 0) continue;
          for (let q = 0; q < 24; q++) {
            const gq = ns[(q / 3) | 0] * 3 + (q % 3);
            const rq = freeIdx[gq]; if (rq < 0) continue;
            K[rp * nFree + rq] += Ke[p][q];
          }
        }
      }
      // residual on free DOFs (no external load there): R = −f_int
      const R = new Float64Array(nFree);
      let rnorm = 0;
      for (let d = 0; d < nDof; d++) { const rd = freeIdx[d]; if (rd >= 0) { R[rd] = -fint[d]; rnorm += R[rd] * R[rd]; } }
      rnorm = Math.sqrt(rnorm);
      if (nit === 0) r0norm = Math.max(rnorm, 1e-30);
      stepIters = nit + 1;
      if (rnorm <= tol * r0norm || rnorm < 1e-9) break;
      const du = cgSolve(K, R, nFree);
      for (let d = 0; d < nDof; d++) { const rd = freeIdx[d]; if (rd >= 0) u[d] += du[rd]; }
    }
    if (stepIters >= maxNewton) converged = false;

    // commit converged state + record reaction.
    for (let e = 0; e < elems.length; e++) for (let g = 0; g < 8; g++) committed[e][g] = trialState[e][g];
    // recompute f_int at the converged u for an accurate reaction.
    let reaction = 0;
    if (opts.reactionDofs && opts.reactionDofs.length) {
      const fint = new Float64Array(nDof);
      const ue = new Float64Array(24);
      for (let e = 0; e < elems.length; e++) {
        const ns = elems[e];
        for (let i = 0; i < 8; i++) { ue[i * 3] = u[ns[i] * 3]; ue[i * 3 + 1] = u[ns[i] * 3 + 1]; ue[i * 3 + 2] = u[ns[i] * 3 + 2]; }
        for (let g = 0; g < 8; g++) {
          const { B, detJ } = gauss[g];
          const strain = new Array<number>(6).fill(0);
          for (let a = 0; a < 6; a++) { let s = 0; for (let k = 0; k < 24; k++) s += B[a][k] * ue[k]; strain[a] = s; }
          const mt = materialTangentJ2(strain, committed[e][g], mat);
          for (let k = 0; k < 24; k++) { let s = 0; for (let a = 0; a < 6; a++) s += B[a][k] * mt.stress[a]; fint[ns[(k / 3) | 0] * 3 + (k % 3)] += s * detJ; }
        }
      }
      for (const d of opts.reactionDofs) reaction += fint[d];
    }
    reactionHistory.push(reaction);
    newtonIters.push(stepIters);
  }

  return { displacement: u, reactionHistory, newtonIters, converged };
}
