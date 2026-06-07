/**
 * partModalFEM.ts — modal (natural-frequency) analysis on the REAL part FEM.
 *
 * Track M / M2. Until now real modal/buckling lived only on the HEX8 topology
 * grid (`fea/modalFEM.ts`, `fea/buckling.ts`); the real PART mesh (TET10 from an
 * arbitrary BufferGeometry, `analysis/femSolver.ts`) did static stress only. This
 * module brings natural frequencies to actual modelled / imported parts by
 * reusing femSolver's TET10 stiffness and `modalAnalysis.computeModes`.
 *
 * Mass matrix — the TET10 trap: a naive row-sum lumping of the consistent TET10
 * mass yields NEGATIVE corner masses, which `computeModes` (needs a positive
 * mass diagonal) cannot use. We instead use the exact HRZ-style lumping derived
 * from the closed-form barycentric integral  ∫_T ∏ Lᵢ^αᵢ dV = 6V·∏αᵢ! / (Σαᵢ+3)! :
 *
 *   corner  N_i = L_i(2L_i−1)  → ∫N_i² dV = V/70
 *   midside N   = 4 L_a L_b     → ∫N²   dV = 8V/105
 *   Σ diag = 4·(V/70) + 6·(8V/105) = 18V/35
 *   scale each by ρV / (18V/35) = 35ρ/18 to conserve the element mass ρV:
 *     corner  → ρV/36   (×4)     midside → 4ρV/27  (×6)     Σ = ρV  (all > 0)
 *
 * Units: consistent N-mm-MPa-s. E in MPa (N/mm²), length mm, density ρ in
 * tonne/mm³ (steel ≈ 7.85e-9). Then ω is rad/s and f is Hz.
 *
 * Scope: `computeModes` is a DENSE inverse-power eigensolver, so keep the mesh
 * coarse (`maxNodes`). A sparse generalised eigensolver (reuse femSolver's
 * sparsePCG) is the follow-up for fine production meshes.
 */

import * as THREE from 'three';
import { generateTetMesh, buildTet10Mesh, computeTet10Stiffness, CSRMatrix, sparsePCG } from './femSolver';
import type { ModeShape } from '../fea/modalAnalysis';

/**
 * Sparse generalised eigensolver  K φ = λ M φ  (M diagonal, lumped) for the
 * lowest `modeCount` modes via inverse power iteration with M-orthogonal
 * deflation. Each iteration solves K y = M x with femSolver's `sparsePCG`, so it
 * stays O(nnz) and scales to fine meshes (unlike the dense `computeModes`). The
 * eigenvalue is the Rayleigh quotient of the M-normalised iterate.
 */
function sparseModes(
  K: CSRMatrix,
  M: Float64Array,
  modeCount: number,
  maxIters = 120,
  tol = 1e-7,
): ModeShape[] {
  const n = M.length;
  const modes: ModeShape[] = [];
  const priors: Float64Array[] = [];
  const mNorm = (x: Float64Array): number => {
    let s = 0; for (let i = 0; i < n; i++) s += x[i]! * x[i]! * M[i]!; return Math.sqrt(s);
  };
  const mDeflate = (x: Float64Array): void => {
    for (const p of priors) {
      let c = 0; for (let i = 0; i < n; i++) c += p[i]! * M[i]! * x[i]!;
      for (let i = 0; i < n; i++) x[i]! -= c * p[i]!;
    }
  };
  for (let m = 0; m < modeCount; m++) {
    let x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = Math.sin((i + 1) * (m + 1) * 0.7);
    mDeflate(x); { const nm = mNorm(x) || 1; for (let i = 0; i < n; i++) x[i]! /= nm; }
    let lambda = 0;
    for (let it = 0; it < maxIters; it++) {
      const b = new Float64Array(n);
      for (let i = 0; i < n; i++) b[i] = M[i]! * x[i]!;
      const y = Float64Array.from(sparsePCG(K, b, 3000, 1e-9).x);
      mDeflate(y);
      const nm = mNorm(y);
      if (nm < 1e-30) break;
      for (let i = 0; i < n; i++) y[i]! /= nm;
      const Ky = K.multiply(y);
      let num = 0; for (let i = 0; i < n; i++) num += y[i]! * Ky[i]!;
      x = y;
      if (Math.abs(num - lambda) <= tol * Math.max(1, Math.abs(num))) { lambda = num; break; }
      lambda = num;
    }
    priors.push(Float64Array.from(x));
    const omega = Math.sqrt(Math.max(0, lambda));
    modes.push({ eigenvalue: lambda, frequencyHz: omega / (2 * Math.PI), vector: Array.from(x) });
  }
  return modes;
}

