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

  const { lambda, mode } = bucklingEigen(K, B, nFree, opts.iters ?? 200);
  return { criticalLoadFactor: lambda, mode, nFree };
}

/** Inverse power iteration y = K⁻¹ B x → smallest λ of K φ = λ B φ (Rayleigh quotient). */
function bucklingEigen(K: Float64Array, B: Float64Array, nFree: number, maxIters: number): { lambda: number; mode: Float64Array } {
  let x: Float64Array = new Float64Array(nFree);
  for (let i = 0; i < nFree; i++) x[i] = Math.sin((i + 1) * 0.7);
  const mat = (M: Float64Array, v: Float64Array) => { const out = new Float64Array(nFree); for (let i = 0; i < nFree; i++) { const row = i * nFree; let s = 0; for (let j = 0; j < nFree; j++) s += M[row + j] * v[j]; out[i] = s; } return out; };
  const dot = (u: Float64Array, v: Float64Array) => { let s = 0; for (let i = 0; i < nFree; i++) s += u[i] * v[i]; return s; };
  let lambda = 0;
  for (let it = 0; it < maxIters; it++) {
    const y = cgSolve(K, mat(B, x), nFree);
    const ny = Math.sqrt(dot(y, y));
    if (ny < 1e-30) break;
    for (let i = 0; i < nFree; i++) y[i] /= ny;
    const num = dot(y, mat(K, y));
    const den = dot(y, mat(B, y));
    const newLambda = den !== 0 ? num / den : 0;
    x = y;
    if (Math.abs(newLambda - lambda) < 1e-6 * Math.max(1, Math.abs(newLambda))) { lambda = newLambda; break; }
    lambda = newLambda;
  }
  return { lambda, mode: x };
}

/** HEX8 strain-displacement rows (dN/dx,dy,dz per node) at the element CENTRE,
 *  for a cube of size h. At ξ=η=ζ=0: dN_i/dξ = ξ_i/8 ⇒ dN_i/dx = ξ_i/(4h). */
function hex8CentreGrad(h: number): { dNx: number[]; dNy: number[]; dNz: number[] } {
  const dNx: number[] = [], dNy: number[] = [], dNz: number[] = [];
  for (const c of HEX_CORNERS) {
    dNx.push((2 * c[0] - 1) / (4 * h));
    dNy.push((2 * c[1] - 1) / (4 * h));
    dNz.push((2 * c[2] - 1) / (4 * h));
  }
  return { dNx, dNy, dNz };
}

/** Recover the Cauchy stress tensor at an element centre from its nodal displacements. */
function elementStress(ue: Float64Array, grad: { dNx: number[]; dNy: number[]; dNz: number[] }, E: number, nu: number): StressTensor {
  // strain at centre
  let exx = 0, eyy = 0, ezz = 0, gxy = 0, gyz = 0, gzx = 0;
  for (let i = 0; i < 8; i++) {
    const ux = ue[i * 3], uy = ue[i * 3 + 1], uz = ue[i * 3 + 2];
    exx += grad.dNx[i] * ux; eyy += grad.dNy[i] * uy; ezz += grad.dNz[i] * uz;
    gxy += grad.dNy[i] * ux + grad.dNx[i] * uy;
    gyz += grad.dNz[i] * uy + grad.dNy[i] * uz;
    gzx += grad.dNz[i] * ux + grad.dNx[i] * uz;
  }
  const lam = (E * nu) / ((1 + nu) * (1 - 2 * nu)), mu = E / (2 * (1 + nu));
  const tr = exx + eyy + ezz;
  return {
    xx: lam * tr + 2 * mu * exx, yy: lam * tr + 2 * mu * eyy, zz: lam * tr + 2 * mu * ezz,
    xy: mu * gxy, yz: mu * gyz, zx: mu * gzx,
  };
}

export interface BucklingFromLoadOptions {
  E: number; nu: number; cell: number;
  fixed: Set<number>;
  /** Reference load: node id → [Fx,Fy,Fz] (N). Buckling load = λ_cr · this load. */
  load: Map<number, [number, number, number]>;
  iters?: number;
}

export interface BucklingFromLoadResult extends BucklingResult {
  /** Mean axial-stress components of the recovered prestress field (diagnostic). */
  meanStress: { xx: number; yy: number; zz: number };
}

/**
 * Linear buckling with the prestress derived from an actual STATIC SOLVE under the
 * reference load — removing the uniform-stress assumption of hex8LinearBuckling.
 * Solves K u = F, recovers per-element stress, assembles K_g from that real field,
 * then solves K φ = λ (−K_g) φ. λ_cr · (reference load) = buckling load.
 */
