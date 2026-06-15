/**
 * topology3D — true 3D SIMP topology optimisation (roadmap Track G / G1).
 *
 * The existing optimiser (topologyOptimization.ts) runs a 2D Q4 plane-stress FEA
 * on the Z-averaged cross-section and replicates the result through thickness —
 * it cannot capture a genuinely 3D load path. This is the real thing: 8-node
 * HEXAHEDRAL (HEX8) brick elements on the voxel grid, a 3D linear-elastic solve
 * each iteration (matrix-free element-by-element CG — no global assembly, so the
 * memory stays O(elements)), modified-SIMP density penalisation, a 3D sensitivity
 * filter, and the Optimality-Criteria update with a volume constraint.
 *
 * Pure + dependency-free (no THREE), so it unit-tests headlessly.
 */

export type BuildAxis = 'X' | 'Y' | 'Z';

export interface Topology3DConfig {
  nx: number; ny: number; nz: number; // element grid
  volfrac: number;                    // target volume fraction (0..1)
  penal?: number;                     // SIMP penalty p (default 3)
  rmin?: number;                      // filter radius in elements (default 1.5)
  maxIter?: number;                   // OC iterations (default 40)
  nu?: number;                        // Poisson ratio (default 0.3)
  /** Additive-manufacturing build direction. When set, the design is constrained
   *  so every solid element is supported from the build plate within ~45° — i.e.
   *  the result prints WITHOUT support structures. */
  overhang?: BuildAxis;
  /** Minimum-feature-size control via density filtering + Heaviside projection.
   *  The filter radius (rmin) sets the length scale; the projection sharpens the
   *  design to near black-and-white so no member is thinner than the tool/nozzle.
   *  `beta` controls sharpness (higher ⇒ more discrete). When set, the optimiser
   *  uses the density-filter + projection path instead of sensitivity filtering. */
  projection?: { beta?: number; eta?: number };
  /** Passive (non-design) regions, by element index. `solid` is forced full —
   *  mounting bosses, bearing seats — `void` is forced empty — clearance holes,
   *  keep-out zones. The optimiser routes material around them. */
  passiveSolid?: Iterable<number>;
  passiveVoid?: Iterable<number>;
}

export interface BoundaryConditions3D {
  /** Fixed (all-DOF) node ids. */
  fixed: Set<number>;
  /** Point loads: [globalDof, value]. */
  loads: Array<[number, number]>;
}

export interface Topology3DResult {
  density: Float32Array;          // nx*ny*nz, element-major (x fastest? see eIdx)
  complianceHistory: number[];    // compliance per iteration
  volumeFraction: number;         // final realised fraction
  iterations: number;
}

// ─── HEX8 element stiffness for a unit cube, E = 1 ──────────────────────────

/** Corner offsets (dx,dy,dz) → local node order; natural coord = 2·offset − 1. */
const HEX_CORNERS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];

