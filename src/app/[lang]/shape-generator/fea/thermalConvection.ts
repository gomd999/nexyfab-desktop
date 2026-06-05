/**
 * thermalConvection.ts — steady-state conduction with surface CONVECTION (Robin /
 * Newton-cooling) and RADIATION boundary conditions, extending the conduction-only
 * thermalFEM with the boundary physics real parts actually lose heat through.
 *
 *   conduction:  ∇·(k∇T) = 0
 *   convection:  −k ∂T/∂n = h (T − T∞)           on a surface (linear)
 *   radiation:   −k ∂T/∂n = εσ (T⁴ − T∞⁴)         on a surface (nonlinear)
 *
 * Convection adds the surface terms h∫N_aN_b dA (to K) and h T∞∫N_a dA (to the RHS).
 * Radiation is linearised as an effective film coefficient h_rad = εσ(T²+T∞²)(T+T∞)
 * and solved by Picard iteration. Verified against the analytic 1-D balances.
 *
 * Units: k W/(mm·K), h W/(mm²·K), σ in W/(mm²·K⁴); radiation needs ABSOLUTE T (K).
 */
import { TopologyGrid } from '../analysis/topology3D';
import { buildHex8Thermal0 } from './thermalFEM';

/** Stefan–Boltzmann constant in mm units: 5.670374e-8 W/(m²·K⁴) → /1e6 per mm². */
export const SIGMA_SB = 5.670374419e-14; // W/(mm²·K⁴)

/** Consistent bilinear-quad surface mass matrix (cyclic node order), ×(area/36). */
const QUAD_M = [
  [4, 2, 1, 2], [2, 4, 2, 1], [1, 2, 4, 2], [2, 1, 2, 4],
];

export interface SurfaceFace {
  axis: 'x' | 'y' | 'z';
  atMax: boolean;
}
export interface ConvectionFace extends SurfaceFace { h: number; Tinf: number; }
export interface RadiationFace extends SurfaceFace { emissivity: number; Tinf: number; }

export interface ThermalConvectionOptions {
  conductivity: number;
  cell: number;
  fixedTemp: Map<number, number>;
  heatSource?: Map<number, number>;
  convection?: ConvectionFace[];
  radiation?: RadiationFace[];
  /** Initial guess for the Picard radiation iteration (K). Default 300. */
  initialTemp?: number;
  picardIters?: number;
  picardTol?: number;
}

export interface ThermalConvectionResult {
  temperature: Float32Array;
  maxTemp: number;
  minTemp: number;
  /** Picard iterations actually used (1 when no radiation). */
  iterations: number;
}

/** Boundary face quads (4 node ids each, cyclic) of the grid on a given face plane. */
export function faceQuads(grid: TopologyGrid, axis: 'x' | 'y' | 'z', atMax: boolean): number[][] {
  const quads: number[][] = [];
  const n = axis === 'x' ? grid.nx : axis === 'y' ? grid.ny : grid.nz;
  const at = atMax ? n : 0;
  if (axis === 'x') {
    for (let ez = 0; ez < grid.nz; ez++) for (let ey = 0; ey < grid.ny; ey++)
      quads.push([grid.node(at, ey, ez), grid.node(at, ey + 1, ez), grid.node(at, ey + 1, ez + 1), grid.node(at, ey, ez + 1)]);
  } else if (axis === 'y') {
    for (let ez = 0; ez < grid.nz; ez++) for (let ex = 0; ex < grid.nx; ex++)
      quads.push([grid.node(ex, at, ez), grid.node(ex + 1, at, ez), grid.node(ex + 1, at, ez + 1), grid.node(ex, at, ez + 1)]);
  } else {
    for (let ey = 0; ey < grid.ny; ey++) for (let ex = 0; ex < grid.nx; ex++)
      quads.push([grid.node(ex, ey, at), grid.node(ex + 1, ey, at), grid.node(ex + 1, ey + 1, at), grid.node(ex, ey + 1, at)]);
  }
  return quads;
}

