/**
 * thermoElastic.ts — coupled thermo-mechanical (thermal-stress) analysis on the
 * HEX8 grid. A temperature change imposes a thermal strain ε_th = α·ΔT·I; the
 * stress is σ = D:(ε − ε_th), so a constrained body that cannot expand develops
 * thermal stress.
 *
 *   thermal load:  f_th = ∫ Bᵀ D ε_th dV   (equivalent nodal forces of expansion)
 *   solve:         K u = f_th  (+ any mechanical load)
 *   recover:       σ = D (B u − ε_th)
 *
 * The temperature field can come directly from the conduction solver (hex8Thermal),
 * closing the thermal→structural coupling. Verified against the analytic limits:
 * free expansion (zero stress, u = α·ΔT·x) and full axial restraint (σ = −E·α·ΔT).
 */
import { TopologyGrid, buildHex8K0 } from '../analysis/topology3D';

const HEX_CORNERS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
const GP = [-1 / Math.sqrt(3), 1 / Math.sqrt(3)];

/** Engineering elastic stiffness D_e (6×6). */
function elasticD(E: number, nu: number): number[][] {
  const G = E / (2 * (1 + nu)), K = E / (3 * (1 - 2 * nu)), lam = K - (2 * G) / 3;
  const D = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) D[i][j] = lam + (i === j ? 2 * G : 0);
  for (let i = 3; i < 6; i++) D[i][i] = G;
  return D;
}

