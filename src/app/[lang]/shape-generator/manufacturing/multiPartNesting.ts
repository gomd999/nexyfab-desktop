/**
 * multiPartNesting.ts — 2D part nesting (rectangle packing) on a
 * sheet for laser / waterjet / plasma cutting.
 *
 * Heuristic: Bottom-Left Decreasing (BLD) with optional rotation.
 * Not optimal — the true 2D bin packing is NP-hard — but produces
 * acceptable layouts for typical shop jobs in milliseconds.
 *
 * For non-rectangular parts the caller should pre-compute their
 * tight bounding boxes; rotation by 90° is the only orientation
 * tested.
 *
 * Output:
 *
 *   - Placed parts with (x, y, rotation, sheet index).
 *   - Material utilization per sheet.
 *   - Unplaced parts list.
 */

export interface Vec2 { x: number; y: number }

export interface PartToNest {
  id: string;
  /** Tight bounding box width (mm). */
  widthMm: number;
  /** Tight bounding box height (mm). */
  heightMm: number;
  /** Quantity to place. */
  quantity: number;
  /** Optional priority (higher = placed first). */
  priority?: number;
  /** Allow 90° rotation. */
  rotatable?: boolean;
}

export interface SheetSpec {
  widthMm: number;
  heightMm: number;
  /** Padding around each placed part (kerf gap). */
  paddingMm: number;
}

export interface PlacedPart {
  id: string;
  /** Sheet index (0-based). */
  sheetIndex: number;
  /** Bottom-left corner. */
  origin: Vec2;
  widthMm: number;
  heightMm: number;
  /** Rotation 0 or 90. */
  rotationDeg: 0 | 90;
}

export interface NestingResult {
  placedParts: PlacedPart[];
  /** Per-sheet utilization (0..1). */
  sheetUtilization: number[];
  /** Parts that didn't fit. */
  unplaced: Array<{ id: string; reason: string }>;
  totalSheetsUsed: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function nestParts(parts: PartToNest[], sheet: SheetSpec): NestingResult {
  // Expand quantities into individual instances.
  const instances: PartToNest[] = [];
  for (const p of parts) {
    for (let q = 0; q < p.quantity; q++) {
      instances.push({ ...p, id: `${p.id}#${q}`, quantity: 1 });
    }
  }
  // Sort by priority desc, then height desc, then width desc.
  instances.sort((a, b) => {
    const prioA = a.priority ?? 0;
    const prioB = b.priority ?? 0;
    if (prioA !== prioB) return prioB - prioA;
    if (b.heightMm !== a.heightMm) return b.heightMm - a.heightMm;
    return b.widthMm - a.widthMm;
  });

  const placed: PlacedPart[] = [];
  const unplaced: Array<{ id: string; reason: string }> = [];
  const sheets: PlacedPart[][] = [[]];

  for (const inst of instances) {
    let placedOk = false;
    // Try each open sheet.
    for (let s = 0; s < sheets.length; s++) {
      const result = tryPlace(inst, sheet, sheets[s]!);
      if (result) {
        const rec: PlacedPart = { id: inst.id, sheetIndex: s, ...result };
        sheets[s]!.push(rec);
        placed.push(rec);
        placedOk = true;
        break;
      }
    }
    if (!placedOk) {
      // Check if part itself is too big for sheet.
      const fits = (inst.widthMm <= sheet.widthMm && inst.heightMm <= sheet.heightMm) ||
                   (inst.rotatable !== false && inst.heightMm <= sheet.widthMm && inst.widthMm <= sheet.heightMm);
      if (!fits) {
        unplaced.push({ id: inst.id, reason: 'larger than sheet' });
      } else {
        // Open a new sheet.
        const newSheet: PlacedPart[] = [];
        const result = tryPlace(inst, sheet, newSheet);
        if (result) {
          const rec: PlacedPart = { id: inst.id, sheetIndex: sheets.length, ...result };
          newSheet.push(rec);
          placed.push(rec);
          sheets.push(newSheet);
        } else {
          unplaced.push({ id: inst.id, reason: 'no fit' });
        }
      }
    }
  }

  // Utilization per sheet.
  const sheetArea = sheet.widthMm * sheet.heightMm;
  const sheetUtilization = sheets.map(s => {
    const used = s.reduce((sum, p) => sum + p.widthMm * p.heightMm, 0);
    return sheetArea > 0 ? used / sheetArea : 0;
  });

  return {
    placedParts: placed,
    sheetUtilization,
    unplaced,
    totalSheetsUsed: sheets.filter(s => s.length > 0).length,
  };
}

// ── Bottom-Left fit ───────────────────────────────────────────

function tryPlace(part: PartToNest, sheet: SheetSpec, occupied: PlacedPart[]): Omit<PlacedPart, 'id' | 'sheetIndex'> | null {
  const rotations: Array<{ w: number; h: number; rotation: 0 | 90 }> = [
    { w: part.widthMm, h: part.heightMm, rotation: 0 },
  ];
  if (part.rotatable !== false && part.widthMm !== part.heightMm) {
    rotations.push({ w: part.heightMm, h: part.widthMm, rotation: 90 });
  }

  for (const r of rotations) {
    const w = r.w + sheet.paddingMm;
    const h = r.h + sheet.paddingMm;
    // Candidate positions: bottom-left of sheet + above each placed part + right of each.
    const candidates: Vec2[] = [{ x: sheet.paddingMm, y: sheet.paddingMm }];
    for (const p of occupied) {
      candidates.push({ x: p.origin.x + p.widthMm + sheet.paddingMm, y: p.origin.y });
      candidates.push({ x: p.origin.x, y: p.origin.y + p.heightMm + sheet.paddingMm });
    }
    candidates.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    for (const c of candidates) {
      if (c.x + w > sheet.widthMm + sheet.paddingMm || c.y + h > sheet.heightMm + sheet.paddingMm) continue;
      if (overlapsAny(c, w, h, occupied)) continue;
      return {
        origin: c,
        widthMm: r.w,
        heightMm: r.h,
        rotationDeg: r.rotation,
      };
    }
  }
  return null;
}

function overlapsAny(origin: Vec2, w: number, h: number, parts: PlacedPart[]): boolean {
  for (const p of parts) {
    if (origin.x < p.origin.x + p.widthMm &&
        origin.x + w > p.origin.x &&
        origin.y < p.origin.y + p.heightMm &&
        origin.y + h > p.origin.y) return true;
  }
  return false;
}

// ── Summary ────────────────────────────────────────────────────

export interface NestingSummary {
  placedCount: number;
  unplacedCount: number;
  sheetsUsed: number;
  averageUtilization: number;
  bestSheetUtilization: number;
  worstSheetUtilization: number;
}

export function summarize(result: NestingResult): NestingSummary {
  const utils = result.sheetUtilization;
  return {
    placedCount: result.placedParts.length,
    unplacedCount: result.unplaced.length,
    sheetsUsed: result.totalSheetsUsed,
    averageUtilization: utils.length > 0 ? utils.reduce((s, u) => s + u, 0) / utils.length : 0,
    bestSheetUtilization: utils.length > 0 ? Math.max(...utils) : 0,
    worstSheetUtilization: utils.length > 0 ? Math.min(...utils) : 0,
  };
}