/** HRZ-lumped nodal mass fractions of ρ·V_element for a straight TET10. */
export const TET10_CORNER_MASS_FRAC = 1 / 36;
export const TET10_MIDSIDE_MASS_FRAC = 4 / 27;

export interface PartModalOptions {
  /** Young's modulus, MPa (N/mm²). */
  E: number;
  /** Poisson's ratio. */
  nu: number;
  /** Density ρ, tonne/mm³ (steel ≈ 7.85e-9) for N-mm-MPa-s consistency. */
  density: number;
  /** Number of lowest modes to extract (default 6). */
  modeCount?: number;
  /** TET4 grid node cap — keep modest, the eigensolver is dense (default 300). */
  maxNodes?: number;
  /** Face-normal axis to fully clamp (0=X,1=Y,2=Z). Default 0. */
  fixedAxis?: 0 | 1 | 2;
  /** Which face along that axis to clamp. Default 'min'. */
  fixedSide?: 'min' | 'max';
  /**
   * Constrain transverse motion so only the `fixedAxis` direction is free — the
   * pure-1D-axial idealization. Makes the longitudinal mode the fundamental
   * (bending is removed) and shrinks the system to an axial-DOF-only problem, so
   * the dense eigensolver stays fast. Off by default (full 3D modal).
   */
  constrainTransverse?: boolean;
}

export interface PartModalMode extends ModeShape {
  /** Fraction of the mode's squared amplitude in each global direction (x,y,z). */
  dirFraction: [number, number, number];
  /** Dominant direction (0=x,1=y,2=z) — lets callers pick axial vs bending modes. */
  dominantDir: 0 | 1 | 2;
  /**
   * Effective modal mass per direction Γ_d² (Γ_d = φ_d^T M, φ mass-normalised).
   * Σ over a complete mode set → total mass; the per-mode fraction
   * effectiveMass[d]/totalMass[d] is the standard vibration "participation".
   */
  effectiveMass: [number, number, number];
}

export interface PartModalResult {
  frequenciesHz: number[];
  modes: PartModalMode[];
  nodeCount: number;
  freeDofCount: number;
  /** Total structural mass per direction (tonne) — equals ρ·V in each axis. */
  totalMass: [number, number, number];
}

/** Signed volume of a tet from its 4 corner node indices (TET10 elem[0..3]). */
function tetVolume(coords: Float32Array, e: Int32Array): number {
  const o = e[0]! * 3, p = e[1]! * 3, q = e[2]! * 3, r = e[3]! * 3;
  const bx = coords[p]! - coords[o]!, by = coords[p + 1]! - coords[o + 1]!, bz = coords[p + 2]! - coords[o + 2]!;
  const cx = coords[q]! - coords[o]!, cy = coords[q + 1]! - coords[o + 1]!, cz = coords[q + 2]! - coords[o + 2]!;
  const dx = coords[r]! - coords[o]!, dy = coords[r + 1]! - coords[o + 1]!, dz = coords[r + 2]! - coords[o + 2]!;
  const det = bx * (cy * dz - cz * dy) - by * (cx * dz - cz * dx) + bz * (cx * dy - cy * dx);
  return Math.abs(det) / 6;
}

/**
 * Natural frequencies of a part. Builds a TET10 mesh from the geometry, assembles
 * the dense free-DOF stiffness + HRZ-lumped mass, clamps one face, and solves
 * K φ = ω² M φ for the lowest `modeCount` modes.
 */
