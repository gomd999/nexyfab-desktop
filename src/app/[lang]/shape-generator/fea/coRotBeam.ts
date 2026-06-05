/**
 * coRotBeam.ts — geometrically NONLINEAR (large-deflection, large-rotation) 2D
 * Euler–Bernoulli beam by the CO-ROTATIONAL formulation. Each element carries a
 * frame that rotates with it; the deformation is measured in that local frame
 * (small strain) while rigid-body rotation is handled exactly, so arbitrarily
 * large deflections are captured.
 *
 *   local forces:   N = EA/L0·ū,   [M_i,M_j] = EI/L0·[[4,2],[2,4]]·[θ̄_i,θ̄_j]
 *   global force:    f = Bᵀ q_local
 *   tangent:         K = Bᵀ K_local B + (N/Lₙ) z zᵀ + ((M_i+M_j)/Lₙ²)(r zᵀ + z rᵀ)
 *
 * Solved by Newton-Raphson with load stepping. Verified against the exact elastica
 * of a cantilever under a pure end moment — which curls into a perfect circular arc
 * of radius R = EI/M (tip at R·sinΘ, R(1−cosΘ), Θ = ML/EI).
 *
 * Limitation: the rigid rotation α is wrapped to (−π,π], so an individual element
 * rotating past ±π (e.g. curling beyond a half-turn, Θ ≳ π over too few elements)
 * needs incremental rotation tracking — a documented follow-up.
 */

export interface BeamOptions {
  /** Number of elements along the (initially straight, horizontal) beam. */
  nElems: number;
  /** Total initial length. */
  length: number;
  EA: number;          // axial rigidity
  EI: number;          // flexural rigidity
  /** Applied end moment (at the tip node), ramped over load steps. */
  endMoment?: number;
  /** Applied transverse tip force (in +y), ramped over load steps. */
  tipForce?: number;
  loadSteps?: number;
  maxNewton?: number;
  tol?: number;
}

export interface BeamResult {
  /** Nodal [u,v,θ] displacements (length 3·(nElems+1)). */
  u: Float64Array;
  tip: { x: number; y: number; rotation: number };
  converged: boolean;
  newtonIters: number[];
}

function solveDense(K: number[][], b: number[]): number[] {
  const n = b.length;
  const A = K.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    const d = A[c][c] || 1e-300;
    for (let j = c; j <= n; j++) A[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c]; for (let j = c; j <= n; j++) A[r][j] -= f * A[c][j]; }
  }
  return A.map((row) => row[n]);
}

/** Internal force + tangent of one co-rotational beam element (6 DOF). */
function elementContribution(X: number[], u: number[], idx: number[], L0: number, beta0: number, EA: number, EI: number) {
  const xi = X[idx[0]] + u[idx[0]], yi = X[idx[1]] + u[idx[1]], ti = u[idx[2]];
  const xj = X[idx[3]] + u[idx[3]], yj = X[idx[4]] + u[idx[4]], tj = u[idx[5]];
  const dx = xj - xi, dy = yj - yi;
  const Ln = Math.hypot(dx, dy);
  const c = dx / Ln, s = dy / Ln;
  const beta = Math.atan2(s, c);
  // rigid rotation α = β − β0, wrapped to (−π,π].
  let alpha = beta - beta0;
  while (alpha > Math.PI) alpha -= 2 * Math.PI;
  while (alpha < -Math.PI) alpha += 2 * Math.PI;
  const ubar = Ln - L0;
  const tbi = ti - alpha, tbj = tj - alpha;          // local node rotations
  const N = (EA / L0) * ubar;
  const Mi = (EI / L0) * (4 * tbi + 2 * tbj);
  const Mj = (EI / L0) * (2 * tbi + 4 * tbj);

  const r = [-c, -s, 0, c, s, 0];                    // ∂ū/∂d
  const z = [s, -c, 0, -s, c, 0];                    // Lₙ·∂β/∂d
  // B (3×6): rows ū, θ̄_i, θ̄_j
  const B = [
    r.slice(),
    [-z[0] / Ln, -z[1] / Ln, 1, -z[3] / Ln, -z[4] / Ln, 0],
    [-z[0] / Ln, -z[1] / Ln, 0, -z[3] / Ln, -z[4] / Ln, 1],
  ];
  const q = [N, Mi, Mj];
  const fint = new Array<number>(6).fill(0);
  for (let a = 0; a < 6; a++) for (let k = 0; k < 3; k++) fint[a] += B[k][a] * q[k];

  // local material stiffness K_l (3×3)
  const Kl = [
    [EA / L0, 0, 0],
    [0, (EI / L0) * 4, (EI / L0) * 2],
    [0, (EI / L0) * 2, (EI / L0) * 4],
  ];
  const Kt = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
  // material: Bᵀ K_l B
  for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) {
    let sum = 0;
    for (let k = 0; k < 3; k++) { let klb = 0; for (let l = 0; l < 3; l++) klb += Kl[k][l] * B[l][b]; sum += B[k][a] * klb; }
    Kt[a][b] += sum;
  }
  // geometric: (N/Lₙ) z zᵀ + ((Mi+Mj)/Lₙ²)(r zᵀ + z rᵀ)
  const g1 = N / Ln, g2 = (Mi + Mj) / (Ln * Ln);
  for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) {
    Kt[a][b] += g1 * z[a] * z[b] + g2 * (r[a] * z[b] + z[a] * r[b]);
  }
  return { fint, Kt };
}

