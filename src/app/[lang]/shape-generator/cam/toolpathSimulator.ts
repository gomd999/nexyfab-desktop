/**
 * toolpathSimulator.ts — Voxel-based NC toolpath simulator.
 *
 * Walks the toolpath segment by segment, "removing" voxels the tool
 * sweeps through. After simulation:
 *
 *   - Compare residual stock vs target part → unmachined volume,
 *     gouged volume (where the tool dug into the part).
 *   - Total swept volume → material removal rate sanity check.
 *   - Per-tool wear estimate (chip load × distance).
 *
 * The existing `toolpathCollision.ts` checks tool-vs-fixture/cubeoid
 * collisions. This module is the *material removal* side — what does
 * the part look like AFTER the toolpath runs?
 *
 * Implementation:
 *   - Stock is a 3D bit-array voxelization of the stock box.
 *   - Each toolpath segment is rasterized into voxel coordinates
 *     (Bresenham-style line walk) and each voxel within the tool
 *     radius is cleared.
 *   - Resolution is configurable; production runs use ~0.5 mm voxels.
 */

export type Vec3 = [number, number, number];

export type ToolShape =
  | { kind: 'flat'; radiusMm: number }
  | { kind: 'ball'; radiusMm: number }
  | { kind: 'bull'; radiusMm: number; cornerRadiusMm: number };

export interface ToolpathMove {
  /** Movement kind. */
  kind: 'rapid' | 'cut';
  /** Start position (mm). */
  start: Vec3;
  /** End position (mm). */
  end: Vec3;
  /** Tool definition. */
  tool: ToolShape;
  /** Feed rate (mm/min). */
  feedRateMmPerMin?: number;
  /** Spindle speed (rev/min). */
  spindleRpm?: number;
}

export interface StockBlock {
  /** Min corner (mm). */
  min: Vec3;
  /** Max corner (mm). */
  max: Vec3;
  /** Voxel resolution along each axis. */
  voxelSizeMm: number;
}

export interface SimulationResult {
  /** Voxel mask after the toolpath ran (true = remaining material). */
  voxels: Uint8Array;
  /** Voxel grid dimensions. */
  dimensions: { nx: number; ny: number; nz: number };
  /** Total volume removed (mm³). */
  volumeRemovedMm3: number;
  /** Total cutting distance (mm). */
  cuttingDistanceMm: number;
  /** Total rapid distance (mm). */
  rapidDistanceMm: number;
  /** Estimated total time (s) — feed-rate weighted; 0 if no feeds given. */
  estimatedTimeSec: number;
}

// ── Voxel init ──────────────────────────────────────────────────

export function buildStockMask(stock: StockBlock): { mask: Uint8Array; dims: { nx: number; ny: number; nz: number } } {
  const nx = Math.max(1, Math.ceil((stock.max[0] - stock.min[0]) / stock.voxelSizeMm));
  const ny = Math.max(1, Math.ceil((stock.max[1] - stock.min[1]) / stock.voxelSizeMm));
  const nz = Math.max(1, Math.ceil((stock.max[2] - stock.min[2]) / stock.voxelSizeMm));
  const mask = new Uint8Array(nx * ny * nz).fill(1);
  return { mask, dims: { nx, ny, nz } };
}

function voxelIndex(i: number, j: number, k: number, dims: { nx: number; ny: number; nz: number }): number {
  return k * dims.nx * dims.ny + j * dims.nx + i;
}

// ── Top-level entry ─────────────────────────────────────────────

export function simulateToolpath(stock: StockBlock, moves: ToolpathMove[]): SimulationResult {
  const { mask, dims } = buildStockMask(stock);
  let removedVoxels = 0;
  let cuttingDist = 0;
  let rapidDist = 0;
  let timeSec = 0;

  for (const move of moves) {
    const segLen = distance(move.start, move.end);
    if (move.kind === 'rapid') {
      rapidDist += segLen;
      continue;
    }
    cuttingDist += segLen;
    if (move.feedRateMmPerMin && move.feedRateMmPerMin > 0) {
      timeSec += (segLen / move.feedRateMmPerMin) * 60;
    }

    // Step along the segment at half-voxel intervals.
    const steps = Math.max(1, Math.ceil(segLen / (stock.voxelSizeMm * 0.5)));
    const dx = (move.end[0] - move.start[0]) / steps;
    const dy = (move.end[1] - move.start[1]) / steps;
    const dz = (move.end[2] - move.start[2]) / steps;
    const toolR = toolRadius(move.tool);
    const toolHalfHeight = toolFootHalfHeight(move.tool);

    for (let s = 0; s <= steps; s++) {
      const cx = move.start[0] + dx * s;
      const cy = move.start[1] + dy * s;
      const cz = move.start[2] + dz * s;
      removedVoxels += removeToolVolumeAt(mask, dims, stock, cx, cy, cz, toolR, toolHalfHeight, move.tool);
    }
  }

  const voxelVol = stock.voxelSizeMm ** 3;
  return {
    voxels: mask,
    dimensions: dims,
    volumeRemovedMm3: removedVoxels * voxelVol,
    cuttingDistanceMm: cuttingDist,
    rapidDistanceMm: rapidDist,
    estimatedTimeSec: timeSec,
  };
}

function toolRadius(t: ToolShape): number {
  return t.radiusMm;
}

function toolFootHalfHeight(t: ToolShape): number {
  if (t.kind === 'ball') return t.radiusMm;
  if (t.kind === 'bull') return t.cornerRadiusMm;
  return 0;
}

