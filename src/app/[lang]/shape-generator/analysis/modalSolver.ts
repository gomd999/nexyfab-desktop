/**
 * modalSolver.ts — REAL modal (natural-frequency) analysis on the part geometry, built on
 * the same verified TET10 stiffness the static solver uses. This replaces the old
 * modalAnalysis.ts, whose stiffness was a hand-tuned diagonal proxy (magic constants
 * 0.5/0.3) with no element formulation behind it — it could not match a closed-form
 * frequency. Here we solve the generalised eigenproblem
 *
 *      K·φ = ω²·M·φ
 *
 * with K = the assembled TET10 stiffness (reused from femSolver) and M = a lumped
 * (diagonal) mass matrix, reduced to the free DOFs. The lowest modes are found by
 * inverse iteration (solve K·x = M·v repeatedly via the same PCG), with M-orthogonal
 * deflation between modes. Frequencies come out in Hz.
 *
 * Units: geometry is mm (converted to m internally), E in Pa, density in kg/m³ ⇒ ω in
 * rad/s, f = ω/2π in Hz. Verified against the analytic cantilever fundamental
 * f₁ = (1.875104²/2π)·√(E·I/(ρ·A·L⁴)) in modalSolver.test.ts.
 */

import * as THREE from 'three';
import {
  generateTetMesh, buildTet10Mesh, computeTet10Stiffness, CSRMatrix, sparsePCG,
} from './femSolver';

export interface ModalMode {
  /** Natural frequency in Hz. */
  frequencyHz: number;
  /** Mass-normalised mode shape over the free DOFs (reduced ordering). */
  shape: Float64Array;
}

export interface ModalSolverResult {
  modes: ModalMode[];
  dofCount: number;
  freeDofCount: number;
  elementCount: number;
}

export interface ModalMaterialSI {
  /** Young's modulus in Pa. */
  youngsModulus: number;
  poissonRatio: number;
  /** Density in kg/m³. */
  density: number;
}

/** Signed volume (m³) of the corner tet of a TET10 element, given metre coords. */
function tetVolume(nodes: Float32Array, a: number, b: number, c: number, d: number): number {
  const ax = nodes[a*3], ay = nodes[a*3+1], az = nodes[a*3+2];
  const bx = nodes[b*3]-ax, by = nodes[b*3+1]-ay, bz = nodes[b*3+2]-az;
  const cx = nodes[c*3]-ax, cy = nodes[c*3+1]-ay, cz = nodes[c*3+2]-az;
  const dx = nodes[d*3]-ax, dy = nodes[d*3+1]-ay, dz = nodes[d*3+2]-az;
  const det = bx*(cy*dz - cz*dy) - by*(cx*dz - cz*dx) + bz*(cx*dy - cy*dx);
  return Math.abs(det) / 6;
}

/**
 * Compute the lowest `numModes` natural frequencies of a part fixed on a set of faces.
 * `fixedFaceIndices` index the NON-INDEXED surface triangles (as in runFEM).
 */
