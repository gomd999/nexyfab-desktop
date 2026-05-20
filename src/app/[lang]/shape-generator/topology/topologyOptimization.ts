/**
 * topologyOptimization.ts — Generative design via SIMP (Solid
 * Isotropic Material with Penalization).
 *
 * The user specifies:
 *   - A *design space* (voxel grid + mask of "must stay solid"
 *     regions like mounting bosses + load attach points).
 *   - One or more *load cases* (force at a voxel) + boundary
 *     conditions (fixed voxels).
 *   - A *target volume fraction* (typical 30%–50% of full).
 *
 * SIMP iterates:
 *   1. Compute compliance (deformation energy) per element at current
 *      density distribution.
 *   2. Penalize: stiffness = density^p (typical p = 3).
 *   3. Update density via the optimality criterion (OC) method:
 *      ρ_new = ρ · sqrt(|sensitivity| / λ), bisection on λ until
 *      volume constraint is met.
 *   4. Apply a *density filter* (mean over neighbour voxels) to
 *      prevent checkerboard patterns.
 *
 * Output is the per-voxel density field → marching-cubes (already in
 * `lattice/latticeGenerator`) renders the optimized shape.
 *
 * This is a teaching-grade implementation in JS — runs in milliseconds
 * for 32³ grids. Production work uses a sparse-matrix FEA solver
 * (Eigen/SciPy) and orders-of-magnitude finer grids; the API here
 * matches that future production solver so callers stay unchanged.
 */

export interface VoxelGrid {
  /** Dimensions. */
  nx: number; ny: number; nz: number;
  /** Per-voxel density 0..1 (mutable working buffer). */
  densities: Float32Array;
  /** True for voxels that must stay solid (regardless of optimizer). */
  keepSolid?: Uint8Array;
  /** True for voxels that must stay void. */
  keepVoid?: Uint8Array;
}

export interface LoadCase {
  /** Voxel ix, iy, iz where force is applied. */
  voxelIndex: [number, number, number];
  /** Force vector (N). */
  forceN: [number, number, number];
}

export interface FixedSupport {
  /** Voxel that is fully constrained. */
  voxelIndex: [number, number, number];
}

export interface SimpOptions {
  /** SIMP penalization exponent. */
  penalty: number;
  /** Target volume fraction (0..1). */
  volumeFraction: number;
  /** Minimum density (avoids singular stiffness). */
  minDensity: number;
  /** Density-filter radius (voxels). 0 = off. */
  filterRadius: number;
  /** Max OC iterations. */
  maxIterations: number;
  /** Convergence threshold on max density change. */
  convergenceThreshold: number;
  /** Move limit per iteration. */
  moveLimit: number;
}

export const DEFAULT_SIMP_OPTIONS: SimpOptions = {
  penalty: 3,
  volumeFraction: 0.4,
  minDensity: 0.001,
  filterRadius: 1.5,
  maxIterations: 50,
  convergenceThreshold: 0.005,
  moveLimit: 0.2,
};

// ── Helpers ──────────────────────────────────────────────────────

function idx(grid: VoxelGrid, i: number, j: number, k: number): number {
  return k * grid.ny * grid.nx + j * grid.nx + i;
}

/** Very rough compliance sensitivity per voxel — we approximate the
 *  "energy at this voxel" as the sum of nearby load magnitudes weighted
 *  by inverse distance. For real FEA, this would be the per-element
 *  strain energy from the displacement solve. */
function computeSensitivity(
  grid: VoxelGrid,
  loads: LoadCase[],
  supports: FixedSupport[],
  options: SimpOptions,
): Float32Array {
  const sensitivity = new Float32Array(grid.nx * grid.ny * grid.nz);
  for (let k = 0; k < grid.nz; k++) {
    for (let j = 0; j < grid.ny; j++) {
      for (let i = 0; i < grid.nx; i++) {
        let s = 0;
        for (const load of loads) {
          const dx = i - load.voxelIndex[0];
          const dy = j - load.voxelIndex[1];
          const dz = k - load.voxelIndex[2];
          const distSq = dx * dx + dy * dy + dz * dz + 0.1;
          const fMag = Math.hypot(load.forceN[0], load.forceN[1], load.forceN[2]);
          s += fMag / distSq;
        }
        // Closer to a support → higher load path importance.
        for (const sup of supports) {
          const dx = i - sup.voxelIndex[0];
          const dy = j - sup.voxelIndex[1];
          const dz = k - sup.voxelIndex[2];
          const distSq = dx * dx + dy * dy + dz * dz + 0.1;
          s += 100 / distSq;
        }
        // Penalty exponent applied.
        const d = grid.densities[idx(grid, i, j, k)]!;
        sensitivity[idx(grid, i, j, k)] = options.penalty * Math.pow(Math.max(options.minDensity, d), options.penalty - 1) * s;
      }
    }
  }
  return sensitivity;
}

/** Density filter — replace each density with weighted mean of its
 *  neighbours within `filterRadius`. Prevents checkerboard. */
