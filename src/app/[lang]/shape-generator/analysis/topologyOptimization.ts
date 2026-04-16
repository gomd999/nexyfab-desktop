import * as THREE from 'three';

export interface TopologyConfig {
  volumeFraction: number;   // target % of material to keep (0.3 = 30%)
  iterations: number;       // optimization iterations (20-50 practical)
  penaltyExp: number;       // SIMP penalty p (typically 3)
  filterRadius: number;     // density filter radius (smoothing)
  gridX: number;            // grid resolution X
  gridY: number;            // grid resolution Y
  gridZ: number;            // grid resolution Z
  fixedFaces: number[];     // face indices for fixed boundary (0=bottom, 1=top, etc.)
  loadFace: number;         // face index where load is applied
  loadDirection: [number, number, number]; // load vector
}

export interface TopologyResult {
  densities: Float32Array;  // per-element density ρ
  gridX: number;
  gridY: number;
  gridZ: number;
  boundingBox: { min: THREE.Vector3; max: THREE.Vector3 };
  compliance: number;       // structural compliance (lower = stiffer)
  volumeFraction: number;   // achieved volume fraction
  iterations: number;
  converged: boolean;
}

const DEFAULT_CONFIG: TopologyConfig = {
  volumeFraction: 0.4,
  iterations: 30,
  penaltyExp: 3,
  filterRadius: 1.5,
  gridX: 20,
  gridY: 20,
  gridZ: 20,
  fixedFaces: [0],
  loadFace: 1,
  loadDirection: [0, -1, 0],
};

// ─── 2D Q4 Plane-Stress FEA (for SIMP sensitivity computation) ───────────────

const NU = 0.3; // Poisson's ratio

/**
 * Pre-compute 8×8 Q4 element stiffness matrix for a unit square with E=1, ν=NU.
 * Uses 2×2 Gauss quadrature.
 */
function buildQ4ElementStiffness(): Float64Array {
  const c = 1 / (1 - NU * NU);
  const D = [
    [c,       c * NU,  0                 ],
    [c * NU,  c,       0                 ],
    [0,       0,       c * (1 - NU) / 2  ],
  ];

  const K0 = new Float64Array(64);
  const g  = 1 / Math.sqrt(3); // Gauss point at ±1/√3

  for (const s of [-g, g]) {
    for (const t of [-g, g]) {
      // Shape fn derivatives in natural coords (4 nodes, CCW from bottom-left)
      const dNs = [-(1 - t) / 4,  (1 - t) / 4,  (1 + t) / 4, -(1 + t) / 4];
      const dNt = [-(1 - s) / 4, -(1 + s) / 4,  (1 + s) / 4,  (1 - s) / 4];
      // Unit square Jacobian: J = diag(0.5, 0.5) → detJ = 0.25, dN/dx = 2·dN/ds
      const dNx = dNs.map(v => v * 2);
      const dNy = dNt.map(v => v * 2);

      // B matrix rows: [εxx; εyy; γxy], 8 cols (u0,v0, u1,v1, u2,v2, u3,v3)
      const B: number[][] = [Array(8).fill(0), Array(8).fill(0), Array(8).fill(0)];
      for (let i = 0; i < 4; i++) {
        B[0][2*i]   = dNx[i];
        B[1][2*i+1] = dNy[i];
        B[2][2*i]   = dNy[i];
        B[2][2*i+1] = dNx[i];
      }

      // DB = D·B (3×8)
      const DB: number[][] = [Array(8).fill(0), Array(8).fill(0), Array(8).fill(0)];
      for (let r = 0; r < 3; r++)
        for (let c2 = 0; c2 < 8; c2++)
          for (let k = 0; k < 3; k++) DB[r][c2] += D[r][k] * B[k][c2];

      // K0 += Bᵀ DB · detJ (weights = 1×1 = 1)
      for (let r = 0; r < 8; r++)
        for (let c2 = 0; c2 < 8; c2++) {
          let sum = 0;
          for (let k = 0; k < 3; k++) sum += B[k][r] * DB[k][c2];
          K0[r * 8 + c2] += sum * 0.25;
        }
    }
  }

  return K0;
}

/** Sparse matrix: rows contain (col, value) pairs for non-zero entries. */
interface SparseMat {
  n:    number;
  cols: Int32Array[];
  vals: Float64Array[];
}