export function runPartModal(geometry: THREE.BufferGeometry, opts: PartModalOptions): PartModalResult {
  const { E, nu, density } = opts;
  const modeCount = opts.modeCount ?? 6;
  const maxNodes = opts.maxNodes ?? 300;
  const fixedAxis = opts.fixedAxis ?? 0;
  const fixedSide = opts.fixedSide ?? 'min';
  const constrainTransverse = opts.constrainTransverse ?? false;

  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const { nodes: tet4Nodes, tets } = generateTetMesh(pos, maxNodes);
  const { nodes: coords, elems } = buildTet10Mesh(tet4Nodes, tets);
  const nNodes = coords.length / 3;
  const n = 3 * nNodes;

  // --- HRZ-lumped mass (all-positive, exact total mass per element) ---
  const massFull = new Float64Array(n);
  for (const e of elems) {
    const V = tetVolume(coords, e);
    const mCorner = density * V * TET10_CORNER_MASS_FRAC;
    const mMid = density * V * TET10_MIDSIDE_MASS_FRAC;
    for (let k = 0; k < 10; k++) {
      const m = k < 4 ? mCorner : mMid;
      const nd = e[k]! * 3;
      massFull[nd] += m; massFull[nd + 1] += m; massFull[nd + 2] += m;
    }
  }

  // --- Clamp one face: find its plane along the fixed axis, fix those nodes ---
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < nNodes; i++) { const c = coords[i * 3 + fixedAxis]!; if (c < lo) lo = c; if (c > hi) hi = c; }
  const plane = fixedSide === 'min' ? lo : hi;
  const tol = Math.max(hi - lo, 1e-9) * 1e-4 + 1e-6;
  const fixedNode = new Uint8Array(nNodes);
  for (let i = 0; i < nNodes; i++) if (Math.abs(coords[i * 3 + fixedAxis]! - plane) <= tol) fixedNode[i] = 1;

  // --- Compact free-DOF map. constrainTransverse keeps only the fixedAxis
  //     component free. freeComp records each free DOF's global direction. ---
  const dofMap = new Int32Array(n).fill(-1);
  const freeComp: number[] = [];
  let nf = 0;
  for (let i = 0; i < nNodes; i++) {
    if (fixedNode[i]) continue;
    for (let comp = 0; comp < 3; comp++) {
      if (constrainTransverse && comp !== fixedAxis) continue;
      dofMap[i * 3 + comp] = nf++;
      freeComp.push(comp);
    }
  }

  // --- Assemble sparse (CSR) free-DOF stiffness + free mass diagonal ---
  const entries = new Map<number, Map<number, number>>();
  const addK = (r: number, c: number, v: number): void => {
    let row = entries.get(r);
    if (!row) { row = new Map(); entries.set(r, row); }
    row.set(c, (row.get(c) ?? 0) + v);
  };
  for (const e of elems) {
    const { Ke } = computeTet10Stiffness(coords, e, E, nu);
    for (let a = 0; a < 30; a++) {
      const fi = dofMap[e[(a / 3) | 0]! * 3 + (a % 3)]!; if (fi < 0) continue;
      for (let b = 0; b < 30; b++) {
        const fj = dofMap[e[(b / 3) | 0]! * 3 + (b % 3)]!; if (fj < 0) continue;
        addK(fi, fj, Ke[a]![b]!);
      }
    }
  }
  const K = new CSRMatrix(nf, nf, entries);
  const massDiag = new Float64Array(nf);
  for (let g = 0; g < n; g++) {
    const f = dofMap[g]!;
    if (f >= 0) massDiag[f] = massFull[g]!;
  }

  const rawModes = sparseModes(K, massDiag, modeCount);

  // Total structural mass per direction (full mesh, = ρV in each axis).
  const totalMass: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < nNodes; i++) for (let d = 0; d < 3; d++) totalMass[d]! += massFull[i * 3 + d]!;

  // Classify each mode by dominant direction + compute effective modal mass
  // Γ_d² (Γ_d = Σ_{i∈d} M_i φ_i, φ mass-normalised so M_eff = Γ²).
  const modes: PartModalMode[] = rawModes.map((m) => {
    const e = [0, 0, 0];
    const gamma = [0, 0, 0];
    for (let i = 0; i < m.vector.length; i++) {
      const v = m.vector[i]!, d = freeComp[i]!;
      e[d]! += v * v;
      gamma[d]! += massDiag[i]! * v;
    }
    const tot = e[0]! + e[1]! + e[2]! || 1;
    const dirFraction: [number, number, number] = [e[0]! / tot, e[1]! / tot, e[2]! / tot];
    const dominantDir = (dirFraction[0] >= dirFraction[1] && dirFraction[0] >= dirFraction[2]
      ? 0 : dirFraction[1] >= dirFraction[2] ? 1 : 2) as 0 | 1 | 2;
    const effectiveMass: [number, number, number] = [gamma[0]! ** 2, gamma[1]! ** 2, gamma[2]! ** 2];
    return { ...m, dirFraction, dominantDir, effectiveMass };
  });

  return {
    frequenciesHz: modes.map((m) => m.frequencyHz),
    modes,
    nodeCount: nNodes,
    freeDofCount: nf,
    totalMass,
  };
}
