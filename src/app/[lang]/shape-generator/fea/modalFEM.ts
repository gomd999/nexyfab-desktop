/**
 * modalFEM — natural-frequency (modal) analysis on the REAL HEX8 FEM kernel.
 *
 * Reuses the verified HEX8 element stiffness (topology3D.buildHex8K0) + a lumped
 * mass matrix, reduces out the fixed DOFs, and solves the generalised eigenproblem
 * K φ = ω² M φ via computeModes (inverse power iteration, now CG-backed). This is
 * the accurate counterpart to the crude voxel approximation — verified against the
 * analytic cantilever beam frequency.
 *
 * Consistent units (N, mm, MPa = N/mm², tonne = N·s²/mm): E in MPa, ρ in
 * tonne/mm³, cell size in mm ⇒ frequencies in Hz.
 */
import { TopologyGrid, buildHex8K0 } from '../analysis/topology3D';
import { computeModes } from './modalAnalysis';

export interface Hex8ModalOptions {
  E: number;        // Young's modulus (MPa)
  nu: number;       // Poisson ratio
  rho: number;      // density (tonne/mm³)
  cell: number;     // voxel size (mm)
  fixed: Set<number>; // fully-fixed node ids
  nModes?: number;
}

export interface Hex8ModalResult {
  frequenciesHz: number[];
}

/** Assemble the reduced (free-DOF) HEX8 stiffness + lumped mass for a uniform
 *  solid grid and return the lowest natural frequencies (Hz). */
export function hex8Modes(grid: TopologyGrid, opts: Hex8ModalOptions): Hex8ModalResult {
  const K0 = buildHex8K0(opts.nu);     // unit cube, E = 1
  const h = opts.cell;
  const kScale = opts.E * h;           // K_e = E·h·K0 (3-D elasticity scaling)
  const lumpedNodeMass = (opts.rho * h * h * h) / 8; // per node per element

  const nDof = grid.nNodes * 3;
  const fixedDof = new Uint8Array(nDof);
  for (const nd of opts.fixed) { fixedDof[nd*3] = 1; fixedDof[nd*3+1] = 1; fixedDof[nd*3+2] = 1; }

  // map every DOF to a free-DOF index (or -1 if fixed).
  const freeIdx = new Int32Array(nDof).fill(-1);
  let nFree = 0;
  for (let d = 0; d < nDof; d++) if (!fixedDof[d]) freeIdx[d] = nFree++;

  const Kff = new Array<number>(nFree * nFree).fill(0);
  const Mdiag = new Array<number>(nFree).fill(0);
  const edof = new Int32Array(24);

  for (let ez = 0; ez < grid.nz; ez++) for (let ey = 0; ey < grid.ny; ey++) for (let ex = 0; ex < grid.nx; ex++) {
    const ns = grid.elemNodes(ex, ey, ez);
    for (let i = 0; i < 8; i++) { edof[i*3] = ns[i]*3; edof[i*3+1] = ns[i]*3+1; edof[i*3+2] = ns[i]*3+2; }
    // stiffness (free × free)
    for (let i = 0; i < 24; i++) {
      const di = freeIdx[edof[i]];
      if (di < 0) continue;
      const row = di * nFree, k0row = i * 24;
      for (let j = 0; j < 24; j++) {
        const dj = freeIdx[edof[j]];
        if (dj < 0) continue;
        Kff[row + dj] += kScale * K0[k0row + j];
      }
    }
    // lumped mass
    for (let i = 0; i < 8; i++) for (let c = 0; c < 3; c++) {
      const dd = freeIdx[ns[i]*3 + c];
      if (dd >= 0) Mdiag[dd] += lumpedNodeMass;
    }
  }

  if (nFree === 0) return { frequenciesHz: [] };
  const modes = computeModes({ stiffness: Kff, massDiag: Mdiag, modeCount: opts.nModes ?? 3, maxIters: 300 });
  return { frequenciesHz: modes.map((m) => m.frequencyHz) };
}

/** Fully-fix the `axis=0` face of the grid (a cantilever root). */
export function fixedFaceNodes(grid: TopologyGrid, axis: 'x' | 'y' | 'z' = 'x'): Set<number> {
  const fixed = new Set<number>();
  for (let iz = 0; iz <= grid.nz; iz++) for (let iy = 0; iy <= grid.ny; iy++) for (let ix = 0; ix <= grid.nx; ix++) {
    const on = axis === 'x' ? ix === 0 : axis === 'y' ? iy === 0 : iz === 0;
    if (on) fixed.add(grid.node(ix, iy, iz));
  }
  return fixed;
}
