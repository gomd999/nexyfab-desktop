/**
 * levelSet.ts — Signed-distance level-set surface representation.
 *
 * Level sets store the implicit surface as a scalar field φ on a
 * regular grid, where φ < 0 = inside and φ = 0 = surface. Used by:
 *
 *   - **Topology-changing simulations** — bubbles merging, fluid
 *     splashes, fracture.
 *   - **CSG with smooth blends** — same as SDF, but with re-initialised
 *     distance values keeping the field crisp.
 *   - **Curve / surface evolution** — advect the field under a velocity
 *     to grow / shrink / smooth.
 *
 * Three operations live here:
 *
 *   1. **Sample** a level-set from an SDF or scalar function.
 *   2. **Reinitialise** — restore the signed-distance property after
 *     numerical drift (fast sweeping method, simplified).
 *   3. **Advect** — move the surface along a velocity field (semi-
 *     Lagrangian step).
 *
 * Output is the updated grid, ready for marching cubes or sampling.
 */

export interface Grid3D {
  /** Grid dimensions. */
  nx: number;
  ny: number;
  nz: number;
  /** World-space cell size (mm). */
  cellMm: number;
  /** Origin in world (mm). */
  origin: [number, number, number];
  /** Cell values φ. */
  values: Float32Array;
}

// ── Construction ───────────────────────────────────────────────

export function createGrid(nx: number, ny: number, nz: number, cellMm: number, origin: [number, number, number] = [0, 0, 0]): Grid3D {
  return {
    nx, ny, nz, cellMm, origin,
    values: new Float32Array(nx * ny * nz).fill(Infinity),
  };
}

export function gridIndex(grid: Grid3D, i: number, j: number, k: number): number {
  return k * grid.nx * grid.ny + j * grid.nx + i;
}

export function gridSample(grid: Grid3D, i: number, j: number, k: number): number {
  const ci = Math.max(0, Math.min(grid.nx - 1, i));
  const cj = Math.max(0, Math.min(grid.ny - 1, j));
  const ck = Math.max(0, Math.min(grid.nz - 1, k));
  return grid.values[gridIndex(grid, ci, cj, ck)] ?? Infinity;
}

export function gridSet(grid: Grid3D, i: number, j: number, k: number, value: number): void {
  if (i < 0 || j < 0 || k < 0 || i >= grid.nx || j >= grid.ny || k >= grid.nz) return;
  grid.values[gridIndex(grid, i, j, k)] = value;
}

export function worldPos(grid: Grid3D, i: number, j: number, k: number): [number, number, number] {
  return [
    grid.origin[0] + i * grid.cellMm,
    grid.origin[1] + j * grid.cellMm,
    grid.origin[2] + k * grid.cellMm,
  ];
}

// ── Sample from SDF ────────────────────────────────────────────

export type SdfFn = (x: number, y: number, z: number) => number;

export function sampleFromSdf(grid: Grid3D, sdf: SdfFn): void {
  for (let k = 0; k < grid.nz; k++) {
    for (let j = 0; j < grid.ny; j++) {
      for (let i = 0; i < grid.nx; i++) {
        const [x, y, z] = worldPos(grid, i, j, k);
        grid.values[gridIndex(grid, i, j, k)] = sdf(x, y, z);
      }
    }
  }
}

// ── Reinitialisation (fast sweeping) ───────────────────────────

/** Restore |∇φ| = 1 around the zero-isosurface using a simplified
 *  fast sweeping method. After surface evolution the field is no
 *  longer a true signed-distance; this fixes it within a narrow band. */
export function reinitialise(grid: Grid3D, sweepCount: number = 3): void {
  const h = grid.cellMm;
  // Identify nearby cells (those with a sign change with a neighbour).
  const newValues = new Float32Array(grid.values);
  for (let pass = 0; pass < sweepCount; pass++) {
    // Sweep in 8 different directions through the grid.
    for (let sweep = 0; sweep < 8; sweep++) {
      const iStart = (sweep & 1) ? grid.nx - 1 : 0;
      const iEnd = (sweep & 1) ? -1 : grid.nx;
      const iStep = (sweep & 1) ? -1 : 1;
      const jStart = (sweep & 2) ? grid.ny - 1 : 0;
      const jEnd = (sweep & 2) ? -1 : grid.ny;
      const jStep = (sweep & 2) ? -1 : 1;
      const kStart = (sweep & 4) ? grid.nz - 1 : 0;
      const kEnd = (sweep & 4) ? -1 : grid.nz;
      const kStep = (sweep & 4) ? -1 : 1;
      for (let k = kStart; k !== kEnd; k += kStep) {
        for (let j = jStart; j !== jEnd; j += jStep) {
          for (let i = iStart; i !== iEnd; i += iStep) {
            const cur = newValues[gridIndex(grid, i, j, k)]!;
            const sign = cur < 0 ? -1 : 1;
            const a = Math.min(Math.abs(gridSample(grid, i - 1, j, k)), Math.abs(gridSample(grid, i + 1, j, k)));
            const b = Math.min(Math.abs(gridSample(grid, i, j - 1, k)), Math.abs(gridSample(grid, i, j + 1, k)));
            const c = Math.min(Math.abs(gridSample(grid, i, j, k - 1)), Math.abs(gridSample(grid, i, j, k + 1)));
            const sorted = [a, b, c].filter(v => isFinite(v)).sort((x, y) => x - y);
            let phi = sorted[0]! + h;
            if (sorted.length >= 2 && phi > sorted[1]!) {
              // Two-direction update.
              const u = (sorted[0]! + sorted[1]! + Math.sqrt(Math.max(0, 2 * h * h - (sorted[0]! - sorted[1]!) ** 2))) / 2;
              phi = u;
            }
            const absNew = Math.min(Math.abs(cur), phi);
            newValues[gridIndex(grid, i, j, k)] = sign * absNew;
          }
        }
      }
    }
  }
  grid.values = newValues;
}

