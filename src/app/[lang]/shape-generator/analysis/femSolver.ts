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

export interface Tet {
  nodes: [number, number, number, number];
  volume: number;
}

/** Parity of forward ray–triangle crossings (Möller–Trumbore) for a GENERIC ray
 *  direction. A generic (non-axis-aligned) direction makes grazing a shared
 *  edge of axis-aligned coplanar surface triangles a measure-zero event, so the
 *  count is robust where a +X/+Y/+Z projection parity is not. Odd ⇒ inside. */
function rayParity(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  tri: Float32Array, triCount: number,
): boolean {
  const EPS = 1e-12;
  let crossings = 0;
  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    const v0x = tri[o], v0y = tri[o + 1], v0z = tri[o + 2];
    const e1x = tri[o + 3] - v0x, e1y = tri[o + 4] - v0y, e1z = tri[o + 5] - v0z;
    const e2x = tri[o + 6] - v0x, e2y = tri[o + 7] - v0y, e2z = tri[o + 8] - v0z;
    // p = dir × e2
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -EPS && det < EPS) continue;
    const inv = 1 / det;
    const tx = ox - v0x, ty = oy - v0y, tz = oz - v0z;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const s = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (s > EPS) crossings++; // forward hit only
  }
  return (crossings & 1) === 1;
}

/** Robust point-in-solid: majority vote of three generic ray directions. */
export function pointInsideSurface(
  px: number, py: number, pz: number,
  tri: Float32Array, triCount: number,
): boolean {
  let votes = 0;
  if (rayParity(px, py, pz, 1, 0.017, 0.011, tri, triCount)) votes++;
  if (rayParity(px, py, pz, 0.013, 1, 0.019, tri, triCount)) votes++;
  if (rayParity(px, py, pz, 0.021, 0.014, 1, tri, triCount)) votes++;
  return votes >= 2;
}

/**
 * Generate a CONFORMING tetrahedral mesh by structured-grid decomposition.
 *
 * Each grid cell whose centre is inside the solid is split into 6 tets sharing a
 * common diagonal (Freudenthal/Kuhn), with cells referencing SHARED grid nodes —
 * so the mesh is globally conforming (adjacent cells share faces) and has NO
 * floating, zero-stiffness nodes. (The previous "fan each surface triangle to its
 * nearest interior hub" approach produced a non-conforming shell with unreferenced
 * interior nodes → a singular stiffness matrix, CG non-convergence, and
 * astronomically large spurious displacements. This is the M1 mesh fix.)
 */
