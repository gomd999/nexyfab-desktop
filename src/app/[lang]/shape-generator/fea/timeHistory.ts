/**
 * timeHistory.ts — direct time-integration (transient dynamics) on the HEX8 kernel:
 *   M ü + C u̇ + K u = F(t)
 * solved by the NEWMARK-β method. The default (β=1/4, γ=1/2 — constant average
 * acceleration) is unconditionally stable and introduces NO numerical damping, so
 * an undamped system conserves energy exactly.
 *
 * Damping is Rayleigh: C = α·M + β_R·K.
 *
 * Verified against the analytic single-mode response (free vibration at the natural
 * frequency with preserved amplitude; damped envelope e^{−ζω t}; static limit).
 *
 * Reuses the verified modal assembly — consistent units (N, mm, tonne, s ⇒ Hz).
 */
import { TopologyGrid } from '../analysis/topology3D';
import { assembleHex8Modal, Hex8ModalOptions } from './modalFEM';

export interface TimeHistoryOptions extends Hex8ModalOptions {
  dt: number;                 // time step (s)
  steps: number;              // number of steps
  /** Rayleigh damping C = α·M + β_R·K (default 0 = undamped). */
  rayleighAlpha?: number;
  rayleighBeta?: number;
  /** Newmark parameters (default constant-average-acceleration β=1/4, γ=1/2). */
  beta?: number;
  gamma?: number;
  /** Initial displacement / velocity in free-DOF order (default zero). */
  initialDisp?: Float64Array;
  initialVel?: Float64Array;
  /** Constant nodal load (free-DOF order) scaled in time by `loadTime` (default step). */
  load?: Float64Array;
  loadTime?: (t: number) => number;
  /** Free-DOF indices whose time-history to record. */
  probeFreeDofs?: number[];
}

export interface TimeHistoryResult {
  times: number[];                 // length steps+1
  /** probe[k] = time-history of probeFreeDofs[k]. */
  probe: number[][];
  /** Final displacement (free-DOF order). */
  finalDisp: Float64Array;
  nFree: number;
}

/** Dense SPD CG solve A x = b. */
function cgSolve(A: Float64Array, b: Float64Array, x0: Float64Array, n: number, iters = Math.max(300, n * 2), tol = 1e-11): Float64Array {
  const x = Float64Array.from(x0), r = new Float64Array(n), Ap = new Float64Array(n);
  for (let i = 0; i < n; i++) { const row = i * n; let s = 0; for (let j = 0; j < n; j++) s += A[row + j] * x[j]; r[i] = b[i] - s; }
  const Minv = new Float64Array(n);
  for (let i = 0; i < n; i++) { const d = A[i * n + i]; Minv[i] = d !== 0 ? 1 / d : 1; }
  const z = new Float64Array(n); for (let i = 0; i < n; i++) z[i] = r[i] * Minv[i];
  const p = Float64Array.from(z);
  const dot = (u: Float64Array, v: Float64Array) => { let s = 0; for (let i = 0; i < n; i++) s += u[i] * v[i]; return s; };
  let rz = dot(r, z); const b2 = Math.max(dot(b, b), 1e-300);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) { const row = i * n; let s = 0; for (let j = 0; j < n; j++) s += A[row + j] * p[j]; Ap[i] = s; }
    const alpha = rz / (dot(p, Ap) || 1e-300);
    for (let i = 0; i < n; i++) { x[i] += alpha * p[i]; r[i] -= alpha * Ap[i]; }
    if (dot(r, r) / b2 < tol * tol) break;
    for (let i = 0; i < n; i++) z[i] = r[i] * Minv[i];
    const rzNew = dot(r, z);
    const bb = rzNew / (rz || 1e-300);
    for (let i = 0; i < n; i++) p[i] = z[i] + bb * p[i];
    rz = rzNew;
  }
  return x;
}

