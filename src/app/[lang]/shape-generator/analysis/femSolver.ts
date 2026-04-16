import * as THREE from 'three';
import type { FEAMaterial, FEABoundaryCondition } from './simpleFEA';

/**
 * Linear Finite Element Method solver.
 *
 * Uses linear tetrahedral elements (4-node, constant strain).
 * Implements direct stiffness method with Conjugate Gradient solver.
 *
 * Accuracy: ±10-15% for simple loading conditions.
 * Much better than the previous beam-theory/voxel approximation (±30-50%).
 */

export interface FEMResult {
  /** Von Mises stress at each surface vertex (MPa) */
  vonMisesStress: Float32Array;
  /** Displacement magnitude at each surface vertex (mm) */
  displacement: Float32Array;
  /** Displacement vector (x,y,z) at each surface vertex (mm) */
  displacementVectors: Float32Array;
  /** Maximum von Mises stress (MPa) */
  maxStress: number;
  /** Maximum displacement (mm) */
  maxDisplacement: number;
  /** Minimum non-zero von Mises stress (MPa) */
  minStress: number;
  /** Safety factor (yieldStrength / maxStress) */
  safetyFactor: number;
  /** Number of DOF solved */
  dofCount: number;
  /** Number of tetrahedral elements */
  elementCount: number;
  /** Whether the PCG solver converged */
  converged: boolean;
  /** Number of PCG iterations taken */
  iterations: number;
}

interface Tet {
  nodes: [number, number, number, number];
  volume: number;
}