export function computeNaturalFrequencies(
  geometry: THREE.BufferGeometry,
  material: ModalMaterialSI,
  fixedFaceIndices: number[],
  numModes = 3,
  maxNodes = 4000,
): ModalSolverResult {
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const pos = nonIndexed.attributes.position as THREE.BufferAttribute;
  const surfaceVertCount = pos.count;

  // --- TET10 mesh (mm), then metre coords for SI stiffness/mass ---
  const tet4 = generateTetMesh(pos, Math.max(64, Math.floor(maxNodes / 3)));
  const { nodes: nodesMM, elems } = buildTet10Mesh(tet4.nodes, tet4.tets);
  const nNodes = nodesMM.length / 3;
  const nDOF = nNodes * 3;
  const nodesM = new Float32Array(nodesMM.length);
  for (let i = 0; i < nodesMM.length; i++) nodesM[i] = nodesMM[i] * 1e-3;

  const E = material.youngsModulus; // Pa
  const nu = material.poissonRatio;
  const rho = material.density;     // kg/m³

  // --- Infer the fixed plane from the selected surface triangles (same rule as runFEM) ---
  const fixed = new Set<number>();
  if (fixedFaceIndices.length > 0) {
    const sum = [0, 0, 0], sum2 = [0, 0, 0]; let cnt = 0;
    for (const fi of fixedFaceIndices) {
      const base = fi * 3;
      if (base + 2 >= surfaceVertCount) continue;
      for (let k = 0; k < 3; k++) {
        const vi = base + k;
        const c = [pos.getX(vi), pos.getY(vi), pos.getZ(vi)];
        for (let d = 0; d < 3; d++) { sum[d] += c[d]; sum2[d] += c[d] * c[d]; }
        cnt++;
      }
    }
    if (cnt > 0) {
      const mean = [sum[0]/cnt, sum[1]/cnt, sum[2]/cnt];
      const variance = [0, 1, 2].map((d) => sum2[d]/cnt - mean[d]*mean[d]);
      const axis = variance[0] <= variance[1] && variance[0] <= variance[2] ? 0 : variance[1] <= variance[2] ? 1 : 2;
      const planeVal = mean[axis];
      let span = 0;
      for (let d = 0; d < 3; d++) {
        let lo = Infinity, hi = -Infinity;
        for (let n = 0; n < nNodes; n++) { const v = nodesMM[n*3+d]; if (v < lo) lo = v; if (v > hi) hi = v; }
        span = Math.max(span, hi - lo);
      }
      const planeTol = Math.max(1e-4, 1e-3 * span);
      for (let n = 0; n < nNodes; n++) {
        if (Math.abs(nodesMM[n*3+axis] - planeVal) < planeTol) {
          fixed.add(n*3); fixed.add(n*3+1); fixed.add(n*3+2);
        }
      }
    }
  }

  // --- Assemble global K (sparse) and lumped diagonal M ---
  const entries = new Map<number, Map<number, number>>();
  const add = (r: number, c: number, v: number) => {
    let row = entries.get(r); if (!row) { row = new Map(); entries.set(r, row); }
    row.set(c, (row.get(c) ?? 0) + v);
  };
  const Mdiag = new Float64Array(nDOF);
  for (const elem of elems) {
    const { Ke } = computeTet10Stiffness(nodesM, elem, E, nu);
    for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++)
      for (let di = 0; di < 3; di++) for (let dj = 0; dj < 3; dj++)
        add(elem[i]*3+di, elem[j]*3+dj, Ke[i*3+di][j*3+dj]);
    // lumped element mass: ρ·V split equally over the 10 nodes
    const me = rho * tetVolume(nodesM, elem[0], elem[1], elem[2], elem[3]);
    const per = me / 10;
    for (let i = 0; i < 10; i++) { const n = elem[i]; Mdiag[n*3] += per; Mdiag[n*3+1] += per; Mdiag[n*3+2] += per; }
  }

  // --- Reduce to free DOFs ---
  const g2r = new Int32Array(nDOF).fill(-1);
  const free: number[] = [];
  for (let d = 0; d < nDOF; d++) if (!fixed.has(d)) { g2r[d] = free.length; free.push(d); }
  const nf = free.length;
  const Mr = new Float64Array(nf);
  for (let i = 0; i < nf; i++) Mr[i] = Mdiag[free[i]] || 1e-30;
  const rEntries = new Map<number, Map<number, number>>();
  for (let i = 0; i < nf; i++) {
    const gr = free[i];
    const row = entries.get(gr); if (!row) continue;
    const rr = new Map<number, number>();
    for (const [c, v] of row) { const rc = g2r[c]; if (rc >= 0) rr.set(rc, v); }
    rEntries.set(i, rr);
  }
  const Kr = new CSRMatrix(nf, nf, rEntries);

  // --- Inverse iteration with M-orthogonal deflation for the lowest modes ---
  const modes: ModalMode[] = [];
  const found: Float64Array[] = [];
  const mDot = (a: Float64Array, b: Float64Array) => { let s = 0; for (let i = 0; i < nf; i++) s += a[i]*Mr[i]*b[i]; return s; };

  for (let mode = 0; mode < numModes && nf > 0; mode++) {
    let v: Float64Array = new Float64Array(nf);
    for (let i = 0; i < nf; i++) v[i] = Math.sin((i + 1) * (mode + 1) * 0.7) + 0.3; // deterministic seed
    // M-normalise
    let nrm = Math.sqrt(Math.max(mDot(v, v), 1e-300));
    for (let i = 0; i < nf; i++) v[i] /= nrm;

    let lambda = 0;
    for (let iter = 0; iter < 60; iter++) {
      // deflate the seed against found modes
      for (const phi of found) { const c = mDot(phi, v); for (let i = 0; i < nf; i++) v[i] -= c * phi[i]; }
      // solve K x = M v
      const b = new Float64Array(nf);
      for (let i = 0; i < nf; i++) b[i] = Mr[i] * v[i];
      const { x } = sparsePCG(Kr, b, 3000, 1e-9);
      // deflate the result too
      for (const phi of found) { const c = mDot(phi, x); for (let i = 0; i < nf; i++) x[i] -= c * phi[i]; }
      nrm = Math.sqrt(Math.max(mDot(x, x), 1e-300));
      for (let i = 0; i < nf; i++) x[i] /= nrm;
      // Rayleigh quotient λ = xᵀKx / xᵀMx (xᵀMx = 1)
      const Kx = Kr.multiply(x);
      let num = 0; for (let i = 0; i < nf; i++) num += x[i] * Kx[i];
      const newLambda = num; // since xᵀMx normalised to 1
      v = x;
      if (iter > 5 && Math.abs(newLambda - lambda) < 1e-6 * Math.abs(newLambda)) { lambda = newLambda; break; }
      lambda = newLambda;
    }
    found.push(v);
    const omega = Math.sqrt(Math.max(lambda, 0));
    modes.push({ frequencyHz: omega / (2 * Math.PI), shape: v });
  }

  modes.sort((a, b) => a.frequencyHz - b.frequencyHz);
  return { modes, dofCount: nDOF, freeDofCount: nf, elementCount: elems.length };
}