/**
 * Assemble sparse global K for a 2D nX×nY element grid.
 * Element stiffness = ρ_e^p · K0.
 */
function assembleKSparse(
  rho2d: Float32Array,
  nX:    number,
  nY:    number,
  K0:    Float64Array,
  p:     number,
): SparseMat {
  const nNodes = (nX + 1) * (nY + 1);
  const nDof   = 2 * nNodes;
  const entries = new Map<number, Map<number, number>>();

  const add = (r: number, c: number, v: number) => {
    let row = entries.get(r);
    if (!row) { row = new Map(); entries.set(r, row); }
    row.set(c, (row.get(c) ?? 0) + v);
  };

  const nId = (ex: number, ey: number) => ex * (nY + 1) + ey;

  for (let ex = 0; ex < nX; ex++) {
    for (let ey = 0; ey < nY; ey++) {
      const rhoP = Math.pow(Math.max(1e-4, rho2d[ex * nY + ey]), p);
      const ns  = [nId(ex, ey), nId(ex+1, ey), nId(ex+1, ey+1), nId(ex, ey+1)];
      const dof = [2*ns[0], 2*ns[0]+1, 2*ns[1], 2*ns[1]+1,
                   2*ns[2], 2*ns[2]+1, 2*ns[3], 2*ns[3]+1];
      for (let i = 0; i < 8; i++)
        for (let j = 0; j < 8; j++)
          add(dof[i], dof[j], rhoP * K0[i * 8 + j]);
    }
  }

  const cols: Int32Array[]   = [];
  const vals: Float64Array[] = [];
  for (let r = 0; r < nDof; r++) {
    const row = entries.get(r) ?? new Map<number, number>();
    const sorted = [...row.keys()].sort((a, b) => a - b);
    cols.push(new Int32Array(sorted));
    vals.push(new Float64Array(sorted.map(c => row.get(c)!)));
  }

  return { n: nDof, cols, vals };
}

/** Sparse matrix-vector product y = K·x. */
function spMv(K: SparseMat, x: Float64Array): Float64Array {
  const y = new Float64Array(K.n);
  for (let i = 0; i < K.n; i++) {
    const c = K.cols[i], v = K.vals[i];
    let s = 0;
    for (let j = 0; j < c.length; j++) s += v[j] * x[c[j]];
    y[i] = s;
  }
  return y;
}

function dotf(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * Preconditioned CG solver with diagonal preconditioner.
 * Dirichlet BCs enforced by zero-row/col + large diagonal.
 */
function cgSolveSparse(
  K:         SparseMat,
  f:         Float64Array,
  fixedDofs: number[],
  maxIter = 300,
  tol = 1e-8,
): Float64Array {
  const n    = K.n;
  const fixedSet = new Set(fixedDofs);

  // Modify K in-place for BCs (large diagonal penalty)
  const penalty = 1e20;
  for (const d of fixedDofs) {
    K.vals[d] = new Float64Array(K.cols[d].length);
    const selfIdx = K.cols[d].indexOf(d);
    if (selfIdx >= 0) K.vals[d][selfIdx] = penalty;
    else { K.cols[d] = new Int32Array([...K.cols[d], d]); K.vals[d] = new Float64Array([...K.vals[d], penalty]); }
    // zero out column d in other rows
    for (let r = 0; r < n; r++) {
      if (fixedSet.has(r)) continue;
      const ci = K.cols[r];
      for (let j = 0; j < ci.length; j++) {
        if (ci[j] === d) { K.vals[r][j] = 0; break; }
      }
    }
  }

  // Zero out load on fixed DOFs
  const fmod = f.slice();
  for (const d of fixedDofs) fmod[d] = 0;

  // Diagonal preconditioner M = diag(K)
  const Minv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const ci = K.cols[i];
    let diag = 1;
    for (let j = 0; j < ci.length; j++) if (ci[j] === i) { diag = K.vals[i][j]; break; }
    Minv[i] = diag > 0 ? 1 / diag : 1;
  }

  const x  = new Float64Array(n);
  const r  = fmod.slice();
  const z  = r.map((v, i) => v * Minv[i]) as Float64Array;
  const p  = z.slice();
  let rz   = dotf(r, z);

  for (let iter = 0; iter < maxIter; iter++) {
    const Ap    = spMv(K, p);
    const alpha = rz / dotf(p, Ap);
    for (let i = 0; i < n; i++) { x[i] += alpha * p[i]; r[i] -= alpha * Ap[i]; }
    for (let i = 0; i < n; i++) z[i] = r[i] * Minv[i];
    const rzNew = dotf(r, z);
    if (Math.sqrt(dotf(r, r)) < tol) break;
    const beta = rzNew / rz;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
    rz = rzNew;
  }

  return x;
}

