/**
 * multiSheetManager.ts — Manage a drawing with multiple sheets and
 * cross-sheet references.
 *
 * Engineering drawings often span several sheets:
 *
 *   - Sheet 1: assembly overview + BOM.
 *   - Sheet 2: detail views.
 *   - Sheet 3: section views.
 *   - Sheet N: GD&T + inspection callouts.
 *
 * Each sheet has its own paper size + title block + content list.
 * A *cross-sheet reference* says "Detail A is shown on Sheet 2,
 * Zone B-3". Module manages:
 *
 *   - Sheet add/remove/reorder.
 *   - Reference creation + cross-link verification (target exists).
 *   - Per-sheet entity counts.
 *   - Print-order assembly into a single PDF book.
 */

export type PaperSize = 'A4' | 'A3' | 'A2' | 'A1' | 'A0' | 'Letter' | 'Tabloid';

export interface Sheet {
  id: string;
  /** Sheet number in book (1-based). */
  sheetNumber: number;
  /** Display title. */
  title: string;
  paperSize: PaperSize;
  orientation: 'portrait' | 'landscape';
  /** Entity ids contained on this sheet. */
  entityIds: Set<string>;
  /** Cross-sheet references on this sheet pointing elsewhere. */
  outgoingRefs: SheetReference[];
}

export interface SheetReference {
  /** Reference id (e.g., callout text "see Detail A"). */
  refId: string;
  /** Target sheet id. */
  targetSheetId: string;
  /** Optional target entity id. */
  targetEntityId?: string;
  /** Zone label on the target sheet (e.g., "B-3"). */
  zone?: string;
}

export interface MultiSheetState {
  sheets: Map<string, Sheet>;
  /** Insertion order. */
  order: string[];
}

// ── Construction ───────────────────────────────────────────────

export function createBook(): MultiSheetState {
  return { sheets: new Map(), order: [] };
}

// ── Sheet CRUD ─────────────────────────────────────────────────

export function addSheet(state: MultiSheetState, sheetId: string, options: Partial<Omit<Sheet, 'id' | 'entityIds' | 'outgoingRefs'>> = {}): Sheet {
  if (state.sheets.has(sheetId)) {
    throw new Error(`Sheet ${sheetId} already exists`);
  }
  const sheet: Sheet = {
    id: sheetId,
    sheetNumber: state.sheets.size + 1,
    title: options.title ?? `Sheet ${state.sheets.size + 1}`,
    paperSize: options.paperSize ?? 'A3',
    orientation: options.orientation ?? 'landscape',
    entityIds: new Set(),
    outgoingRefs: [],
  };
  state.sheets.set(sheetId, sheet);
  state.order.push(sheetId);
  return sheet;
}

export function removeSheet(state: MultiSheetState, sheetId: string): boolean {
  if (!state.sheets.has(sheetId)) return false;
  state.sheets.delete(sheetId);
  state.order = state.order.filter(id => id !== sheetId);
  // Renumber.
  state.order.forEach((id, i) => {
    const s = state.sheets.get(id);
    if (s) s.sheetNumber = i + 1;
  });
  return true;
}

export function reorderSheet(state: MultiSheetState, sheetId: string, newPosition: number): boolean {
  const idx = state.order.indexOf(sheetId);
  if (idx === -1) return false;
  state.order.splice(idx, 1);
  state.order.splice(Math.max(0, Math.min(state.order.length, newPosition)), 0, sheetId);
  state.order.forEach((id, i) => {
    const s = state.sheets.get(id);
    if (s) s.sheetNumber = i + 1;
  });
  return true;
}

// ── Entities ──────────────────────────────────────────────────

export function addEntityToSheet(state: MultiSheetState, sheetId: string, entityId: string): boolean {
  const s = state.sheets.get(sheetId);
  if (!s) return false;
  s.entityIds.add(entityId);
  return true;
}

export function removeEntityFromSheet(state: MultiSheetState, sheetId: string, entityId: string): boolean {
  const s = state.sheets.get(sheetId);
  if (!s) return false;
  return s.entityIds.delete(entityId);
}

export function findSheetForEntity(state: MultiSheetState, entityId: string): Sheet | null {
  for (const s of state.sheets.values()) {
    if (s.entityIds.has(entityId)) return s;
  }
  return null;
}

// ── References ────────────────────────────────────────────────

export function addReference(state: MultiSheetState, fromSheetId: string, ref: SheetReference): boolean {
  const s = state.sheets.get(fromSheetId);
  if (!s) return false;
  s.outgoingRefs.push(ref);
  return true;
}

export interface BrokenReference {
  fromSheetId: string;
  refId: string;
  reason: string;
}

export function validateReferences(state: MultiSheetState): BrokenReference[] {
  const broken: BrokenReference[] = [];
  for (const [sheetId, s] of state.sheets) {
    for (const ref of s.outgoingRefs) {
      const target = state.sheets.get(ref.targetSheetId);
      if (!target) {
        broken.push({ fromSheetId: sheetId, refId: ref.refId, reason: `target sheet not found: ${ref.targetSheetId}` });
        continue;
      }
      if (ref.targetEntityId && !target.entityIds.has(ref.targetEntityId)) {
        broken.push({ fromSheetId: sheetId, refId: ref.refId, reason: `target entity ${ref.targetEntityId} not on target sheet` });
      }
    }
  }
  return broken;
}

// ── Print order ───────────────────────────────────────────────

export function getPrintOrder(state: MultiSheetState): Sheet[] {
  return state.order.map(id => state.sheets.get(id)!).filter(Boolean);
}

// ── Summary ────────────────────────────────────────────────────

export interface BookSummary {
  sheetCount: number;
  totalEntities: number;
  totalReferences: number;
  brokenReferenceCount: number;
  paperSizes: PaperSize[];
}

export function summarize(state: MultiSheetState): BookSummary {
  let entities = 0;
  let refs = 0;
  const sizes = new Set<PaperSize>();
  for (const s of state.sheets.values()) {
    entities += s.entityIds.size;
    refs += s.outgoingRefs.length;
    sizes.add(s.paperSize);
  }
  return {
    sheetCount: state.sheets.size,
    totalEntities: entities,
    totalReferences: refs,
    brokenReferenceCount: validateReferences(state).length,
    paperSizes: [...sizes],
  };
}
