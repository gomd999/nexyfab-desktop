/**
 * plateMindlin.ts — 4-node Mindlin–Reissner plate-bending element with SELECTIVE
 * REDUCED INTEGRATION, the efficient way to bend thin/thick plates without the
 * shear locking that cripples low-order solid elements in bending.
 *
 *   DOF/node:   (w, φx, φy)   — transverse deflection + normal rotations
 *   bending:    κ = [φx,x, φy,y, φx,y+φy,x],  energy ∫ κᵀ D_b κ,  D_b = D·[[1,ν,0],[ν,1,0],[0,0,(1-ν)/2]]
 *   shear:      γ = [w,x+φx, w,y+φy],          energy ∫ γᵀ D_s γ,  D_s = κ_s·G·t·I
 *   D = E t³ / (12(1−ν²))  (flexural rigidity),  κ_s = 5/6 (shear correction)
 *
 * Bending is integrated 2×2; transverse shear 1×1 (reduced) — so as t/L → 0 the
 * element converges to thin-plate (Kirchhoff) theory. Verified against the
 * Timoshenko series solution for a simply-supported square plate.
 */

export interface PlateOptions {
  nx: number; ny: number;          // element counts
  lx: number; ly: number;          // element sizes (plate side = nx·lx etc.)
  E: number; nu: number; thickness: number;
  /** Uniform transverse pressure q (force/area). */
  pressure?: number;
  /** Transverse point load (value, x, y) added to the nearest node. */
  pointLoad?: { value: number; x: number; y: number };
  /** Edges with w = 0 (simply supported). Default: all four. */
  supportedEdges?: { xMin?: boolean; xMax?: boolean; yMin?: boolean; yMax?: boolean };
  /** Also clamp rotations on supported edges (built-in instead of simply supported). */
  clamped?: boolean;
}

export interface PlateResult {
  /** Nodal transverse deflection w, indexed node = j·(nx+1)+i. */
  w: Float64Array;
  maxDeflection: number;
  nodeW: (i: number, j: number) => number;
}

const G2 = [-1 / Math.sqrt(3), 1 / Math.sqrt(3)];

/** Bilinear shape values + x/y derivatives at natural (ξ,η) on an lx×ly rectangle. */
function shape(xi: number, eta: number, lx: number, ly: number) {
  const N = [0.25 * (1 - xi) * (1 - eta), 0.25 * (1 + xi) * (1 - eta), 0.25 * (1 + xi) * (1 + eta), 0.25 * (1 - xi) * (1 + eta)];
  const dNxi = [-0.25 * (1 - eta), 0.25 * (1 - eta), 0.25 * (1 + eta), -0.25 * (1 + eta)];
  const dNeta = [-0.25 * (1 - xi), -0.25 * (1 + xi), 0.25 * (1 + xi), 0.25 * (1 - xi)];
  const Nx = dNxi.map((d) => d * (2 / lx));
  const Ny = dNeta.map((d) => d * (2 / ly));
  return { N, Nx, Ny };
}

function cgSolve(K: Float64Array, b: Float64Array, n: number): Float64Array {
  const x = new Float64Array(n), r = Float64Array.from(b);
  const Minv = new Float64Array(n);
  for (let i = 0; i < n; i++) { const d = K[i * n + i]; Minv[i] = d !== 0 ? 1 / d : 1; }
  const z = new Float64Array(n); for (let i = 0; i < n; i++) z[i] = r[i] * Minv[i];
  const p = Float64Array.from(z), Ap = new Float64Array(n);
  const dot = (u: Float64Array, v: Float64Array) => { let s = 0; for (let i = 0; i < n; i++) s += u[i] * v[i]; return s; };
  let rz = dot(r, z); const b2 = Math.max(dot(b, b), 1e-300);
  for (let it = 0; it < Math.max(1000, n * 3); it++) {
    for (let i = 0; i < n; i++) { const row = i * n; let s = 0; for (let j = 0; j < n; j++) s += K[row + j] * p[j]; Ap[i] = s; }
    const alpha = rz / (dot(p, Ap) || 1e-300);
    for (let i = 0; i < n; i++) { x[i] += alpha * p[i]; r[i] -= alpha * Ap[i]; }
    if (dot(r, r) / b2 < 1e-24) break;
    for (let i = 0; i < n; i++) z[i] = r[i] * Minv[i];
    const rzNew = dot(r, z); const beta = rzNew / (rz || 1e-300);
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i]; rz = rzNew;
  }
  return x;
}

