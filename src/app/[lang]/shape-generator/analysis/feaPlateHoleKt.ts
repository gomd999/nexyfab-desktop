/**
 * feaPlateHoleKt.ts — Kt de-risking spike (FEA path c, 2026-06-08).
 *
 * The production TET10 solver (`femSolver.ts`) meshes parts on a STRUCTURED
 * VOXEL grid, so a circular hole is a staircase: it under-predicts the
 * stress-concentration factor Kt (≈1.8–2.2 vs the analytic 3.0 for a hole in a
 * plate — `feaStressConcentration.test.ts` is `.skip`'d on exactly this gap).
 *
 * This module is the de-risking spike for closing it: a BOUNDARY-CONFORMING
 * mesh. It builds a polar (ring × sector) mesh of an annular plate-with-hole —
 * elements follow the hole circle exactly — runs a real Q4 plane-stress FEA
 * (reusing femSolver's sparse CSR + PCG), and recovers the hoop stress at the
 * hole edge. Verified against the Kirsch solution (Kt = 3 at θ=90°, σ_θθ = −σ at
 * θ=0°) in `feaPlateHoleKt.test.ts`. It does NOT touch the validated production
 * solver — it proves the conforming-mesh path is worth the (XL) TetGen-wasm
 * integration before committing to it.
 *
 * Units: consistent (E, σ in the same unit; geometry in the same length unit).
 */

import { CSRMatrix, sparsePCG } from './femSolver';

export interface PlateHoleKtOptions {
  /** Hole radius a. */
  holeRadius?: number;
  /** Outer radius R (R ≫ a → Kirsch infinite-plate limit). */
  outerRadius?: number;
  /** Radial rings (geometric grading concentrates them near the hole). */
  radialRings?: number;
  /** Sectors around the circle — MUST be a multiple of 4 (axis symmetry). */
  sectors?: number;
  /** Young's modulus. */
  E?: number;
  /** Poisson's ratio. */
  nu?: number;
  /** Far-field uniaxial tension σ applied along +x. */
  appliedStress?: number;
}

export interface PlateHoleKtResult {
  /** Kt = max hoop stress at the hole edge / applied stress (≈3 for Kirsch). */
  kt: number;
  /** Hoop stress / σ at the load axis (θ≈0°) — Kirsch gives −1. */
  hoopAtLoadAxis: number;
  nodeCount: number;
  elementCount: number;
  converged: boolean;
}

const GAUSS = [-1 / Math.sqrt(3), 1 / Math.sqrt(3)];

/** Q4 shape-function derivatives wrt (ξ,η) at a point. */
function dN(xi: number, eta: number): { dxi: number[]; deta: number[] } {
  return {
    dxi: [-(1 - eta) / 4, (1 - eta) / 4, (1 + eta) / 4, -(1 + eta) / 4],
    deta: [-(1 - xi) / 4, -(1 + xi) / 4, (1 + xi) / 4, (1 - xi) / 4],
  };
}

/** Plane-stress constitutive matrix (3×3). */
function planeStressD(E: number, nu: number): number[][] {
  const c = E / (1 - nu * nu);
  return [
    [c, c * nu, 0],
    [c * nu, c, 0],
    [0, 0, c * (1 - nu) / 2],
  ];
}

