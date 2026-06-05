/**
 * transientThermal.ts — transient (time-dependent) heat conduction on the HEX8
 * kernel:  C·dT/dt + K_t·T = Q.  C is the lumped heat-capacity matrix, K_t the
 * HEX8 conductance (shared with the steady solver). Integrated with BACKWARD
 * EULER — implicit and unconditionally stable, so large time steps never blow up.
 *
 *   (C/Δt + K_t) T^{n+1} = (C/Δt) T^n + Q
 *
 * Verified against the analytic transient solution (lumped heating, modal decay
 * rate, steady-state limit).
 *
 * Units: conductivity in W/(mm·K); volHeatCapacity ρ·c_p in J/(mm³·K); cell in mm;
 * dt in s ⇒ thermal diffusivity α = k / (ρ·c_p) in mm²/s.
 */
import { TopologyGrid } from '../analysis/topology3D';
import { buildHex8Thermal0 } from './thermalFEM';

export interface TransientThermalOptions {
  conductivity: number;            // k, W/(mm·K)
  volHeatCapacity: number;         // ρ·c_p, J/(mm³·K)
  cell: number;                    // voxel size (mm)
  /** Prescribed temperatures (held constant in time). */
  fixedTemp: Map<number, number>;
  /** Nodal heat sources Q (W), constant in time. */
  heatSource?: Map<number, number>;
  /** Initial temperature: scalar (uniform) or per-node field. */
  initialTemp: number | Float32Array;
  dt: number;                      // time step (s)
  steps: number;                   // number of steps
  /** Nodes whose temperature time-history to record (for inspection). */
  probeNodes?: number[];
}

export interface TransientThermalResult {
  /** Final temperature per node. */
  temperature: Float32Array;
  /** Recorded times (s), length steps+1 (including t=0). */
  times: number[];
  /** probe[k] = time-history of probeNodes[k] (length steps+1). */
  probe: number[][];
  maxTemp: number;
  minTemp: number;
}

function cg(matvec: (x: Float64Array, out: Float64Array) => void, b: Float64Array, x0: Float64Array, n: number, iters = Math.max(500, n * 2), tol = 1e-10): Float64Array {
  const x = Float64Array.from(x0), r = new Float64Array(n), p = new Float64Array(n), Ap = new Float64Array(n);
  matvec(x, Ap);
  for (let i = 0; i < n; i++) { r[i] = b[i] - Ap[i]; p[i] = r[i]; }
  const dot = (u: Float64Array, v: Float64Array) => { let s = 0; for (let i = 0; i < n; i++) s += u[i] * v[i]; return s; };
  let rr = dot(r, r); const b2 = Math.max(dot(b, b), 1e-300);
  for (let it = 0; it < iters; it++) {
    matvec(p, Ap);
    const alpha = rr / (dot(p, Ap) || 1e-300);
    for (let i = 0; i < n; i++) { x[i] += alpha * p[i]; r[i] -= alpha * Ap[i]; }
    const rrNew = dot(r, r);
    if (rrNew / b2 < tol * tol) break;
    const beta = rrNew / (rr || 1e-300);
    for (let i = 0; i < n; i++) p[i] = r[i] + beta * p[i];
    rr = rrNew;
  }
  return x;
}

/**
 * Time-march the transient heat equation. Reuses the HEX8 conductance and adds a
 * lumped heat-capacity matrix C (ρ·c_p·V/8 per node per element); backward Euler
 * gives a constant system matrix A = C/Δt + K_t, refactored implicitly by CG each
 * step (only the RHS changes).
 */