// ─── Pre-built Q4 element stiffness (computed once, shared across iterations) ─
const K0_Q4 = buildQ4ElementStiffness();

/**
 * Run SIMP topology optimization on a voxel grid.
 * Uses a proper 2D Q4 plane-stress FEA to compute element sensitivities.
 * The 2D FEA runs on the XY cross-section and sensitivities are replicated to 3D.
 * Uses Optimality Criteria (OC) update scheme.
 */
export async function runTopologyOptimization(
  geometry: THREE.BufferGeometry,
  config: Partial<TopologyConfig> = {},
  onProgress?: (iter: number, compliance: number, vf: number, densities: Float32Array) => void,
): Promise<TopologyResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { gridX, gridY, gridZ, penaltyExp, filterRadius } = cfg;
  const N = gridX * gridY * gridZ;

  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;

  // Initialize densities uniformly at target volume fraction
  const rho = new Float32Array(N).fill(cfg.volumeFraction);
  const dc  = new Float32Array(N);

  function idx(x: number, y: number, z: number) {
    return x * gridY * gridZ + y * gridZ + z;
  }

  const active = new Uint8Array(N).fill(1);

  // ── 2D FEA setup ──────────────────────────────────────────────────────────
  // Face mapping: 0=bottom(minY), 1=top(maxY), 2=front(minZ)=approx ey=0,
  //               3=back=approx ey=gridY, 4=left(minX) ey=0, 5=right(maxX) ey=gridY
  const nNodes2d = (gridX + 1) * (gridY + 1);
  const nDof2d   = 2 * nNodes2d;
  const nId2d    = (ex: number, ey: number) => ex * (gridY + 1) + ey;

  // Build fixed DOFs from fixedFaces
  const fixedDofSet = new Set<number>();
  const addFixed = (ex: number, ey: number) => {
    const n = nId2d(Math.min(gridX, Math.max(0, ex)), Math.min(gridY, Math.max(0, ey)));
    fixedDofSet.add(2 * n); fixedDofSet.add(2 * n + 1);
  };
  for (const face of cfg.fixedFaces) {
    if (face === 0) for (let x = 0; x <= gridX; x++) addFixed(x, 0);         // bottom
    if (face === 1) for (let x = 0; x <= gridX; x++) addFixed(x, gridY);     // top
    if (face === 4) for (let y = 0; y <= gridY; y++) addFixed(0, y);         // left
    if (face === 5) for (let y = 0; y <= gridY; y++) addFixed(gridX, y);     // right
  }
  const fixedDofs2d = [...fixedDofSet];

  // Build load vector — apply uniform traction on the load face
  const f2d = new Float64Array(nDof2d);
  const loadDir = new THREE.Vector3(...cfg.loadDirection).normalize();
  const applyLoad = (ex: number, ey: number) => {
    const n = nId2d(Math.min(gridX, Math.max(0, ex)), Math.min(gridY, Math.max(0, ey)));
    if (!fixedDofSet.has(2 * n))   f2d[2 * n]     += loadDir.x;
    if (!fixedDofSet.has(2*n+1))   f2d[2 * n + 1] += loadDir.y;
  };
  const lf = cfg.loadFace;
  if (lf === 0) for (let x = 0; x <= gridX; x++) applyLoad(x, 0);
  if (lf === 1) for (let x = 0; x <= gridX; x++) applyLoad(x, gridY);
  if (lf === 4) for (let y = 0; y <= gridY; y++) applyLoad(0, y);
  if (lf === 5) for (let y = 0; y <= gridY; y++) applyLoad(gridX, y);
  // Normalize load
  let fNorm = 0;
  for (let i = 0; i < nDof2d; i++) fNorm += f2d[i] * f2d[i];
  fNorm = Math.sqrt(fNorm) || 1;
  for (let i = 0; i < nDof2d; i++) f2d[i] /= fNorm;

  // Ensure at least one fixed DOF to prevent rigid body motion
  if (fixedDofs2d.length === 0) { fixedDofs2d.push(0, 1); }

  let compliance = Infinity;
  let converged  = false;

  for (let iter = 0; iter < cfg.iterations; iter++) {
    // ── Step 1: Average rho along Z to get 2D element densities ──────────────
    const rho2d = new Float32Array(gridX * gridY);
    for (let ex = 0; ex < gridX; ex++)
      for (let ey = 0; ey < gridY; ey++) {
        let sum = 0;
        for (let ez = 0; ez < gridZ; ez++) sum += rho[idx(ex, ey, ez)];
        rho2d[ex * gridY + ey] = sum / gridZ;
      }

    // ── Step 2: Assemble sparse K and solve K·u = f ───────────────────────────
    const K = assembleKSparse(rho2d, gridX, gridY, K0_Q4, penaltyExp);
    const u = cgSolveSparse(K, f2d.slice(), fixedDofs2d.slice());

    // ── Step 3: Compute 2D element sensitivities ──────────────────────────────
    const dc2d = new Float32Array(gridX * gridY);
    compliance = 0;
    for (let ex = 0; ex < gridX; ex++) {
      for (let ey = 0; ey < gridY; ey++) {
        const ns  = [nId2d(ex, ey), nId2d(ex+1, ey), nId2d(ex+1, ey+1), nId2d(ex, ey+1)];
        const dof = [2*ns[0], 2*ns[0]+1, 2*ns[1], 2*ns[1]+1,
                     2*ns[2], 2*ns[2]+1, 2*ns[3], 2*ns[3]+1];
        // ueᵀ K0 ue — element strain energy at full density
        let ueK0ue = 0;
        for (let i = 0; i < 8; i++)
          for (let j = 0; j < 8; j++)
            ueK0ue += u[dof[i]] * K0_Q4[i * 8 + j] * u[dof[j]];
        const rhoE = Math.max(1e-4, rho2d[ex * gridY + ey]);
        dc2d[ex * gridY + ey] = -penaltyExp * Math.pow(rhoE, penaltyExp - 1) * ueK0ue;
        compliance += Math.pow(rhoE, penaltyExp) * ueK0ue;
      }
    }

    // ── Step 4: Map 2D sensitivities to 3D (replicate across Z) ──────────────
    for (let x = 0; x < gridX; x++)
      for (let y = 0; y < gridY; y++)
        for (let z = 0; z < gridZ; z++)
          dc[idx(x, y, z)] = active[idx(x, y, z)] ? dc2d[x * gridY + y] : 0;

    // ── Step 5: Density filter (smooth sensitivities to avoid checkerboard) ──
    const dcFiltered = new Float32Array(dc);
    const r = Math.ceil(filterRadius);
    for (let x = 0; x < gridX; x++) {
      for (let y = 0; y < gridY; y++) {
        for (let z = 0; z < gridZ; z++) {
          const i = idx(x, y, z);
          if (!active[i]) continue;
          let sum = 0, wsum = 0;
          for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
              for (let dz = -r; dz <= r; dz++) {
                const nx2 = x + dx, ny2 = y + dy, nz2 = z + dz;
                if (nx2 < 0 || nx2 >= gridX || ny2 < 0 || ny2 >= gridY || nz2 < 0 || nz2 >= gridZ) continue;
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (dist > filterRadius) continue;
                const w = filterRadius - dist;
                const j = idx(nx2, ny2, nz2);
                sum += w * rho[j] * dc[j];
                wsum += w * rho[j];
              }
            }
          }
          dcFiltered[i] = wsum > 0 ? sum / wsum : dc[i];
        }
      }
    }

    // ── Step 6: OC (Optimality Criteria) density update ──
    // Bisection to find Lagrange multiplier λ satisfying volume constraint
    let lo = 0, hi = 1e9;
    const rhoNew = new Float32Array(rho);

    for (let bisect = 0; bisect < 40; bisect++) {
      const lmid = (lo + hi) / 2;
      let vol = 0;
      for (let i = 0; i < N; i++) {
        if (!active[i]) continue;
        const oc = rho[i] * Math.sqrt(Math.max(0, -dcFiltered[i] / lmid));
        rhoNew[i] = Math.min(1, Math.min(rho[i] + 0.2, Math.max(0, Math.max(rho[i] - 0.2, oc))));
        vol += rhoNew[i];
      }
      if (vol / N > cfg.volumeFraction) lo = lmid; else hi = lmid;
    }

    // Check convergence
    let maxChange = 0;
    for (let i = 0; i < N; i++) {
      maxChange = Math.max(maxChange, Math.abs(rhoNew[i] - rho[i]));
      rho[i] = rhoNew[i];
    }

    const currentVF = rho.reduce((s, v) => s + v, 0) / N;
    onProgress?.(iter + 1, compliance, currentVF, rho);

    if (maxChange < 0.001 && iter > 5) { converged = true; break; }

    // yield to browser event loop every 5 iterations
    if (iter % 5 === 4) await new Promise(r2 => setTimeout(r2, 0));
  }

  return {
    densities: rho,
    gridX, gridY, gridZ,
    boundingBox: { min: bb.min.clone(), max: bb.max.clone() },
    compliance,
    volumeFraction: rho.reduce((s, v) => s + v, 0) / N,
    iterations: cfg.iterations,
    converged,
  };
}

