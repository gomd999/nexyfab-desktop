/**
 * buckling.ts — linear (eigenvalue) buckling on the HEX8 FEM kernel.
 *
 * Solves the geometric-stiffness eigenproblem  K φ = λ (−K_g) φ  for the lowest
 * positive load factor λ_cr: the multiplier on the reference stress state at which
 * the structure first buckles. K is the elastic stiffness (reused HEX8 element);
 * K_g is the geometric (stress) stiffness built from a reference stress field.
 *
 * v1 takes a UNIFORM reference stress tensor over the domain — the classic Euler
 * column assumption (uniform axial compression). Verified against the analytic
 * Euler buckling load. Deriving a non-uniform prestress from a coupled static
 * solve is a documented follow-up.
 *
 * Consistent units (N, mm, MPa = N/mm²): E in MPa, stress in MPa, cell in mm.
 */
import { TopologyGrid, buildHex8K0 } from '../analysis/topology3D';

const HEX_CORNERS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];

/** Reference stress tensor (MPa), constant over the domain. Compression negative. */
export interface StressTensor { xx: number; yy: number; zz: number; xy?: number; yz?: number; zx?: number }

/**
 * 8×8 geometric-stiffness "scalar" matrix of a unit cube under a constant stress:
 * kg(a,b) = ∫ ∇N_a · (σ ∇N_b) dV  via 2×2×2 Gauss. (Couples same-direction DOFs.)
 */
export function buildHex8Geom0(s: StressTensor): Float64Array {
  const sxx = s.xx, syy = s.yy, szz = s.zz, sxy = s.xy ?? 0, syz = s.yz ?? 0, szx = s.zx ?? 0;
  const g = 1 / Math.sqrt(3), gp = [-g, g];
  const xi = HEX_CORNERS.map((c) => 2 * c[0] - 1);
  const eta = HEX_CORNERS.map((c) => 2 * c[1] - 1);
  const zet = HEX_CORNERS.map((c) => 2 * c[2] - 1);
  const K0 = new Float64Array(64);
  for (const r of gp) for (const s2 of gp) for (const t of gp) {
    const dNx = new Array<number>(8), dNy = new Array<number>(8), dNz = new Array<number>(8);
    for (let i = 0; i < 8; i++) {
      // unit cube: x = (ξ+1)/2 ⇒ dN/dx = 2·dN/dξ
      dNx[i] = 2 * 0.125 * xi[i] * (1 + eta[i] * s2) * (1 + zet[i] * t);
      dNy[i] = 2 * 0.125 * (1 + xi[i] * r) * eta[i] * (1 + zet[i] * t);
      dNz[i] = 2 * 0.125 * (1 + xi[i] * r) * (1 + eta[i] * s2) * zet[i];
    }
    const detJ = 0.125;
    for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) {
      // ∇N_a · σ ∇N_b
      const sb_x = sxx * dNx[b] + sxy * dNy[b] + szx * dNz[b];
      const sb_y = sxy * dNx[b] + syy * dNy[b] + syz * dNz[b];
      const sb_z = szx * dNx[b] + syz * dNy[b] + szz * dNz[b];
      K0[a * 8 + b] += detJ * (dNx[a] * sb_x + dNy[a] * sb_y + dNz[a] * sb_z);
    }
  }
  return K0;
}

export interface BucklingOptions {
  E: number;        // Young's modulus (MPa)
  nu: number;       // Poisson ratio
  cell: number;     // voxel size (mm)
  fixed: Set<number>; // fully-fixed node ids
  /** Reference stress (MPa), uniform over the domain. */
  prestress: StressTensor;
  /** Inverse-iteration count (default 200). */
  iters?: number;
}

export interface BucklingResult {
  /** Critical load factor λ_cr: buckling stress = λ_cr · |reference stress|. */
  criticalLoadFactor: number;
  /** Buckling mode shape (free-DOF vector). */
  mode: Float64Array;
  nFree: number;
}

/** Dense SPD CG solve K x = b (K row-major n×n). */
function cgSolve(K: Float64Array, b: Float64Array, n: number, iters = Math.max(300, n * 2), tol = 1e-10): Float64Array {
  const x = new Float64Array(n), r = Float64Array.from(b);
  const Minv = new Float64Array(n);
  for (let i = 0; i < n; i++) { const d = K[i * n + i]; Minv[i] = d !== 0 ? 1 / d : 1; }
  const z = new Float64Array(n); for (let i = 0; i < n; i++) z[i] = r[i] * Minv[i];
  const p = Float64Array.from(z);
  const dot = (u: Float64Array, v: Float64Array) => { let s = 0; for (let i = 0; i < n; i++) s += u[i] * v[i]; return s; };
  let rz = dot(r, z); const b2 = Math.max(dot(b, b), 1e-300);
  const Ap = new Float64Array(n);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) { const row = i * n; let s = 0; for (let j = 0; j < n; j++) s += K[row + j] * p[j]; Ap[i] = s; }
    const alpha = rz / (dot(p, Ap) || 1e-300);
    for (let i = 0; i < n; i++) { x[i] += alpha * p[i]; r[i] -= alpha * Ap[i]; }
    if (dot(r, r) / b2 < tol * tol) break;
    for (let i = 0; i < n; i++) z[i] = r[i] * Minv[i];
    const rzNew = dot(r, z);
    const beta = rzNew / (rz || 1e-300);
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
    rz = rzNew;
  }
  return x;
}