/** Newmark-β time integration of the HEX8 structural system. */
export function hex8TimeHistory(grid: TopologyGrid, opts: TimeHistoryOptions): TimeHistoryResult {
  const { Kff, Mdiag, nFree } = assembleHex8Modal(grid, opts);
  if (nFree === 0) return { times: [0], probe: (opts.probeFreeDofs ?? []).map(() => [0]), finalDisp: new Float64Array(0), nFree: 0 };

  const K = Float64Array.from(Kff);
  const M = Float64Array.from(Mdiag);
  const aR = opts.rayleighAlpha ?? 0, bR = opts.rayleighBeta ?? 0;
  const beta = opts.beta ?? 0.25, gamma = opts.gamma ?? 0.5, dt = opts.dt;

  const matK = (v: Float64Array, out: Float64Array) => {
    for (let i = 0; i < nFree; i++) { const row = i * nFree; let s = 0; for (let j = 0; j < nFree; j++) s += K[row + j] * v[j]; out[i] = s; }
  };
  // C·v = α·M⊙v + β_R·K·v
  const tmp = new Float64Array(nFree);
  const matC = (v: Float64Array, out: Float64Array) => { matK(v, tmp); for (let i = 0; i < nFree; i++) out[i] = aR * M[i] * v[i] + bR * tmp[i]; };

  // Newmark constants
  const a0 = 1 / (beta * dt * dt), a1 = gamma / (beta * dt), a2 = 1 / (beta * dt);
  const a3 = 1 / (2 * beta) - 1, a4 = gamma / beta - 1, a5 = (dt / 2) * (gamma / beta - 2);
  const a6 = dt * (1 - gamma), a7 = gamma * dt;

  // effective stiffness K_eff = K + a0·M + a1·C  (constant; C = αM + β_R K)
  const Keff = new Float64Array(nFree * nFree);
  for (let i = 0; i < nFree; i++) {
    const row = i * nFree;
    for (let j = 0; j < nFree; j++) Keff[row + j] = K[row + j] * (1 + a1 * bR);
    Keff[row + i] += a0 * M[i] + a1 * aR * M[i];
  }

  // state
  let u: Float64Array = opts.initialDisp ? Float64Array.from(opts.initialDisp) : new Float64Array(nFree);
  let v: Float64Array = opts.initialVel ? Float64Array.from(opts.initialVel) : new Float64Array(nFree);
  const load = opts.load ?? new Float64Array(nFree);
  const loadTime = opts.loadTime ?? (() => 1);

  // initial acceleration ü0 = M⁻¹ (F0 − C v0 − K u0)
  const Ku = new Float64Array(nFree), Cv = new Float64Array(nFree);
  matK(u, Ku); matC(v, Cv);
  let a: Float64Array = new Float64Array(nFree);
  { const g = loadTime(0); for (let i = 0; i < nFree; i++) a[i] = (load[i] * g - Cv[i] - Ku[i]) / (M[i] || 1e-300); }

  const probeDofs = opts.probeFreeDofs ?? [];
  const times: number[] = [0];
  const probe: number[][] = probeDofs.map((d) => [u[d]]);

  const Feff = new Float64Array(nFree), rhsM = new Float64Array(nFree), rhsC = new Float64Array(nFree);
  for (let step = 0; step < opts.steps; step++) {
    const t1 = (step + 1) * dt;
    const g1 = loadTime(t1);
    // F_eff = F^{n+1} + M(a0 u + a2 v + a3 a) + C(a1 u + a4 v + a5 a)
    for (let i = 0; i < nFree; i++) rhsM[i] = a0 * u[i] + a2 * v[i] + a3 * a[i];
    for (let i = 0; i < nFree; i++) rhsC[i] = a1 * u[i] + a4 * v[i] + a5 * a[i];
    matC(rhsC, tmp);
    for (let i = 0; i < nFree; i++) Feff[i] = load[i] * g1 + M[i] * rhsM[i] + tmp[i];

    const uNext = cgSolve(Keff, Feff, u, nFree);
    const aNext = new Float64Array(nFree);
    for (let i = 0; i < nFree; i++) aNext[i] = a0 * (uNext[i] - u[i]) - a2 * v[i] - a3 * a[i];
    const vNext = new Float64Array(nFree);
    for (let i = 0; i < nFree; i++) vNext[i] = v[i] + a6 * a[i] + a7 * aNext[i];
    u = uNext; v = vNext; a = aNext;

    times.push(t1);
    for (let k = 0; k < probeDofs.length; k++) probe[k].push(u[probeDofs[k]]);
  }

  return { times, probe, finalDisp: u, nFree };
}