export function generateTetMesh(
  pos: THREE.BufferAttribute,
  maxNodes = 1500,
): { nodes: Float32Array; tets: Tet[] } {
  const surfaceVertCount = pos.count;
  const triCount = surfaceVertCount / 3;

  // Surface triangles (flat) + bbox.
  const tri = new Float32Array(surfaceVertCount * 3);
  const bb = new THREE.Box3();
  const tmp = new THREE.Vector3();
  for (let i = 0; i < surfaceVertCount; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    tri[i * 3] = x; tri[i * 3 + 1] = y; tri[i * 3 + 2] = z;
    bb.expandByPoint(tmp.set(x, y, z));
  }
  const size = new THREE.Vector3(); bb.getSize(size);
  const sx = Math.max(size.x, 1e-9), sy = Math.max(size.y, 1e-9), sz = Math.max(size.z, 1e-9);

  // Divisions per axis, ~uniform cell size, total grid nodes ≤ maxNodes.
  let div = Math.max(2, Math.floor(Math.cbrt(maxNodes)) - 1);
  let nx = 0, ny = 0, nz = 0;
  const maxDim = Math.max(sx, sy, sz);
  for (; div >= 1; div--) {
    nx = Math.max(1, Math.round((div * sx) / maxDim));
    ny = Math.max(1, Math.round((div * sy) / maxDim));
    nz = Math.max(1, Math.round((div * sz) / maxDim));
    if ((nx + 1) * (ny + 1) * (nz + 1) <= maxNodes) break;
  }
  const hx = sx / nx, hy = sy / ny, hz = sz / nz;
  const nodeAt = (ix: number, iy: number, iz: number): [number, number, number] => [
    bb.min.x + ix * hx, bb.min.y + iy * hy, bb.min.z + iz * hz,
  ];

  // Lazily allocate only the grid nodes that an included cell actually uses.
  const nodeIndex = new Map<number, number>();
  const coords: number[] = [];
  const gridKey = (ix: number, iy: number, iz: number) => (iz * (ny + 1) + iy) * (nx + 1) + ix;
  const getNode = (ix: number, iy: number, iz: number): number => {
    const key = gridKey(ix, iy, iz);
    let idx = nodeIndex.get(key);
    if (idx === undefined) {
      idx = coords.length / 3;
      const [x, y, z] = nodeAt(ix, iy, iz);
      coords.push(x, y, z);
      nodeIndex.set(key, idx);
    }
    return idx;
  };

  // 8 cube corners by (di, dj, dk) bits → corner index; the 6-tet Freudenthal split.
  const CORNER: Array<[number, number, number]> = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ];
  const SPLIT: Array<[number, number, number, number]> = [
    [0, 1, 3, 7], [0, 3, 2, 7], [0, 2, 6, 7], [0, 6, 4, 7], [0, 4, 5, 7], [0, 5, 1, 7],
  ];

  const tets: Tet[] = [];
  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        // Jitter the sample off the cell centre by irrational fractions so the
        // +X ray never aligns with a surface-subdivision grid line (which would
        // graze a shared triangle edge and miscount the parity).
        const cxw = bb.min.x + (ix + 0.5) * hx;
        const cyw = bb.min.y + (iy + 0.5 + 0.0137) * hy;
        const czw = bb.min.z + (iz + 0.5 + 0.0237) * hz;
        if (!pointInsideSurface(cxw, cyw, czw, tri, triCount)) continue;

        const corner = CORNER.map(([di, dj, dk]) => getNode(ix + di, iy + dj, iz + dk));
        for (const [a, b, c, dd] of SPLIT) {
          tets.push({ nodes: [corner[a], corner[b], corner[c], corner[dd]], volume: (hx * hy * hz) / 6 });
        }
      }
    }
  }

  // Fallback: a degenerate/open surface where no cell tested inside — wrap the
  // whole bbox as a single 6-tet cell so the solver still returns something.
  if (tets.length === 0) {
    const corner = CORNER.map(([di, dj, dk]) => getNode(di * nx, dj * ny, dk * nz));
    for (const [a, b, c, dd] of SPLIT) {
      tets.push({ nodes: [corner[a], corner[b], corner[c], corner[dd]], volume: (sx * sy * sz) / 6 });
    }
  }

  return { nodes: new Float32Array(coords), tets };
}

// ─── TET10 (10-node quadratic tetrahedron) ──────────────────────────────────
//
// Linear (TET4) elements have a CONSTANT strain field, so they lock in bending —
// a cantilever comes out far too stiff (~50% under-predicted). TET10 carries
// edge-midside nodes and quadratic shape functions ⇒ a LINEAR strain field,
// which represents bending well (cantilever within a few %). Stiffness is
// integrated with a 4-point Gauss rule (the integrand is quadratic).

/** The 6 edges of a tet as local corner-index pairs (midside node ordering). */
const TET_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3],
];

/** The 4 triangular faces of a TET10 as LOCAL node indices: the 3 corner nodes
 *  followed by the 3 edge-midside nodes on that face (midside numbering per
 *  TET_EDGES). Used to integrate a consistent surface traction on a loaded face. */
const TET_FACES: ReadonlyArray<{ c: readonly [number, number, number]; m: readonly [number, number, number] }> = [
  { c: [0, 1, 2], m: [4, 7, 5] }, // edges (0,1)=4 (1,2)=7 (0,2)=5
  { c: [0, 1, 3], m: [4, 8, 6] }, // edges (0,1)=4 (1,3)=8 (0,3)=6
  { c: [0, 2, 3], m: [5, 9, 6] }, // edges (0,2)=5 (2,3)=9 (0,3)=6
  { c: [1, 2, 3], m: [7, 9, 8] }, // edges (1,2)=7 (2,3)=9 (1,3)=8
];

/** 4-point Gauss quadrature for a tet (degree-2 exact), in barycentric coords. */
const G_A = 0.5854101966249685, G_B = 0.1381966011250105;
const TET10_GAUSS: ReadonlyArray<readonly [number, number, number, number]> = [
  [G_A, G_B, G_B, G_B], [G_B, G_A, G_B, G_B], [G_B, G_B, G_A, G_B], [G_B, G_B, G_B, G_A],
];