export function buildHex8K0(nu: number): Float64Array {
  const lam = nu / ((1 + nu) * (1 - 2 * nu)), mu = 1 / (2 * (1 + nu)); // E = 1
  const D = [
    [lam + 2*mu, lam, lam, 0, 0, 0], [lam, lam + 2*mu, lam, 0, 0, 0], [lam, lam, lam + 2*mu, 0, 0, 0],
    [0, 0, 0, mu, 0, 0], [0, 0, 0, 0, mu, 0], [0, 0, 0, 0, 0, mu],
  ];
  const g = 1 / Math.sqrt(3);
  const gp = [-g, g];
  const K0 = new Float64Array(24 * 24);
  const xi = HEX_CORNERS.map((c) => 2 * c[0] - 1);
  const eta = HEX_CORNERS.map((c) => 2 * c[1] - 1);
  const zet = HEX_CORNERS.map((c) => 2 * c[2] - 1);

  for (const r of gp) for (const s of gp) for (const t of gp) {
    // shape derivatives wrt natural coords
    const dNr = new Array(8), dNs = new Array(8), dNt = new Array(8);
    for (let i = 0; i < 8; i++) {
      dNr[i] = 0.125 * xi[i] * (1 + eta[i] * s) * (1 + zet[i] * t);
      dNs[i] = 0.125 * (1 + xi[i] * r) * eta[i] * (1 + zet[i] * t);
      dNt[i] = 0.125 * (1 + xi[i] * r) * (1 + eta[i] * s) * zet[i];
    }
    // unit cube: x = (ξ+1)/2 → J = 0.5·I, detJ = 0.125, dN/dx = 2·dN/dξ
    const detJ = 0.125;
    const B = Array.from({ length: 6 }, () => new Float64Array(24));
    for (let i = 0; i < 8; i++) {
      const bx = 2 * dNr[i], by = 2 * dNs[i], bz = 2 * dNt[i];
      const cx = i * 3, cy = i * 3 + 1, cz = i * 3 + 2;
      B[0][cx] = bx; B[1][cy] = by; B[2][cz] = bz;
      B[3][cx] = by; B[3][cy] = bx;
      B[4][cy] = bz; B[4][cz] = by;
      B[5][cx] = bz; B[5][cz] = bx;
    }
    // K0 += detJ · Bᵀ D B  (Gauss weight = 1)
    const DB = Array.from({ length: 6 }, () => new Float64Array(24));
    for (let a = 0; a < 6; a++) for (let j = 0; j < 24; j++) {
      let v = 0; for (let l = 0; l < 6; l++) v += D[a][l] * B[l][j]; DB[a][j] = v;
    }
    for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) {
      let v = 0; for (let a = 0; a < 6; a++) v += B[a][i] * DB[a][j];
      K0[i * 24 + j] += detJ * v;
    }
  }
  return K0;
}

// ─── grid helpers ───────────────────────────────────────────────────────────

const EMIN = 1e-9; // void stiffness floor (modified SIMP) keeps K non-singular

export class TopologyGrid {
  constructor(public nx: number, public ny: number, public nz: number) {}
  node(ix: number, iy: number, iz: number): number {
    return (iz * (this.ny + 1) + iy) * (this.nx + 1) + ix;
  }
  /** The 8 corner node ids of element (ex,ey,ez), in HEX_CORNERS order. */
  elemNodes(ex: number, ey: number, ez: number): number[] {
    return HEX_CORNERS.map(([dx, dy, dz]) => this.node(ex + dx, ey + dy, ez + dz));
  }
  eIdx(ex: number, ey: number, ez: number): number {
    return (ez * this.ny + ey) * this.nx + ex;
  }
  get nNodes(): number { return (this.nx + 1) * (this.ny + 1) * (this.nz + 1); }
  get nElems(): number { return this.nx * this.ny * this.nz; }
}

// ─── matrix-free element-by-element operators ──────────────────────────────

/** y = K(ρ)·x, assembled on the fly. Fixed DOFs are projected out (u=0). */
function applyK(
  grid: TopologyGrid, K0: Float64Array, xE: Float32Array, p: number,
  x: Float64Array, fixed: Uint8Array, out: Float64Array,
): void {
  out.fill(0);
  const edof = new Int32Array(24);
  for (let ez = 0; ez < grid.nz; ez++) for (let ey = 0; ey < grid.ny; ey++) for (let ex = 0; ex < grid.nx; ex++) {
    const ns = grid.elemNodes(ex, ey, ez);
    for (let i = 0; i < 8; i++) { edof[i*3] = ns[i]*3; edof[i*3+1] = ns[i]*3+1; edof[i*3+2] = ns[i]*3+2; }
    const scale = EMIN + Math.pow(xE[grid.eIdx(ex, ey, ez)], p) * (1 - EMIN);
    for (let i = 0; i < 24; i++) {
      const di = edof[i];
      if (fixed[di]) continue;
      let s = 0;
      const row = i * 24;
      for (let j = 0; j < 24; j++) {
        const dj = edof[j];
        if (fixed[dj]) continue;
        s += K0[row + j] * x[dj];
      }
      out[di] += scale * s;
    }
  }
}

