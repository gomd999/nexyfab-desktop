/**
 * holeTable — Phase 4.3 follow-up of NexyFab Pro own-CAD (ADR-013).
 *
 * Hole table builder for a drawing. Machine-shop hole tables list every
 * drilled / bored feature by a tag (A1, A2, ...) with its position (signed
 * deltas from a single datum origin), diameter and a depth label ("THRU"
 * for a through hole, or a blind-depth string). When many holes share the
 * same diameter + depth they collapse into one tagged row with a count —
 * the convention on production drawings so the operator reads "4× Ø6 THRU"
 * instead of four near-identical rows.
 *
 * Pure logic only (no React/DOM/Three). Sits next to {@link ./bom} and
 * {@link ./ordinateDimension}; the renderer (Phase 4.4) consumes the rows
 * for the on-sheet table and the CSV helper feeds the rfq/quoting export.
 *
 * Scope (Phase 4.3 minimal):
 *   - buildHoleTable(holes, opts?) → HoleTableRow[]
 *     - deterministic sort by (x, y) then by id for ties
 *     - optional grouping of identical diameter + depth into one counted row
 *     - origin subtraction (signed deltas, default datum 0, 0)
 *     - configurable decimal precision (default 2)
 *   - holeTableToCsv(rows) → RFC4180-ish CSV string
 *
 * Out of scope (Phase 4.4+):
 *   - Counterbore / countersink callout symbols.
 *   - Thread spec / tap drill columns.
 *   - Per-customer column layout.
 */

// ─── types ───────────────────────────────────────────────────────────────

export interface HoleSpec {
  id: string;
  x: number;
  y: number;
  diameter: number;
  /** Blind depth in drawing units. `undefined` means a through hole. */
  depth?: number;
}

export interface HoleTableRow {
  /** Auto-assigned tag (A1, A2, ...). */
  tag: string;
  /** Signed delta from the datum origin along X, precision-formatted. */
  x: number;
  /** Signed delta from the datum origin along Y, precision-formatted. */
  y: number;
  /** Precision-formatted diameter. */
  diameter: number;
  /** "THRU" for a through hole, else a blind-depth label (e.g. "↧ 5.00"). */
  depthLabel: string;
  /** Number of identical holes this row represents (1 when not grouped). */
  count: number;
}

export interface BuildHoleTableOptions {
  /** Collapse holes with the same diameter + depth into one counted row. */
  groupIdentical?: boolean;
  /** Decimal places for x / y / diameter. Defaults to 2. */
  precision?: number;
  /** Datum X. Every row's x is `hole.x - originX`. Defaults to 0. */
  originX?: number;
  /** Datum Y. Every row's y is `hole.y - originY`. Defaults to 0. */
  originY?: number;
}

// ─── errors ──────────────────────────────────────────────────────────────

export class HoleTableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HoleTableError';
  }
}

// ─── constants ───────────────────────────────────────────────────────────

/** Tag prefix for auto-generated hole groups. Single series for Phase 4.3. */
export const HOLE_TAG_PREFIX = 'A';

/** Through-hole depth label per ISO / ASME drafting convention. */
export const THRU_LABEL = 'THRU';

/** Depth-symbol glyph (downward arrow) prefixed to blind-depth labels. */
export const DEPTH_SYMBOL = '↧';

// ─── validation ──────────────────────────────────────────────────────────

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function assertHole(hole: HoleSpec, index: number): void {
  const where = `hole[${index}]${hole && hole.id ? ` '${hole.id}'` : ''}`;
  if (!hole || typeof hole.id !== 'string' || hole.id.length === 0) {
    throw new HoleTableError(`${where}: id must be a non-empty string`);
  }
  if (!isFiniteNumber(hole.x) || !isFiniteNumber(hole.y)) {
    throw new HoleTableError(`${where}: x and y must be finite numbers`);
  }
  if (!isFiniteNumber(hole.diameter) || hole.diameter <= 0) {
    throw new HoleTableError(`${where}: diameter must be a positive finite number`);
  }
  if (hole.depth !== undefined && (!isFiniteNumber(hole.depth) || hole.depth <= 0)) {
    throw new HoleTableError(`${where}: depth must be a positive finite number when present`);
  }
}

function assertPrecision(precision: number): void {
  if (!Number.isInteger(precision) || precision < 0 || precision > 12) {
    throw new HoleTableError('precision must be an integer in [0, 12]');
  }
}