/** Barycentric coordinates (L1..L4) of the 10 TET10 nodes, in the same node
 *  ordering buildTet10Mesh produces (4 corners, then the 6 edge midsides in
 *  TET_EDGES order). Used to sample the strain field AT the nodes for stress
 *  recovery — the extreme-fibre surface nodes carry the peak bending stress that
 *  a centroid sample smears toward the neutral axis. */
const TET10_NODE_L: ReadonlyArray<readonly [number, number, number, number]> = [
  [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1],       // corners
  [0.5, 0.5, 0, 0], [0.5, 0, 0.5, 0], [0.5, 0, 0, 0.5],          // edges (0,1)(0,2)(0,3)
  [0, 0.5, 0.5, 0], [0, 0.5, 0, 0.5], [0, 0, 0.5, 0.5],          // edges (1,2)(1,3)(2,3)
];

/** Augment a TET4 mesh with SHARED edge-midside nodes → TET10 connectivity.
 *  Midsides are cached by sorted corner-pair so adjacent elements share them
 *  (the mesh stays conforming). */
export function buildTet10Mesh(nodes: Float32Array, tets: Tet[]): { nodes: Float32Array; elems: Int32Array[] } {
  const coords: number[] = Array.from(nodes);
  let nNodes = nodes.length / 3;
  const midCache = new Map<number, number>();
  const getMid = (a: number, b: number): number => {
    const key = a < b ? a * 1e7 + b : b * 1e7 + a;
    let idx = midCache.get(key);
    if (idx === undefined) {
      idx = nNodes++;
      coords.push(
        (nodes[a*3] + nodes[b*3]) / 2,
        (nodes[a*3+1] + nodes[b*3+1]) / 2,
        (nodes[a*3+2] + nodes[b*3+2]) / 2,
      );
      midCache.set(key, idx);
    }
    return idx;
  };
  const elems: Int32Array[] = [];
  for (const tet of tets) {
    const c = tet.nodes;
    const e = new Int32Array(10);
    e[0] = c[0]; e[1] = c[1]; e[2] = c[2]; e[3] = c[3];
    for (let k = 0; k < 6; k++) e[4 + k] = getMid(c[TET_EDGES[k][0]], c[TET_EDGES[k][1]]);
    elems.push(e);
  }
  return { nodes: new Float32Array(coords), elems };
}

/** TET10 shape-function derivatives wrt natural coords (r=L2,s=L3,t=L4) at the
 *  barycentric point (L1..L4). Returns dN/dr, dN/ds, dN/dt (each length 10). */
