/**
 * partBucklingFEM.ts — linear (eigenvalue) buckling on the REAL TET10 part FEM.
 *
 * Track M / M2, the buckling half (part modal lives in the existing
 * `modalSolver.ts`). Solves the geometric-
 * stiffness eigenproblem  K φ = λ (−K_g) φ  for the lowest positive load factor
 * λ_cr: the multiplier on a uniform reference stress at which the part first
 * buckles. Mirrors the verified HEX8 path (`fea/buckling.ts`) but on an arbitrary
 * TET10 part mesh, reusing femSolver's TET10 stiffness + geometric-stiffness
 * scalar and the sparse CG solver.
 *
 * v1 takes a UNIFORM reference stress (the classic Euler column assumption:
 * uniform axial compression). A non-uniform prestress from a coupled static
 * pre-solve is a follow-up. Units: N-mm-MPa.
 */

import * as THREE from 'three';
import {
  generateTetMesh,
  buildTet10Mesh,
  computeTet10Stiffness,
  computeTet10GeomScalar,
  CSRMatrix,
  sparsePCG,
  type StressTensor3,
} from './femSolver';

export interface PartBucklingOptions {
  /** Young's modulus, MPa (N/mm²). */
  E: number;
  /** Poisson's ratio. */
  nu: number;
  /** Uniform reference stress (MPa); compression negative. λ_cr scales this. */
  prestress: StressTensor3;
  /** TET4 grid node cap (default 2500). */
  maxNodes?: number;
  /** Face-normal axis to fully clamp (0=X,1=Y,2=Z). Default 0. */
  fixedAxis?: 0 | 1 | 2;
  /** Which face along that axis to clamp. Default 'min'. */
  fixedSide?: 'min' | 'max';
  /** Inverse-iteration cap (default 200). */
  iters?: number;
}

export interface PartBucklingResult {
  /** Lowest positive buckling load factor λ_cr (buckling stress = λ_cr·|ref|). */
  criticalLoadFactor: number;
  nodeCount: number;
  freeDofCount: number;
}

/** Inverse power iteration y = K⁻¹ B x → smallest λ of K φ = λ B φ (Rayleigh). */
function bucklingEigen(K: CSRMatrix, B: CSRMatrix, nf: number, maxIters: number): number {
  let x = new Float64Array(nf);
  for (let i = 0; i < nf; i++) x[i] = Math.sin((i + 1) * 0.7);
  let lambda = 0;
  for (let it = 0; it < maxIters; it++) {
    const Bx = B.multiply(x);
    const y = Float64Array.from(sparsePCG(K, Bx, 2000, 1e-7).x);
    let ny = 0; for (let i = 0; i < nf; i++) ny += y[i]! * y[i]!;
    ny = Math.sqrt(ny);
    if (ny < 1e-30) break;
    for (let i = 0; i < nf; i++) y[i]! /= ny;
    const Ky = K.multiply(y), By = B.multiply(y);
    let num = 0, den = 0;
    for (let i = 0; i < nf; i++) { num += y[i]! * Ky[i]!; den += y[i]! * By[i]!; }
    const newLambda = den !== 0 ? num / den : 0;
    x = y;
    if (Math.abs(newLambda - lambda) < 1e-6 * Math.max(1, Math.abs(newLambda))) { lambda = newLambda; break; }
    lambda = newLambda;
  }
  return lambda;
}

/**
 * Lowest buckling load factor of a part under a uniform reference prestress.
 */
export function runPartBuckling(geometry: THREE.BufferGeometry, opts: PartBucklingOptions): PartBucklingResult {
  const { E, nu, prestress } = opts;
  const maxNodes = opts.maxNodes ?? 2500;
  const fixedAxis = opts.fixedAxis ?? 0;
  const fixedSide = opts.fixedSide ?? 'min';
  const iters = opts.iters ?? 200;

  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const { nodes: tet4Nodes, tets } = generateTetMesh(pos, maxNodes);
  const { nodes: coords, elems } = buildTet10Mesh(tet4Nodes, tets);
  const nNodes = coords.length / 3;
  const n = 3 * nNodes;

  // Clamp one face.
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < nNodes; i++) { const c = coords[i * 3 + fixedAxis]!; if (c < lo) lo = c; if (c > hi) hi = c; }
  const plane = fixedSide === 'min' ? lo : hi;
  const tol = Math.max(hi - lo, 1e-9) * 1e-4 + 1e-6;
  const fixedNode = new Uint8Array(nNodes);
  for (let i = 0; i < nNodes; i++) if (Math.abs(coords[i * 3 + fixedAxis]! - plane) <= tol) fixedNode[i] = 1;

  const dofMap = new Int32Array(n).fill(-1);
  let nf = 0;
  for (let i = 0; i < nNodes; i++) {
    if (fixedNode[i]) continue;
    dofMap[i * 3] = nf++; dofMap[i * 3 + 1] = nf++; dofMap[i * 3 + 2] = nf++;
  }
  if (nf === 0) return { criticalLoadFactor: 0, nodeCount: nNodes, freeDofCount: 0 };

  // K (elastic) and B = −K_g (geometric), both CSR over free DOFs.
  const kEntries = new Map<number, Map<number, number>>();
  const bEntries = new Map<number, Map<number, number>>();
  const add = (map: Map<number, Map<number, number>>, r: number, c: number, v: number): void => {
    let row = map.get(r); if (!row) { row = new Map(); map.set(r, row); }
    row.set(c, (row.get(c) ?? 0) + v);
  };
  for (const e of elems) {
    const { Ke } = computeTet10Stiffness(coords, e, E, nu);
    for (let a = 0; a < 30; a++) {
      const fi = dofMap[e[(a / 3) | 0]! * 3 + (a % 3)]!; if (fi < 0) continue;
      for (let b = 0; b < 30; b++) {
        const fj = dofMap[e[(b / 3) | 0]! * 3 + (b % 3)]!; if (fj < 0) continue;
        add(kEntries, fi, fj, Ke[a]![b]!);
      }
    }
    // Geometric: scalar kg(a,b) on the 3 same-direction DOF slots; B = −K_g.
    const Kg = computeTet10GeomScalar(coords, e, prestress);
    for (let a = 0; a < 10; a++) for (let b = 0; b < 10; b++) {
      const kg = Kg[a]![b]!; if (kg === 0) continue;
      for (let c = 0; c < 3; c++) {
        const fi = dofMap[e[a]! * 3 + c]!; if (fi < 0) continue;
        const fj = dofMap[e[b]! * 3 + c]!; if (fj < 0) continue;
        add(bEntries, fi, fj, -kg);
      }
    }
  }
  const K = new CSRMatrix(nf, nf, kEntries);
  const B = new CSRMatrix(nf, nf, bEntries);

  const lambda = bucklingEigen(K, B, nf, iters);
  return { criticalLoadFactor: lambda, nodeCount: nNodes, freeDofCount: nf };
}