/** Jacobi (diagonal) preconditioner of K(ρ). */
function buildDiag(grid: TopologyGrid, K0: Float64Array, xE: Float32Array, p: number, fixed: Uint8Array): Float64Array {
  const diag = new Float64Array(grid.nNodes * 3);
  const edof = new Int32Array(24);
  for (let ez = 0; ez < grid.nz; ez++) for (let ey = 0; ey < grid.ny; ey++) for (let ex = 0; ex < grid.nx; ex++) {
    const ns = grid.elemNodes(ex, ey, ez);
    for (let i = 0; i < 8; i++) { edof[i*3] = ns[i]*3; edof[i*3+1] = ns[i]*3+1; edof[i*3+2] = ns[i]*3+2; }
    const scale = EMIN + Math.pow(xE[grid.eIdx(ex, ey, ez)], p) * (1 - EMIN);
    for (let i = 0; i < 24; i++) diag[edof[i]] += scale * K0[i * 24 + i];
  }
  for (let i = 0; i < diag.length; i++) if (fixed[i] || diag[i] === 0) diag[i] = 1;
  return diag;
}

function pcg(
  grid: TopologyGrid, K0: Float64Array, xE: Float32Array, p: number,
  f: Float64Array, fixed: Uint8Array, maxIter = 400, tol = 1e-8,
): Float64Array {
  const n = f.length;
  const diag = buildDiag(grid, K0, xE, p, fixed);
  const Minv = diag.map((d) => 1 / d) as Float64Array;
  const u = new Float64Array(n);
  const r = f.slice();
  for (let i = 0; i < n; i++) if (fixed[i]) r[i] = 0;
  const z = new Float64Array(n); for (let i = 0; i < n; i++) z[i] = r[i] * Minv[i];
  const pv = z.slice();
  const Ap = new Float64Array(n);
  let rz = dot(r, z);
  const r0 = Math.sqrt(dot(r, r)) || 1;
  for (let it = 0; it < maxIter; it++) {
    applyK(grid, K0, xE, p, pv, fixed, Ap);
    const alpha = rz / (dot(pv, Ap) || 1e-30);
    for (let i = 0; i < n; i++) { u[i] += alpha * pv[i]; r[i] -= alpha * Ap[i]; }
    if (Math.sqrt(dot(r, r)) / r0 < tol) break;
    for (let i = 0; i < n; i++) z[i] = r[i] * Minv[i];
    const rzNew = dot(r, z);
    const beta = rzNew / rz;
    for (let i = 0; i < n; i++) pv[i] = z[i] + beta * pv[i];
    rz = rzNew;
  }
  return u;
}

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s;
}

// ─── density filter (sensitivity smoothing, kills checkerboarding) ──────────

function buildFilter(grid: TopologyGrid, rmin: number): { idx: Int32Array[]; w: Float64Array[] } {
  const idx: Int32Array[] = [], w: Float64Array[] = [];
  const R = Math.ceil(rmin);
  for (let ez = 0; ez < grid.nz; ez++) for (let ey = 0; ey < grid.ny; ey++) for (let ex = 0; ex < grid.nx; ex++) {
    const is: number[] = [], ws: number[] = [];
    for (let kz = Math.max(0, ez-R); kz <= Math.min(grid.nz-1, ez+R); kz++)
    for (let ky = Math.max(0, ey-R); ky <= Math.min(grid.ny-1, ey+R); ky++)
    for (let kx = Math.max(0, ex-R); kx <= Math.min(grid.nx-1, ex+R); kx++) {
      const dist = Math.hypot(ex-kx, ey-ky, ez-kz);
      if (dist > rmin) continue;
      is.push(grid.eIdx(kx, ky, kz)); ws.push(rmin - dist);
    }
    idx.push(new Int32Array(is)); w.push(new Float64Array(ws));
  }
  return { idx, w };
}

// ─── additive-manufacturing overhang filter (Langelaar-style) ───────────────

const axisIdxOf = (a: BuildAxis): number => (a === 'X' ? 0 : a === 'Y' ? 1 : 2);

/** Smooth max via log-sum-exp (numerically stabilised). P→∞ ⇒ hard max. */
function smax(vals: number[], P: number): number {
  if (vals.length === 0) return 0;
  let m = vals[0];
  for (const v of vals) if (v > m) m = v;
  let s = 0;
  for (const v of vals) s += Math.exp(P * (v - m));
  return m + Math.log(s) / P;
}
const smin = (a: number, b: number, P: number): number => -smax([-a, -b], P);

/**
 * Printable-density transform: every layer above the build plate may only be as
 * solid as the material SUPPORTING it from the layer below (the directly-below
 * element + its 4 face-neighbours ≈ a 45° support cone). So a floating overhang
 * is suppressed — the result prints without supports. Build plate = the `axis=0`
 * face. `P` controls how sharp the smooth min/max is.
 */