function applyDensityFilter(grid: VoxelGrid, filterRadius: number): void {
  if (filterRadius <= 0) return;
  const out = new Float32Array(grid.densities.length);
  const r = Math.ceil(filterRadius);
  for (let k = 0; k < grid.nz; k++) {
    for (let j = 0; j < grid.ny; j++) {
      for (let i = 0; i < grid.nx; i++) {
        let sumW = 0, sumWD = 0;
        for (let dk = -r; dk <= r; dk++) {
          for (let dj = -r; dj <= r; dj++) {
            for (let di = -r; di <= r; di++) {
              const ni = i + di, nj = j + dj, nk = k + dk;
              if (ni < 0 || ni >= grid.nx || nj < 0 || nj >= grid.ny || nk < 0 || nk >= grid.nz) continue;
              const dist = Math.hypot(di, dj, dk);
              if (dist > filterRadius) continue;
              const w = filterRadius - dist;
              sumW += w;
              sumWD += w * grid.densities[idx(grid, ni, nj, nk)]!;
            }
          }
        }
        out[idx(grid, i, j, k)] = sumW > 0 ? sumWD / sumW : grid.densities[idx(grid, i, j, k)]!;
      }
    }
  }
  for (let i = 0; i < grid.densities.length; i++) grid.densities[i] = out[i]!;
}

/** Optimality-criterion update — bisection on Lagrange multiplier λ
 *  until volume constraint is satisfied. */
function ocUpdate(
  grid: VoxelGrid,
  sensitivity: Float32Array,
  targetVolume: number,
  options: SimpOptions,
): void {
  let lambdaLo = 1e-9;
  let lambdaHi = 1e9;
  const newDens = new Float32Array(grid.densities.length);
  const totalVoxels = grid.densities.length;
  while (lambdaHi - lambdaLo > 1e-3) {
    const lambdaMid = (lambdaLo + lambdaHi) / 2;
    let volume = 0;
    for (let v = 0; v < totalVoxels; v++) {
      const oldD = grid.densities[v]!;
      // Optimality criterion update.
      const factor = Math.sqrt(Math.max(0, sensitivity[v]! / lambdaMid));
      let newD = Math.max(
        options.minDensity,
        Math.max(oldD - options.moveLimit,
          Math.min(1, Math.min(oldD + options.moveLimit, oldD * factor))),
      );
      if (grid.keepSolid && grid.keepSolid[v]) newD = 1;
      if (grid.keepVoid && grid.keepVoid[v]) newD = options.minDensity;
      newDens[v] = newD;
      volume += newD;
    }
    const meanDensity = volume / totalVoxels;
    if (meanDensity > targetVolume) lambdaLo = lambdaMid;
    else lambdaHi = lambdaMid;
  }
  for (let v = 0; v < totalVoxels; v++) grid.densities[v] = newDens[v]!;
}

// ── Main entry ───────────────────────────────────────────────────

export interface OptimizationResult {
  iterations: number;
  converged: boolean;
  finalVolumeFraction: number;
  /** Per-iteration max density change. */
  history: number[];
  /** Per-iteration mean density. */
  volumeHistory: number[];
}

export function optimizeTopology(
  grid: VoxelGrid,
  loads: LoadCase[],
  supports: FixedSupport[],
  options: Partial<SimpOptions> = {},
): OptimizationResult {
  const opts: SimpOptions = { ...DEFAULT_SIMP_OPTIONS, ...options };
  const history: number[] = [];
  const volHistory: number[] = [];
  // Initialize uniformly at target volume fraction.
  grid.densities.fill(opts.volumeFraction);
  if (grid.keepSolid) {
    for (let i = 0; i < grid.densities.length; i++) if (grid.keepSolid[i]) grid.densities[i] = 1;
  }

  let converged = false;
  let iter = 0;
  for (iter = 0; iter < opts.maxIterations; iter++) {
    const before = new Float32Array(grid.densities);
    const sens = computeSensitivity(grid, loads, supports, opts);
    ocUpdate(grid, sens, opts.volumeFraction, opts);
    applyDensityFilter(grid, opts.filterRadius);
    // Re-enforce hard constraints after the filter blurs them.
    if (grid.keepSolid) {
      for (let v = 0; v < grid.densities.length; v++) {
        if (grid.keepSolid[v]) grid.densities[v] = 1;
      }
    }
    if (grid.keepVoid) {
      for (let v = 0; v < grid.densities.length; v++) {
        if (grid.keepVoid[v]) grid.densities[v] = opts.minDensity;
      }
    }

    let maxChange = 0;
    let sum = 0;
    for (let v = 0; v < grid.densities.length; v++) {
      const d = Math.abs(grid.densities[v]! - before[v]!);
      if (d > maxChange) maxChange = d;
      sum += grid.densities[v]!;
    }
    history.push(maxChange);
    volHistory.push(sum / grid.densities.length);
    if (maxChange < opts.convergenceThreshold) {
      converged = true;
      iter++;
      break;
    }
  }

  return {
    iterations: iter,
    converged,
    finalVolumeFraction: volHistory[volHistory.length - 1] ?? 0,
    history,
    volumeHistory: volHistory,
  };
}

/** Convenience: threshold the optimized density field to a binary mask. */
export function thresholdToBinary(grid: VoxelGrid, threshold: number = 0.5): Uint8Array {
  const out = new Uint8Array(grid.densities.length);
  for (let i = 0; i < grid.densities.length; i++) {
    out[i] = grid.densities[i]! >= threshold ? 1 : 0;
  }
  return out;
}

/** Compute volume fraction of the current grid. */
export function volumeFraction(grid: VoxelGrid): number {
  let sum = 0;
  for (const d of grid.densities) sum += d;
  return sum / grid.densities.length;
}
