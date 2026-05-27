/**
 * dimensionChainStagger.ts — Auto-place chain-dimension text in
 * staggered rows so labels don't pile up on a tight chain.
 *
 * When dimensioning many features along one line (e.g., a row of
 * holes), labels overlap if all sit on one extension-line stack.
 * Staggering them into 2-3 alternating rows fixes this.
 *
 * Module:
 *   - Walks dimensions in sequence along an axis.
 *   - Distributes them across N stagger rows.
 *   - Reports the row index per dimension + the global stack height.
 */

export interface Vec2 { x: number; y: number }

export interface ChainDimension {
  id: string;
  /** Position along the chain axis (mm). */
  axisPosition: number;
  /** Label text width (mm). */
  textWidthMm: number;
}

export interface StaggerOptions {
  /** Number of rows. */
  rowCount: number;
  /** Vertical spacing between rows (mm). */
  rowSpacingMm: number;
  /** Required clearance between labels in the same row. */
  minClearanceMm: number;
}

export const DEFAULT_OPTIONS: StaggerOptions = {
  rowCount: 2,
  rowSpacingMm: 4,
  minClearanceMm: 1,
};

export interface PlacedDimension {
  id: string;
  axisPosition: number;
  rowIndex: number;
  /** Y offset relative to baseline. */
  yOffsetMm: number;
}

export interface StaggerResult {
  placements: PlacedDimension[];
  stackHeightMm: number;
  /** Conflicts that remain after staggering. */
  remainingConflicts: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function staggerChain(dimensions: ChainDimension[], options: Partial<StaggerOptions> = {}): StaggerResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (dimensions.length === 0) {
    return { placements: [], stackHeightMm: 0, remainingConflicts: 0 };
  }
  const sorted = dimensions.slice().sort((a, b) => a.axisPosition - b.axisPosition);
  const placements: PlacedDimension[] = [];
  // Track last position per row.
  const rowEnds: number[] = new Array(opts.rowCount).fill(-Infinity);
  for (const dim of sorted) {
    // Find a row whose last label ended before this position − clearance.
    let chosen = -1;
    for (let r = 0; r < opts.rowCount; r++) {
      if (dim.axisPosition - dim.textWidthMm / 2 >= rowEnds[r]! + opts.minClearanceMm) {
        chosen = r;
        break;
      }
    }
    if (chosen === -1) {
      // Place in row with earliest end (still conflicts).
      chosen = rowEnds.indexOf(Math.min(...rowEnds));
    }
    placements.push({
      id: dim.id,
      axisPosition: dim.axisPosition,
      rowIndex: chosen,
      yOffsetMm: chosen * opts.rowSpacingMm,
    });
    rowEnds[chosen] = dim.axisPosition + dim.textWidthMm / 2;
  }
  // Re-check conflicts.
  const remainingConflicts = countConflicts(placements, dimensions, opts.minClearanceMm);
  const stackHeight = (opts.rowCount - 1) * opts.rowSpacingMm;
  return { placements, stackHeightMm: stackHeight, remainingConflicts };
}

function countConflicts(placements: PlacedDimension[], dimensions: ChainDimension[], clearance: number): number {
  let conflicts = 0;
  const dimMap = new Map(dimensions.map(d => [d.id, d]));
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      const a = placements[i]!;
      const b = placements[j]!;
      if (a.rowIndex !== b.rowIndex) continue;
      const da = dimMap.get(a.id)!;
      const db = dimMap.get(b.id)!;
      const gap = Math.abs(a.axisPosition - b.axisPosition) - (da.textWidthMm + db.textWidthMm) / 2;
      if (gap < clearance) conflicts++;
    }
  }
  return conflicts;
}

// ── Reflow with auto-row-count ───────────────────────────────

export function autoReflow(dimensions: ChainDimension[], options: Partial<StaggerOptions> = {}): StaggerResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  for (let rows = 1; rows <= 6; rows++) {
    const r = staggerChain(dimensions, { ...opts, rowCount: rows });
    if (r.remainingConflicts === 0) return r;
  }
  return staggerChain(dimensions, { ...opts, rowCount: 6 });
}

// ── Per-row stats ────────────────────────────────────────────

export interface RowStats {
  rowIndex: number;
  dimensionCount: number;
  span: number;
}

export function rowStatistics(result: StaggerResult): RowStats[] {
  const map = new Map<number, PlacedDimension[]>();
  for (const p of result.placements) {
    if (!map.has(p.rowIndex)) map.set(p.rowIndex, []);
    map.get(p.rowIndex)!.push(p);
  }
  const out: RowStats[] = [];
  for (const [row, dims] of map) {
    const sorted = dims.slice().sort((a, b) => a.axisPosition - b.axisPosition);
    const span = sorted.length < 2 ? 0 : sorted[sorted.length - 1]!.axisPosition - sorted[0]!.axisPosition;
    out.push({ rowIndex: row, dimensionCount: dims.length, span });
  }
  return out.sort((a, b) => a.rowIndex - b.rowIndex);
}

// ── Summary ────────────────────────────────────────────────────

export interface StaggerSummary {
  dimensionCount: number;
  rowsUsed: number;
  remainingConflicts: number;
  stackHeightMm: number;
}

export function summarize(result: StaggerResult): StaggerSummary {
  const rows = new Set(result.placements.map(p => p.rowIndex));
  return {
    dimensionCount: result.placements.length,
    rowsUsed: rows.size,
    remainingConflicts: result.remainingConflicts,
    stackHeightMm: result.stackHeightMm,
  };
}