export function hex8TransientThermal(grid: TopologyGrid, opts: TransientThermalOptions): TransientThermalResult {
  const K0 = buildHex8Thermal0();
  const kScale = opts.conductivity * opts.cell;     // K_e = k·h·K0
  const nodeCap = (opts.volHeatCapacity * opts.cell ** 3) / 8; // lumped C per node per element
  const nNodes = grid.nNodes;

  // free-node reduction (fixed-temperature nodes removed; they stay constant).
  const isFixed = new Uint8Array(nNodes);
  for (const nd of opts.fixedTemp.keys()) isFixed[nd] = 1;
  const freeIdx = new Int32Array(nNodes).fill(-1);
  let nFree = 0;
  for (let i = 0; i < nNodes; i++) if (!isFixed[i]) freeIdx[i] = nFree++;

  // assemble conductance rows (free×free) + lumped capacity per free node +
  // the steady source/Dirichlet RHS contribution (constant in time).
  const rows: Map<number, number>[] = Array.from({ length: nFree }, () => new Map());
  const C = new Float64Array(nFree);
  const fixedDir = new Float64Array(nFree);         // -Σ K·T_fixed (Dirichlet → RHS)
  const ns = new Array<number>(8);
  for (let ez = 0; ez < grid.nz; ez++) for (let ey = 0; ey < grid.ny; ey++) for (let ex = 0; ex < grid.nx; ex++) {
    const corners = grid.elemNodes(ex, ey, ez);
    for (let i = 0; i < 8; i++) ns[i] = corners[i];
    for (let a = 0; a < 8; a++) {
      const ra = freeIdx[ns[a]];
      if (ra < 0) continue;
      C[ra] += nodeCap;
      for (let b = 0; b < 8; b++) {
        const kab = kScale * K0[a * 8 + b];
        if (kab === 0) continue;
        const rb = freeIdx[ns[b]];
        if (rb >= 0) rows[ra].set(rb, (rows[ra].get(rb) ?? 0) + kab);
        else fixedDir[ra] -= kab * (opts.fixedTemp.get(ns[b]) ?? 0);
      }
    }
  }
  const cols: Int32Array[] = rows.map((m) => Int32Array.from(m.keys()));
  const vals: Float64Array[] = rows.map((m) => Float64Array.from(m.values()));

  // constant source RHS term
  const Qsrc = new Float64Array(nFree);
  if (opts.heatSource) for (const [nd, q] of opts.heatSource) { const r = freeIdx[nd]; if (r >= 0) Qsrc[r] += q; }

  // A = C/dt + K_t  (matrix-free)
  const invDt = 1 / opts.dt;
  const matvecA = (x: Float64Array, out: Float64Array) => {
    for (let i = 0; i < nFree; i++) {
      const c = cols[i], v = vals[i];
      let s = C[i] * invDt * x[i];
      for (let j = 0; j < c.length; j++) s += v[j] * x[c[j]];
      out[i] = s;
    }
  };

  // initial state
  const temperature = new Float32Array(nNodes);
  for (let i = 0; i < nNodes; i++) {
    temperature[i] = isFixed[i] ? (opts.fixedTemp.get(i) ?? 0)
      : typeof opts.initialTemp === 'number' ? opts.initialTemp : opts.initialTemp[i];
  }
  let Tfree: Float64Array = new Float64Array(nFree);
  for (let i = 0; i < nNodes; i++) if (freeIdx[i] >= 0) Tfree[freeIdx[i]] = temperature[i];

  const probeNodes = opts.probeNodes ?? [];
  const times: number[] = [0];
  const probe: number[][] = probeNodes.map((nd) => [temperature[nd]]);

  const rhs = new Float64Array(nFree);
  for (let step = 0; step < opts.steps; step++) {
    // RHS = C/dt·T^n + Q + Dirichlet
    for (let i = 0; i < nFree; i++) rhs[i] = C[i] * invDt * Tfree[i] + Qsrc[i] + fixedDir[i];
    Tfree = cg(matvecA, rhs, Tfree, nFree);
    for (let i = 0; i < nNodes; i++) if (freeIdx[i] >= 0) temperature[i] = Tfree[freeIdx[i]];
    times.push((step + 1) * opts.dt);
    for (let k = 0; k < probeNodes.length; k++) probe[k].push(temperature[probeNodes[k]]);
  }

  let maxT = -Infinity, minT = Infinity;
  for (let i = 0; i < nNodes; i++) { const T = temperature[i]; if (T > maxT) maxT = T; if (T < minT) minT = T; }
  return { temperature, times, probe, maxTemp: maxT, minTemp: minT };
}
