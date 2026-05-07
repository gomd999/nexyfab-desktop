/**
 * Material stock cut-list optimizer.
 *
 * Given a list of required part lengths (1D bar/tube stock) and a standard stock
 * length, computes a First-Fit-Decreasing (FFD) cut-list with kerf allowance.
 *
 * Output reports: total bars used, yield (used / total), waste per bar.
 */

export interface CutRequirement {
  id: string;
  length: number;      // mm
  qty: number;
  label?: string;
}

export interface CutPiece {
  reqId: string;
  length: number;
  label?: string;
}

export interface StockBar {
  barIndex: number;
  stockLength: number;
  pieces: CutPiece[];
  used: number;
  kerf: number;
  remaining: number;
}

export interface StockOptimizerResult {
  bars: StockBar[];
  totalStockLength: number;
  totalUsedLength: number;
  totalKerfLength: number;
  wasteLength: number;
  utilizationPct: number;
  unfulfilled: CutRequirement[];
}

export interface StockOptimizerOptions {
  stockLength: number;   // mm — length of a single bar
  kerfMm?: number;       // mm of material removed per cut (default 2)
  maxBars?: number;      // safety cap (default 10000)
}

export function optimizeCutList(
  requirements: CutRequirement[],
  opts: StockOptimizerOptions,
): StockOptimizerResult {
  const stockLength = opts.stockLength;
  const kerf = opts.kerfMm ?? 2;
  const maxBars = opts.maxBars ?? 10000;

  // Expand quantities → individual pieces, sorted descending (FFD)
  const pieces: CutPiece[] = [];
  const unfulfilled: CutRequirement[] = [];
  for (const r of requirements) {
    if (r.length > stockLength) {
      unfulfilled.push(r);
      continue;
    }
    for (let i = 0; i < r.qty; i++) {
      pieces.push({ reqId: r.id, length: r.length, label: r.label });
    }
  }
  pieces.sort((a, b) => b.length - a.length);

  const bars: StockBar[] = [];
  for (const piece of pieces) {
    // Find first bar that can accommodate this piece + a kerf cut
    // (kerf only applies between pieces, not before the first one).
    let placed = false;
    for (const bar of bars) {
      const need = bar.pieces.length === 0 ? piece.length : piece.length + kerf;
      if (bar.used + need <= stockLength) {
        bar.pieces.push(piece);
        bar.used += need;
        if (bar.pieces.length > 1) bar.kerf += kerf;
        bar.remaining = stockLength - bar.used;
        placed = true;
        break;
      }
    }
    if (!placed) {
      if (bars.length >= maxBars) break;
      const bar: StockBar = {
        barIndex: bars.length,
        stockLength,
        pieces: [piece],
        used: piece.length,
        kerf: 0,
        remaining: stockLength - piece.length,
      };
      bars.push(bar);
    }
  }

  const totalStockLength = bars.length * stockLength;
  const totalUsedLength = bars.reduce((s, b) => s + b.pieces.reduce((x, p) => x + p.length, 0), 0);
  const totalKerfLength = bars.reduce((s, b) => s + b.kerf, 0);
  const wasteLength = totalStockLength - totalUsedLength - totalKerfLength;
  const utilizationPct = totalStockLength > 0 ? (totalUsedLength / totalStockLength) * 100 : 0;

  return {
    bars,
    totalStockLength,
    totalUsedLength,
    totalKerfLength,
    wasteLength,
    utilizationPct,
    unfulfilled,
  };
}

/** Convenience: format a cut-list result as human-readable plaintext. */
export function formatCutListReport(result: StockOptimizerResult, stockLength: number): string {
  const lines: string[] = [];
  lines.push(`=== Cut List (stock ${stockLength}mm × ${result.bars.length} bars) ===`);
  result.bars.forEach((bar, i) => {
    const piecesStr = bar.pieces.map(p => p.length.toFixed(1)).join(' + ');
    lines.push(`Bar ${i + 1}: ${piecesStr} (used ${bar.used.toFixed(1)}mm, waste ${bar.remaining.toFixed(1)}mm)`);
  });
  lines.push('');
  lines.push(`Total stock:       ${result.totalStockLength.toFixed(1)} mm`);
  lines.push(`Total cut:         ${result.totalUsedLength.toFixed(1)} mm`);
  lines.push(`Kerf loss:         ${result.totalKerfLength.toFixed(1)} mm`);
  lines.push(`Waste (drop):      ${result.wasteLength.toFixed(1)} mm`);
  lines.push(`Utilization:       ${result.utilizationPct.toFixed(1)} %`);
  if (result.unfulfilled.length > 0) {
    lines.push('');
    lines.push(`⚠ Unfulfilled (exceeds stock length):`);
    result.unfulfilled.forEach(r => lines.push(`  - ${r.id}: ${r.length}mm × ${r.qty}`));
  }
  return lines.join('\n');
}