// ─── Manufacturability Assessment ────────────────────────────────────────────

export type MfgProcess = 'cnc' | 'fdm' | 'sls' | 'sheetmetal' | 'injection';
export type MfgFeasibility = 'feasible' | 'challenging' | 'not_recommended';

export interface ManufacturabilityFlag {
  process: MfgProcess;
  label: string;
  feasibility: MfgFeasibility;
  score: number;     // 0-100, higher = more manufacturable
  reasons: string[];
  reasonsKo: string[];
}

/**
 * Analyse a topology result and return per-process manufacturability flags.
 * Uses density-field heuristics: overhang ratio, flatness, feature thickness.
 */
export function assessManufacturability(result: TopologyResult, threshold = 0.5): ManufacturabilityFlag[] {
  const { densities, gridX, gridY, gridZ, volumeFraction } = result;

  function idx(x: number, y: number, z: number) {
    return x * gridY * gridZ + y * gridZ + z;
  }

  const solid = (x: number, y: number, z: number): boolean => {
    if (x < 0 || x >= gridX || y < 0 || y >= gridY || z < 0 || z >= gridZ) return false;
    return densities[idx(x, y, z)] >= threshold;
  };

  let totalSolid = 0;
  let overhangCount = 0;    // solid voxel with empty voxel directly below (Y-)
  let thinFeatures = 0;     // solid voxel with few solid face-neighbors
  let flatLayers = 0;       // solid voxels in Y=0..1 layer (sheet-metal indicator)

  for (let x = 0; x < gridX; x++) {
    for (let y = 0; y < gridY; y++) {
      for (let z = 0; z < gridZ; z++) {
        if (!solid(x, y, z)) continue;
        totalSolid++;

        // Overhang: solid but nothing below in Y direction
        if (y > 0 && !solid(x, y - 1, z)) overhangCount++;

        // Thin feature: count face neighbors
        let faceNeighbors = 0;
        if (solid(x + 1, y, z)) faceNeighbors++;
        if (solid(x - 1, y, z)) faceNeighbors++;
        if (solid(x, y + 1, z)) faceNeighbors++;
        if (solid(x, y - 1, z)) faceNeighbors++;
        if (solid(x, y, z + 1)) faceNeighbors++;
        if (solid(x, y, z - 1)) faceNeighbors++;
        if (faceNeighbors <= 1) thinFeatures++;

        // Flat indicator: voxels concentrated in bottom 2 Y-layers
        if (y <= 1) flatLayers++;
      }
    }
  }

  if (totalSolid === 0) return [];

  const overhangRatio = overhangCount / totalSolid;       // 0 = no overhangs, 1 = everything overhangs
  const thinRatio = thinFeatures / totalSolid;            // isolated/thin features fraction
  const flatRatio = flatLayers / totalSolid;              // fraction of material in bottom 2 layers
  const materialDensity = volumeFraction;                 // kept material fraction (0-1)

  // ── CNC ───────────────────────────────────────────────────────────────────
  // Penalize for: high overhang (needs 5-axis or special fixturing), thin features, low volume fraction (many pockets)
  const cncScore = Math.round(
    100 * (1 - overhangRatio * 0.6 - thinRatio * 0.3 - Math.max(0, 0.3 - materialDensity) * 0.5),
  );
  const cncReasons: string[] = [];
  const cncReasonsKo: string[] = [];
  if (overhangRatio > 0.3) { cncReasons.push(`${(overhangRatio * 100).toFixed(0)}% overhang — may require 5-axis or re-fixturing`); cncReasonsKo.push(`${(overhangRatio * 100).toFixed(0)}% 오버행 — 5축 가공 또는 재고정 필요`); }
  if (thinRatio > 0.15) { cncReasons.push('Thin/isolated features detected — tool deflection risk'); cncReasonsKo.push('얇은/고립 피처 감지 — 공구 처짐 위험'); }
  if (materialDensity < 0.25) { cncReasons.push('Low density — many deep pockets increase machining time'); cncReasonsKo.push('낮은 밀도 — 깊은 포켓이 많아 가공 시간 증가'); }
  if (cncReasons.length === 0) { cncReasons.push('Topology is suitable for CNC subtractive machining'); cncReasonsKo.push('CNC 절삭 가공에 적합한 위상 구조입니다'); }
  const cncFeasibility: MfgFeasibility = cncScore >= 60 ? 'feasible' : cncScore >= 35 ? 'challenging' : 'not_recommended';

  // ── FDM (filament 3D printing) ─────────────────────────────────────────────
  // Penalize large overhang (>45° needs support), thin walls (< 2 voxels)
  // FDM can handle moderate overhangs with support material
  const fdmScore = Math.round(
    100 * (1 - overhangRatio * 0.35 - thinRatio * 0.2),
  );
  const fdmReasons: string[] = [];
  const fdmReasonsKo: string[] = [];
  if (overhangRatio > 0.4) { fdmReasons.push(`${(overhangRatio * 100).toFixed(0)}% overhang — support material required, increases material cost`); fdmReasonsKo.push(`${(overhangRatio * 100).toFixed(0)}% 오버행 — 서포트 재료 필요, 비용 증가`); }
  if (thinRatio > 0.2) { fdmReasons.push('Fine features may not print reliably at standard nozzle diameter'); fdmReasonsKo.push('표준 노즐 직경에서 미세 피처 출력 신뢰성 낮음'); }
  if (fdmReasons.length === 0) { fdmReasons.push('Topology is printable with FDM; consider orientation for minimal support'); fdmReasonsKo.push('FDM 출력 가능, 서포트 최소화를 위한 출력 방향 설정 권장'); }
  const fdmFeasibility: MfgFeasibility = fdmScore >= 55 ? 'feasible' : fdmScore >= 30 ? 'challenging' : 'not_recommended';

  // ── SLS (powder bed) ──────────────────────────────────────────────────────
  // SLS is self-supporting — no overhang penalty. Only thin features matter.
  const slsScore = Math.round(100 * (1 - thinRatio * 0.3));
  const slsReasons: string[] = [];
  const slsReasonsKo: string[] = [];
  slsReasons.push('SLS is self-supporting — no overhang constraints');
  slsReasonsKo.push('SLS는 자체 지지 — 오버행 제약 없음');
  if (thinRatio > 0.25) { slsReasons.push('Very thin features may lose powder during depowdering'); slsReasonsKo.push('매우 얇은 피처는 탈분말 중 손실 위험'); }
  const slsFeasibility: MfgFeasibility = slsScore >= 70 ? 'feasible' : 'challenging';

  // ── Sheet Metal ────────────────────────────────────────────────────────────
  // Only feasible if the topology is essentially planar (flatRatio high, low complexity)
  const sheetScore = Math.round(
    100 * (flatRatio * 0.7 + (1 - overhangRatio) * 0.3) * (materialDensity > 0.6 ? 1 : 0.5),
  );
  const sheetReasons: string[] = [];
  const sheetReasonsKo: string[] = [];
  if (flatRatio < 0.3) { sheetReasons.push('Topology is volumetric — sheet metal requires essentially 2D structure'); sheetReasonsKo.push('위상이 입체적 — 판금은 본질적으로 2D 구조 필요'); }
  if (overhangRatio > 0.2) { sheetReasons.push('Significant 3D overhangs cannot be formed by bending'); sheetReasonsKo.push('3D 오버행은 절곡으로 성형 불가'); }
  if (sheetReasons.length === 0) { sheetReasons.push('Relatively flat topology — sheet metal forming may be viable'); sheetReasonsKo.push('비교적 평면적 구조 — 판금 성형 고려 가능'); }
  const sheetFeasibility: MfgFeasibility = sheetScore >= 50 ? 'feasible' : sheetScore >= 25 ? 'challenging' : 'not_recommended';

  // ── Injection Molding ──────────────────────────────────────────────────────
  // Needs: reasonable wall thickness uniformity, no internal undercuts, volume fraction ≥ 0.35
  const injScore = Math.round(
    100 * (1 - overhangRatio * 0.5 - thinRatio * 0.4 - Math.max(0, 0.35 - materialDensity) * 0.8),
  );
  const injReasons: string[] = [];
  const injReasonsKo: string[] = [];
  if (overhangRatio > 0.25) { injReasons.push('Internal undercuts detected — side-action slides required, increases tooling cost'); injReasonsKo.push('내부 언더컷 감지 — 슬라이드 코어 필요, 금형 비용 증가'); }
  if (materialDensity < 0.35) { injReasons.push('Very low volume fraction — excessive core complexity'); injReasonsKo.push('매우 낮은 체적 분율 — 코어 복잡도 과다'); }
  if (thinRatio > 0.2) { injReasons.push('Thin features may cause short-shots or sink marks'); injReasonsKo.push('얇은 피처 — 미성형 또는 싱크마크 위험'); }
  if (injReasons.length === 0) { injReasons.push('Topology is compatible with injection molding'); injReasonsKo.push('사출 성형 가능한 위상 구조'); }
  const injFeasibility: MfgFeasibility = injScore >= 55 ? 'feasible' : injScore >= 30 ? 'challenging' : 'not_recommended';

  return ([
    { process: 'cnc' as MfgProcess, label: 'CNC Machining', feasibility: cncFeasibility, score: Math.max(0, cncScore), reasons: cncReasons, reasonsKo: cncReasonsKo },
    { process: 'fdm' as MfgProcess, label: 'FDM 3D Print', feasibility: fdmFeasibility, score: Math.max(0, fdmScore), reasons: fdmReasons, reasonsKo: fdmReasonsKo },
    { process: 'sls' as MfgProcess, label: 'SLS Powder Bed', feasibility: slsFeasibility, score: Math.max(0, slsScore), reasons: slsReasons, reasonsKo: slsReasonsKo },
    { process: 'sheetmetal' as MfgProcess, label: 'Sheet Metal', feasibility: sheetFeasibility, score: Math.max(0, sheetScore), reasons: sheetReasons, reasonsKo: sheetReasonsKo },
    { process: 'injection' as MfgProcess, label: 'Injection Molding', feasibility: injFeasibility, score: Math.max(0, injScore), reasons: injReasons, reasonsKo: injReasonsKo },
  ] as ManufacturabilityFlag[]).sort((a, b) => b.score - a.score);
}