/** HEX8 B-matrix (6×24, engineering shear), N shape values, detJ at a natural point. */
function hex8B(xi: number, eta: number, zet: number, h: number): { B: number[][]; N: number[]; detJ: number } {
  const N: number[] = [], dNx: number[] = [], dNy: number[] = [], dNz: number[] = [];
  for (const c of HEX_CORNERS) {
    const sx = 2 * c[0] - 1, sy = 2 * c[1] - 1, sz = 2 * c[2] - 1;
    N.push(0.125 * (1 + sx * xi) * (1 + sy * eta) * (1 + sz * zet));
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
  return { B, N, detJ: (h / 2) ** 3 };
}

export interface ThermoElasticOptions {
  E: number; nu: number; cell: number;
  /** Thermal expansion coefficient α (1/K). */
  alpha: number;
  /** Temperature change ΔT: scalar (uniform) or per-node field (e.g. from hex8Thermal). */
  deltaT: number | Float32Array | Float64Array;
  /** Support DOFs (node*3+axis → prescribed displacement). */
  fixed: Map<number, number>;
  /** Extra mechanical nodal loads (node*3+axis → force). */
  load?: Map<number, number>;
}

export interface ThermoElasticResult {
  displacement: Float64Array;
  /** Cauchy stress per element (at the centre) [xx,yy,zz,xy,yz,zx]. */
  elementStress: Float64Array[];
  maxVonMises: number;
}

function cgSolveReduced(K: Float64Array, f: Float64Array, nDof: number, fixed: Map<number, number>): Float64Array {
  const isFixed = new Uint8Array(nDof);
  for (const d of fixed.keys()) isFixed[d] = 1;
  const freeIdx = new Int32Array(nDof).fill(-1);
  let nFree = 0;
  for (let d = 0; d < nDof; d++) if (!isFixed[d]) freeIdx[d] = nFree++;
  const cols: Int32Array[] = [], vals: Float64Array[] = [];
  const b = new Float64Array(nFree);
  for (let d = 0; d < nDof; d++) {
    const r = freeIdx[d]; if (r < 0) continue;
    let s = f[d]; const row = d * nDof; const c: number[] = [], v: number[] = [];
    for (let e = 0; e < nDof; e++) { const ke = K[row + e]; if (ke === 0) continue; const re = freeIdx[e]; if (re >= 0) { c.push(re); v.push(ke); } else s -= ke * (fixed.get(e) ?? 0); }
    b[r] = s; cols[r] = Int32Array.from(c); vals[r] = Float64Array.from(v);
  }
  const x = new Float64Array(nFree), r = Float64Array.from(b), Ap = new Float64Array(nFree);
  const diag = new Float64Array(nFree);
  for (let i = 0; i < nFree; i++) { const c = cols[i], vv = vals[i]; for (let j = 0; j < c.length; j++) if (c[j] === i) diag[i] = vv[j]; }
  const z = new Float64Array(nFree); for (let i = 0; i < nFree; i++) z[i] = r[i] / (diag[i] || 1);
  const p = Float64Array.from(z);
  const dot = (u: Float64Array, w: Float64Array) => { let s = 0; for (let i = 0; i < nFree; i++) s += u[i] * w[i]; return s; };
  let rz = dot(r, z); const b2 = Math.max(dot(b, b), 1e-300);
  for (let it = 0; it < Math.max(500, nFree * 2); it++) {
    for (let i = 0; i < nFree; i++) { const c = cols[i], vv = vals[i]; let s = 0; for (let j = 0; j < c.length; j++) s += vv[j] * p[c[j]]; Ap[i] = s; }
    const alpha = rz / (dot(p, Ap) || 1e-300);
    for (let i = 0; i < nFree; i++) { x[i] += alpha * p[i]; r[i] -= alpha * Ap[i]; }
    if (dot(r, r) / b2 < 1e-22) break;
    for (let i = 0; i < nFree; i++) z[i] = r[i] / (diag[i] || 1);
    const rzNew = dot(r, z); const beta = rzNew / (rz || 1e-300);
    for (let i = 0; i < nFree; i++) p[i] = z[i] + beta * p[i]; rz = rzNew;
  }
  const u = new Float64Array(nDof);
  for (const [d, val] of fixed) u[d] = val;
  for (let d = 0; d < nDof; d++) { const rr = freeIdx[d]; if (rr >= 0) u[d] = x[rr]; }
  return u;
}

/** Solve a thermo-elastic problem: thermal expansion + restraint → thermal stress. */
export function hex8ThermoElastic(grid: TopologyGrid, opts: ThermoElasticOptions): ThermoElasticResult {
  const h = opts.cell, nDof = grid.nNodes * 3;
  const K0 = buildHex8K0(opts.nu), kScale = opts.E * h;
  const D = elasticD(opts.E, opts.nu);
  const Tof = (nd: number) => typeof opts.deltaT === 'number' ? opts.deltaT : opts.deltaT[nd];

  // assemble K + thermal force f_th = ∫ Bᵀ D ε_th dV (ε_th = αΔT·[1,1,1,0,0,0]).
  const K = new Float64Array(nDof * nDof);
  const f = new Float64Array(nDof);
  if (opts.load) for (const [d, v] of opts.load) f[d] += v;
  const edof = new Int32Array(24);
  const gauss = [] as Array<{ B: number[][]; N: number[]; detJ: number }>;
  for (const r of GP) for (const s of GP) for (const t of GP) gauss.push(hex8B(r, s, t, h));

  const elemList: Int32Array[] = [];
  for (let ez = 0; ez < grid.nz; ez++) for (let ey = 0; ey < grid.ny; ey++) for (let ex = 0; ex < grid.nx; ex++) {
    const ns = grid.elemNodes(ex, ey, ez);
    elemList.push(Int32Array.from(ns));
    for (let i = 0; i < 8; i++) { edof[i * 3] = ns[i] * 3; edof[i * 3 + 1] = ns[i] * 3 + 1; edof[i * 3 + 2] = ns[i] * 3 + 2; }
    for (let i = 0; i < 24; i++) { const di = edof[i], row = di * nDof, k0row = i * 24; for (let j = 0; j < 24; j++) K[row + edof[j]] += kScale * K0[k0row + j]; }
    // thermal force
    for (const { B, N, detJ } of gauss) {
      let Tg = 0; for (let a = 0; a < 8; a++) Tg += N[a] * Tof(ns[a]);
      const eth = opts.alpha * Tg;
      const Deth = [D[0][0] * eth + D[0][1] * eth + D[0][2] * eth, D[1][0] * eth + D[1][1] * eth + D[1][2] * eth, D[2][0] * eth + D[2][1] * eth + D[2][2] * eth, 0, 0, 0];
      for (let k = 0; k < 24; k++) { let s = 0; for (let a = 0; a < 6; a++) s += B[a][k] * Deth[a]; f[edof[k]] += s * detJ; }
    }
  }

  const u = cgSolveReduced(K, f, nDof, opts.fixed);

  // recover element-centre stress σ = D(B u − ε_th).
  const centre = hex8B(0, 0, 0, h);
  const elementStress: Float64Array[] = [];
  let maxVM = 0;
  const ue = new Float64Array(24);
  for (const ns of elemList) {
    for (let i = 0; i < 8; i++) { ue[i * 3] = u[ns[i] * 3]; ue[i * 3 + 1] = u[ns[i] * 3 + 1]; ue[i * 3 + 2] = u[ns[i] * 3 + 2]; }
    let Tc = 0; for (let a = 0; a < 8; a++) Tc += centre.N[a] * Tof(ns[a]);
    const eth = opts.alpha * Tc;
    const strain = new Array<number>(6).fill(0);
    for (let a = 0; a < 6; a++) { let s = 0; for (let k = 0; k < 24; k++) s += centre.B[a][k] * ue[k]; strain[a] = s; }
    strain[0] -= eth; strain[1] -= eth; strain[2] -= eth;     // subtract thermal strain
    const sig = new Float64Array(6);
    for (let a = 0; a < 6; a++) { let s = 0; for (let b = 0; b < 6; b++) s += D[a][b] * strain[b]; sig[a] = s; }
    elementStress.push(sig);
    const tr = (sig[0] + sig[1] + sig[2]) / 3;
    const vm = Math.sqrt(1.5 * ((sig[0] - tr) ** 2 + (sig[1] - tr) ** 2 + (sig[2] - tr) ** 2 + 2 * (sig[3] ** 2 + sig[4] ** 2 + sig[5] ** 2)));
    if (vm > maxVM) maxVM = vm;
  }
  return { displacement: u, elementStress, maxVonMises: maxVM };
}