/** Q4 element stiffness + the B-matrices at each Gauss point (for stress recovery). */
function q4Element(xy: number[][], D: number[][]): {
  Ke: number[][];
  gauss: Array<{ B: number[][]; x: number; y: number }>;
} {
  const Ke: number[][] = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const gauss: Array<{ B: number[][]; x: number; y: number }> = [];
  for (const xi of GAUSS) {
    for (const eta of GAUSS) {
      const { dxi, deta } = dN(xi, eta);
      // Jacobian
      let j00 = 0, j01 = 0, j10 = 0, j11 = 0;
      for (let k = 0; k < 4; k++) {
        j00 += dxi[k]! * xy[k]![0]!; j01 += dxi[k]! * xy[k]![1]!;
        j10 += deta[k]! * xy[k]![0]!; j11 += deta[k]! * xy[k]![1]!;
      }
      const det = j00 * j11 - j01 * j10;
      const inv00 = j11 / det, inv01 = -j01 / det, inv10 = -j10 / det, inv11 = j00 / det;
      // dN/dx, dN/dy
      const dx: number[] = [], dy: number[] = [];
      for (let k = 0; k < 4; k++) {
        dx.push(inv00 * dxi[k]! + inv01 * deta[k]!);
        dy.push(inv10 * dxi[k]! + inv11 * deta[k]!);
      }
      // B (3×8)
      const B: number[][] = [new Array(8).fill(0), new Array(8).fill(0), new Array(8).fill(0)];
      for (let k = 0; k < 4; k++) {
        B[0]![2 * k] = dx[k]!;
        B[1]![2 * k + 1] = dy[k]!;
        B[2]![2 * k] = dy[k]!;
        B[2]![2 * k + 1] = dx[k]!;
      }
      // Ke += B^T D B * det (weight 1 for 2×2 Gauss)
      const DB: number[][] = [new Array(8).fill(0), new Array(8).fill(0), new Array(8).fill(0)];
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 8; c++)
          DB[r]![c] = D[r]![0]! * B[0]![c]! + D[r]![1]! * B[1]![c]! + D[r]![2]! * B[2]![c]!;
      for (let a = 0; a < 8; a++)
        for (let b = 0; b < 8; b++) {
          let s = 0;
          for (let r = 0; r < 3; r++) s += B[r]![a]! * DB[r]![b]!;
          Ke[a]![b]! += s * det;
        }
      // Gauss-point physical position (for hoop-stress recovery)
      const Nv = [(1 - xi) * (1 - eta) / 4, (1 + xi) * (1 - eta) / 4, (1 + xi) * (1 + eta) / 4, (1 - xi) * (1 + eta) / 4];
      let gx = 0, gy = 0;
      for (let k = 0; k < 4; k++) { gx += Nv[k]! * xy[k]![0]!; gy += Nv[k]! * xy[k]![1]!; }
      gauss.push({ B, x: gx, y: gy });
    }
  }
  return { Ke, gauss };
}