export function amOverhangFilter(
  density: Float32Array, grid: TopologyGrid, axis: BuildAxis, P = 50, hard = false,
): Float32Array {
  const dims = [grid.nx, grid.ny, grid.nz];
  const ai = axisIdxOf(axis);
  const [p0, p1] = [0, 1, 2].filter((d) => d !== ai); // the two perpendicular axes
  const nLayers = dims[ai];
  const printable = Float32Array.from(density);
  const at = (c: number[]): number => grid.eIdx(c[0], c[1], c[2]);
  // Smooth min/max for gradient flow during optimisation; hard min/max for the
  // final projection, which GUARANTEES a support-free result (printable ≤ the max
  // support below ⇒ a solid element always has a solid element below it).
  const sMax = (v: number[]) => (hard ? Math.max(...v) : smax(v, P));
  const sMin = (a: number, b: number) => (hard ? Math.min(a, b) : smin(a, b, P));

  for (let layer = 1; layer < nLayers; layer++) {
    for (let a = 0; a < dims[p0]; a++) {
      for (let b = 0; b < dims[p1]; b++) {
        const c = [0, 0, 0];
        c[ai] = layer; c[p0] = a; c[p1] = b;
        const support: number[] = [];
        for (const [da, db] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const sa = a + da, sb = b + db;
          if (sa < 0 || sb < 0 || sa >= dims[p0] || sb >= dims[p1]) continue;
          const sc = [0, 0, 0];
          sc[ai] = layer - 1; sc[p0] = sa; sc[p1] = sb;
          support.push(printable[at(sc)]);
        }
        printable[at(c)] = sMin(density[at(c)], support.length ? sMax(support) : 0);
      }
    }
  }
  return printable;
}

/** Count solid elements (> threshold) that lack any solid support directly below
 *  within the 45° stencil — i.e. unprintable overhangs. 0 ⇒ support-free print. */
export function countUnsupportedOverhang(
  density: Float32Array, grid: TopologyGrid, axis: BuildAxis, threshold = 0.5,
): number {
  const dims = [grid.nx, grid.ny, grid.nz];
  const ai = axisIdxOf(axis);
  const [p0, p1] = [0, 1, 2].filter((d) => d !== ai);
  const at = (c: number[]): number => grid.eIdx(c[0], c[1], c[2]);
  let count = 0;
  for (let layer = 1; layer < dims[ai]; layer++) {
    for (let a = 0; a < dims[p0]; a++) for (let b = 0; b < dims[p1]; b++) {
      const c = [0, 0, 0]; c[ai] = layer; c[p0] = a; c[p1] = b;
      if (density[at(c)] <= threshold) continue;
      let supported = false;
      for (const [da, db] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const sa = a + da, sb = b + db;
        if (sa < 0 || sb < 0 || sa >= dims[p0] || sb >= dims[p1]) continue;
        const sc = [0, 0, 0]; sc[ai] = layer - 1; sc[p0] = sa; sc[p1] = sb;
        if (density[at(sc)] > threshold) { supported = true; break; }
      }
      if (!supported) count++;
    }
  }
  return count;
}

// ─── minimum-feature-size: density filter + Heaviside projection ────────────

type Filter = { idx: Int32Array[]; w: Float64Array[] };

/** Density filter x̃ = (H x)/(Hs). Smooths features below the radius — the basis
 *  for a minimum length scale (combined with projection). */
function densityFilter(x: Float32Array, filter: Filter): Float32Array {
  const out = new Float32Array(x.length);
  for (let e = 0; e < x.length; e++) {
    const ii = filter.idx[e], ww = filter.w[e];
    let num = 0, den = 0;
    for (let k = 0; k < ii.length; k++) { num += ww[k] * x[ii[k]]; den += ww[k]; }
    out[e] = num / den;
  }
  return out;
}

/** Transpose of the density filter applied to a chained sensitivity dc/dx̃. */
function densityFilterT(g: Float64Array, filter: Filter): Float64Array {
  const out = new Float64Array(g.length);
  for (let e = 0; e < g.length; e++) {
    const ii = filter.idx[e], ww = filter.w[e];
    let den = 0; for (let k = 0; k < ii.length; k++) den += ww[k];
    const ge = g[e] / den;
    for (let k = 0; k < ii.length; k++) out[ii[k]] += ww[k] * ge;
  }
  return out;
}