export function hex8BucklingFromLoad(grid: TopologyGrid, opts: BucklingFromLoadOptions): BucklingFromLoadResult {
  const K0 = buildHex8K0(opts.nu);
  const h = opts.cell;
  const kScale = opts.E * h;
  const nDof = grid.nNodes * 3;
  const fixedDof = new Uint8Array(nDof);
  for (const nd of opts.fixed) { fixedDof[nd * 3] = 1; fixedDof[nd * 3 + 1] = 1; fixedDof[nd * 3 + 2] = 1; }
  const freeIdx = new Int32Array(nDof).fill(-1);
  let nFree = 0;
  for (let d = 0; d < nDof; d++) if (!fixedDof[d]) freeIdx[d] = nFree++;
  const empty: BucklingFromLoadResult = { criticalLoadFactor: 0, mode: new Float64Array(0), nFree: 0, meanStress: { xx: 0, yy: 0, zz: 0 } };
  if (nFree === 0) return empty;

  // assemble elastic K (free×free)
  const K = new Float64Array(nFree * nFree);
  const edof = new Int32Array(24);
  type Elem = { ns: Int32Array };
  const elems: Elem[] = [];
  for (let ez = 0; ez < grid.nz; ez++) for (let ey = 0; ey < grid.ny; ey++) for (let ex = 0; ex < grid.nx; ex++) {
    const corners = grid.elemNodes(ex, ey, ez);
    const ns = new Int32Array(8);
    for (let i = 0; i < 8; i++) { ns[i] = corners[i]; edof[i * 3] = corners[i] * 3; edof[i * 3 + 1] = corners[i] * 3 + 1; edof[i * 3 + 2] = corners[i] * 3 + 2; }
    elems.push({ ns });
    for (let i = 0; i < 24; i++) {
      const di = freeIdx[edof[i]]; if (di < 0) continue;
      const row = di * nFree, k0row = i * 24;
      for (let j = 0; j < 24; j++) { const dj = freeIdx[edof[j]]; if (dj < 0) continue; K[row + dj] += kScale * K0[k0row + j]; }
    }
  }

  // static solve K u = F
  const f = new Float64Array(nFree);
  for (const [nd, F] of opts.load) for (let c = 0; c < 3; c++) { const r = freeIdx[nd * 3 + c]; if (r >= 0) f[r] += F[c]; }
  const uFree = cgSolve(K, f, nFree);
  const u = new Float64Array(nDof);
  for (let d = 0; d < nDof; d++) { const r = freeIdx[d]; if (r >= 0) u[d] = uFree[r]; }

  // per-element stress → geometric stiffness B = −K_g
  const grad = hex8CentreGrad(h);
  const B = new Float64Array(nFree * nFree);
  const ue = new Float64Array(24);
  const meanStress = { xx: 0, yy: 0, zz: 0 };
  for (const { ns } of elems) {
    for (let i = 0; i < 8; i++) { ue[i * 3] = u[ns[i] * 3]; ue[i * 3 + 1] = u[ns[i] * 3 + 1]; ue[i * 3 + 2] = u[ns[i] * 3 + 2]; }
    const s = elementStress(ue, grad, opts.E, opts.nu);
    meanStress.xx += s.xx; meanStress.yy += s.yy; meanStress.zz += s.zz;
    const KG0 = buildHex8Geom0(s);
    for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) {
      const kg = h * KG0[a * 8 + b];
      if (kg === 0) continue;
      for (let c = 0; c < 3; c++) {
        const di = freeIdx[ns[a] * 3 + c]; if (di < 0) continue;
        const dj = freeIdx[ns[b] * 3 + c]; if (dj < 0) continue;
        B[di * nFree + dj] -= kg;
      }
    }
  }
  meanStress.xx /= elems.length; meanStress.yy /= elems.length; meanStress.zz /= elems.length;

  const { lambda, mode } = bucklingEigen(K, B, nFree, opts.iters ?? 200);
  return { criticalLoadFactor: lambda, mode, nFree, meanStress };
}

/** Distribute a total axial force `total` (N, along `axis`) over a grid end face. */
export function axialEndLoad(grid: TopologyGrid, axis: 'x' | 'y' | 'z', atMax: boolean, total: number): Map<number, [number, number, number]> {
  const n = axis === 'x' ? grid.nx : axis === 'y' ? grid.ny : grid.nz;
  const nodes: number[] = [];
  for (let iz = 0; iz <= grid.nz; iz++) for (let iy = 0; iy <= grid.ny; iy++) for (let ix = 0; ix <= grid.nx; ix++) {
    const coord = axis === 'x' ? ix : axis === 'y' ? iy : iz;
    if (coord === (atMax ? n : 0)) nodes.push(grid.node(ix, iy, iz));
  }
  const per = total / nodes.length;
  const ax = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const load = new Map<number, [number, number, number]>();
  for (const nd of nodes) { const f: [number, number, number] = [0, 0, 0]; f[ax] = per; load.set(nd, f); }
  return load;
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