// ─── formatting ──────────────────────────────────────────────────────────

/** Round to `precision` places, normalizing -0 so two equal magnitudes match. */
function roundTo(value: number, precision: number): number {
  const rounded = Number(value.toFixed(precision));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function depthLabelOf(depth: number | undefined, precision: number): string {
  if (depth === undefined) return THRU_LABEL;
  return `${DEPTH_SYMBOL} ${depth.toFixed(precision)}`;
}

// ─── build ───────────────────────────────────────────────────────────────

/**
 * Build the hole table rows from a list of hole specs.
 *
 * Rows are sorted by (x, y) ascending — using the origin-subtracted,
 * precision-rounded coordinates — with the original id as a deterministic
 * tie-breaker so the output is stable across runs regardless of input order.
 *
 * When `groupIdentical` is set, holes sharing the same rounded diameter and
 * the same depth label collapse into a single row whose `count` is the group
 * size; the grouped row inherits the position of the group's first hole in
 * sorted order. Tags (A1, A2, ...) are assigned after sorting/grouping.
 */
export function buildHoleTable(
  holes: ReadonlyArray<HoleSpec>,
  opts: BuildHoleTableOptions = {},
): HoleTableRow[] {
  if (!Array.isArray(holes)) {
    throw new HoleTableError('holes must be an array');
  }
  const precision = opts.precision ?? 2;
  assertPrecision(precision);
  const originX = opts.originX ?? 0;
  const originY = opts.originY ?? 0;
  if (!isFiniteNumber(originX) || !isFiniteNumber(originY)) {
    throw new HoleTableError('originX and originY must be finite numbers');
  }

  // Validate + project to origin-relative, precision-rounded coordinates.
  const projected = holes.map((hole, index) => {
    assertHole(hole, index);
    return {
      id: hole.id,
      x: roundTo(hole.x - originX, precision),
      y: roundTo(hole.y - originY, precision),
      diameter: roundTo(hole.diameter, precision),
      depthLabel: depthLabelOf(hole.depth, precision),
    };
  });

  // Deterministic sort: x, then y, then id.
  projected.sort(
    (a, b) => a.x - b.x || a.y - b.y || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  const rows: HoleTableRow[] = [];
  if (opts.groupIdentical) {
    // Collapse identical diameter + depth label. Preserve sorted order of
    // first appearance so tags follow the table top-to-bottom.
    const indexByKey = new Map<string, number>();
    for (const p of projected) {
      const key = `${p.diameter}|${p.depthLabel}`;
      const existing = indexByKey.get(key);
      if (existing === undefined) {
        indexByKey.set(key, rows.length);
        rows.push({
          tag: '',
          x: p.x,
          y: p.y,
          diameter: p.diameter,
          depthLabel: p.depthLabel,
          count: 1,
        });
      } else {
        rows[existing].count += 1;
      }
    }
  } else {
    for (const p of projected) {
      rows.push({
        tag: '',
        x: p.x,
        y: p.y,
        diameter: p.diameter,
        depthLabel: p.depthLabel,
        count: 1,
      });
    }
  }

  // Assign tags after final ordering is fixed.
  rows.forEach((row, i) => {
    row.tag = `${HOLE_TAG_PREFIX}${i + 1}`;
  });
  return rows;
}

// ─── CSV export ──────────────────────────────────────────────────────────

const CSV_HEADER = ['Tag', 'X', 'Y', 'Diameter', 'Depth', 'Count'];

/**
 * Serialize hole-table rows to an RFC4180-ish CSV string (CRLF line breaks,
 * fields quoted only when they contain a comma, quote or newline; embedded
 * quotes doubled). Includes a header row.
 */
export function holeTableToCsv(rows: ReadonlyArray<HoleTableRow>): string {
  if (!Array.isArray(rows)) {
    throw new HoleTableError('rows must be an array');
  }
  const lines: string[] = [CSV_HEADER.map(csvField).join(',')];
  for (const row of rows) {
    lines.push(
      [
        csvField(row.tag),
        csvField(String(row.x)),
        csvField(String(row.y)),
        csvField(String(row.diameter)),
        csvField(row.depthLabel),
        csvField(String(row.count)),
      ].join(','),
    );
  }
  return lines.join('\r\n');
}

function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