const HS_DEN = (beta: number, eta: number) => Math.tanh(beta * eta) + Math.tanh(beta * (1 - eta));
/** Smooth Heaviside projection: pushes x̃ toward 0/1 about the threshold η. */
function heaviside(x: number, beta: number, eta: number): number {
  return (Math.tanh(beta * eta) + Math.tanh(beta * (x - eta))) / HS_DEN(beta, eta);
}
/** d(projection)/dx̃. */
function dHeaviside(x: number, beta: number, eta: number): number {
  const s = Math.tanh(beta * (x - eta));
  return (beta * (1 - s * s)) / HS_DEN(beta, eta);
}

// ─── the optimiser ──────────────────────────────────────────────────────────

export function optimizeTopology3D(cfg: Topology3DConfig, bc: BoundaryConditions3D): Topology3DResult {
  const p = cfg.penal ?? 3, rmin = cfg.rmin ?? 1.5, maxIter = cfg.maxIter ?? 40, nu = cfg.nu ?? 0.3;
  const grid = new TopologyGrid(cfg.nx, cfg.ny, cfg.nz);
  const K0 = buildHex8K0(nu);
  const nE = grid.nElems, nDof = grid.nNodes * 3;

  const fixed = new Uint8Array(nDof);
  for (const nodeId of bc.fixed) { fixed[nodeId*3] = 1; fixed[nodeId*3+1] = 1; fixed[nodeId*3+2] = 1; }
  const f = new Float64Array(nDof);
  for (const [d, v] of bc.loads) f[d] += v;

  const filter = buildFilter(grid, rmin);
  const pSolid = new Set<number>(cfg.passiveSolid ?? []);
  const pVoid = new Set<number>(cfg.passiveVoid ?? []);
  const applyPassive = (x: Float32Array): Float32Array => {
    for (const e of pSolid) x[e] = 1;
    for (const e of pVoid) x[e] = 0;
    return x;
  };
  let xE = applyPassive(new Float32Array(nE).fill(cfg.volfrac));
  const complianceHistory: number[] = [];
  const proj = cfg.projection;
  const betaMax = proj?.beta ?? 16, eta = proj?.eta ?? 0.5;
  // β-continuation: start soft (≈ no projection) and sharpen toward betaMax so the
  // design goes black-and-white gradually — a fixed high β traps the optimiser in
  // a poor local minimum.
  const betaAt = (it: number) => Math.min(betaMax, Math.pow(2, Math.floor(it / Math.max(1, Math.floor(maxIter / 5)))));

  let iter = 0;
  for (; iter < maxIter; iter++) {
    const beta = betaAt(iter);
    // Physical density seen by the FEA:
    //  - projection: density-filter (length scale) then Heaviside-project (discrete);
    //  - overhang: suppress unsupported material;
    //  - else: the design density itself.
    let xTilde: Float32Array | null = null;
    let xPhys: Float32Array;
    if (proj) {
      xTilde = densityFilter(xE, filter);
      xPhys = new Float32Array(nE);
      for (let e = 0; e < nE; e++) xPhys[e] = heaviside(xTilde[e], beta, eta);
    } else {
      xPhys = cfg.overhang ? amOverhangFilter(xE, grid, cfg.overhang) : xE;
    }
    if (pSolid.size || pVoid.size) { xPhys = xPhys === xE ? Float32Array.from(xE) : xPhys; applyPassive(xPhys); }
    const u = pcg(grid, K0, xPhys, p, f, fixed);

    // Element compliance + raw sensitivity (wrt the physical density).
    const dc = new Float64Array(nE);
    let compliance = 0;
    const edof = new Int32Array(24), ue = new Float64Array(24);
    for (let ez = 0; ez < grid.nz; ez++) for (let ey = 0; ey < grid.ny; ey++) for (let ex = 0; ex < grid.nx; ex++) {
      const ns = grid.elemNodes(ex, ey, ez);
      for (let i = 0; i < 8; i++) { edof[i*3]=ns[i]*3; edof[i*3+1]=ns[i]*3+1; edof[i*3+2]=ns[i]*3+2; }
      for (let i = 0; i < 24; i++) ue[i] = u[edof[i]];
      let ueKue = 0;
      for (let i = 0; i < 24; i++) { let s = 0; const row = i*24; for (let j = 0; j < 24; j++) s += K0[row+j]*ue[j]; ueKue += ue[i]*s; }
      const e = grid.eIdx(ex, ey, ez);
      const dens = Math.pow(xPhys[e], p);
      compliance += (EMIN + dens * (1 - EMIN)) * ueKue;
      dc[e] = -p * Math.pow(xPhys[e], p - 1) * (1 - EMIN) * ueKue;
    }
    complianceHistory.push(compliance);

    // Sensitivity wrt the DESIGN variable.
    let dcf: Float64Array;
    if (proj && xTilde) {
      // Chain through the projection (dc/dx̃ = dc/dxPhys · H′) then the filter transpose.
      const dcChain = new Float64Array(nE);
      for (let e = 0; e < nE; e++) dcChain[e] = dc[e] * dHeaviside(xTilde[e], beta, eta);
      dcf = densityFilterT(dcChain, filter);
    } else {
      // Sensitivity filtering: (Σ w·x·dc)/(x·Σ w).
      dcf = new Float64Array(nE);
      for (let e = 0; e < nE; e++) {
        let num = 0, den = 0;
        const ii = filter.idx[e], ww = filter.w[e];
        for (let k = 0; k < ii.length; k++) { num += ww[k] * xPhys[ii[k]] * dc[ii[k]]; den += ww[k]; }
        dcf[e] = num / (Math.max(1e-9, xPhys[e]) * den);
      }
    }

    // Optimality-Criteria update with a bisection on the Lagrange multiplier.
    let lo = 1e-9, hi = 1e9;
    const xNew = new Float32Array(nE);
    const move = 0.2;
    while ((hi - lo) / (0.5 * (hi + lo)) > 1e-3) {
      const lmid = 0.5 * (lo + hi);
      let vol = 0;
      for (let e = 0; e < nE; e++) {
        const be = Math.sqrt(Math.max(0, -dcf[e] / lmid));
        let xe = xE[e] * be;
        xe = Math.min(xE[e] + move, Math.min(1, Math.max(xE[e] - move, Math.max(0, xe))));
        xNew[e] = xe; vol += xe;
      }
      if (vol / nE > cfg.volfrac) lo = lmid; else hi = lmid;
    }
    applyPassive(xNew); // keep-in/keep-out regions are not design variables
    let change = 0;
    for (let e = 0; e < nE; e++) { change = Math.max(change, Math.abs(xNew[e] - xE[e])); }
    xE = xNew;
    if (change < 0.01) { iter++; break; }
  }

  // Final physical design: projected (min-feature) → overhang-hard-projected → raw.
  let out: Float32Array;
  if (proj) {
    const xt = densityFilter(xE, filter);
    out = new Float32Array(nE);
    for (let e = 0; e < nE; e++) out[e] = heaviside(xt[e], betaMax, eta);
  } else if (cfg.overhang) {
    out = amOverhangFilter(xE, grid, cfg.overhang, 50, true); // hard ⇒ guaranteed support-free
  } else {
    out = Float32Array.from(xE);
  }
  applyPassive(out); // passive regions are exact in the final design too
  let vol = 0; for (let e = 0; e < nE; e++) vol += out[e];
  return { density: out, complianceHistory, volumeFraction: vol / nE, iterations: iter };
}

/** Cantilever BC helper: the x=0 face fully fixed, a downward (−Y) point load
 *  distributed over the x=nx face's mid-height edge. */
export function cantileverBC(grid: TopologyGrid, totalLoad = -1): BoundaryConditions3D {
  const fixed = new Set<number>();
  for (let iy = 0; iy <= grid.ny; iy++) for (let iz = 0; iz <= grid.nz; iz++) fixed.add(grid.node(0, iy, iz));
  const loads: Array<[number, number]> = [];
  const tipNodes: number[] = [];
  for (let iz = 0; iz <= grid.nz; iz++) tipNodes.push(grid.node(grid.nx, 0, iz)); // bottom edge of free end
  for (const n of tipNodes) loads.push([n * 3 + 1, totalLoad / tipNodes.length]);
  return { fixed, loads };
}