export function plateWithHoleKt(opts: PlateHoleKtOptions = {}): PlateHoleKtResult {
  const a = opts.holeRadius ?? 1;
  const R = opts.outerRadius ?? 20;
  const nr = opts.radialRings ?? 28;
  const nt = opts.sectors ?? 96;
  const E = opts.E ?? 1;
  const nu = opts.nu ?? 0.3;
  const sigma = opts.appliedStress ?? 1;
  if (nt % 4 !== 0) throw new Error('sectors must be a multiple of 4 (axis symmetry)');

  // ── nodes: ring i (0..nr-1) × sector j (0..nt-1), geometric radial grading ──
  const radii: number[] = [];
  for (let i = 0; i < nr; i++) radii.push(a * Math.pow(R / a, i / (nr - 1)));
  const theta = (j: number): number => (2 * Math.PI * j) / nt;
  const nid = (i: number, j: number): number => i * nt + (j % nt);
  const nNodes = nr * nt;
  const coords: Array<[number, number]> = [];
  for (let i = 0; i < nr; i++)
    for (let j = 0; j < nt; j++)
      coords.push([radii[i]! * Math.cos(theta(j)), radii[i]! * Math.sin(theta(j))]);

  // ── DOF map with symmetry BCs (u_y=0 on x-axis, u_x=0 on y-axis) ──
  const ndof = 2 * nNodes;
  const fixed = new Uint8Array(ndof);
  const jx0 = 0, jx180 = nt / 2, jy90 = nt / 4, jy270 = (3 * nt) / 4;
  for (let i = 0; i < nr; i++) {
    fixed[2 * nid(i, jx0) + 1] = 1;     // θ=0   → u_y=0
    fixed[2 * nid(i, jx180) + 1] = 1;   // θ=180 → u_y=0
    fixed[2 * nid(i, jy90)] = 1;        // θ=90  → u_x=0
    fixed[2 * nid(i, jy270)] = 1;       // θ=270 → u_x=0
  }
  const dofMap = new Int32Array(ndof).fill(-1);
  let nf = 0;
  for (let d = 0; d < ndof; d++) if (!fixed[d]) dofMap[d] = nf++;

  // ── assemble K over Q4 elements (reuse femSolver CSR + PCG) ──
  const D = planeStressD(E, nu);
  const entries = new Map<number, Map<number, number>>();
  const add = (r: number, c: number, v: number): void => {
    let row = entries.get(r); if (!row) { row = new Map(); entries.set(r, row); }
    row.set(c, (row.get(c) ?? 0) + v);
  };
  // Element stress recovery needs the element node ids + gauss B; cache hole-ring ones.
  type ElemCache = { nodes: number[]; gauss: Array<{ B: number[][]; x: number; y: number }> };
  const holeElems: ElemCache[] = [];
  for (let i = 0; i < nr - 1; i++) {
    for (let j = 0; j < nt; j++) {
      // CCW node order (positive Jacobian): inner-j → outer-j → outer-j+1 → inner-j+1.
      const en = [nid(i, j), nid(i + 1, j), nid(i + 1, j + 1), nid(i, j + 1)];
      const xy = en.map((n) => coords[n]!);
      const { Ke, gauss } = q4Element(xy, D);
      const edof = en.flatMap((n) => [2 * n, 2 * n + 1]);
      for (let a2 = 0; a2 < 8; a2++) {
        const fa = dofMap[edof[a2]!]!; if (fa < 0) continue;
        for (let b2 = 0; b2 < 8; b2++) {
          const fb = dofMap[edof[b2]!]!; if (fb < 0) continue;
          add(fa, fb, Ke[a2]![b2]!);
        }
      }
      if (i === 0) holeElems.push({ nodes: en, gauss });
    }
  }
  const K = new CSRMatrix(nf, nf, entries);

  // ── far-field uniaxial tension σ_xx=σ → traction t_x=σ·cosθ on the outer ring ──
  const F = new Float64Array(nf);
  const ds = R * (2 * Math.PI / nt); // tributary arc length per outer node
  for (let j = 0; j < nt; j++) {
    const fx = sigma * Math.cos(theta(j)) * ds;
    const d = dofMap[2 * nid(nr - 1, j)]!;
    if (d >= 0) F[d] += fx;
  }

  const { x: uf, converged } = sparsePCG(K, F, 5000, 1e-10);
  const u = new Float64Array(ndof);
  for (let d = 0; d < ndof; d++) if (dofMap[d] >= 0) u[d] = uf[dofMap[d]!]!;

  // ── recover hoop stress σ_θθ at the hole-ring Gauss points ──
  let kt = 0;
  let hoopAtLoadAxis = 0;
  let minAngleDist = Infinity;
  for (const el of holeElems) {
    const edof = el.nodes.flatMap((n) => [2 * n, 2 * n + 1]);
    const ue = edof.map((d) => u[d]!);
    for (const g of el.gauss) {
      // strain = B u; stress = D strain
      const eps = [0, 0, 0];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) eps[r]! += g.B[r]![c]! * ue[c]!;
      const sx = D[0]![0]! * eps[0]! + D[0]![1]! * eps[1]!;
      const sy = D[1]![0]! * eps[0]! + D[1]![1]! * eps[1]!;
      const sxy = D[2]![2]! * eps[2]!;
      const ang = Math.atan2(g.y, g.x);
      const s = Math.sin(ang), c2 = Math.cos(ang);
      // σ_θθ = σx sin²θ − 2σxy sinθcosθ + σy cos²θ
      const hoop = sx * s * s - 2 * sxy * s * c2 + sy * c2 * c2;
      if (hoop > kt) kt = hoop;
      const dist = Math.min(Math.abs(ang), Math.abs(Math.abs(ang) - Math.PI));
      if (dist < minAngleDist) { minAngleDist = dist; hoopAtLoadAxis = hoop; }
    }
  }

  return {
    kt: kt / sigma,
    hoopAtLoadAxis: hoopAtLoadAxis / sigma,
    nodeCount: nNodes,
    elementCount: (nr - 1) * nt,
    converged,
  };
}