/** Newton-Raphson large-deflection solve of a cantilever beam. */
export function coRotBeamSolve(opts: BeamOptions): BeamResult {
  const ne = opts.nElems, nNode = ne + 1, nDof = nNode * 3;
  const L0 = opts.length / ne;
  const X = new Array<number>(nDof).fill(0);
  for (let i = 0; i <= ne; i++) { X[i * 3] = i * L0; X[i * 3 + 1] = 0; X[i * 3 + 2] = 0; }
  const beta0 = 0;
  const nSteps = opts.loadSteps ?? 20, maxNewton = opts.maxNewton ?? 30, tol = opts.tol ?? 1e-9;

  // fixed: node 0 (u,v,θ); applied loads at the tip node.
  const fixed = new Set<number>([0, 1, 2]);
  const tipNode = ne;
  const u = new Float64Array(nDof);
  const newtonIters: number[] = [];
  let converged = true;

  for (let step = 1; step <= nSteps; step++) {
    const frac = step / nSteps;
    const fext = new Float64Array(nDof);
    if (opts.endMoment) fext[tipNode * 3 + 2] = opts.endMoment * frac;
    if (opts.tipForce) fext[tipNode * 3 + 1] = opts.tipForce * frac;

    let iter = 0;
    for (let nit = 0; nit < maxNewton; nit++) {
      const Kg = Array.from({ length: nDof }, () => new Array<number>(nDof).fill(0));
      const fint = new Float64Array(nDof);
      for (let e = 0; e < ne; e++) {
        const idx = [e * 3, e * 3 + 1, e * 3 + 2, (e + 1) * 3, (e + 1) * 3 + 1, (e + 1) * 3 + 2];
        const { fint: fe, Kt } = elementContribution(X, Array.from(u), idx, L0, beta0, opts.EA, opts.EI);
        for (let a = 0; a < 6; a++) { fint[idx[a]] += fe[a]; for (let b = 0; b < 6; b++) Kg[idx[a]][idx[b]] += Kt[a][b]; }
      }
      // residual
      const R: number[] = new Array(nDof).fill(0);
      let rnorm = 0;
      for (let d = 0; d < nDof; d++) if (!fixed.has(d)) { R[d] = fext[d] - fint[d]; rnorm += R[d] * R[d]; }
      rnorm = Math.sqrt(rnorm);
      iter = nit + 1;
      if (rnorm < tol * (1 + Math.abs(opts.endMoment ?? 0) + Math.abs(opts.tipForce ?? 0))) break;
      // reduce + solve
      const freeDofs: number[] = [];
      for (let d = 0; d < nDof; d++) if (!fixed.has(d)) freeDofs.push(d);
      const nF = freeDofs.length;
      const Kr = Array.from({ length: nF }, () => new Array<number>(nF).fill(0));
      const br = new Array<number>(nF).fill(0);
      for (let a = 0; a < nF; a++) { br[a] = R[freeDofs[a]]; for (let b = 0; b < nF; b++) Kr[a][b] = Kg[freeDofs[a]][freeDofs[b]]; }
      const du = solveDense(Kr, br);
      for (let a = 0; a < nF; a++) u[freeDofs[a]] += du[a];
    }
    newtonIters.push(iter);
    if (iter >= maxNewton) converged = false;
  }

  return {
    u, converged, newtonIters,
    tip: { x: X[tipNode * 3] + u[tipNode * 3], y: X[tipNode * 3 + 1] + u[tipNode * 3 + 1], rotation: u[tipNode * 3 + 2] },
  };
}