/**
 * Convert topology optimization result to a renderable BufferGeometry.
 * Renders voxels above threshold density as cubes.
 */
export function topologyResultToGeometry(
  result: TopologyResult,
  threshold = 0.5,
): THREE.BufferGeometry {
  const { densities, gridX, gridY, gridZ, boundingBox } = result;
  const { min, max } = boundingBox;

  const sx = (max.x - min.x) / gridX;
  const sy = (max.y - min.y) / gridY;
  const sz = (max.z - min.z) / gridZ;

  const verts: number[] = [];
  const norms: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];

  // Cube face normals and vertices (unit cube, 6 faces)
  const faceNormals = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const faceDirs = [
    [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
    [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
    [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
    [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
    [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
  ];

  function addVoxel(x: number, y: number, z: number, density: number) {
    const wx = min.x + x * sx;
    const wy = min.y + y * sy;
    const wz = min.z + z * sz;
    const t = (density - threshold) / (1 - threshold);
    // Color: blue (low density) → red (high density)
    const r = t; const g = 0.3; const b = 1 - t;

    for (let f = 0; f < 6; f++) {
      const base = verts.length / 3;
      const fn = faceNormals[f];
      for (const [dx, dy, dz] of faceDirs[f]) {
        verts.push(wx + dx * sx, wy + dy * sy, wz + dz * sz);
        norms.push(...fn);
        colors.push(r, g, b);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  for (let x = 0; x < gridX; x++) {
    for (let y = 0; y < gridY; y++) {
      for (let z = 0; z < gridZ; z++) {
        const i = x * gridY * gridZ + y * gridZ + z;
        if (densities[i] >= threshold) addVoxel(x, y, z, densities[i]);
      }
    }
  }

  if (verts.length === 0) return new THREE.BufferGeometry();

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  return geo;
}