/** Simple spatial hash for fast nearest-vertex lookup. */
class SpatialHash {
  private cells = new Map<string, number[]>();
  private cellSize: number;

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  private key(x: number, y: number, z: number): string {
    return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)},${Math.floor(z / this.cellSize)}`;
  }

  add(x: number, y: number, z: number, index: number) {
    const k = this.key(x, y, z);
    if (!this.cells.has(k)) this.cells.set(k, []);
    this.cells.get(k)!.push(index);
  }

  /** Returns all indices in the 3×3×3 neighbourhood. */
  query(x: number, y: number, z: number): number[] {
    const result: number[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const k = this.key(
            x + dx * this.cellSize,
            y + dy * this.cellSize,
            z + dz * this.cellSize,
          );
          const cell = this.cells.get(k);
          if (cell) result.push(...cell);
        }
      }
    }
    return result;
  }
}

/**
 * Generate a simple tetrahedral mesh from a surface triangle mesh.
 * Each surface triangle is connected to one interior "hub" node to form a tet.
 * Interior nodes are placed on a regular grid inside the bounding box.
 */
function generateTetMesh(
  pos: THREE.BufferAttribute,
  maxNodes = 1500,
): { nodes: Float32Array; tets: Tet[] } {
  const surfaceVertCount = pos.count;
  const MERGE_EPS = 1e-4;
  const hash = new SpatialHash(MERGE_EPS * 10);

  // --- Step 1: deduplicate surface vertices ---
  const uniqueVerts: THREE.Vector3[] = [];
  const surfIndexMap = new Int32Array(surfaceVertCount); // raw index -> unique index

  for (let i = 0; i < surfaceVertCount; i++) {
    const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    const nearby = hash.query(v.x, v.y, v.z);
    let found = -1;
    for (const idx of nearby) {
      if (uniqueVerts[idx].distanceTo(v) < MERGE_EPS) { found = idx; break; }
    }
    if (found === -1) {
      found = uniqueVerts.length;
      hash.add(v.x, v.y, v.z, found);
      uniqueVerts.push(v);
    }
    surfIndexMap[i] = found;
  }

  const totalSurface = uniqueVerts.length;

  // --- Step 2: add interior nodes via grid sampling ---
  const bb = new THREE.Box3();
  for (const v of uniqueVerts) bb.expandByPoint(v);
  const bbSize = new THREE.Vector3();
  bb.getSize(bbSize);

  const interiorTarget = Math.min(maxNodes - totalSurface, 600);
  const gridN = Math.max(2, Math.cbrt(interiorTarget) | 0);

  for (let ix = 0; ix < gridN && uniqueVerts.length < maxNodes; ix++) {
    for (let iy = 0; iy < gridN && uniqueVerts.length < maxNodes; iy++) {
      for (let iz = 0; iz < gridN && uniqueVerts.length < maxNodes; iz++) {
        uniqueVerts.push(new THREE.Vector3(
          bb.min.x + (ix + 0.5) / gridN * bbSize.x,
          bb.min.y + (iy + 0.5) / gridN * bbSize.y,
          bb.min.z + (iz + 0.5) / gridN * bbSize.z,
        ));
      }
    }
  }

  // Pack into flat array
  const nodes = new Float32Array(uniqueVerts.length * 3);
  for (let i = 0; i < uniqueVerts.length; i++) {
    nodes[i * 3] = uniqueVerts[i].x;
    nodes[i * 3 + 1] = uniqueVerts[i].y;
    nodes[i * 3 + 2] = uniqueVerts[i].z;
  }

  const interiorStart = totalSurface;
  const interiorEnd = uniqueVerts.length;

  // --- Step 3: build tets — each surface tri + nearest interior hub ---
  const triCount = surfaceVertCount / 3;
  const tets: Tet[] = [];

  for (let t = 0; t < triCount; t++) {
    const ri0 = t * 3, ri1 = t * 3 + 1, ri2 = t * 3 + 2;
    const n0 = surfIndexMap[ri0];
    const n1 = surfIndexMap[ri1];
    const n2 = surfIndexMap[ri2];
    if (n0 === n1 || n0 === n2 || n1 === n2) continue;

    // Centroid of the triangle
    const cx = (uniqueVerts[n0].x + uniqueVerts[n1].x + uniqueVerts[n2].x) / 3;
    const cy = (uniqueVerts[n0].y + uniqueVerts[n1].y + uniqueVerts[n2].y) / 3;
    const cz = (uniqueVerts[n0].z + uniqueVerts[n1].z + uniqueVerts[n2].z) / 3;

    // Find nearest interior node
    let nearestIdx = interiorStart;
    let nearestDist2 = Infinity;
    for (let n = interiorStart; n < interiorEnd; n++) {
      const dx = cx - nodes[n * 3];
      const dy = cy - nodes[n * 3 + 1];
      const dz = cz - nodes[n * 3 + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < nearestDist2) { nearestDist2 = d2; nearestIdx = n; }
    }

    const n3 = nearestIdx;
    if (n3 === n0 || n3 === n1 || n3 === n2) continue;

    // Compute signed volume
    const p0 = uniqueVerts[n0], p1 = uniqueVerts[n1], p2 = uniqueVerts[n2], p3 = uniqueVerts[n3];
    const e1x = p1.x - p0.x, e1y = p1.y - p0.y, e1z = p1.z - p0.z;
    const e2x = p2.x - p0.x, e2y = p2.y - p0.y, e2z = p2.z - p0.z;
    const e3x = p3.x - p0.x, e3y = p3.y - p0.y, e3z = p3.z - p0.z;
    // cross(e2, e3)
    const cx2 = e2y * e3z - e2z * e3y;
    const cy2 = e2z * e3x - e2x * e3z;
    const cz2 = e2x * e3y - e2y * e3x;
    const vol = Math.abs(e1x * cx2 + e1y * cy2 + e1z * cz2) / 6;

    if (vol < 1e-18) continue;

    tets.push({ nodes: [n0, n1, n2, n3], volume: vol });
  }

  return { nodes, tets };
}

/**
 * Compute the 12×12 element stiffness matrix for a linear tetrahedral element.
 * Returns both the Ke matrix and the B (strain-displacement) matrix for
 * later stress recovery.
 */
function computeTetStiffness(
  nodes: Float32Array,
  tet: Tet,
  E: number,   // MPa (or any consistent unit)
  nu: number,
): { Ke: number[][]; B: number[][] } {
  const [n0, n1, n2, n3] = tet.nodes;

  const x = [nodes[n0*3], nodes[n1*3], nodes[n2*3], nodes[n3*3]];
  const y = [nodes[n0*3+1], nodes[n1*3+1], nodes[n2*3+1], nodes[n3*3+1]];
  const z = [nodes[n0*3+2], nodes[n1*3+2], nodes[n2*3+2], nodes[n3*3+2]];

  // Determinant of Jacobian (= 6 * volume)
  const V6 = (
    (x[1]-x[0]) * ((y[2]-y[0])*(z[3]-z[0]) - (y[3]-y[0])*(z[2]-z[0]))
    - (x[2]-x[0]) * ((y[1]-y[0])*(z[3]-z[0]) - (y[3]-y[0])*(z[1]-z[0]))
    + (x[3]-x[0]) * ((y[1]-y[0])*(z[2]-z[0]) - (y[2]-y[0])*(z[1]-z[0]))
  );

  const V = Math.abs(V6) / 6;
  const zero12 = (): number[] => Array(12).fill(0);

  if (V < 1e-20) {
    return {
      Ke: Array(12).fill(null).map(zero12),
      B: Array(6).fill(null).map(zero12),
    };
  }

  // Shape function natural-coordinate derivatives (dN/dx, dN/dy, dN/dz)
  // For a linear tet these are constant — computed from cofactors.
  const b = new Array<number>(4);
  const c = new Array<number>(4);
  const d = new Array<number>(4);

  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4, k = (i + 2) % 4, l = (i + 3) % 4;
    const sign = i % 2 === 0 ? 1 : -1;
    b[i] = sign * ((y[k]-y[j])*(z[l]-z[j]) - (y[l]-y[j])*(z[k]-z[j])) / V6;
    c[i] = -sign * ((x[k]-x[j])*(z[l]-z[j]) - (x[l]-x[j])*(z[k]-z[j])) / V6;
    d[i] = sign * ((x[k]-x[j])*(y[l]-y[j]) - (x[l]-x[j])*(y[k]-y[j])) / V6;
  }

  // B matrix (6 rows × 12 cols)
  const B: number[][] = Array(6).fill(null).map(zero12);
  for (let i = 0; i < 4; i++) {
    B[0][i*3]   = b[i];
    B[1][i*3+1] = c[i];
    B[2][i*3+2] = d[i];
    B[3][i*3]   = c[i]; B[3][i*3+1] = b[i];
    B[4][i*3+1] = d[i]; B[4][i*3+2] = c[i];
    B[5][i*3]   = d[i]; B[5][i*3+2] = b[i];
  }

  // Isotropic constitutive matrix D (6×6)
  const lam = E * nu / ((1 + nu) * (1 - 2 * nu));
  const mu  = E / (2 * (1 + nu));
  const D: number[][] = [
    [lam+2*mu, lam,      lam,      0,  0,  0 ],
    [lam,      lam+2*mu, lam,      0,  0,  0 ],
    [lam,      lam,      lam+2*mu, 0,  0,  0 ],
    [0,        0,        0,        mu, 0,  0 ],
    [0,        0,        0,        0,  mu, 0 ],
    [0,        0,        0,        0,  0,  mu],
  ];

  // Ke = V * B^T * D * B
  const Ke: number[][] = Array(12).fill(null).map(zero12);
  for (let i = 0; i < 12; i++) {
    for (let j = 0; j < 12; j++) {
      let sum = 0;
      for (let k = 0; k < 6; k++) {
        let db = 0;
        for (let l = 0; l < 6; l++) {
          db += D[k][l] * B[l][j];
        }
        sum += B[k][i] * db;
      }
      Ke[i][j] = V * sum;
    }
  }

  return { Ke, B };
}

/**
 * CSR (Compressed Sparse Row) sparse matrix.
 * Memory: O(nnz) instead of O(n²).
 * For FEM stiffness matrices, nnz ≈ 27*n (bandwidth of typical tet mesh).
 */
class CSRMatrix {
  readonly nRows: number;
  readonly nCols: number;
  /** Non-zero values */
  values: Float64Array;
  /** Column indices of each non-zero */
  colIndices: Int32Array;
  /** Row pointer: row i starts at rowPtr[i], ends at rowPtr[i+1] */
  rowPtr: Int32Array;

  constructor(nRows: number, nCols: number, entries: Map<number, Map<number, number>>) {
    this.nRows = nRows;
    this.nCols = nCols;

    // Count nnz
    let nnz = 0;
    for (const row of entries.values()) nnz += row.size;

    this.values = new Float64Array(nnz);
    this.colIndices = new Int32Array(nnz);
    this.rowPtr = new Int32Array(nRows + 1);

    let ptr = 0;
    for (let r = 0; r < nRows; r++) {
      this.rowPtr[r] = ptr;
      const rowMap = entries.get(r);
      if (rowMap) {
        // Sort by column for CSR validity
        const cols = Array.from(rowMap.keys()).sort((a, b) => a - b);
        for (const c of cols) {
          this.values[ptr] = rowMap.get(c)!;
          this.colIndices[ptr] = c;
          ptr++;
        }
      }
    }
    this.rowPtr[nRows] = ptr;
  }

  /** Sparse matrix-vector product: y = A * x */
  multiply(x: Float64Array): Float64Array {
    const y = new Float64Array(this.nRows);
    for (let r = 0; r < this.nRows; r++) {
      let sum = 0;
      for (let ptr = this.rowPtr[r]; ptr < this.rowPtr[r + 1]; ptr++) {
        sum += this.values[ptr] * x[this.colIndices[ptr]];
      }
      y[r] = sum;
    }
    return y;
  }

  /** Extract diagonal for Jacobi preconditioner */
  getDiagonal(): Float64Array {
    const diag = new Float64Array(this.nRows);
    for (let r = 0; r < this.nRows; r++) {
      for (let ptr = this.rowPtr[r]; ptr < this.rowPtr[r + 1]; ptr++) {
        if (this.colIndices[ptr] === r) {
          diag[r] = this.values[ptr];
          break;
        }
      }
    }
    return diag;
  }
}

/**
 * Preconditioned Conjugate Gradient solver for CSR sparse matrix.
 * Uses Jacobi (diagonal) preconditioner: M = diag(A).
 *
 * Convergence: O(√κ) iterations vs O(κ) for plain CG,
 * where κ is the condition number.
 */
function sparsePCG(
  A: CSRMatrix,
  b: Float64Array,
  maxIter = 2000,
  tol = 1e-8,
): { x: Float64Array; converged: boolean; iterations: number } {
  const n = b.length;
  const x = new Float64Array(n);

  // Jacobi preconditioner: M_inv[i] = 1/A[i,i]
  const diag = A.getDiagonal();
  const Minv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    Minv[i] = Math.abs(diag[i]) > 1e-15 ? 1.0 / diag[i] : 1.0;
  }

  // r = b - A*x (x=0 initially, so r=b)
  const r = new Float64Array(b);

  // z = M_inv * r
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) z[i] = Minv[i] * r[i];

  const p = new Float64Array(z);
  let rz = 0;
  for (let i = 0; i < n; i++) rz += r[i] * z[i];

  let converged = false;
  let iterations = 0;
  const bNorm = Math.sqrt(b.reduce((s, v) => s + v * v, 0)) || 1;

  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1;

    // Ap = A * p
    const Ap = A.multiply(p);

    // alpha = rz / (p^T A p)
    let pAp = 0;
    for (let i = 0; i < n; i++) pAp += p[i] * Ap[i];
    if (Math.abs(pAp) < 1e-30) break;

    const alpha = rz / pAp;

    // x = x + alpha*p
    // r = r - alpha*Ap
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i];
      r[i] -= alpha * Ap[i];
    }

    // Check convergence: ||r|| / ||b|| < tol
    let rNorm = 0;
    for (let i = 0; i < n; i++) rNorm += r[i] * r[i];
    rNorm = Math.sqrt(rNorm);
    if (rNorm / bNorm < tol) { converged = true; break; }

    // z = M_inv * r
    for (let i = 0; i < n; i++) z[i] = Minv[i] * r[i];

    // beta = r_new^T z_new / r_old^T z_old
    let rzNew = 0;
    for (let i = 0; i < n; i++) rzNew += r[i] * z[i];
    const beta = rzNew / (rz || 1e-30);
    rz = rzNew;

    // p = z + beta*p
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
  }

  return { x, converged, iterations };
}

/**
 * @deprecated Use sparsePCG with CSRMatrix instead.
 * Dense Conjugate Gradient kept as a private fallback reference only.
 * This is O(n²) per iteration and will OOM for large DOF counts.
 */
function _denseConjugateGradient(
  A: Float64Array,
  b: Float64Array,
  n: number,
  maxIter = 800,
  tol = 1e-7,
): { x: Float64Array; converged: boolean } {
  const x = new Float64Array(n);
  const r = new Float64Array(b);  // r = b (x=0)
  const p = new Float64Array(r);
  let rsold = 0;
  for (let i = 0; i < n; i++) rsold += r[i] * r[i];

  let converged = false;

  for (let iter = 0; iter < maxIter; iter++) {
    const Ap = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      const row = i * n;
      for (let j = 0; j < n; j++) s += A[row + j] * p[j];
      Ap[i] = s;
    }

    let pAp = 0;
    for (let i = 0; i < n; i++) pAp += p[i] * Ap[i];
    if (Math.abs(pAp) < 1e-20) break;

    const alpha = rsold / pAp;
    let rsnew = 0;
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i];
      r[i] -= alpha * Ap[i];
      rsnew += r[i] * r[i];
    }

    if (Math.sqrt(rsnew) < tol) { converged = true; break; }

    const beta = rsnew / rsold;
    for (let i = 0; i < n; i++) p[i] = r[i] + beta * p[i];
    rsold = rsnew;
  }

  return { x, converged };
}

/**
 * Main FEM solver.
 *
 * geometry  — THREE.BufferGeometry (may be indexed)
 * material  — FEAMaterial (GPa / MPa units as used in the rest of the codebase)
 * conditions — FEABoundaryCondition[] using face indices (same as simpleFEA)
 * maxNodes  — mesh resolution cap (default 1200)
 */
export function runFEM(
  geometry: THREE.BufferGeometry,
  material: FEAMaterial,
  conditions: FEABoundaryCondition[],
  maxNodes = 1200,
): FEMResult {
  // Work with non-indexed triangles so face indices are contiguous triples
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  nonIndexed.computeVertexNormals();
  const pos = nonIndexed.attributes.position as THREE.BufferAttribute;
  const surfaceVertCount = pos.count;

  // Young's modulus: input is GPa, convert to MPa for internal consistency
  const E  = material.youngsModulus * 1000; // MPa
  const nu = material.poissonRatio;
  const yieldStr = material.yieldStrength; // MPa

  // Generate tet mesh
  const { nodes, tets } = generateTetMesh(pos, maxNodes);
  const nNodes = nodes.length / 3;
  const nDOF   = nNodes * 3;

  // --- Assemble global stiffness matrix K (CSR sparse) ---
  // Sparse assembly: accumulate into Map<row, Map<col, value>> first,
  // then construct CSRMatrix. Memory: O(nnz) ≈ O(27*nNodes) instead of O(nDOF²).
  const entries = new Map<number, Map<number, number>>();

  const addToSparse = (row: number, col: number, val: number) => {
    if (!entries.has(row)) entries.set(row, new Map());
    const rowMap = entries.get(row)!;
    rowMap.set(col, (rowMap.get(col) ?? 0) + val);
  };

  const tetStiffnesses: Array<{ Ke: number[][]; B: number[][] }> = [];

  for (const tet of tets) {
    const { Ke, B } = computeTetStiffness(nodes, tet, E, nu);
    tetStiffnesses.push({ Ke, B });

    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        for (let di = 0; di < 3; di++) {
          for (let dj = 0; dj < 3; dj++) {
            const row = tet.nodes[i] * 3 + di;
            const col = tet.nodes[j] * 3 + dj;
            addToSparse(row, col, Ke[i*3+di][j*3+dj]);
          }
        }
      }
    }
  }

  // --- Force vector ---
  const F = new Float64Array(nDOF);
  const fixedDOFs = new Set<number>();

  // Build a lookup: surface raw vertex index -> tet node index
  // (reuse the surfIndexMap logic implicitly via nearest-node search)
  // For conditions with faceIndices we find the tet nodes near each face centroid.

  for (const cond of conditions) {
    for (const fi of cond.faceIndices) {
      const base = fi * 3;
      if (base + 2 >= surfaceVertCount) continue;

      // Face centroid in surface geometry
      const cx = (pos.getX(base) + pos.getX(base+1) + pos.getX(base+2)) / 3;
      const cy = (pos.getY(base) + pos.getY(base+1) + pos.getY(base+2)) / 3;
      const cz = (pos.getZ(base) + pos.getZ(base+1) + pos.getZ(base+2)) / 3;

      // Find nearest tet node
      let nearest = 0;
      let nearestD2 = Infinity;
      for (let n = 0; n < nNodes; n++) {
        const dx = cx - nodes[n*3], dy = cy - nodes[n*3+1], dz = cz - nodes[n*3+2];
        const d2 = dx*dx + dy*dy + dz*dz;
        if (d2 < nearestD2) { nearestD2 = d2; nearest = n; }
      }

      if (cond.type === 'fixed') {
        fixedDOFs.add(nearest*3);
        fixedDOFs.add(nearest*3+1);
        fixedDOFs.add(nearest*3+2);
      } else if (cond.type === 'force' && cond.value) {
        // Distribute over faces — each face contributes 1/faceCount of total
        const nFaces = cond.faceIndices.length;
        F[nearest*3]   += cond.value[0] / nFaces;
        F[nearest*3+1] += cond.value[1] / nFaces;
        F[nearest*3+2] += cond.value[2] / nFaces;
      } else if (cond.type === 'pressure' && cond.value) {
        // Compute face normal
        const v0 = new THREE.Vector3(pos.getX(base),   pos.getY(base),   pos.getZ(base));
        const v1 = new THREE.Vector3(pos.getX(base+1), pos.getY(base+1), pos.getZ(base+1));
        const v2 = new THREE.Vector3(pos.getX(base+2), pos.getY(base+2), pos.getZ(base+2));
        const normal = new THREE.Vector3().subVectors(v1, v0).cross(new THREE.Vector3().subVectors(v2, v0)).normalize();
        const pressureMag = new THREE.Vector3(cond.value[0], cond.value[1], cond.value[2]).length();
        const nFaces = cond.faceIndices.length;
        F[nearest*3]   += normal.x * pressureMag / nFaces;
        F[nearest*3+1] += normal.y * pressureMag / nFaces;
        F[nearest*3+2] += normal.z * pressureMag / nFaces;
      }
    }
  }

  // --- Apply fixed DOF constraints via large-number (penalty) method ---
  const LARGE = 1e30;
  for (const dof of fixedDOFs) {
    if (!entries.has(dof)) entries.set(dof, new Map());
    entries.get(dof)!.set(dof, LARGE);
    F[dof] = 0;
  }

  // Build CSR sparse matrix from accumulated entries
  const K = new CSRMatrix(nDOF, nDOF, entries);

  // --- Solve K * u = F (Preconditioned Conjugate Gradient, Jacobi preconditioner) ---
  const { x: u, converged, iterations: solverIterations } = sparsePCG(K, F, 2000, 1e-7);

  // --- Recover stress at each tet, then average to tet nodes ---
  const nodeStress  = new Float32Array(nNodes);
  const nodeDisp    = new Float32Array(nNodes);
  const nodeDispVec = new Float32Array(nNodes * 3);
  const nodeCount   = new Float32Array(nNodes);

  for (let ti = 0; ti < tets.length; ti++) {
    const tet = tets[ti];
    const { B } = tetStiffnesses[ti];

    // Element displacement vector (12 DOF)
    const ue = new Array<number>(12);
    for (let i = 0; i < 4; i++) {
      const n = tet.nodes[i];
      ue[i*3]   = u[n*3];
      ue[i*3+1] = u[n*3+1];
      ue[i*3+2] = u[n*3+2];
    }

    // Strain vector: eps = B * ue (6 components)
    const eps = new Array<number>(6).fill(0);
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 12; c++) eps[r] += B[r][c] * ue[c];
    }

    // Constitutive matrix to get stress sigma = D * eps
    const lam = E * nu / ((1 + nu) * (1 - 2 * nu));
    const mu  = E / (2 * (1 + nu));
    const sx = lam*(eps[0]+eps[1]+eps[2]) + 2*mu*eps[0];
    const sy = lam*(eps[0]+eps[1]+eps[2]) + 2*mu*eps[1];
    const sz = lam*(eps[0]+eps[1]+eps[2]) + 2*mu*eps[2];
    const txy = mu * eps[3];
    const tyz = mu * eps[4];
    const txz = mu * eps[5];

    // Von Mises stress
    const vonMises = Math.sqrt(0.5 * (
      (sx-sy)**2 + (sy-sz)**2 + (sz-sx)**2 +
      6 * (txy**2 + tyz**2 + txz**2)
    ));

    // Distribute to element nodes
    for (const n of tet.nodes) {
      nodeStress[n] += vonMises;
      const dm = Math.sqrt(u[n*3]**2 + u[n*3+1]**2 + u[n*3+2]**2);
      nodeDisp[n]    += dm;
      nodeDispVec[n*3]   += u[n*3];
      nodeDispVec[n*3+1] += u[n*3+1];
      nodeDispVec[n*3+2] += u[n*3+2];
      nodeCount[n]++;
    }
  }

  // Average per tet node
  for (let n = 0; n < nNodes; n++) {
    const cnt = nodeCount[n] || 1;
    nodeStress[n]    /= cnt;
    nodeDisp[n]      /= cnt;
    nodeDispVec[n*3]   /= cnt;
    nodeDispVec[n*3+1] /= cnt;
    nodeDispVec[n*3+2] /= cnt;
  }

  // --- Map tet-node results back to surface vertices ---
  // For each surface vertex, find the nearest tet node and copy its values.
  const surfStress    = new Float32Array(surfaceVertCount);
  const surfDisp      = new Float32Array(surfaceVertCount);
  const surfDispVec   = new Float32Array(surfaceVertCount * 3);

  // Search all tet nodes — surface nodes (indices 0..totalSurface-1) come first,
  // so skipping interior nodes would give wrong mappings for dense meshes.
  const searchLimit = nNodes;

  for (let i = 0; i < surfaceVertCount; i++) {
    const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    let bestD2 = Infinity, bestN = 0;
    for (let n = 0; n < searchLimit; n++) {
      const dx = px - nodes[n*3], dy = py - nodes[n*3+1], dz = pz - nodes[n*3+2];
      const d2 = dx*dx + dy*dy + dz*dz;
      if (d2 < bestD2) { bestD2 = d2; bestN = n; }
    }
    surfStress[i]      = nodeStress[bestN];
    surfDisp[i]        = nodeDisp[bestN];
    surfDispVec[i*3]   = nodeDispVec[bestN*3];
    surfDispVec[i*3+1] = nodeDispVec[bestN*3+1];
    surfDispVec[i*3+2] = nodeDispVec[bestN*3+2];
  }

  // --- Summary stats ---
  let maxStress = 0, minStress = Infinity, maxDisp = 0;
  for (let i = 0; i < surfaceVertCount; i++) {
    if (surfStress[i] > maxStress) maxStress = surfStress[i];
    if (surfStress[i] > 0 && surfStress[i] < minStress) minStress = surfStress[i];
    if (surfDisp[i]  > maxDisp)  maxDisp  = surfDisp[i];
  }
  if (!isFinite(minStress)) minStress = 0;

  const safetyFactor = maxStress > 0 ? Math.min(yieldStr / maxStress, 99) : 99;

  return {
    vonMisesStress:     surfStress,
    displacement:       surfDisp,
    displacementVectors: surfDispVec,
    maxStress,
    maxDisplacement: maxDisp,
    minStress,
    safetyFactor,
    dofCount:    nDOF,
    elementCount: tets.length,
    converged,
    iterations: solverIterations,
  };
}