function tet10ShapeDeriv(L: readonly [number, number, number, number]): { dr: number[]; ds: number[]; dt: number[] } {
  // dL_i/d(r,s,t): L1=1−r−s−t, L2=r, L3=s, L4=t.
  const dL = [[-1, -1, -1], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const dr = new Array<number>(10), ds = new Array<number>(10), dt = new Array<number>(10);
  for (let i = 0; i < 4; i++) {                 // corners: N_i = L_i(2L_i−1)
    const f = 4 * L[i] - 1;
    dr[i] = f * dL[i][0]; ds[i] = f * dL[i][1]; dt[i] = f * dL[i][2];
  }
  for (let k = 0; k < 6; k++) {                 // midsides: N = 4 L_a L_b
    const a = TET_EDGES[k][0], b = TET_EDGES[k][1], m = 4 + k;
    dr[m] = 4 * (dL[a][0] * L[b] + L[a] * dL[b][0]);
    ds[m] = 4 * (dL[a][1] * L[b] + L[a] * dL[b][1]);
    dt[m] = 4 * (dL[a][2] * L[b] + L[a] * dL[b][2]);
  }
  return { dr, ds, dt };
}

/** Build the 6×30 strain–displacement matrix B at one quadrature point, given
 *  the inverse Jacobian. Returns B and detJ (caller skips degenerate points). */
function tet10B(coords: Float32Array, elem: Int32Array, L: readonly [number, number, number, number]):
  { B: number[][]; detJ: number } {
  const { dr, ds, dt } = tet10ShapeDeriv(L);
  // Jacobian J_ij = Σ_k dN_k/dξ_j · x_{k,i}
  const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let k = 0; k < 10; k++) {
    const n = elem[k], dξ = [dr[k], ds[k], dt[k]];
    const xi = coords[n*3], yi = coords[n*3+1], zi = coords[n*3+2];
    for (let j = 0; j < 3; j++) { J[0][j] += dξ[j]*xi; J[1][j] += dξ[j]*yi; J[2][j] += dξ[j]*zi; }
  }
  const detJ = J[0][0]*(J[1][1]*J[2][2]-J[1][2]*J[2][1])
             - J[0][1]*(J[1][0]*J[2][2]-J[1][2]*J[2][0])
             + J[0][2]*(J[1][0]*J[2][1]-J[1][1]*J[2][0]);
  const B: number[][] = Array(6).fill(null).map(() => new Array<number>(30).fill(0));
  if (Math.abs(detJ) < 1e-18) return { B, detJ: 0 };
  const id = 1 / detJ;
  const inv = [
    [(J[1][1]*J[2][2]-J[1][2]*J[2][1])*id, (J[0][2]*J[2][1]-J[0][1]*J[2][2])*id, (J[0][1]*J[1][2]-J[0][2]*J[1][1])*id],
    [(J[1][2]*J[2][0]-J[1][0]*J[2][2])*id, (J[0][0]*J[2][2]-J[0][2]*J[2][0])*id, (J[0][2]*J[1][0]-J[0][0]*J[1][2])*id],
    [(J[1][0]*J[2][1]-J[1][1]*J[2][0])*id, (J[0][1]*J[2][0]-J[0][0]*J[2][1])*id, (J[0][0]*J[1][1]-J[0][1]*J[1][0])*id],
  ];
  for (let k = 0; k < 10; k++) {
    // dN/dx_i = Σ_j inv[j][i] · dN/dξ_j
    const dξ = [dr[k], ds[k], dt[k]];
    const nx = inv[0][0]*dξ[0] + inv[1][0]*dξ[1] + inv[2][0]*dξ[2];
    const ny = inv[0][1]*dξ[0] + inv[1][1]*dξ[1] + inv[2][1]*dξ[2];
    const nz = inv[0][2]*dξ[0] + inv[1][2]*dξ[1] + inv[2][2]*dξ[2];
    const cx = k*3, cy = k*3+1, cz = k*3+2;
    B[0][cx] = nx; B[1][cy] = ny; B[2][cz] = nz;
    B[3][cx] = ny; B[3][cy] = nx;
    B[4][cy] = nz; B[4][cz] = ny;
    B[5][cx] = nz; B[5][cz] = nx;
  }
  return { B, detJ };
}

/** TET10 element stiffness (30×30) via 4-point Gauss + a centroid B for stress. */
export function computeTet10Stiffness(
  coords: Float32Array, elem: Int32Array, E: number, nu: number,
): { Ke: number[][]; Bc: number[][] } {
  const lam = E * nu / ((1 + nu) * (1 - 2 * nu)), mu = E / (2 * (1 + nu));
  const D = [
    [lam+2*mu, lam, lam, 0, 0, 0], [lam, lam+2*mu, lam, 0, 0, 0], [lam, lam, lam+2*mu, 0, 0, 0],
    [0, 0, 0, mu, 0, 0], [0, 0, 0, 0, mu, 0], [0, 0, 0, 0, 0, mu],
  ];
  const Ke = Array(30).fill(null).map(() => new Array<number>(30).fill(0));
  for (const L of TET10_GAUSS) {
    const { B, detJ } = tet10B(coords, elem, L);
    if (detJ === 0) continue;
    const w = detJ / 24; // (ref-tet volume 1/6) × (weight 1/4) × |J|
    // DB = D·B (6×30), then Ke += w·Bᵀ·DB
    const DB = Array(6).fill(null).map(() => new Array<number>(30).fill(0));
    for (let r = 0; r < 6; r++) for (let j = 0; j < 30; j++) {
      let s = 0; for (let l = 0; l < 6; l++) s += D[r][l] * B[l][j]; DB[r][j] = s;
    }
    for (let i = 0; i < 30; i++) for (let j = 0; j < 30; j++) {
      let s = 0; for (let r = 0; r < 6; r++) s += B[r][i] * DB[r][j];
      Ke[i][j] += w * s;
    }
  }
  const { B: Bc } = tet10B(coords, elem, [0.25, 0.25, 0.25, 0.25]);
  return { Ke, Bc };
}

/** Cartesian shape-function gradients (∂N/∂x,∂N/∂y,∂N/∂z per node) + |J| at one
 *  barycentric point — the raw gradients tet10B folds into the symmetric B. Used
 *  by the geometric-stiffness (buckling) assembly. */