/**
 * Lowest positive buckling load factor of a uniform solid grid under a uniform
 * reference stress. Inverse power iteration on K φ = λ B φ with B = −K_g converges
 * to the smallest λ (the critical factor) via the Rayleigh quotient.
 */
export function hex8LinearBuckling(grid: TopologyGrid, opts: BucklingOptions): BucklingResult {
  const K0 = buildHex8K0(opts.nu);                 // unit cube, E = 1
  const KG0 = buildHex8Geom0(opts.prestress);      // unit cube geometric (scalar per node pair)
  const h = opts.cell;
  const kScale = opts.E * h;                        // K_e = E·h·K0
  const gScale = h;                                 // K_g element = h · (stress already in KG0)

  const nDof = grid.nNodes * 3;
  const fixedDof = new Uint8Array(nDof);
  for (const nd of opts.fixed) { fixedDof[nd * 3] = 1; fixedDof[nd * 3 + 1] = 1; fixedDof[nd * 3 + 2] = 1; }
  const freeIdx = new Int32Array(nDof).fill(-1);
  let nFree = 0;
  for (let d = 0; d < nDof; d++) if (!fixedDof[d]) freeIdx[d] = nFree++;
  if (nFree === 0) return { criticalLoadFactor: 0, mode: new Float64Array(0), nFree: 0 };

  const K = new Float64Array(nFree * nFree);
  const B = new Float64Array(nFree * nFree);        // B = −K_g
  const edof = new Int32Array(24);
  const ns = new Int32Array(8);
  for (let ez = 0; ez < grid.nz; ez++) for (let ey = 0; ey < grid.ny; ey++) for (let ex = 0; ex < grid.nx; ex++) {
    const corners = grid.elemNodes(ex, ey, ez);
    for (let i = 0; i < 8; i++) { ns[i] = corners[i]; edof[i * 3] = corners[i] * 3; edof[i * 3 + 1] = corners[i] * 3 + 1; edof[i * 3 + 2] = corners[i] * 3 + 2; }
    // elastic stiffness (full 24×24)
    for (let i = 0; i < 24; i++) {
      const di = freeIdx[edof[i]]; if (di < 0) continue;
      const row = di * nFree, k0row = i * 24;
      for (let j = 0; j < 24; j++) { const dj = freeIdx[edof[j]]; if (dj < 0) continue; K[row + dj] += kScale * K0[k0row + j]; }
    }
    // geometric stiffness: scalar kg(a,b) placed on the 3 same-direction DOF slots
    for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) {
      const kg = gScale * KG0[a * 8 + b];
      if (kg === 0) continue;
      for (let c = 0; c < 3; c++) {
        const di = freeIdx[ns[a] * 3 + c]; if (di < 0) continue;
        const dj = freeIdx[ns[b] * 3 + c]; if (dj < 0) continue;
        B[di * nFree + dj] -= kg;                  // B = −K_g
      }
    }
  }

  // Inverse power iteration: y = K⁻¹ B x → converges to smallest λ of Kφ=λBφ.
  let x: Float64Array = new Float64Array(nFree);
  for (let i = 0; i < nFree; i++) x[i] = Math.sin((i + 1) * 0.7);
  const matB = (v: Float64Array) => { const out = new Float64Array(nFree); for (let i = 0; i < nFree; i++) { const row = i * nFree; let s = 0; for (let j = 0; j < nFree; j++) s += B[row + j] * v[j]; out[i] = s; } return out; };
  const matK = (v: Float64Array) => { const out = new Float64Array(nFree); for (let i = 0; i < nFree; i++) { const row = i * nFree; let s = 0; for (let j = 0; j < nFree; j++) s += K[row + j] * v[j]; out[i] = s; } return out; };
  const dot = (u: Float64Array, v: Float64Array) => { let s = 0; for (let i = 0; i < nFree; i++) s += u[i] * v[i]; return s; };

  let lambda = 0;
  const maxIters = opts.iters ?? 200;
  for (let it = 0; it < maxIters; it++) {
    const bx = matB(x);
    const y = cgSolve(K, bx, nFree);
    const ny = Math.sqrt(dot(y, y));
    if (ny < 1e-30) break;
    for (let i = 0; i < nFree; i++) y[i] /= ny;
    // Rayleigh quotient λ = yᵀ K y / yᵀ B y
    const num = dot(y, matK(y));
    const den = dot(y, matB(y));
    const newLambda = den !== 0 ? num / den : 0;
    x = y;
    if (Math.abs(newLambda - lambda) < 1e-6 * Math.max(1, Math.abs(newLambda))) { lambda = newLambda; break; }
    lambda = newLambda;
  }
  return { criticalLoadFactor: lambda, mode: x, nFree };
}

/** Fully-fix the `axis=0` face of the grid (column root). */
export function fixedRootFace(grid: TopologyGrid, axis: 'x' | 'y' | 'z' = 'x'): Set<number> {
  const fixed = new Set<number>();
  for (let iz = 0; iz <= grid.nz; iz++) for (let iy = 0; iy <= grid.ny; iy++) for (let ix = 0; ix <= grid.nx; ix++) {
    const on = axis === 'x' ? ix === 0 : axis === 'y' ? iy === 0 : iz === 0;
    if (on) fixed.add(grid.node(ix, iy, iz));
  }
  return fixed;
}
