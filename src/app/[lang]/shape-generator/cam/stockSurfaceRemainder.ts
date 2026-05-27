/**
 * stockSurfaceRemainder.ts — Compute residual stock surface remaining
 * after a CAM operation (or sequence of operations).
 *
 * For each cell in a height-field representation of the stock, the
 * module tracks the residual material (initial − machined). Used to:
 *
 *   - Drive a follow-up "semi-finish" pass that only targets the
 *     unfinished regions.
 *   - Estimate residual-volume that must still be removed.
 *   - Identify locations where the previous tool couldn't reach.
 */

export interface HeightField {
  /** Cells along X. */
  cellsX: number;
  /** Cells along Y. */
  cellsY: number;
  /** Cell pitch (mm). */
  pitchMm: number;
  /** Z height per cell (mm); same length as cellsX × cellsY. */
  heights: number[];
}

export interface Operation {
  id: string;
  /** Final Z surface that this operation produces in each cell. */
  resultingHeights: HeightField;
}

export interface RemainderOptions {
  /** Threshold below which residual is treated as zero. */
  noiseFloorMm: number;
  /** Optional clip mask (true = include cell). */
  mask?: boolean[];
}

export const DEFAULT_OPTIONS: RemainderOptions = {
  noiseFloorMm: 0.001,
};

export interface RemainderResult {
  /** Per-cell residual height (mm). */
  residualHeights: number[];
  /** Cell pitch (echoed from input). */
  pitchMm: number;
  /** Cells with significant residue. */
  significantCellCount: number;
  /** Total residual volume (mm³). */
  totalResidualMm3: number;
  /** Max residual height. */
  maxResidualMm: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function computeRemainder(
  initial: HeightField,
  operations: Operation[],
  options: Partial<RemainderOptions> = {},
): RemainderResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const cellCount = initial.cellsX * initial.cellsY;
  // Final surface = min height across operations and initial.
  const finalSurface = initial.heights.slice();
  for (const op of operations) {
    if (op.resultingHeights.heights.length !== cellCount) continue;
    for (let i = 0; i < cellCount; i++) {
      const opH = op.resultingHeights.heights[i]!;
      if (opH < finalSurface[i]!) finalSurface[i] = opH;
    }
  }
  // Residual = initial − final. But that's the material removed, not remaining.
  // For remainder against a target part shape, we'd need the target. Here we
  // assume zero is the target (cut down to z=0); so remainder = final − 0 = final.
  // We treat heights >= noise floor as remaining.
  const residual = finalSurface.map(h => Math.max(0, h));
  let significant = 0;
  let totalVol = 0;
  let maxRes = 0;
  for (let i = 0; i < cellCount; i++) {
    if (opts.mask && !opts.mask[i]) continue;
    const h = residual[i]!;
    if (h > opts.noiseFloorMm) significant++;
    totalVol += h * initial.pitchMm * initial.pitchMm;
    if (h > maxRes) maxRes = h;
  }
  return {
    residualHeights: residual,
    pitchMm: initial.pitchMm,
    significantCellCount: significant,
    totalResidualMm3: totalVol,
    maxResidualMm: maxRes,
  };
}

// ── Identify remainder regions by flood-fill ─────────────────

export interface RemainderRegion {
  id: number;
  cellIndices: number[];
  /** Bounding box in mm. */
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  meanHeightMm: number;
  /** Recommended tool diameter ≈ min(width, height). */
  recommendedToolDiaMm: number;
}

export function findRemainderRegions(result: RemainderResult, initial: HeightField, threshold: number = 0.01): RemainderRegion[] {
  const { cellsX, cellsY } = initial;
  const visited = new Uint8Array(cellsX * cellsY);
  const regions: RemainderRegion[] = [];
  let nextId = 0;
  for (let y = 0; y < cellsY; y++) {
    for (let x = 0; x < cellsX; x++) {
      const idx = y * cellsX + x;
      if (visited[idx] || result.residualHeights[idx]! < threshold) continue;
      const cluster = flood(cellsX, cellsY, x, y, result.residualHeights, threshold, visited);
      if (cluster.length === 0) continue;
      const region = buildRegion(nextId++, cluster, cellsX, result, initial.pitchMm);
      regions.push(region);
    }
  }
  return regions;
}

function flood(cellsX: number, cellsY: number, startX: number, startY: number, heights: number[], threshold: number, visited: Uint8Array): number[] {
  const out: number[] = [];
  const stack: { x: number; y: number }[] = [{ x: startX, y: startY }];
  while (stack.length > 0) {
    const { x, y } = stack.pop()!;
    if (x < 0 || x >= cellsX || y < 0 || y >= cellsY) continue;
    const idx = y * cellsX + x;
    if (visited[idx]) continue;
    if (heights[idx]! < threshold) continue;
    visited[idx] = 1;
    out.push(idx);
    stack.push({ x: x + 1, y });
    stack.push({ x: x - 1, y });
    stack.push({ x, y: y + 1 });
    stack.push({ x, y: y - 1 });
  }
  return out;
}

function buildRegion(id: number, cluster: number[], cellsX: number, result: RemainderResult, pitchMm: number): RemainderRegion {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let totalHeight = 0;
  for (const idx of cluster) {
    const x = idx % cellsX;
    const y = Math.floor(idx / cellsX);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    totalHeight += result.residualHeights[idx]!;
  }
  const w = (maxX - minX + 1) * pitchMm;
  const h = (maxY - minY + 1) * pitchMm;
  return {
    id,
    cellIndices: cluster,
    bbox: { minX: minX * pitchMm, minY: minY * pitchMm, maxX: (maxX + 1) * pitchMm, maxY: (maxY + 1) * pitchMm },
    meanHeightMm: totalHeight / cluster.length,
    recommendedToolDiaMm: Math.min(w, h) * 0.5,
  };
}

// ── Estimate post-op surface roughness from remainder ────────

export function residualRoughnessEstimate(result: RemainderResult): number {
  // RMS height as proxy for Ra.
  let sum = 0;
  let count = 0;
  for (const h of result.residualHeights) {
    sum += h * h;
    count++;
  }
  return count === 0 ? 0 : Math.sqrt(sum / count);
}

// ── Summary ────────────────────────────────────────────────────

export interface RemainderSummary {
  significantCellCount: number;
  totalResidualMm3: number;
  maxResidualMm: number;
  averageResidualMm: number;
}

export function summarize(result: RemainderResult): RemainderSummary {
  let sum = 0;
  let count = 0;
  for (const h of result.residualHeights) {
    sum += h;
    count++;
  }
  return {
    significantCellCount: result.significantCellCount,
    totalResidualMm3: result.totalResidualMm3,
    maxResidualMm: result.maxResidualMm,
    averageResidualMm: count === 0 ? 0 : sum / count,
  };
}
