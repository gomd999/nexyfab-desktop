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
  /** Full nodal displacement over ALL mesh DOFs (fixed DOFs = 0), length = dofCount. */
  displacement: Float64Array;
  /** Effective modal mass fraction in the dominant translational direction (0..1). */
  effectiveMassFraction: number;
}

export interface ModalSolverResult {
  modes: ModalMode[];
  dofCount: number;
  freeDofCount: number;
  elementCount: number;
  /** Tet-mesh node coordinates in mm (length = dofCount), for mapping shapes to vertices. */
  nodesMM: Float32Array;
  /** Total physical mass of the part (kg). */
  totalMassKg: number;
}

export interface ModalMaterialSI {
  /** Young's modulus in Pa. */
  youngsModulus: number;
  poissonRatio: number;
  /** Density in kg/m³. */
  density: number;
}

// ─── TET10 consistent mass coefficient matrix C ──────────────────────────────
// For straight-edged TET10 the geometry map is affine (constant Jacobian), so the element
// consistent mass is M_e[i][j] = ρ·V·C[i][j] with C a FIXED 10×10 matrix, C = 6·∫_ref N_i
// N_j dV_ref. Each shape function is a sum of barycentric monomials; the reference moment
// of L1^a L2^b L3^c L4^d over the unit tet is a!b!c!d!/(a+b+c+d+3)!. We build C once at load
// from those exact moments (no quadrature, no transcription of a printed table). A lumped
// mass under-predicts higher modes (a cantilever's 2nd bending mode came out ~5% low at any
// mesh resolution); the consistent mass fixes that.