function cg(matvec: (x: Float64Array, out: Float64Array) => void, b: Float64Array, n: number, iters = Math.max(500, n * 2), tol = 1e-11): Float64Array {
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

/**
 * Steady conduction + convection + radiation. Builds the conduction matrix and the
 * (constant) convection surface terms once; radiation contributes a temperature-
 * dependent film coefficient updated by Picard iteration until the temperature
 * field converges.
 */
export function hex8ThermalConvection(grid: TopologyGrid, opts: ThermalConvectionOptions): ThermalConvectionResult {
  const K0 = buildHex8Thermal0();
  const kScale = opts.conductivity * opts.cell;
  const area = opts.cell * opts.cell;       // quad area
  const nNodes = grid.nNodes;

  // free-node reduction
  const isFixed = new Uint8Array(nNodes);
  for (const nd of opts.fixedTemp.keys()) isFixed[nd] = 1;
  const freeIdx = new Int32Array(nNodes).fill(-1);
  let nFree = 0;
  for (let i = 0; i < nNodes; i++) if (!isFixed[i]) freeIdx[i] = nFree++;

  // conduction rows (free×free) + Dirichlet RHS contribution (constant)
  const rows: Map<number, number>[] = Array.from({ length: nFree }, () => new Map());
  const rhsConst = new Float64Array(nFree);
  const ns = new Array<number>(8);
  for (let ez = 0; ez < grid.nz; ez++) for (let ey = 0; ey < grid.ny; ey++) for (let ex = 0; ex < grid.nx; ex++) {
    const corners = grid.elemNodes(ex, ey, ez);
    for (let i = 0; i < 8; i++) ns[i] = corners[i];
    for (let a = 0; a < 8; a++) {
      const ra = freeIdx[ns[a]]; if (ra < 0) continue;
      for (let b = 0; b < 8; b++) {
        const kab = kScale * K0[a * 8 + b]; if (kab === 0) continue;
        const rb = freeIdx[ns[b]];
        if (rb >= 0) rows[ra].set(rb, (rows[ra].get(rb) ?? 0) + kab);
        else rhsConst[ra] -= kab * (opts.fixedTemp.get(ns[b]) ?? 0);
      }
    }
  }
  if (opts.heatSource) for (const [nd, q] of opts.heatSource) { const r = freeIdx[nd]; if (r >= 0) rhsConst[r] += q; }

  // helper: add a surface film term (coefficient hf, ambient Tinf) over a quad.
  const addFilm = (quad: number[], hf: number, Tinf: number, K: Map<number, number>[], rhs: Float64Array) => {
    const sm = (hf * area) / 36;
    for (let a = 0; a < 4; a++) {
      const ra = freeIdx[quad[a]];
      // RHS: hf·Tinf·∫N_a dA = hf·Tinf·area/4
      if (ra >= 0) rhs[ra] += hf * Tinf * (area / 4);
      for (let b = 0; b < 4; b++) {
        const kab = sm * QUAD_M[a][b];
        if (ra >= 0) {
          const rb = freeIdx[quad[b]];
          if (rb >= 0) K[ra].set(rb, (K[ra].get(rb) ?? 0) + kab);
          else rhs[ra] -= kab * (opts.fixedTemp.get(quad[b]) ?? 0);
        }
      }
    }
  };

  // convection (constant) is folded into the base system.
  const convQuads: Array<{ quad: number[]; h: number; Tinf: number }> = [];
  for (const f of opts.convection ?? []) for (const quad of faceQuads(grid, f.axis, f.atMax)) convQuads.push({ quad, h: f.h, Tinf: f.Tinf });
  for (const c of convQuads) addFilm(c.quad, c.h, c.Tinf, rows, rhsConst);

  const radQuads: Array<{ quad: number[]; eps: number; Tinf: number }> = [];
  for (const f of opts.radiation ?? []) for (const quad of faceQuads(grid, f.axis, f.atMax)) radQuads.push({ quad, eps: f.emissivity, Tinf: f.Tinf });

  // assemble + solve once for the convection/conduction base (no radiation).
  const solve = (extraRows: Map<number, number>[] | null, extraRhs: Float64Array | null): Float64Array => {
    const cols: Int32Array[] = rows.map((m, i) => {
      const merged = new Map(m);
      if (extraRows) for (const [k, v] of extraRows[i]) merged.set(k, (merged.get(k) ?? 0) + v);
      return Int32Array.from(merged.keys());
    });
    const vals: Float64Array[] = rows.map((m, i) => {
      const merged = new Map(m);
      if (extraRows) for (const [k, v] of extraRows[i]) merged.set(k, (merged.get(k) ?? 0) + v);
      return Float64Array.from(merged.values());
    });
    const b = Float64Array.from(rhsConst);
    if (extraRhs) for (let i = 0; i < nFree; i++) b[i] += extraRhs[i];
    const matvec = (x: Float64Array, out: Float64Array) => {
      for (let i = 0; i < nFree; i++) { const c = cols[i], v = vals[i]; let s = 0; for (let j = 0; j < c.length; j++) s += v[j] * x[c[j]]; out[i] = s; }
    };
    return nFree > 0 ? cg(matvec, b, nFree) : new Float64Array(0);
  };

  const toFull = (Tfree: Float64Array): Float32Array => {
    const T = new Float32Array(nNodes);
    for (let i = 0; i < nNodes; i++) T[i] = isFixed[i] ? (opts.fixedTemp.get(i) ?? 0) : Tfree[freeIdx[i]];
    return T;
  };

  let Tfull: Float32Array;
  let iterations = 1;
  if (radQuads.length === 0) {
    Tfull = toFull(solve(null, null));
  } else {
    // Picard: h_rad = εσ(T²+T∞²)(T+T∞) from the current field, re-solve until stable.
    const T0 = opts.initialTemp ?? 300;
    Tfull = new Float32Array(nNodes).fill(T0);
    for (let i = 0; i < nNodes; i++) if (isFixed[i]) Tfull[i] = opts.fixedTemp.get(i) ?? 0;
    const maxIt = opts.picardIters ?? 50, tol = opts.picardTol ?? 1e-4;
    const relax = 0.7;
    for (let it = 0; it < maxIt; it++) {
      const extraRows: Map<number, number>[] = Array.from({ length: nFree }, () => new Map());
      const extraRhs = new Float64Array(nFree);
      for (const r of radQuads) {
        // evaluate film coefficient at the quad-average temperature.
        let Tavg = 0; for (const nd of r.quad) Tavg += Tfull[nd]; Tavg /= 4;
        const hRad = r.eps * SIGMA_SB * (Tavg * Tavg + r.Tinf * r.Tinf) * (Tavg + r.Tinf);
        addFilm(r.quad, hRad, r.Tinf, extraRows, extraRhs);
      }
      const Tnew = toFull(solve(extraRows, extraRhs));
      let maxd = 0, maxv = 1;
      for (let i = 0; i < nNodes; i++) { maxd = Math.max(maxd, Math.abs(Tnew[i] - Tfull[i])); maxv = Math.max(maxv, Math.abs(Tnew[i])); }
      for (let i = 0; i < nNodes; i++) if (!isFixed[i]) Tfull[i] = (1 - relax) * Tfull[i] + relax * Tnew[i];
      iterations = it + 1;
      if (maxd / maxv < tol) break;
    }
  }

  let maxT = -Infinity, minT = Infinity;
  for (let i = 0; i < nNodes; i++) { const T = Tfull[i]; if (T > maxT) maxT = T; if (T < minT) minT = T; }
  return { temperature: Tfull, maxTemp: maxT, minTemp: minT, iterations };
}
