/**
 * partsListEmitter.ts — Emit a parts list (BOM table) for a drawing
 * with grouping, sorting, and formatting options.
 *
 * Generates structured output suitable for rendering as a table
 * directly on the drawing or exporting to CSV / JSON / Excel.
 *
 * Features:
 *   - Group identical part numbers; sum quantities.
 *   - Optional grouping by material or assembly level.
 *   - Sort by item number, part number, description, or qty.
 *   - Render column widths based on content.
 *   - Support customer-specific column ordering.
 */

export interface BomLineItem {
  itemNumber: number;
  partNumber: string;
  description: string;
  quantity: number;
  material?: string;
  weight?: number;
  vendor?: string;
}

export type SortField = 'itemNumber' | 'partNumber' | 'description' | 'quantity';
export type GroupBy = 'none' | 'material' | 'vendor';
export type ColumnKey = 'itemNumber' | 'partNumber' | 'description' | 'quantity' | 'material' | 'weight' | 'vendor';

export interface EmitOptions {
  sortBy: SortField;
  ascending: boolean;
  groupBy: GroupBy;
  columns: ColumnKey[];
  mergeDuplicates: boolean;
}

export const DEFAULT_OPTIONS: EmitOptions = {
  sortBy: 'itemNumber',
  ascending: true,
  groupBy: 'none',
  columns: ['itemNumber', 'partNumber', 'description', 'quantity'],
  mergeDuplicates: true,
};

export interface PartsTable {
  groups: PartsGroup[];
  totalRows: number;
  totalQuantity: number;
}

export interface PartsGroup {
  /** Group name (empty for 'none' grouping). */
  name: string;
  items: BomLineItem[];
}

// ── Top-level entry ────────────────────────────────────────────

export function emitPartsList(items: BomLineItem[], options: Partial<EmitOptions> = {}): PartsTable {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let processed = items.slice();
  if (opts.mergeDuplicates) processed = mergeByPartNumber(processed);
  processed.sort((a, b) => sortCompare(a, b, opts.sortBy, opts.ascending));

  const groups: PartsGroup[] = groupItems(processed, opts.groupBy);
  let totalQty = 0;
  for (const g of groups) for (const i of g.items) totalQty += i.quantity;

  return {
    groups,
    totalRows: processed.length,
    totalQuantity: totalQty,
  };
}

function mergeByPartNumber(items: BomLineItem[]): BomLineItem[] {
  const map = new Map<string, BomLineItem>();
  for (const item of items) {
    const existing = map.get(item.partNumber);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      map.set(item.partNumber, { ...item });
    }
  }
  return Array.from(map.values());
}

function sortCompare(a: BomLineItem, b: BomLineItem, field: SortField, ascending: boolean): number {
  const dir = ascending ? 1 : -1;
  switch (field) {
    case 'itemNumber': return (a.itemNumber - b.itemNumber) * dir;
    case 'partNumber': return a.partNumber.localeCompare(b.partNumber) * dir;
    case 'description': return a.description.localeCompare(b.description) * dir;
    case 'quantity': return (a.quantity - b.quantity) * dir;
  }
}

function groupItems(items: BomLineItem[], by: GroupBy): PartsGroup[] {
  if (by === 'none') return [{ name: '', items }];
  const groups = new Map<string, BomLineItem[]>();
  for (const item of items) {
    const key = (by === 'material' ? item.material : item.vendor) ?? 'Unspecified';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([name, items]) => ({ name, items }));
}

// ── CSV rendering ────────────────────────────────────────────

export function renderCsv(table: PartsTable, columns: ColumnKey[]): string {
  const header = columns.join(',');
  const rows: string[] = [header];
  for (const g of table.groups) {
    if (g.name) rows.push(`# ${g.name}`);
    for (const item of g.items) {
      rows.push(columns.map(c => formatCsvCell(item, c)).join(','));
    }
  }
  return rows.join('\n');
}

function formatCsvCell(item: BomLineItem, col: ColumnKey): string {
  switch (col) {
    case 'itemNumber': return String(item.itemNumber);
    case 'partNumber': return escapeCsv(item.partNumber);
    case 'description': return escapeCsv(item.description);
    case 'quantity': return String(item.quantity);
    case 'material': return escapeCsv(item.material ?? '');
    case 'weight': return item.weight === undefined ? '' : item.weight.toFixed(3);
    case 'vendor': return escapeCsv(item.vendor ?? '');
  }
}

function escapeCsv(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ── Column-width inference ───────────────────────────────────

export interface ColumnWidth {
  column: ColumnKey;
  /** Width in characters. */
  charWidth: number;
}

export function inferColumnWidths(table: PartsTable, columns: ColumnKey[], maxWidth: number = 50): ColumnWidth[] {
  return columns.map(col => {
    let max = col.length;
    for (const g of table.groups) {
      for (const item of g.items) {
        const cell = formatCsvCell(item, col);
        if (cell.length > max) max = cell.length;
      }
    }
    return { column: col, charWidth: Math.min(maxWidth, max) };
  });
}

// ── Filter / partition ────────────────────────────────────────

export function filterByVendor(table: PartsTable, vendor: string): BomLineItem[] {
  const all: BomLineItem[] = [];
  for (const g of table.groups) for (const i of g.items) if (i.vendor === vendor) all.push(i);
  return all;
}

// ── Summary ────────────────────────────────────────────────────

export interface EmitSummary {
  groupCount: number;
  totalRows: number;
  totalQuantity: number;
  largestGroupSize: number;
}

export function summarize(table: PartsTable): EmitSummary {
  let largest = 0;
  for (const g of table.groups) if (g.items.length > largest) largest = g.items.length;
  return {
    groupCount: table.groups.length,
    totalRows: table.totalRows,
    totalQuantity: table.totalQuantity,
    largestGroupSize: largest,
  };
}