/** Solve a rectangular Mindlin plate under pressure / point load. */
export function mindlinPlateSolve(opts: PlateOptions): PlateResult {
  const { nx, ny, lx, ly, E, nu, thickness: t } = opts;
  const nNodesX = nx + 1, nNodesY = ny + 1, nNodes = nNodesX * nNodesY, nDof = nNodes * 3;
  const node = (i: number, j: number) => j * nNodesX + i;
  const D = (E * t ** 3) / (12 * (1 - nu * nu));
  const Db = [[D, D * nu, 0], [D * nu, D, 0], [0, 0, D * (1 - nu) / 2]];
  const G = E / (2 * (1 + nu)), ks = 5 / 6, Ds = ks * G * t;
  const area = lx * ly;

  const K = new Float64Array(nDof * nDof);
  const addKe = (ns: number[], Ke: number[][]) => {
    const map = new Array<number>(12);
    for (let a = 0; a < 4; a++) { map[a * 3] = ns[a] * 3; map[a * 3 + 1] = ns[a] * 3 + 1; map[a * 3 + 2] = ns[a] * 3 + 2; }
    for (let p = 0; p < 12; p++) { const row = map[p] * nDof; for (let q = 0; q < 12; q++) K[row + map[q]] += Ke[p][q]; }
  };

  for (let ey = 0; ey < ny; ey++) for (let ex = 0; ex < nx; ex++) {
    const ns = [node(ex, ey), node(ex + 1, ey), node(ex + 1, ey + 1), node(ex, ey + 1)];
    const Ke = Array.from({ length: 12 }, () => new Array<number>(12).fill(0));

    // bending: 2×2 Gauss
    for (const xi of G2) for (const eta of G2) {
      const { Nx, Ny } = shape(xi, eta, lx, ly);
      const Bb = Array.from({ length: 3 }, () => new Array<number>(12).fill(0));
      for (let a = 0; a < 4; a++) {
        Bb[0][a * 3 + 1] = Nx[a];               // κx = φx,x
        Bb[1][a * 3 + 2] = Ny[a];               // κy = φy,y
        Bb[2][a * 3 + 1] = Ny[a]; Bb[2][a * 3 + 2] = Nx[a]; // κxy
      }
      const wgt = area / 4;                      // detJ·(1·1)
      for (let p = 0; p < 12; p++) for (let q = 0; q < 12; q++) {
        let s = 0; for (let r = 0; r < 3; r++) { let dbq = 0; for (let c = 0; c < 3; c++) dbq += Db[r][c] * Bb[c][q]; s += Bb[r][p] * dbq; }
        Ke[p][q] += s * wgt;
      }
    }

    // transverse shear: 1×1 reduced Gauss (centre)
    {
      const { N, Nx, Ny } = shape(0, 0, lx, ly);
      const Bs = Array.from({ length: 2 }, () => new Array<number>(12).fill(0));
      for (let a = 0; a < 4; a++) {
        Bs[0][a * 3] = Nx[a]; Bs[0][a * 3 + 1] = N[a];   // γxz = w,x + φx
        Bs[1][a * 3] = Ny[a]; Bs[1][a * 3 + 2] = N[a];   // γyz = w,y + φy
      }
      const wgt = area;                          // 1-point rule over the element
      for (let p = 0; p < 12; p++) for (let q = 0; q < 12; q++) {
        Ke[p][q] += Ds * (Bs[0][p] * Bs[0][q] + Bs[1][p] * Bs[1][q]) * wgt;
      }
    }
    addKe(ns, Ke);
  }

  // loads (transverse, on the w DOF)
  const f = new Float64Array(nDof);
  if (opts.pressure) {
    const per = (opts.pressure * area) / 4;
    for (let ey = 0; ey < ny; ey++) for (let ex = 0; ex < nx; ex++)
      for (const nd of [node(ex, ey), node(ex + 1, ey), node(ex + 1, ey + 1), node(ex, ey + 1)]) f[nd * 3] += per;
  }
  if (opts.pointLoad) {
    const i = Math.round(opts.pointLoad.x / lx), j = Math.round(opts.pointLoad.y / ly);
    f[node(i, j) * 3] += opts.pointLoad.value;
  }

  // boundary conditions
  const sup = opts.supportedEdges ?? { xMin: true, xMax: true, yMin: true, yMax: true };
  const fixed = new Uint8Array(nDof);
  const fixNode = (i: number, j: number) => {
    fixed[node(i, j) * 3] = 1;                   // w = 0
    if (opts.clamped) { fixed[node(i, j) * 3 + 1] = 1; fixed[node(i, j) * 3 + 2] = 1; }
  };
  for (let i = 0; i < nNodesX; i++) { if (sup.yMin) fixNode(i, 0); if (sup.yMax) fixNode(i, ny); }
  for (let j = 0; j < nNodesY; j++) { if (sup.xMin) fixNode(0, j); if (sup.xMax) fixNode(nx, j); }

  // reduce + solve
  const freeIdx = new Int32Array(nDof).fill(-1);
  let nFree = 0;
  for (let d = 0; d < nDof; d++) if (!fixed[d]) freeIdx[d] = nFree++;
  const Kff = new Float64Array(nFree * nFree), bf = new Float64Array(nFree);
  for (let d = 0; d < nDof; d++) {
    const rd = freeIdx[d]; if (rd < 0) continue;
    bf[rd] = f[d];
    const row = d * nDof;
    for (let e = 0; e < nDof; e++) { const re = freeIdx[e]; if (re >= 0) Kff[rd * nFree + re] = K[row + e]; }
  }
  const uf = cgSolve(Kff, bf, nFree);

  const w = new Float64Array(nNodes);
  let maxAbs = 0, maxSigned = 0;
  for (let nd = 0; nd < nNodes; nd++) {
    const d = nd * 3, rd = freeIdx[d];
    const val = rd >= 0 ? uf[rd] : 0;
    w[nd] = val;
    if (Math.abs(val) > maxAbs) { maxAbs = Math.abs(val); maxSigned = val; }
  }
  return { w, maxDeflection: maxSigned, nodeW: (i, j) => w[node(i, j)] };
}