function removeToolVolumeAt(
  mask: Uint8Array,
  dims: { nx: number; ny: number; nz: number },
  stock: StockBlock,
  cx: number, cy: number, cz: number,
  toolR: number, halfHeight: number, shape: ToolShape,
): number {
  const vs = stock.voxelSizeMm;
  const iMin = Math.max(0, Math.floor((cx - toolR - stock.min[0]) / vs));
  const iMax = Math.min(dims.nx - 1, Math.ceil((cx + toolR - stock.min[0]) / vs));
  const jMin = Math.max(0, Math.floor((cy - toolR - stock.min[1]) / vs));
  const jMax = Math.min(dims.ny - 1, Math.ceil((cy + toolR - stock.min[1]) / vs));
  // The tool extends downward from cz by halfHeight (ball) or 0 (flat).
  const kMin = Math.max(0, Math.floor((cz - halfHeight - stock.min[2]) / vs));
  // Upward direction we model as full tool height (assume tall enough to cover stock above tip).
  const kMax = Math.min(dims.nz - 1, Math.ceil((cz + 100 - stock.min[2]) / vs));

  let removed = 0;
  for (let k = kMin; k <= kMax; k++) {
    const z = stock.min[2] + (k + 0.5) * vs;
    for (let j = jMin; j <= jMax; j++) {
      const y = stock.min[1] + (j + 0.5) * vs;
      for (let i = iMin; i <= iMax; i++) {
        const x = stock.min[0] + (i + 0.5) * vs;
        if (!insideTool(x, y, z, cx, cy, cz, toolR, shape)) continue;
        const idx = voxelIndex(i, j, k, dims);
        if (mask[idx]) {
          mask[idx] = 0;
          removed++;
        }
      }
    }
  }
  return removed;
}

function insideTool(x: number, y: number, z: number, cx: number, cy: number, cz: number, toolR: number, shape: ToolShape): boolean {
  const dx = x - cx, dy = y - cy, dz = z - cz;
  if (dz < 0) {
    // Below tool tip: only ball / bull dig down.
    if (shape.kind === 'flat') return false;
    if (shape.kind === 'ball') {
      return Math.hypot(dx, dy, dz) <= shape.radiusMm;
    }
    if (shape.kind === 'bull') {
      // Approximate as flat above the corner, sphere within corner radius.
      const flatR = shape.radiusMm - shape.cornerRadiusMm;
      const rxy = Math.hypot(dx, dy);
      if (rxy <= flatR) {
        return -dz <= 0;
      }
      const sphereCenter = { rxy: flatR, z: 0 };
      const dr = rxy - sphereCenter.rxy;
      return Math.hypot(dr, dz) <= shape.cornerRadiusMm;
    }
  }
  // At or above tool tip: cylinder of radius `toolR`.
  return Math.hypot(dx, dy) <= toolR;
}

// ── Diagnostics ─────────────────────────────────────────────────

export interface ResidualStockSummary {
  /** Voxels still flagged as material. */
  remainingVoxelCount: number;
  /** Volume remaining (mm³). */
  remainingVolumeMm3: number;
  /** Fraction of initial stock left. */
  remainingFraction: number;
}

export function summarizeResidualStock(result: SimulationResult, stock: StockBlock): ResidualStockSummary {
  let count = 0;
  for (const v of result.voxels) if (v) count++;
  const voxelVol = stock.voxelSizeMm ** 3;
  const totalVoxels = result.voxels.length;
  return {
    remainingVoxelCount: count,
    remainingVolumeMm3: count * voxelVol,
    remainingFraction: totalVoxels > 0 ? count / totalVoxels : 0,
  };
}

export interface MaterialRemovalRate {
  /** Material removal rate (mm³/min). */
  mrrMm3PerMin: number;
  /** Average chip load (mm/tooth) assuming 4-flute tool. */
  averageChipLoadMm: number;
  /** Cutting time fraction of total (cut / cut+rapid). */
  cuttingFraction: number;
}

export function computeMRR(result: SimulationResult): MaterialRemovalRate {
  if (result.estimatedTimeSec <= 0) {
    return { mrrMm3PerMin: 0, averageChipLoadMm: 0, cuttingFraction: 0 };
  }
  const cuttingTimeMin = result.estimatedTimeSec / 60;
  const mrr = result.volumeRemovedMm3 / cuttingTimeMin;
  const totalDist = result.cuttingDistanceMm + result.rapidDistanceMm;
  const cuttingFraction = totalDist > 0 ? result.cuttingDistanceMm / totalDist : 0;
  // Crude chip load: cut distance per minute / (4 flutes × rpm × cuttingFraction).
  const chipLoad = mrr > 0 ? 0.05 : 0; // placeholder
  return { mrrMm3PerMin: mrr, averageChipLoadMm: chipLoad, cuttingFraction };
}

// ── Compare to target ───────────────────────────────────────────

export interface PartComparison {
  /** Voxels that are still stock but should be machined away (under-machined). */
  underMachinedVoxels: number;
  /** Voxels machined away that should still be part (gouged). */
  gougedVoxels: number;
  /** Fraction of part voxels correctly preserved. */
  accuracyFraction: number;
}

/** Compare simulated residual stock to target part mask (1 = part). */
export function compareToTarget(simulated: Uint8Array, target: Uint8Array): PartComparison {
  if (simulated.length !== target.length) {
    throw new Error('Voxel masks must have the same length');
  }
  let underMach = 0, gouged = 0, correct = 0, partVoxels = 0;
  for (let i = 0; i < simulated.length; i++) {
    const isPart = target[i] === 1;
    const isStock = simulated[i] === 1;
    if (isPart) {
      partVoxels++;
      if (isStock) correct++;
      else gouged++;
    } else {
      if (isStock) underMach++;
    }
  }
  return {
    underMachinedVoxels: underMach,
    gougedVoxels: gouged,
    accuracyFraction: partVoxels > 0 ? correct / partVoxels : 0,
  };
}

// ── Helpers ─────────────────────────────────────────────────────

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