const FACT = [1, 1, 2, 6, 24, 120, 720, 5040];
/** ∫_ref L1^e0 L2^e1 L3^e2 L4^e3 dV_ref over the unit tetrahedron. */
function refMoment(e: number[]): number {
  const s = e[0] + e[1] + e[2] + e[3];
  return (FACT[e[0]] * FACT[e[1]] * FACT[e[2]] * FACT[e[3]]) / FACT[s + 3];
}
// Each shape function as monomial terms {coef, exponents[4]} (corner i: 2L_i²−L_i; mid a,b: 4L_aL_b).
const SHAPE_TERMS: Array<Array<{ c: number; e: [number, number, number, number] }>> = (() => {
  const corner = (i: number) => {
    const e2: [number, number, number, number] = [0, 0, 0, 0]; e2[i] = 2;
    const e1: [number, number, number, number] = [0, 0, 0, 0]; e1[i] = 1;
    return [{ c: 2, e: e2 }, { c: -1, e: e1 }];
  };
  const edges: Array<[number, number]> = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
  const mid = ([a, b]: [number, number]) => {
    const e: [number, number, number, number] = [0, 0, 0, 0]; e[a] += 1; e[b] += 1;
    return [{ c: 4, e }];
  };
  return [corner(0), corner(1), corner(2), corner(3), ...edges.map(mid)];
})();
const MASS_C: number[][] = (() => {
  const C = Array.from({ length: 10 }, () => new Array<number>(10).fill(0));
  for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) {
    let s = 0;
    for (const ti of SHAPE_TERMS[i]) for (const tj of SHAPE_TERMS[j]) {
      s += ti.c * tj.c * refMoment([ti.e[0] + tj.e[0], ti.e[1] + tj.e[1], ti.e[2] + tj.e[2], ti.e[3] + tj.e[3]]);
    }
    C[i][j] = 6 * s; // ×6 so Σ_ij C = 1 (mass conservation): M_e = ρ·V·C
  }
  return C;
})();

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

  // --- Assemble global K and CONSISTENT M (both sparse) ---
  const entries = new Map<number, Map<number, number>>();
  const mEntries = new Map<number, Map<number, number>>();
  const addTo = (map: Map<number, Map<number, number>>, r: number, c: number, v: number) => {
    let row = map.get(r); if (!row) { row = new Map(); map.set(r, row); }
    row.set(c, (row.get(c) ?? 0) + v);
  };
  let totalMassKg = 0;
  for (const elem of elems) {
    const { Ke } = computeTet10Stiffness(nodesM, elem, E, nu);
    for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++)
      for (let di = 0; di < 3; di++) for (let dj = 0; dj < 3; dj++)
        addTo(entries, elem[i]*3+di, elem[j]*3+dj, Ke[i*3+di][j*3+dj]);
    // consistent element mass M_e[3i+d][3j+d] = ρ·V·C[i][j] (translational DOFs decouple)
    const me = rho * tetVolume(nodesM, elem[0], elem[1], elem[2], elem[3]);
    totalMassKg += me;
    for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) {
      const mij = me * MASS_C[i][j];
      for (let d = 0; d < 3; d++) addTo(mEntries, elem[i]*3+d, elem[j]*3+d, mij);
    }
  }

  // --- Reduce K and M to free DOFs ---
  const g2r = new Int32Array(nDOF).fill(-1);
  const free: number[] = [];
  for (let d = 0; d < nDOF; d++) if (!fixed.has(d)) { g2r[d] = free.length; free.push(d); }
  const nf = free.length;
  const reduce = (src: Map<number, Map<number, number>>): Map<number, Map<number, number>> => {
    const out = new Map<number, Map<number, number>>();
    for (let i = 0; i < nf; i++) {
      const row = src.get(free[i]); if (!row) continue;
      const rr = new Map<number, number>();
      for (const [c, v] of row) { const rc = g2r[c]; if (rc >= 0) rr.set(rc, v); }
      out.set(i, rr);
    }
    return out;
  };
  const Kr = new CSRMatrix(nf, nf, reduce(entries));
  const Mr = new CSRMatrix(nf, nf, reduce(mEntries));

  // --- Inverse iteration with M-orthogonal deflation for the lowest modes ---
  const modes: ModalMode[] = [];
  const found: Float64Array[] = [];
  const mDot = (a: Float64Array, b: Float64Array) => { const Mb = Mr.multiply(b); let s = 0; for (let i = 0; i < nf; i++) s += a[i] * Mb[i]; return s; };

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
      const b = Mr.multiply(v);
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
    // expand the reduced free-DOF shape to the full DOF vector (fixed DOFs = 0)
    const full = new Float64Array(nDOF);
    for (let i = 0; i < nf; i++) full[free[i]] = v[i];
    // modal participation factor per axis L_d = φᵀM·r_d = Σ_{axis(i)=d} (Mφ)_i (v is
    // M-normalised ⇒ φᵀMφ=1); effective modal mass = L_d², fraction = L_d²/totalMass.
    const Mv = Mr.multiply(v);
    const L = [0, 0, 0];
    for (let i = 0; i < nf; i++) { const axis = free[i] % 3; L[axis] += Mv[i]; }
    const effFrac = totalMassKg > 0
      ? Math.min(1, Math.max(L[0]*L[0], L[1]*L[1], L[2]*L[2]) / totalMassKg)
      : 0;
    modes.push({ frequencyHz: omega / (2 * Math.PI), shape: v, displacement: full, effectiveMassFraction: effFrac });
  }

  modes.sort((a, b) => a.frequencyHz - b.frequencyHz);
  return { modes, dofCount: nDOF, freeDofCount: nf, elementCount: elems.length, nodesMM, totalMassKg };
}

// ─── Panel adapter ───────────────────────────────────────────────────────────
// Bridges the ModalAnalysisPanel's config (material key + named fixed faces +
// geometry) to the real solver, returning frequencies plus a per-surface-vertex
// displacement magnitude (0..1) per mode so the panel can colour the mesh from the
// REAL mode shape instead of the old voxel proxy.

/** SI material table mirrored from the (deprecated) modalAnalysis MODAL_MATERIALS. */
const PANEL_MATERIALS: Record<string, ModalMaterialSI> = {
  steel:    { youngsModulus: 200e9, poissonRatio: 0.3, density: 7850 },
  aluminum: { youngsModulus: 69e9, poissonRatio: 0.33, density: 2700 },
  titanium: { youngsModulus: 116e9, poissonRatio: 0.34, density: 4500 },
  copper:   { youngsModulus: 130e9, poissonRatio: 0.34, density: 8960 },
  abs:      { youngsModulus: 2.3e9, poissonRatio: 0.35, density: 1050 },
  pla:      { youngsModulus: 3.5e9, poissonRatio: 0.36, density: 1240 },
};

