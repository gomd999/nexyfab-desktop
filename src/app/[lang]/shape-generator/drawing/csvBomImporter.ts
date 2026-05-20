/**
 * csvBomImporter.ts — Parse a CSV file into BOM line items for
 * drawing-callout merge.
 *
 * Spreadsheet → drawing balloon is a common manufacturing workflow:
 * the engineer prepares the BOM in Excel, exports CSV, and feeds
 * it to the CAD/drawing module to pre-fill callouts.
 *
 * Features:
 *
 *   - Header row auto-detect: case-insensitive match against
 *     {part_number, quantity, description, supplier, cost, ...}.
 *   - Quoted-string handling per RFC 4180.
 *   - Decimal separator: dot or comma per row (auto-detect).
 *   - Row validation: missing required fields, negative quantity,
 *     duplicate part numbers.
 *   - Output: structured BOMLine[] + per-row error list.
 */

export interface BOMLine {
  partNumber: string;
  quantity: number;
  description?: string;
  supplier?: string;
  unitCostUsd?: number;
  category?: string;
  /** Free-form extra fields by column name. */
  extras: Record<string, string>;
}

export interface ImportResult {
  lines: BOMLine[];
  /** Detected column → field mapping. */
  columnMap: Record<string, keyof BOMLine | 'extra'>;
  /** Skipped rows with reason. */
  errors: Array<{ rowIndex: number; raw: string; reason: string }>;
  /** Duplicate part numbers (kept first occurrence). */
  duplicateParts: string[];
}

export interface ImportOptions {
  /** Delimiter (default = ','). */
  delimiter: string;
  /** Skip rows whose first cell starts with this prefix (e.g., "#"). */
  commentPrefix?: string;
  /** Allow negative quantities (default false). */
  allowNegativeQuantity: boolean;
}

export const DEFAULT_OPTIONS: ImportOptions = {
  delimiter: ',',
  allowNegativeQuantity: false,
};

// ── Top-level entry ────────────────────────────────────────────

const HEADER_ALIASES: Record<keyof BOMLine | 'extra', string[]> = {
  partNumber: ['part_number', 'partnumber', 'part no', 'part number', 'pn'],
  quantity: ['quantity', 'qty', 'count'],
  description: ['description', 'desc'],
  supplier: ['supplier', 'vendor', 'mfg', 'manufacturer'],
  unitCostUsd: ['unit_cost', 'cost', 'price', 'unit price'],
  category: ['category', 'cat', 'group'],
  extras: [],
  extra: [],
};

export function importCSV(source: string, options: Partial<ImportOptions> = {}): ImportResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const rows = parseCsvRows(source, opts.delimiter, opts.commentPrefix);
  if (rows.length === 0) {
    return { lines: [], columnMap: {}, errors: [], duplicateParts: [] };
  }

  const headerRow = rows[0]!;
  const columnMap: Record<string, keyof BOMLine | 'extra'> = {};
  for (const col of headerRow) {
    const norm = col.trim().toLowerCase();
    let mapped: keyof BOMLine | 'extra' = 'extra';
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (field === 'extras' || field === 'extra') continue;
      if (aliases.some(a => a === norm)) {
        mapped = field as keyof BOMLine;
        break;
      }
    }
    columnMap[col] = mapped;
  }

  const lines: BOMLine[] = [];
  const errors: Array<{ rowIndex: number; raw: string; reason: string }> = [];
  const seenParts = new Set<string>();
  const duplicates = new Set<string>();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!;
    const raw = row.join(opts.delimiter);
    const line: BOMLine = { partNumber: '', quantity: 0, extras: {} };
    for (let c = 0; c < headerRow.length; c++) {
      const colName = headerRow[c]!;
      const mapping = columnMap[colName]!;
      const value = (row[c] ?? '').trim();
      if (mapping === 'extra') {
        line.extras[colName] = value;
      } else if (mapping === 'extras') {
        continue;
      } else {
        applyField(line, mapping, value);
      }
    }
    if (!line.partNumber) {
      errors.push({ rowIndex: r, raw, reason: 'missing part number' });
      continue;
    }
    if (line.quantity <= 0 && !opts.allowNegativeQuantity) {
      errors.push({ rowIndex: r, raw, reason: 'invalid quantity' });
      continue;
    }
    if (seenParts.has(line.partNumber)) {
      duplicates.add(line.partNumber);
      continue;
    }
    seenParts.add(line.partNumber);
    lines.push(line);
  }

  return { lines, columnMap, errors, duplicateParts: [...duplicates] };
}

function applyField(line: BOMLine, field: keyof BOMLine, raw: string): void {
  switch (field) {
    case 'partNumber':
      line.partNumber = raw;
      break;
    case 'quantity':
      line.quantity = parseFlexNumber(raw);
      break;
    case 'description':
      if (raw) line.description = raw;
      break;
    case 'supplier':
      if (raw) line.supplier = raw;
      break;
    case 'unitCostUsd':
      if (raw) line.unitCostUsd = parseFlexNumber(raw);
      break;
    case 'category':
      if (raw) line.category = raw;
      break;
    case 'extras':
      break;
  }
}

// ── CSV parsing ───────────────────────────────────────────────

function parseCsvRows(source: string, delimiter: string, commentPrefix?: string): string[][] {
  const rows: string[][] = [];
  const lines = source.split(/\r?\n/);
  for (const line of lines) {
    if (line.trim() === '') continue;
    if (commentPrefix && line.startsWith(commentPrefix)) continue;
    rows.push(splitCsvLine(line, delimiter));
  }
  return rows;
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === delimiter) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseFlexNumber(raw: string): number {
  if (!raw) return 0;
  // Strip commas (thousands) only if dot is present (US) OR comma is decimal.
  const cleaned = raw.replace(/\s/g, '');
  // If both `,` and `.` exist, the rightmost wins as decimal.
  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    if (lastDot > lastComma) {
      normalized = cleaned.replace(/,/g, '');
    } else {
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    }
  } else if (lastComma >= 0) {
    normalized = cleaned.replace(',', '.');
  } else {
    normalized = cleaned;
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

// ── Aggregation ───────────────────────────────────────────────

export interface BOMRoll {
  totalLines: number;
  totalQuantity: number;
  totalCostUsd: number;
  uniqueSuppliers: number;
}

export function rollupTotals(lines: BOMLine[]): BOMRoll {
  const suppliers = new Set<string>();
  let qty = 0;
  let cost = 0;
  for (const l of lines) {
    qty += l.quantity;
    if (l.unitCostUsd !== undefined) cost += l.unitCostUsd * l.quantity;
    if (l.supplier) suppliers.add(l.supplier);
  }
  return { totalLines: lines.length, totalQuantity: qty, totalCostUsd: cost, uniqueSuppliers: suppliers.size };
}

// ── Summary ────────────────────────────────────────────────────

export interface ImportSummary {
  lineCount: number;
  errorCount: number;
  duplicateCount: number;
  mappedFieldCount: number;
  extraFieldCount: number;
}

export function summarize(result: ImportResult): ImportSummary {
  const mapped = Object.values(result.columnMap).filter(v => v !== 'extra').length;
  const extras = Object.values(result.columnMap).filter(v => v === 'extra').length;
  return {
    lineCount: result.lines.length,
    errorCount: result.errors.length,
    duplicateCount: result.duplicateParts.length,
    mappedFieldCount: mapped,
    extraFieldCount: extras,
  };
}
