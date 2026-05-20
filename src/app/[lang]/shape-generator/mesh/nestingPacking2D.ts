/**
 * nestingPacking2D.ts — 2D part nesting for sheet-cut optimization.
 *
 * For laser, water-jet, plasma, and CNC sheet cuts, every customer
 * order is a set of part outlines that must be packed onto raw sheet
 * stock with minimum waste. This is the classical "irregular bin
 * packing" / "nesting" problem — NP-hard, but heuristics get close
 * enough for production.
 *
 * Algorithms:
 *
 *   - **First-fit decreasing** with axis-aligned bbox → simplest, OK
 *     for rectangular parts.
 *   - **Bottom-left** placement with optional 90° rotation step,
 *     handles non-rect parts via their bbox.
 *   - **No-fit polygon** (placeholder) — full polygon support; here we
 *     bound parts by their bbox.
 *
 * Output: per-part placement + remaining waste + sheet utilization.
 */

export interface Part2D {
  id: string;
  /** Local-space axis-aligned bbox dimensions. */
  widthMm: number;
  heightMm: number;
  /** Quantity to place. */
  quantity: number;
  /** Allow 90° rotation? Default true. */
  allowRotation?: boolean;
}

export interface Sheet {
  /** Sheet dimensions. */
  widthMm: number;
  heightMm: number;
  /** Optional safety margin from each edge (kerf compensation, clamp clearance). */
  marginMm?: number;
}

export interface Placement {
  partId: string;
  /** Lower-left corner (mm). */
  x: number;
  y: number;
  /** Placed width (after rotation). */
  widthMm: number;
  heightMm: number;
  /** Was the part rotated 90°? */
  rotated: boolean;
  /** Sheet index. */
  sheetIndex: number;
}

export interface NestingResult {
  /** Sheets produced. */
  sheets: SheetUsage[];
  /** Per-part placements. */
  placements: Placement[];
  /** Parts that couldn't fit any sheet. */
  unplaced: Array<{ partId: string; quantity: number }>;
  /** Overall sheet utilization (sum of part areas / sum of sheet areas). */
  utilizationFraction: number;
}

export interface SheetUsage {
  index: number;
  widthMm: number;
  heightMm: number;
  usedAreaMm2: number;
  /** Per-sheet placements. */
  placements: Placement[];
}

export interface NestingOptions {
  /** Spacing between parts (mm). */
  gapMm: number;
  /** Max sheets to produce. */
  maxSheets: number;
}

export const DEFAULT_NESTING_OPTIONS: NestingOptions = {
  gapMm: 2,
  maxSheets: 100,
};

// ── Top-level entry ─────────────────────────────────────────────

export function nestParts(parts: Part2D[], sheet: Sheet, options: Partial<NestingOptions> = {}): NestingResult {
  const opts = { ...DEFAULT_NESTING_OPTIONS, ...options };
  const margin = sheet.marginMm ?? 0;
  const usableW = sheet.widthMm - 2 * margin;
  const usableH = sheet.heightMm - 2 * margin;
  // Expand parts to individual instances.
  const instances: Array<{ id: string; w: number; h: number; allowRot: boolean }> = [];
  for (const p of parts) {
    for (let i = 0; i < p.quantity; i++) {
      instances.push({ id: p.id, w: p.widthMm, h: p.heightMm, allowRot: p.allowRotation ?? true });
    }
  }
  // Sort descending by max(w, h).
  instances.sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h));

  const sheets: SheetUsage[] = [];
  const placements: Placement[] = [];
  const unplacedMap = new Map<string, number>();

  for (const inst of instances) {
    let placed = false;
    for (const sh of sheets) {
      const result = tryPlace(inst, sh, opts.gapMm, usableW, usableH, margin);
      if (result) {
        placements.push(result);
        sh.placements.push(result);
        sh.usedAreaMm2 += result.widthMm * result.heightMm;
        placed = true;
        break;
      }
    }
    if (!placed && sheets.length < opts.maxSheets) {
      const newSheet: SheetUsage = {
        index: sheets.length,
        widthMm: sheet.widthMm,
        heightMm: sheet.heightMm,
        usedAreaMm2: 0,
        placements: [],
      };
      sheets.push(newSheet);
      const result = tryPlace(inst, newSheet, opts.gapMm, usableW, usableH, margin);
      if (result) {
        placements.push(result);
        newSheet.placements.push(result);
        newSheet.usedAreaMm2 += result.widthMm * result.heightMm;
        placed = true;
      }
    }
    if (!placed) {
      unplacedMap.set(inst.id, (unplacedMap.get(inst.id) ?? 0) + 1);
    }
  }

  const totalSheetArea = sheets.length * sheet.widthMm * sheet.heightMm;
  const totalUsedArea = sheets.reduce((s, sh) => s + sh.usedAreaMm2, 0);
  const utilization = totalSheetArea > 0 ? totalUsedArea / totalSheetArea : 0;

  return {
    sheets,
    placements,
    unplaced: [...unplacedMap.entries()].map(([partId, quantity]) => ({ partId, quantity })),
    utilizationFraction: utilization,
  };
}

