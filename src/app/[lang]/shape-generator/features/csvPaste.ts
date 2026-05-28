/**
 * CSV paste parser for the Hole Wizard Position tab (Phase 2 W5 — Track C5).
 *
 * Self-contained 30-line parser (no Papa.parse / no third-party dep — see
 * grep audit in W5 plan). Lines map to {x, y[, diameter, label]} points.
 *
 * Delimiter precedence (spec ambiguity resolved here):
 *   1. If any non-empty line contains a tab, use tab.
 *   2. Otherwise, if any contains a semicolon, use semicolon.
 *   3. Otherwise, default to comma.
 * This matches the order Excel and most spreadsheet exports use ("paste
 * from clipboard" almost always lands on tab-separated; CSV-export files
 * tend to be semicolon in EU locales and comma elsewhere).
 *
 * Empty rows are skipped; rows with too few/non-numeric fields are flagged
 * inline with their 1-based line number so the wizard's preview can render
 * a per-row error chip.
 *
 * Spec §7.4 lists CSV paste as "absolute-mode only" — the wizard maps the
 * parsed points to the `manual` array kind.
 */

export interface CsvParsedPoint {
  /** 1-based line number in the original input (for error chip rendering). */
  line: number;
  x: number;
  y: number;
  /** Optional bore diameter override (mm). */
  diameter?: number;
  /** Optional human label. */
  label?: string;
}

export interface CsvParseError {
  /** 1-based line number. */
  line: number;
  /** Original line text (untrimmed). */
  raw: string;
  /** Tag — UI maps to a localized error chip. */
  code:
    | 'TOO_FEW_FIELDS'
    | 'INVALID_NUMBER'
    | 'TOO_MANY_POINTS'
    | 'EMPTY_INPUT';
  message: string;
}

export interface CsvParseResult {
  points: CsvParsedPoint[];
  errors: CsvParseError[];
  /** Bounding box of accepted points; null when there are none. */
  bbox: { minX: number; minY: number; maxX: number; maxY: number } | null;
  /** Detected delimiter — useful for the preview tag. */
  delimiter: '\t' | ';' | ',';
}

/** Hard cap — perf gate matching the W5 scope spec ("max 500 points"). */
export const CSV_PASTE_MAX_POINTS = 500;

function pickDelimiter(lines: string[]): '\t' | ';' | ',' {
  for (const line of lines) {
    if (line.indexOf('\t') !== -1) return '\t';
  }
  for (const line of lines) {
    if (line.indexOf(';') !== -1) return ';';
  }
  return ',';
}

function parseNumber(field: string | undefined): number | null {
  if (field === undefined) return null;
  const trimmed = field.trim();
  if (trimmed === '') return null;
  // Accept both "1.5" and "1,5" (EU decimal) ONLY when the delimiter is not
  // a comma. Caller passes through the already-split field, so by the time
  // we see it the delimiter ambiguity is gone. Simpler: just `Number`.
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a CSV blob into a {points, errors, bbox, delimiter} result. Pure
 * function — never throws. Empty input is reported as a single `EMPTY_INPUT`
 * error rather than a thrown exception so the wizard can show inline help.
 */
export function parseCsvPaste(input: string): CsvParseResult {
  const rawLines = input.split(/\r?\n/);
  // Lines preserve their 1-based number; empty lines are dropped from the
  // parsed output but their indices are still counted (for accurate error
  // messages when row 7 of the user's blob is malformed).
  const nonEmpty: Array<{ line: number; raw: string }> = [];
  rawLines.forEach((raw, i) => {
    if (raw.trim() !== '') nonEmpty.push({ line: i + 1, raw });
  });

  if (nonEmpty.length === 0) {
    return {
      points: [],
      errors: [
        {
          line: 1,
          raw: '',
          code: 'EMPTY_INPUT',
          message: 'CSV input is empty — paste rows of `x, y[, diameter, label]`',
        },
      ],
      bbox: null,
      delimiter: ',',
    };
  }

  const delimiter = pickDelimiter(nonEmpty.map((l) => l.raw));

  const points: CsvParsedPoint[] = [];
  const errors: CsvParseError[] = [];

  for (const { line, raw } of nonEmpty) {
    if (points.length >= CSV_PASTE_MAX_POINTS) {
      errors.push({
        line,
        raw,
        code: 'TOO_MANY_POINTS',
        message: `Exceeded ${CSV_PASTE_MAX_POINTS} points — extra rows dropped`,
      });
      break;
    }
    const fields = raw.split(delimiter).map((f) => f.trim());
    if (fields.length < 2) {
      errors.push({
        line,
        raw,
        code: 'TOO_FEW_FIELDS',
        message: `Expected at least 2 fields (x, y), got ${fields.length}`,
      });
      continue;
    }
    const x = parseNumber(fields[0]);
    const y = parseNumber(fields[1]);
    if (x === null || y === null) {
      errors.push({
        line,
        raw,
        code: 'INVALID_NUMBER',
        message: `Could not parse coordinates from "${fields[0]}", "${fields[1]}"`,
      });
      continue;
    }
    const diameter =
      fields.length >= 3 && fields[2] !== '' ? parseNumber(fields[2]) : null;
    const label =
      fields.length >= 4 && fields[3] !== '' ? fields[3] : undefined;

    const point: CsvParsedPoint = { line, x, y };
    if (diameter !== null) point.diameter = diameter;
    if (label) point.label = label;
    points.push(point);
  }

  let bbox: CsvParseResult['bbox'] = null;
  if (points.length > 0) {
    let minX = points[0].x;
    let maxX = points[0].x;
    let minY = points[0].y;
    let maxY = points[0].y;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    bbox = { minX, maxX, minY, maxY };
  }

  return { points, errors, bbox, delimiter };
}

/**
 * Convert a successful parse result into the `manual` array data shape so
 * the wizard can swap it directly into `arrayDef.params.data.points`.
 */
export function csvPointsToManualPoints(
  arrayId: string,
  parsed: CsvParsedPoint[],
): Array<{ id: string; x: number; y: number }> {
  return parsed.map((p, i) => ({
    id: p.label ? `${arrayId}#csv-${p.label}` : `${arrayId}#csv-${i}`,
    x: p.x,
    y: p.y,
  }));
}
