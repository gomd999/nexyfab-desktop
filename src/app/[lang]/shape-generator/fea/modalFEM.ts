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

interface AssembledModal {
  Kff: number[];       // reduced stiffness (nFree × nFree, row-major)
  Mdiag: number[];     // reduced lumped mass (nFree)
  freeAxis: Int8Array; // 0/1/2 (x/y/z) per free DOF
  dofToFree: Int32Array; // full DOF (node*3+axis) → free index, or -1 if fixed
  nFree: number;
}

/** Assemble the reduced (free-DOF) HEX8 stiffness + lumped mass for a uniform
 *  solid grid, tracking each free DOF's axis. */
function assembleHex8Modal(grid: TopologyGrid, opts: Hex8ModalOptions): AssembledModal {
  const K0 = buildHex8K0(opts.nu);     // unit cube, E = 1
  const h = opts.cell;
  const kScale = opts.E * h;           // K_e = E·h·K0 (3-D elasticity scaling)
  const lumpedNodeMass = (opts.rho * h * h * h) / 8; // per node per element

  const nDof = grid.nNodes * 3;
  const fixedDof = new Uint8Array(nDof);
  for (const nd of opts.fixed) { fixedDof[nd*3] = 1; fixedDof[nd*3+1] = 1; fixedDof[nd*3+2] = 1; }

  const freeIdx = new Int32Array(nDof).fill(-1);
  let nFree = 0;
  for (let d = 0; d < nDof; d++) if (!fixedDof[d]) freeIdx[d] = nFree++;
  const freeAxis = new Int8Array(nFree);
  for (let d = 0; d < nDof; d++) if (freeIdx[d] >= 0) freeAxis[freeIdx[d]] = (d % 3) as 0 | 1 | 2;

  const Kff = new Array<number>(nFree * nFree).fill(0);
  const Mdiag = new Array<number>(nFree).fill(0);
  const edof = new Int32Array(24);

  for (let ez = 0; ez < grid.nz; ez++) for (let ey = 0; ey < grid.ny; ey++) for (let ex = 0; ex < grid.nx; ex++) {
    const ns = grid.elemNodes(ex, ey, ez);
    for (let i = 0; i < 8; i++) { edof[i*3] = ns[i]*3; edof[i*3+1] = ns[i]*3+1; edof[i*3+2] = ns[i]*3+2; }
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
    for (let i = 0; i < 8; i++) for (let c = 0; c < 3; c++) {
      const dd = freeIdx[ns[i]*3 + c];
      if (dd >= 0) Mdiag[dd] += lumpedNodeMass;
    }
  }
  return { Kff, Mdiag, freeAxis, dofToFree: freeIdx, nFree };
}

/** Lowest natural frequencies (Hz) of a uniform solid grid. */
export function hex8Modes(grid: TopologyGrid, opts: Hex8ModalOptions): Hex8ModalResult {
  const { Kff, Mdiag, nFree } = assembleHex8Modal(grid, opts);
  if (nFree === 0) return { frequenciesHz: [] };
  const modes = computeModes({ stiffness: Kff, massDiag: Mdiag, modeCount: opts.nModes ?? 3, maxIters: 300 });
  return { frequenciesHz: modes.map((m) => m.frequencyHz) };
}

export interface ModalParticipation {
  perMode: Array<{ frequencyHz: number; effectiveMass: { x: number; y: number; z: number } }>;
  /** Movable (free) mass per direction. */
  totalMass: { x: number; y: number; z: number };
  /** Cumulative effective-mass fraction after each mode (→ 1 with enough modes). */
  cumulativeFraction: Array<{ x: number; y: number; z: number }>;
}

/**
 * Modal mass participation on the real FEM kernel: per mode, the effective modal
 * mass in each direction (Γ_d² with mass-normalised modes, Γ_d = Σ_{dof∥d} m·φ).
 * Tells you which modes dominate the vibration response in each direction, and —
 * via the cumulative fraction — how many modes a response-spectrum analysis needs.
 */