// ── Placement: bottom-left scan ────────────────────────────────

function tryPlace(
  inst: { id: string; w: number; h: number; allowRot: boolean },
  sheet: SheetUsage,
  gap: number,
  usableW: number,
  usableH: number,
  margin: number,
): Placement | null {
  // Try without rotation, then rotated if allowed.
  const orientations: Array<{ w: number; h: number; rotated: boolean }> = [{ w: inst.w, h: inst.h, rotated: false }];
  if (inst.allowRot && inst.w !== inst.h) {
    orientations.push({ w: inst.h, h: inst.w, rotated: true });
  }
  for (const ori of orientations) {
    if (ori.w > usableW || ori.h > usableH) continue;
    // Find first valid position by scanning bottom-up, left-to-right.
    // Resolution: gap step + part edges of existing placements.
    const candidatePositions = generateCandidatePositions(sheet, gap, margin);
    for (const { x, y } of candidatePositions) {
      if (x + ori.w > margin + usableW || y + ori.h > margin + usableH) continue;
      if (!overlapsAnything(x, y, ori.w, ori.h, sheet.placements, gap)) {
        return {
          partId: inst.id,
          x, y,
          widthMm: ori.w,
          heightMm: ori.h,
          rotated: ori.rotated,
          sheetIndex: sheet.index,
        };
      }
    }
  }
  return null;
}

function generateCandidatePositions(sheet: SheetUsage, gap: number, margin: number): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = [{ x: margin, y: margin }];
  for (const pl of sheet.placements) {
    positions.push({ x: pl.x + pl.widthMm + gap, y: pl.y });
    positions.push({ x: pl.x, y: pl.y + pl.heightMm + gap });
  }
  // Sort bottom-left preference.
  positions.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  return positions;
}

function overlapsAnything(x: number, y: number, w: number, h: number, placements: Placement[], gap: number): boolean {
  for (const pl of placements) {
    if (x + w + gap <= pl.x) continue;
    if (x >= pl.x + pl.widthMm + gap) continue;
    if (y + h + gap <= pl.y) continue;
    if (y >= pl.y + pl.heightMm + gap) continue;
    return true;
  }
  return false;
}

// ── Statistics ─────────────────────────────────────────────────

export interface NestingStats {
  sheetCount: number;
  partsPlaced: number;
  partsUnplaced: number;
  averageUtilization: number;
  totalSheetAreaMm2: number;
  totalUsedAreaMm2: number;
  wasteAreaMm2: number;
}

export function summarize(result: NestingResult, sheet: Sheet): NestingStats {
  const totalSheets = sheet.widthMm * sheet.heightMm * result.sheets.length;
  const used = result.sheets.reduce((s, sh) => s + sh.usedAreaMm2, 0);
  return {
    sheetCount: result.sheets.length,
    partsPlaced: result.placements.length,
    partsUnplaced: result.unplaced.reduce((s, x) => s + x.quantity, 0),
    averageUtilization: result.utilizationFraction,
    totalSheetAreaMm2: totalSheets,
    totalUsedAreaMm2: used,
    wasteAreaMm2: totalSheets - used,
  };
}