// ── Advect via velocity field ──────────────────────────────────

export type VelocityFn = (x: number, y: number, z: number) => [number, number, number];

/** Semi-Lagrangian advection: for each grid cell, trace back along
 *  the velocity field by -dt and sample the value there. */
export function advect(grid: Grid3D, velocity: VelocityFn, dtSec: number): void {
  const newValues = new Float32Array(grid.values.length);
  for (let k = 0; k < grid.nz; k++) {
    for (let j = 0; j < grid.ny; j++) {
      for (let i = 0; i < grid.nx; i++) {
        const [x, y, z] = worldPos(grid, i, j, k);
        const v = velocity(x, y, z);
        const bx = (x - v[0] * dtSec - grid.origin[0]) / grid.cellMm;
        const by = (y - v[1] * dtSec - grid.origin[1]) / grid.cellMm;
        const bz = (z - v[2] * dtSec - grid.origin[2]) / grid.cellMm;
        newValues[gridIndex(grid, i, j, k)] = trilinearSample(grid, bx, by, bz);
      }
    }
  }
  grid.values = newValues;
}

function trilinearSample(grid: Grid3D, x: number, y: number, z: number): number {
  const i0 = Math.floor(x);
  const j0 = Math.floor(y);
  const k0 = Math.floor(z);
  const fx = x - i0;
  const fy = y - j0;
  const fz = z - k0;
  const v000 = gridSample(grid, i0, j0, k0);
  const v100 = gridSample(grid, i0 + 1, j0, k0);
  const v010 = gridSample(grid, i0, j0 + 1, k0);
  const v110 = gridSample(grid, i0 + 1, j0 + 1, k0);
  const v001 = gridSample(grid, i0, j0, k0 + 1);
  const v101 = gridSample(grid, i0 + 1, j0, k0 + 1);
  const v011 = gridSample(grid, i0, j0 + 1, k0 + 1);
  const v111 = gridSample(grid, i0 + 1, j0 + 1, k0 + 1);
  const c00 = v000 * (1 - fx) + v100 * fx;
  const c10 = v010 * (1 - fx) + v110 * fx;
  const c01 = v001 * (1 - fx) + v101 * fx;
  const c11 = v011 * (1 - fx) + v111 * fx;
  const c0 = c00 * (1 - fy) + c10 * fy;
  const c1 = c01 * (1 - fy) + c11 * fy;
  return c0 * (1 - fz) + c1 * fz;
}

// ── Boolean ops on grids ──────────────────────────────────────

export function unionGrids(a: Grid3D, b: Grid3D): void {
  for (let i = 0; i < a.values.length; i++) {
    a.values[i] = Math.min(a.values[i]!, b.values[i]!);
  }
}

export function intersectGrids(a: Grid3D, b: Grid3D): void {
  for (let i = 0; i < a.values.length; i++) {
    a.values[i] = Math.max(a.values[i]!, b.values[i]!);
  }
}

export function subtractGrids(a: Grid3D, b: Grid3D): void {
  for (let i = 0; i < a.values.length; i++) {
    a.values[i] = Math.max(a.values[i]!, -b.values[i]!);
  }
}

// ── Surface metrics ────────────────────────────────────────────

export interface LevelSetStats {
  /** Min φ value (most-inside). */
  minPhi: number;
  /** Max φ value. */
  maxPhi: number;
  /** Approx volume (cells × cellVolume where φ < 0). */
  approxVolumeMm3: number;
  /** Cells within ±h of the zero set. */
  narrowBandCount: number;
}

export function computeStats(grid: Grid3D): LevelSetStats {
  let minPhi = Infinity, maxPhi = -Infinity;
  let insideCount = 0;
  let narrowBand = 0;
  const h = grid.cellMm;
  for (const v of grid.values) {
    if (v < minPhi) minPhi = v;
    if (v > maxPhi) maxPhi = v;
    if (v < 0) insideCount++;
    if (Math.abs(v) <= h) narrowBand++;
  }
  const cellVol = h * h * h;
  return {
    minPhi: isFinite(minPhi) ? minPhi : 0,
    maxPhi: isFinite(maxPhi) ? maxPhi : 0,
    approxVolumeMm3: insideCount * cellVol,
    narrowBandCount: narrowBand,
  };
}
