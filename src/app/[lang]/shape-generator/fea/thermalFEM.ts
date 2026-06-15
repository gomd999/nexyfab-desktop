/**
 * thermalFEM — steady-state heat conduction on the HEX8 FEM kernel.
 *
 * Solves K_t · T = Q (the scalar Laplacian: ∇·(k∇T) + q = 0, one temperature DOF
 * per node) with an 8-node hexahedral conductance element, instead of the crude
 * "uniform conductance" lumped-node approximation. Verified against the analytic
 * 1-D conduction profile.
 *
 * Consistent units (W, mm, K): conductivity in W/(mm·K), cell in mm ⇒ T in K/°C.
 */
import { TopologyGrid } from '../analysis/topology3D';

const HEX_CORNERS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];

/** 8×8 conductance matrix of a unit cube with k = 1: ∫ ∇N·∇N dV, via 2×2×2 Gauss. */
export function buildHex8Thermal0(): Float64Array {
  const g = 1 / Math.sqrt(3), gp = [-g, g];
  const xi = HEX_CORNERS.map((c) => 2 * c[0] - 1);
  const eta = HEX_CORNERS.map((c) => 2 * c[1] - 1);
  const zet = HEX_CORNERS.map((c) => 2 * c[2] - 1);
  const K0 = new Float64Array(64);
  for (const r of gp) for (const s of gp) for (const t of gp) {
    const dNx = new Array<number>(8), dNy = new Array<number>(8), dNz = new Array<number>(8);
    for (let i = 0; i < 8; i++) {
      // unit cube: x = (ξ+1)/2 ⇒ dN/dx = 2·dN/dξ
      dNx[i] = 2 * 0.125 * xi[i] * (1 + eta[i] * s) * (1 + zet[i] * t);
      dNy[i] = 2 * 0.125 * (1 + xi[i] * r) * eta[i] * (1 + zet[i] * t);
      dNz[i] = 2 * 0.125 * (1 + xi[i] * r) * (1 + eta[i] * s) * zet[i];
    }
    const detJ = 0.125;
    for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) {
      K0[a * 8 + b] += detJ * (dNx[a] * dNx[b] + dNy[a] * dNy[b] + dNz[a] * dNz[b]);
    }
  }
  return K0;
}

export interface ThermalOptions {
  conductivity: number;          // W/(mm·K)
  cell: number;                  // voxel size (mm)
  /** Prescribed temperatures: node id → fixed T (Dirichlet). */
  fixedTemp: Map<number, number>;
  /** Nodal heat sources: node id → power (W) injected at that node (Neumann). */
  heatSource?: Map<number, number>;
}

export interface ThermalResult {
  /** Temperature per node (indexed by grid node id). */
  temperature: Float32Array;
  maxTemp: number;
  minTemp: number;
}

function cg(matvec: (x: Float64Array, out: Float64Array) => void, b: Float64Array, n: number, iters = Math.max(500, n * 2), tol = 1e-10): Float64Array {
  const x = new Float64Array(n), r = Float64Array.from(b), p = Float64Array.from(b), Ap = new Float64Array(n);
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

/** Steady-state nodal temperatures of a uniform solid grid. */
export function hex8Thermal(grid: TopologyGrid, opts: ThermalOptions): ThermalResult {
  const K0 = buildHex8Thermal0();
  const kScale = opts.conductivity * opts.cell; // K_e = k·h·K0 (3-D scaling)
  const nNodes = grid.nNodes;

  // free-node reduction (fixed-temperature nodes are removed).
  const isFixed = new Uint8Array(nNodes);
  for (const nd of opts.fixedTemp.keys()) isFixed[nd] = 1;
  const freeIdx = new Int32Array(nNodes).fill(-1);
  let nFree = 0;
  for (let i = 0; i < nNodes; i++) if (!isFixed[i]) freeIdx[i] = nFree++;

  // sparse K (free×free) as adjacency map + RHS with Dirichlet + source moved over.
  const rows: Map<number, number>[] = Array.from({ length: nFree }, () => new Map());
  const rhs = new Float64Array(nFree);
  const ns = new Array<number>(8);
  for (let ez = 0; ez < grid.nz; ez++) for (let ey = 0; ey < grid.ny; ey++) for (let ex = 0; ex < grid.nx; ex++) {
    const corners = grid.elemNodes(ex, ey, ez);
    for (let i = 0; i < 8; i++) ns[i] = corners[i];
    for (let a = 0; a < 8; a++) {
      const ra = freeIdx[ns[a]];
      if (ra < 0) continue;
      for (let b = 0; b < 8; b++) {
        const kab = kScale * K0[a * 8 + b];
        if (kab === 0) continue;
        const rb = freeIdx[ns[b]];
        if (rb >= 0) rows[ra].set(rb, (rows[ra].get(rb) ?? 0) + kab);
        else rhs[ra] -= kab * (opts.fixedTemp.get(ns[b]) ?? 0); // move known T to RHS
      }
    }
  }
  if (opts.heatSource) for (const [nd, q] of opts.heatSource) { const r = freeIdx[nd]; if (r >= 0) rhs[r] += q; }

  // CSR-ish matvec
  const cols: Int32Array[] = rows.map((m) => Int32Array.from(m.keys()));
  const vals: Float64Array[] = rows.map((m) => Float64Array.from(m.values()));
  const matvec = (x: Float64Array, out: Float64Array) => {
    for (let i = 0; i < nFree; i++) { const c = cols[i], v = vals[i]; let s = 0; for (let j = 0; j < c.length; j++) s += v[j] * x[c[j]]; out[i] = s; }
  };
  const Tfree = nFree > 0 ? cg(matvec, rhs, nFree) : new Float64Array(0);

  const temperature = new Float32Array(nNodes);
  let maxT = -Infinity, minT = Infinity;
  for (let i = 0; i < nNodes; i++) {
    const T = isFixed[i] ? (opts.fixedTemp.get(i) ?? 0) : Tfree[freeIdx[i]];
    temperature[i] = T;
    if (T > maxT) maxT = T;
    if (T < minT) minT = T;
  }
  return { temperature, maxTemp: maxT, minTemp: minT };
}

/** Fix every node on the `axis` = `end` face (0 or grid size) to a temperature. */
export function fixFaceTemp(grid: TopologyGrid, axis: 'x' | 'y' | 'z', atMax: boolean, T: number, into: Map<number, number>): void {
  const n = axis === 'x' ? grid.nx : axis === 'y' ? grid.ny : grid.nz;
  for (let iz = 0; iz <= grid.nz; iz++) for (let iy = 0; iy <= grid.ny; iy++) for (let ix = 0; ix <= grid.nx; ix++) {
    const coord = axis === 'x' ? ix : axis === 'y' ? iy : iz;
    if (coord === (atMax ? n : 0)) into.set(grid.node(ix, iy, iz), T);
  }
}