function tet10Gradients(coords: Float32Array, elem: Int32Array, L: readonly [number, number, number, number]):
  { dNx: number[]; dNy: number[]; dNz: number[]; detJ: number } {
  const { dr, ds, dt } = tet10ShapeDeriv(L);
  const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let k = 0; k < 10; k++) {
    const n = elem[k], dξ = [dr[k], ds[k], dt[k]];
    const xi = coords[n * 3], yi = coords[n * 3 + 1], zi = coords[n * 3 + 2];
    for (let j = 0; j < 3; j++) { J[0][j] += dξ[j] * xi; J[1][j] += dξ[j] * yi; J[2][j] += dξ[j] * zi; }
  }
  const detJ = J[0][0] * (J[1][1] * J[2][2] - J[1][2] * J[2][1])
             - J[0][1] * (J[1][0] * J[2][2] - J[1][2] * J[2][0])
             + J[0][2] * (J[1][0] * J[2][1] - J[1][1] * J[2][0]);
  const dNx = new Array<number>(10).fill(0), dNy = new Array<number>(10).fill(0), dNz = new Array<number>(10).fill(0);
  if (Math.abs(detJ) < 1e-18) return { dNx, dNy, dNz, detJ: 0 };
  const id = 1 / detJ;
  const inv = [
    [(J[1][1]*J[2][2]-J[1][2]*J[2][1])*id, (J[0][2]*J[2][1]-J[0][1]*J[2][2])*id, (J[0][1]*J[1][2]-J[0][2]*J[1][1])*id],
    [(J[1][2]*J[2][0]-J[1][0]*J[2][2])*id, (J[0][0]*J[2][2]-J[0][2]*J[2][0])*id, (J[0][2]*J[1][0]-J[0][0]*J[1][2])*id],
    [(J[1][0]*J[2][1]-J[1][1]*J[2][0])*id, (J[0][1]*J[2][0]-J[0][0]*J[2][1])*id, (J[0][0]*J[1][1]-J[0][1]*J[1][0])*id],
  ];
  for (let k = 0; k < 10; k++) {
    const dξ = [dr[k], ds[k], dt[k]];
    dNx[k] = inv[0][0]*dξ[0] + inv[1][0]*dξ[1] + inv[2][0]*dξ[2];
    dNy[k] = inv[0][1]*dξ[0] + inv[1][1]*dξ[1] + inv[2][1]*dξ[2];
    dNz[k] = inv[0][2]*dξ[0] + inv[1][2]*dξ[1] + inv[2][2]*dξ[2];
  }
  return { dNx, dNy, dNz, detJ };
}

/** Uniform stress tensor (MPa); compression negative. */
export interface StressTensor3 { xx: number; yy: number; zz: number; xy?: number; yz?: number; zx?: number }

/** TET10 geometric-stiffness scalar matrix (10×10): kg(a,b) = ∫ ∇N_a·(σ ∇N_b) dV
 *  over the element, via the 4-point Gauss rule. Couples same-direction DOFs —
 *  the caller scatters each scalar onto the x-x, y-y, z-z slots of the (a,b)
 *  nodal block to form the 30×30 geometric stiffness. */
export function computeTet10GeomScalar(
  coords: Float32Array, elem: Int32Array, s: StressTensor3,
): number[][] {
  const sxx = s.xx, syy = s.yy, szz = s.zz, sxy = s.xy ?? 0, syz = s.yz ?? 0, szx = s.zx ?? 0;
  const Kg = Array(10).fill(null).map(() => new Array<number>(10).fill(0));
  for (const L of TET10_GAUSS) {
    const { dNx, dNy, dNz, detJ } = tet10Gradients(coords, elem, L);
    if (detJ === 0) continue;
    const w = detJ / 24;
    for (let a = 0; a < 10; a++) for (let b = 0; b < 10; b++) {
      const sbx = sxx * dNx[b] + sxy * dNy[b] + szx * dNz[b];
      const sby = sxy * dNx[b] + syy * dNy[b] + syz * dNz[b];
      const sbz = szx * dNx[b] + syz * dNy[b] + szz * dNz[b];
      Kg[a][b] += w * (dNx[a] * sbx + dNy[a] * sby + dNz[a] * sbz);
    }
  }
  return Kg;
}

/**
 * CSR (Compressed Sparse Row) sparse matrix.
 * Memory: O(nnz) instead of O(n²).
 * For FEM stiffness matrices, nnz ≈ 27*n (bandwidth of typical tet mesh).
 */