const FACE_AXIS: Record<string, { axis: 0 | 1 | 2; side: 'min' | 'max' }> = {
  left:   { axis: 0, side: 'min' }, right: { axis: 0, side: 'max' },
  bottom: { axis: 1, side: 'min' }, top:   { axis: 1, side: 'max' },
  front:  { axis: 2, side: 'min' }, back:  { axis: 2, side: 'max' },
};

export interface PanelModalResult {
  frequencies: number[];
  /** Per-mode, per-surface-vertex normalised displacement magnitude (0..1). */
  modeVertexMagnitudes: Float32Array[];
  /** Per-mode effective modal mass fraction (0..1) in the dominant direction. */
  participationFactors: number[];
  /** Total physical mass of the part (kg). */
  totalMassKg: number;
  elementCount: number;
}

/** Map named faces ('bottom'…) to surface-triangle indices on the matching bbox plane. */
function namedFacesToIndices(pos: THREE.BufferAttribute, faces: string[]): number[] {
  if (faces.length === 0) return [];
  const tris = pos.count / 3;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.count; i++) {
    const c = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    for (let d = 0; d < 3; d++) { if (c[d] < lo[d]) lo[d] = c[d]; if (c[d] > hi[d]) hi[d] = c[d]; }
  }
  const span = Math.max(hi[0]-lo[0], hi[1]-lo[1], hi[2]-lo[2]);
  const tol = Math.max(1e-4, 1e-3 * span);
  const out: number[] = [];
  for (let f = 0; f < tris; f++) {
    const b = f * 3;
    for (const name of faces) {
      const fa = FACE_AXIS[name]; if (!fa) continue;
      const plane = fa.side === 'min' ? lo[fa.axis] : hi[fa.axis];
      const cx = (pos.getX(b) + pos.getX(b+1) + pos.getX(b+2)) / 3 * (fa.axis === 0 ? 1 : 0)
               + (pos.getY(b) + pos.getY(b+1) + pos.getY(b+2)) / 3 * (fa.axis === 1 ? 1 : 0)
               + (pos.getZ(b) + pos.getZ(b+1) + pos.getZ(b+2)) / 3 * (fa.axis === 2 ? 1 : 0);
      if (Math.abs(cx - plane) < tol) { out.push(f); break; }
    }
  }
  return out;
}

export function computeModalForPanel(
  geometry: THREE.BufferGeometry,
  materialKey: string,
  fixedFaces: string[],
  numModes: number,
): PanelModalResult {
  const material = PANEL_MATERIALS[materialKey] ?? PANEL_MATERIALS.steel;
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const pos = nonIndexed.attributes.position as THREE.BufferAttribute;
  const fixedIdx = namedFacesToIndices(pos, fixedFaces);

  const res = computeNaturalFrequencies(geometry, material, fixedIdx, numModes);
  const nNodes = res.nodesMM.length / 3;

  // For each mode, map every surface vertex to its nearest tet node and read the
  // displacement magnitude there, normalised to the mode's peak.
  const modeVertexMagnitudes = res.modes.map((mode) => {
    const mag = new Float32Array(nNodes);
    let peak = 0;
    for (let n = 0; n < nNodes; n++) {
      const m = Math.hypot(mode.displacement[n*3], mode.displacement[n*3+1], mode.displacement[n*3+2]);
      mag[n] = m; if (m > peak) peak = m;
    }
    const inv = peak > 1e-30 ? 1 / peak : 0;
    const out = new Float32Array(pos.count);
    for (let v = 0; v < pos.count; v++) {
      const px = pos.getX(v), py = pos.getY(v), pz = pos.getZ(v);
      let bestD2 = Infinity, bestN = 0;
      for (let n = 0; n < nNodes; n++) {
        const dx = px - res.nodesMM[n*3], dy = py - res.nodesMM[n*3+1], dz = pz - res.nodesMM[n*3+2];
        const d2 = dx*dx + dy*dy + dz*dz;
        if (d2 < bestD2) { bestD2 = d2; bestN = n; }
      }
      out[v] = mag[bestN] * inv;
    }
    return out;
  });

  return {
    frequencies: res.modes.map((m) => m.frequencyHz),
    modeVertexMagnitudes,
    participationFactors: res.modes.map((m) => m.effectiveMassFraction),
    totalMassKg: res.totalMassKg,
    elementCount: res.elementCount,
  };
}