export function hex8Participation(grid: TopologyGrid, opts: Hex8ModalOptions): ModalParticipation {
  const { Kff, Mdiag, freeAxis, nFree } = assembleHex8Modal(grid, opts);
  if (nFree === 0) return { perMode: [], totalMass: { x: 0, y: 0, z: 0 }, cumulativeFraction: [] };
  const modes = computeModes({ stiffness: Kff, massDiag: Mdiag, modeCount: opts.nModes ?? 6, maxIters: 300 });

  const total = { x: 0, y: 0, z: 0 };
  for (let j = 0; j < nFree; j++) { total[(['x', 'y', 'z'] as const)[freeAxis[j]]] += Mdiag[j]; }

  const perMode: ModalParticipation['perMode'] = [];
  const cumulativeFraction: ModalParticipation['cumulativeFraction'] = [];
  const cum = { x: 0, y: 0, z: 0 };
  for (const m of modes) {
    const g = { x: 0, y: 0, z: 0 };
    for (let j = 0; j < nFree; j++) { g[(['x', 'y', 'z'] as const)[freeAxis[j]]] += Mdiag[j] * m.vector[j]!; }
    const eff = { x: g.x * g.x, y: g.y * g.y, z: g.z * g.z };
    perMode.push({ frequencyHz: m.frequencyHz, effectiveMass: eff });
    cum.x += eff.x; cum.y += eff.y; cum.z += eff.z;
    cumulativeFraction.push({
      x: total.x > 0 ? cum.x / total.x : 0,
      y: total.y > 0 ? cum.y / total.y : 0,
      z: total.z > 0 ? cum.z / total.z : 0,
    });
  }
  return { perMode, totalMass: total, cumulativeFraction };
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

export type Axis3 = 0 | 1 | 2;

export interface HarmonicOptions extends Hex8ModalOptions {
  /** Harmonic point force: magnitude `loadMag` at node `loadNode`, axis `loadAxis`. */
  loadNode: number; loadAxis: Axis3; loadMag: number;
  /** Response is reported at node `probeNode`, axis `probeAxis`. */
  probeNode: number; probeAxis: Axis3;
  /** Excitation frequencies to sweep (Hz). */
  freqsHz: number[];
  /** Modal damping ratio ζ (default 0.02). */
  zeta?: number;
}

export interface HarmonicResult {
  freqHz: number[];
  /** Steady-state response amplitude |u| at the probe per excitation frequency. */
  amplitude: number[];
  /** ω→0 (static) response amplitude — the static deflection. */
  staticAmplitude: number;
}

/**
 * Steady-state HARMONIC (frequency) response by modal superposition. For a force
 * F·e^{iωt} the response is u(ω) = Σ_i (φ_iᵀF) φ_i / (ω_i² − ω² + 2iζω_iω). The
 * amplitude peaks at each natural frequency (resonance); the ω→0 limit is the
 * static deflection. Reuses the verified modal solve.
 */
export function hex8HarmonicResponse(grid: TopologyGrid, opts: HarmonicOptions): HarmonicResult {
  const { Kff, Mdiag, dofToFree, nFree } = assembleHex8Modal(grid, opts);
  const zeros = () => ({ freqHz: opts.freqsHz, amplitude: opts.freqsHz.map(() => 0), staticAmplitude: 0 });
  if (nFree === 0) return zeros();
  const loadDof = dofToFree[opts.loadNode * 3 + opts.loadAxis];
  const probeDof = dofToFree[opts.probeNode * 3 + opts.probeAxis];
  if (loadDof < 0 || probeDof < 0) return zeros();

  const modes = computeModes({ stiffness: Kff, massDiag: Mdiag, modeCount: opts.nModes ?? 8, maxIters: 300 });
  const zeta = opts.zeta ?? 0.02;
  const wi = modes.map((m) => 2 * Math.PI * m.frequencyHz);   // modal ω
  const fi = modes.map((m) => m.vector[loadDof]! * opts.loadMag); // modal force φ_iᵀF
  const pi = modes.map((m) => m.vector[probeDof]!);            // probe component of φ_i

  const amplitude = opts.freqsHz.map((fHz) => {
    const w = 2 * Math.PI * fHz;
    let re = 0, im = 0;
    for (let i = 0; i < modes.length; i++) {
      if (wi[i] <= 0) continue;
      const dRe = wi[i] * wi[i] - w * w;
      const dIm = 2 * zeta * wi[i] * w;
      const d2 = dRe * dRe + dIm * dIm || 1e-300;
      // q_i = f_i / (dRe + i·dIm); u_probe += q_i · p_i
      re += (fi[i] * dRe / d2) * pi[i];
      im += (-fi[i] * dIm / d2) * pi[i];
    }
    return Math.hypot(re, im);
  });

  let staticAmp = 0;
  for (let i = 0; i < modes.length; i++) if (wi[i] > 0) staticAmp += (fi[i] * pi[i]) / (wi[i] * wi[i]);
  return { freqHz: opts.freqsHz, amplitude, staticAmplitude: Math.abs(staticAmp) };
}