export class CSRMatrix {
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
export function sparsePCG(
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
  // Conforming TET4 grid mesh, then upgrade to quadratic TET10 (edge-midside
  // nodes) — linear tets lock in bending; TET10 represents a linear strain field
  // so cantilevers come out within a few %. Grid is sized smaller so the TET10
  // DOF count stays near maxNodes.
  const tet4 = generateTetMesh(pos, Math.max(64, Math.floor(maxNodes / 3)));
  const nCornerNodes = tet4.nodes.length / 3; // nodes [0,nCornerNodes) are corners; the rest are edge midsides
  const { nodes, elems } = buildTet10Mesh(tet4.nodes, tet4.tets);
  const nNodes = nodes.length / 3;
  const nDOF   = nNodes * 3;

  // --- Assemble global stiffness matrix K (CSR sparse) ---
  const entries = new Map<number, Map<number, number>>();

  const addToSparse = (row: number, col: number, val: number) => {
    if (!entries.has(row)) entries.set(row, new Map());
    const rowMap = entries.get(row)!;
    rowMap.set(col, (rowMap.get(col) ?? 0) + val);
  };

  for (const elem of elems) {
    const { Ke } = computeTet10Stiffness(nodes, elem, E, nu);

    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 10; j++) {
        for (let di = 0; di < 3; di++) {
          for (let dj = 0; dj < 3; dj++) {
            addToSparse(elem[i] * 3 + di, elem[j] * 3 + dj, Ke[i*3+di][j*3+dj]);
          }
        }
      }
    }
  }

  // --- Force vector ---
  const F = new Float64Array(nDOF);
  const fixedDOFs = new Set<number>();

  // Boundary conditions are applied over a whole FACE, not a single nearest node.
  // Fixing only the node nearest each face-centroid left the structure
  // under-constrained (rigid-body modes survive ⇒ singular K ⇒ CG diverges). We
  // instead infer the axis-aligned face plane from the selected triangles and
  // constrain / load EVERY mesh node lying on that plane.
  let span = 0;
  for (let d = 0; d < 3; d++) {
    let lo = Infinity, hi = -Infinity;
    for (let n = 0; n < nNodes; n++) { const v = nodes[n*3+d]; if (v < lo) lo = v; if (v > hi) hi = v; }
    span = Math.max(span, hi - lo);
  }
  const planeTol = Math.max(1e-4, 1e-3 * span);

  for (const cond of conditions) {
    // Infer the face plane: the axis with the least vertex spread is the normal;
    // its mean coordinate is the plane value.
    const sum = [0, 0, 0]; const sum2 = [0, 0, 0]; let cnt = 0;
    for (const fi of cond.faceIndices) {
      const base = fi * 3;
      if (base + 2 >= surfaceVertCount) continue;
      for (let k = 0; k < 3; k++) {
        const vi = base + k;
        const c = [pos.getX(vi), pos.getY(vi), pos.getZ(vi)];
        for (let d = 0; d < 3; d++) { sum[d] += c[d]; sum2[d] += c[d] * c[d]; }
        cnt++;
      }
    }
    if (cnt === 0) continue;
    const mean = [sum[0]/cnt, sum[1]/cnt, sum[2]/cnt];
    const variance = [0, 1, 2].map((d) => sum2[d]/cnt - mean[d]*mean[d]);
    const axis = variance[0] <= variance[1] && variance[0] <= variance[2] ? 0 : variance[1] <= variance[2] ? 1 : 2;
    const planeVal = mean[axis];

    // Every mesh node on that plane.
    const onPlane: number[] = [];
    for (let n = 0; n < nNodes; n++) {
      if (Math.abs(nodes[n*3+axis] - planeVal) < planeTol) onPlane.push(n);
    }
    if (onPlane.length === 0) continue;

    if (cond.type === 'fixed') {
      for (const n of onPlane) { fixedDOFs.add(n*3); fixedDOFs.add(n*3+1); fixedDOFs.add(n*3+2); }
    } else if (cond.type === 'force' && cond.value) {
      // cond.value is the TOTAL force on the face. Apply it as a CONSISTENT
      // uniform surface traction integrated face-by-face: for a quadratic
      // (TET10) 6-node triangular face under uniform traction the consistent
      // nodal load is ZERO on the 3 corners and t·A/3 on each of the 3 edge-
      // midside nodes. The earlier area-UNWEIGHTED equal split over midside
      // nodes fails the FE patch test — it left a spurious stress spike at the
      // load face (uniaxial tension read ~38% high and WORSENED under mesh
      // refinement). Integrating each planar tet face fixes it: a uniform
      // stress state is now reproduced exactly (A3 → 200.0 at every resolution).
      const planarFaces: Array<{ m: readonly [number, number, number]; area: number }> = [];
      let totalArea = 0;
      for (const el of elems) {
        for (const face of TET_FACES) {
          const a = el[face.c[0]], b = el[face.c[1]], c = el[face.c[2]];
          if (Math.abs(nodes[a*3+axis] - planeVal) >= planeTol) continue;
          if (Math.abs(nodes[b*3+axis] - planeVal) >= planeTol) continue;
          if (Math.abs(nodes[c*3+axis] - planeVal) >= planeTol) continue;
          const ux = nodes[b*3]-nodes[a*3],   uy = nodes[b*3+1]-nodes[a*3+1], uz = nodes[b*3+2]-nodes[a*3+2];
          const vx = nodes[c*3]-nodes[a*3],   vy = nodes[c*3+1]-nodes[a*3+1], vz = nodes[c*3+2]-nodes[a*3+2];
          const crx = uy*vz-uz*vy, cry = uz*vx-ux*vz, crz = ux*vy-uy*vx;
          const area = 0.5 * Math.hypot(crx, cry, crz);
          if (area <= 0) continue;
          planarFaces.push({ m: [el[face.m[0]], el[face.m[1]], el[face.m[2]]], area });
          totalArea += area;
        }
      }
      if (totalArea > 0) {
        const tx = cond.value[0] / totalArea, ty = cond.value[1] / totalArea, tz = cond.value[2] / totalArea;
        for (const pf of planarFaces) {
          const w = pf.area / 3;
          for (const m of pf.m) { F[m*3] += tx*w; F[m*3+1] += ty*w; F[m*3+2] += tz*w; }
        }
      } else {
        // Degenerate fallback: distribute over the plane's midside nodes.
        const mids = onPlane.filter((n) => n >= nCornerNodes);
        const target = mids.length > 0 ? mids : onPlane;
        const per = target.length;
        for (const n of target) {
          F[n*3]   += cond.value[0] / per;
          F[n*3+1] += cond.value[1] / per;
          F[n*3+2] += cond.value[2] / per;
        }
      }
    } else if (cond.type === 'pressure' && cond.value) {
      // Pressure × face area → a total force along the OUTWARD plane normal,
      // distributed over the plane nodes.
      const perp = [0, 1, 2].filter((d) => d !== axis);
      let lo0 = Infinity, hi0 = -Infinity, lo1 = Infinity, hi1 = -Infinity;
      let axLo = Infinity, axHi = -Infinity;
      for (let n = 0; n < nNodes; n++) { const a = nodes[n*3+axis]; if (a < axLo) axLo = a; if (a > axHi) axHi = a; }
      for (const n of onPlane) {
        const a = nodes[n*3+perp[0]], b = nodes[n*3+perp[1]];
        if (a < lo0) lo0 = a; if (a > hi0) hi0 = a;
        if (b < lo1) lo1 = b; if (b > hi1) hi1 = b;
      }
      const area = Math.max(hi0 - lo0, planeTol) * Math.max(hi1 - lo1, planeTol);
      const pressureMag = Math.hypot(cond.value[0], cond.value[1], cond.value[2]);
      // Outward normal: +1 on the max side of the part, −1 on the min side.
      const sign = Math.abs(planeVal - axHi) <= Math.abs(planeVal - axLo) ? 1 : -1;
      const per = onPlane.length;
      for (const n of onPlane) F[n*3+axis] += (sign * pressureMag * area) / per;
    }
  }

  // --- Apply fixed DOF constraints by Dirichlet ELIMINATION (u = 0) ---
  // The old 1e30 penalty wrecked the conditioning (1e30 on the diagonal vs ~1e5
  // real stiffness → condition number ~1e25), so the Jacobi-PCG converged only
  // intermittently across mesh resolutions. Proper elimination — zero the row and
  // column of each fixed DOF and put a representative value on the diagonal —
  // keeps the system well-conditioned and the fixed DOF trivially u = 0.
  let diagSum = 0, diagCnt = 0;
  for (const [r, rowMap] of entries) {
    const dv = rowMap.get(r);
    if (dv && !fixedDOFs.has(r)) { diagSum += dv; diagCnt++; }
  }
  const diagScale = diagCnt > 0 ? diagSum / diagCnt : 1;
  // Zero the COLUMN of every fixed DOF in the remaining (free) rows.
  for (const [r, rowMap] of entries) {
    if (fixedDOFs.has(r)) continue;
    for (const c of [...rowMap.keys()]) if (fixedDOFs.has(c)) rowMap.delete(c);
  }
  // Replace each fixed ROW with a single diagonal entry; RHS already 0.
  for (const dof of fixedDOFs) {
    entries.set(dof, new Map([[dof, diagScale]]));
    F[dof] = 0;
  }

  // Build CSR sparse matrix from accumulated entries
  const K = new CSRMatrix(nDOF, nDOF, entries);

  // --- Solve K * u = F (Preconditioned Conjugate Gradient, Jacobi preconditioner) ---
  const { x: u, converged, iterations: solverIterations } = sparsePCG(K, F, 2000, 1e-7);

  // --- Recover stress with NODAL sampling + stress-TENSOR averaging ---
  // Centroid-only recovery samples the strain at the element centre, which smears
  // the extreme-fibre bending stress toward the neutral axis: a cantilever meshed
  // one element deep came out ~56% low on σ even though its DISPLACEMENT was exact
  // (the same Ku=F solve). Instead evaluate the strain field at the 10 NODAL
  // positions of every element, accumulate the stress TENSOR at shared nodes,
  // average, then form von Mises — so the surface fibre nodes carry the true peak.
  const nodeSxx = new Float64Array(nNodes), nodeSyy = new Float64Array(nNodes), nodeSzz = new Float64Array(nNodes);
  const nodeSxy = new Float64Array(nNodes), nodeSyz = new Float64Array(nNodes), nodeSzx = new Float64Array(nNodes);
  const nodeStress  = new Float32Array(nNodes);
  const nodeDisp    = new Float32Array(nNodes);
  const nodeDispVec = new Float32Array(nNodes * 3);
  const nodeCount   = new Float32Array(nNodes);

  const lam = E * nu / ((1 + nu) * (1 - 2 * nu));
  const mu  = E / (2 * (1 + nu));
  for (const elem of elems) {
    // Sample the strain field at each of the 10 element-node positions.
    for (let a = 0; a < 10; a++) {
      const { B, detJ } = tet10B(nodes, elem, TET10_NODE_L[a]);
      if (detJ === 0) continue;
      const eps = [0, 0, 0, 0, 0, 0];
      for (let i = 0; i < 10; i++) {
        const n = elem[i];
        const ux = u[n*3], uy = u[n*3+1], uz = u[n*3+2];
        for (let r = 0; r < 6; r++) eps[r] += B[r][i*3]*ux + B[r][i*3+1]*uy + B[r][i*3+2]*uz;
      }
      const na = elem[a];
      const tr = eps[0] + eps[1] + eps[2];
      nodeSxx[na] += lam*tr + 2*mu*eps[0];
      nodeSyy[na] += lam*tr + 2*mu*eps[1];
      nodeSzz[na] += lam*tr + 2*mu*eps[2];
      nodeSxy[na] += mu*eps[3];
      nodeSyz[na] += mu*eps[4];
      nodeSzx[na] += mu*eps[5];
      nodeCount[na]++;
    }
  }

  // Average the tensor at each node → von Mises; displacement carried straight
  // from the solved DOFs.
  for (let n = 0; n < nNodes; n++) {
    const cnt = nodeCount[n] || 1;
    const sx = nodeSxx[n]/cnt, sy = nodeSyy[n]/cnt, sz = nodeSzz[n]/cnt;
    const txy = nodeSxy[n]/cnt, tyz = nodeSyz[n]/cnt, txz = nodeSzx[n]/cnt;
    nodeStress[n] = Math.sqrt(0.5 * (
      (sx-sy)**2 + (sy-sz)**2 + (sz-sx)**2 + 6 * (txy**2 + tyz**2 + txz**2)
    ));
    nodeDisp[n] = Math.sqrt(u[n*3]**2 + u[n*3+1]**2 + u[n*3+2]**2);
    nodeDispVec[n*3]   = u[n*3];
    nodeDispVec[n*3+1] = u[n*3+1];
    nodeDispVec[n*3+2] = u[n*3+2];
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
    elementCount: elems.length,
    converged,
    iterations: solverIterations,
  };
}
