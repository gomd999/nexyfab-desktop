/**
 * DXF import for sketch entities — reverse of sketchDxfExport.
 *
 * Parses an ASCII DXF document (AutoCAD R12-baseline, but tolerant of
 * R2000+ extensions we don't care about) back into the structural
 * `SketchEntities` shape the solver and overlays understand.
 *
 * Parser choice — line-pair walker, not external dxf-parser dep:
 *   - DXF is the simplest possible structured format: even-indexed lines
 *     are group codes (integers), odd-indexed are values (strings). A
 *     ~60-line walker handles everything we need. Pulling in `dxf-parser`
 *     would add 200KB+ of code that knows about BLOCKS / OBJECTS /
 *     extension dicts / spline NURBS — none of which we use.
 *   - Stays in lockstep with sketchSvgImport: no runtime deps, runs in
 *     Node / browser / web-worker / cf-worker identically, and the failure
 *     surface is small enough to reason about end-to-end.
 *
 * What we parse:
 *   - Group-code records inside the ENTITIES section only. HEADER variables
 *     ($INSUNITS) are picked up for the `units` result field. TABLES,
 *     BLOCKS, CLASSES, OBJECTS are skipped entirely — they describe layer
 *     state and metadata we don't round-trip.
 *   - POINT  (10 x, 20 y)                                → SketchPoint
 *   - LINE   (10/20 start, 11/21 end)                    → SketchLine
 *   - CIRCLE (10/20 center, 40 radius)                   → SketchCircle
 *   - ARC    (10/20 center, 40 radius, 50/51 deg→rad)    → SketchArc
 *
 * What we warn about (Phase 2 wishlist):
 *   - LWPOLYLINE / POLYLINE — multi-segment paths, needs explosion to lines.
 *   - SPLINE — NURBS approximation only.
 *   - ELLIPSE — minor-axis ratio needs handling.
 *   - TEXT / MTEXT — annotations, not sketch geometry.
 *   - Anything else inside ENTITIES that isn't one of our four → generic
 *     "unsupported entity" warning so the caller knows something was dropped.
 *
 * Line-ending tolerance:
 *   DXF files in the wild come with LF, CRLF, or (rarely) CR-only line
 *   endings. We normalize all three to LF before walking. Trailing
 *   whitespace on each line is also stripped — some exporters emit
 *   "  10  \n   3.5\n" with leading/trailing padding around the group
 *   code value to align the columns visually. Both forms tokenize the
 *   same after a `.trim()`.
 *
 * Units:
 *   $INSUNITS=4 ⇒ 'mm', $INSUNITS=1 ⇒ 'inch'. Other values (cm, m, feet,
 *   miles, dimensionless, …) generate a warning and fall back to undefined
 *   so the caller can prompt the user. We do NOT convert coordinate values
 *   — same contract as the exporter: caller owns unit consistency.
 *
 * Arc convention:
 *   DXF arcs are CCW from start_angle to end_angle in DEGREES. Our
 *   SvgArc carries radians with the same CCW convention, so the inverse
 *   conversion is `deg * pi / 180`. No sign-flip needed.
 *
 * No exceptions:
 *   Public API never throws. Invalid input returns `{ok: false, error}`
 *   with `entities: undefined` so callers (UI, API routes) can render the
 *   error inline. Internal helpers may throw to signal "skip this entity";
 *   the top-level walker catches and converts to warnings.
 */

import type {
  SketchEntities,
  SvgPoint,
  SvgLine,
  SvgCircle,
  SvgArc,
} from './sketchSvgExport';

export type { SketchEntities } from './sketchSvgExport';

export interface DxfImportResult {
  /** True when the DXF was parsed without a hard structural error. */
  ok: boolean;
  /** Parsed entities (sketch space, +Y up). Undefined when `ok === false`. */
  entities?: SketchEntities;
  /** Non-fatal issues: unsupported entities skipped, malformed records, unknown units, etc. */
  warnings: string[];
  /** Set when parsing failed entirely (no readable structure at all). */
  error?: string;
  /**
   * Drawing units recovered from $INSUNITS, when present. Undefined when
   * the header is missing OR carries an unrecognized unit code (with a
   * warning emitted in the latter case).
   */
  units?: 'mm' | 'inch';
}

// ─── public API ──────────────────────────────────────────────────────────

/**
 * Parse an ASCII DXF document into `SketchEntities`.
 *
 * Round-trips with `exportSketchToDxf`: the returned entities, when
 * re-exported with the same options, produce DXF whose entity coordinates
 * match the originals to 6-decimal precision (matching the exporter's
 * own rounding). Layer membership, color, and stylistic metadata are
 * intentionally dropped — they're not part of `SketchEntities`.
 *
 * Never throws — all failure modes are reported via the result object.
 */
export function importSketchFromDxf(source: string): DxfImportResult {
  const warnings: string[] = [];

  if (typeof source !== 'string' || source.trim().length === 0) {
    return { ok: false, warnings, error: 'empty input' };
  }

  // Normalize line endings (CRLF, CR, mixed → LF) so the line-pair walker
  // can rely on a single split character. Strip the BOM that some Windows
  // exporters prepend (UTF-8 with BOM is rare in DXF but seen in the wild).
  const normalized = source
    .replace(/^﻿/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  const rawLines = normalized.split('\n');
  // Trim each line — DXF tolerates leading/trailing whitespace around the
  // group code, and a few exporters indent for human readability.
  const lines = rawLines.map((l) => l.trim());

  // Drop trailing empty lines so the line-pair walker doesn't see a
  // dangling odd line (which would otherwise be reported as a malformed
  // record). Leading empty lines are kept and absorbed by the walker.
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  if (lines.length < 2) {
    return { ok: false, warnings, error: 'DXF too short to contain any group records' };
  }

  // Walk pairs. Even-index = code (string-of-int), odd-index = value.
  // A truly malformed file (odd line count after trim-trailing-empties)
  // is reported once and parsing continues — most CAD tools also tolerate
  // a hanging record at EOF.
  const pairs: Array<{ code: number; value: string; lineNo: number }> = [];
  let parsedAny = false;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const codeStr = lines[i];
    const valueStr = lines[i + 1];
    // Skip empty pair slots (rare but legal: some legacy R10 emitters
    // produce blank line pairs between sections).
    if (codeStr === '' && valueStr === '') continue;
    // Validate the code is an integer (DXF spec: codes are always ints).
    if (!/^-?\d+$/.test(codeStr)) {
      // Single malformed code: skip the pair and warn — don't abort the
      // whole file. AutoCAD itself is famously tolerant here.
      warnings.push(
        `skipped malformed group code "${truncate(codeStr, 20)}" at line ${i + 1}`,
      );
      continue;
    }
    pairs.push({ code: parseInt(codeStr, 10), value: valueStr, lineNo: i + 1 });
    parsedAny = true;
  }

  if (!parsedAny) {
    return { ok: false, warnings, error: 'no valid group records found' };
  }

  // ── Scan HEADER for $INSUNITS ───────────────────────────────────────
  // Header records are pairs of: (9, "$VARNAME") followed by (NN, value).
  // We only care about $INSUNITS but scan the whole HEADER section so we
  // don't accidentally re-trigger on a same-named string elsewhere.
  let units: 'mm' | 'inch' | undefined;
  const headerRange = findSectionRange(pairs, 'HEADER');
  if (headerRange) {
    for (let i = headerRange.start; i < headerRange.end; i++) {
      if (pairs[i].code === 9 && pairs[i].value === '$INSUNITS') {
        // The next record is the value pair: (70, code).
        const next = pairs[i + 1];
        if (next && next.code === 70) {
          const code = parseInt(next.value, 10);
          if (code === 4) units = 'mm';
          else if (code === 1) units = 'inch';
          else if (Number.isFinite(code)) {
            warnings.push(
              `$INSUNITS=${code} not supported (only 1=inch / 4=mm); units left undefined`,
            );
          }
        }
        break;
      }
    }
  }

  // ── Scan ENTITIES section ───────────────────────────────────────────
  const points: SvgPoint[] = [];
  const lines2: SvgLine[] = [];
  const circles: SvgCircle[] = [];
  const arcs: SvgArc[] = [];

  const entitiesRange = findSectionRange(pairs, 'ENTITIES');
  if (!entitiesRange) {
    // No ENTITIES section at all — this is a valid DXF (just empty
    // geometry). Return ok=true with empty entities so callers can
    // distinguish "no geometry" from "file broken".
    warnings.push('no ENTITIES section found — returning empty entities');
    return {
      ok: true,
      entities: { points, lines: lines2, circles, arcs },
      warnings,
      units,
    };
  }

  // Walk the entities section by partitioning on group code 0 — each new
  // 0-record begins a new entity (or signals ENDSEC which closes the loop).
  // The slice we receive ends BEFORE the closing ENDSEC pair.
  const body = pairs.slice(entitiesRange.start, entitiesRange.end);

  // Locate every 0-record boundary inside the body. Each (start..nextStart)
  // forms one entity record. The first 0-record begins the first entity;
  // anything before it (rare but legal: pre-entity comments via code 999)
  // is ignored.
  const boundaries: number[] = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i].code === 0) boundaries.push(i);
  }
  boundaries.push(body.length); // sentinel — end of last entity

  for (let b = 0; b + 1 < boundaries.length; b++) {
    const start = boundaries[b];
    const end = boundaries[b + 1];
    const head = body[start];
    if (!head || head.code !== 0) continue;
    const type = head.value;
    // Collect this entity's group records (everything after the 0/type
    // header up to the next 0-record).
    const recs = body.slice(start + 1, end);

    try {
      switch (type) {
        case 'POINT': {
          const p = parsePoint(recs);
          points.push(p);
          break;
        }
        case 'LINE': {
          const ln = parseLine(recs);
          lines2.push(ln);
          break;
        }
        case 'CIRCLE': {
          const c = parseCircle(recs);
          circles.push(c);
          break;
        }
        case 'ARC': {
          const a = parseArc(recs);
          arcs.push(a);
          break;
        }
        // Phase 2 candidates — known DXF entity types we deliberately
        // don't parse yet. Warn so the caller can surface "we dropped
        // your splines" rather than silently losing geometry.
        case 'LWPOLYLINE':
        case 'POLYLINE':
          warnings.push(
            `unsupported entity ${type} skipped (Phase 2: needs segment explosion)`,
          );
          break;
        case 'SPLINE':
          warnings.push(
            'unsupported entity SPLINE skipped (Phase 2: NURBS approximation)',
          );
          break;
        case 'ELLIPSE':
          warnings.push(
            'unsupported entity ELLIPSE skipped (Phase 2: needs minor-axis handling)',
          );
          break;
        case 'TEXT':
        case 'MTEXT':
          warnings.push(
            `unsupported entity ${type} skipped (annotations are not sketch geometry)`,
          );
          break;
        case 'INSERT':
        case 'DIMENSION':
        case 'HATCH':
        case 'SOLID':
        case '3DFACE':
        case 'VERTEX':
        case 'SEQEND':
        case 'ATTRIB':
        case 'ATTDEF':
          warnings.push(
            `unsupported entity ${type} skipped`,
          );
          break;
        default:
          // Unknown entity — warn but don't break the rest of the file.
          warnings.push(`unknown entity type "${truncate(type, 30)}" skipped`);
          break;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      warnings.push(`skipped ${type}: ${msg}`);
    }
  }

  return {
    ok: true,
    entities: { points, lines: lines2, circles, arcs },
    warnings,
    units,
  };
}

// ─── section locator ─────────────────────────────────────────────────────

/**
 * Locate a named DXF section, returning the index range of its BODY
 * (between the opening "2/<name>" record and the closing "0/ENDSEC"
 * record). Returns `null` if the section is not present.
 *
 * The DXF section pattern is:
 *   0 SECTION
 *   2 <NAME>        ← name pair
 *   ... body ...
 *   0 ENDSEC        ← closer
 *
 * We return the body range as [start, end) — start = index AFTER the
 * 2/<name> pair, end = index of the 0/ENDSEC record (exclusive).
 */
function findSectionRange(
  pairs: ReadonlyArray<{ code: number; value: string }>,
  name: string,
): { start: number; end: number } | null {
  for (let i = 0; i + 1 < pairs.length; i++) {
    if (
      pairs[i].code === 0 &&
      pairs[i].value === 'SECTION' &&
      pairs[i + 1].code === 2 &&
      pairs[i + 1].value === name
    ) {
      // Find the matching ENDSEC. Sections do not nest in DXF, so the
      // first 0/ENDSEC after our header is the closer.
      const start = i + 2;
      for (let j = start; j < pairs.length; j++) {
        if (pairs[j].code === 0 && pairs[j].value === 'ENDSEC') {
          return { start, end: j };
        }
      }
      // Unterminated section — return everything to EOF rather than
      // refusing to parse. Real-world files occasionally omit a trailing
      // ENDSEC; we don't want to lose all the geometry over it.
      return { start, end: pairs.length };
    }
  }
  return null;
}

// ─── per-entity parsers ──────────────────────────────────────────────────

/**
 * Walk an entity's group records and pluck the few codes we care about.
 * Returns the first occurrence of each code — the only case where DXF
 * repeats a code within one entity is for polyline vertices, which we
 * don't parse. Returns `undefined` for absent codes.
 */
function pluck(
  recs: ReadonlyArray<{ code: number; value: string }>,
): Map<number, string> {
  const m = new Map<number, string>();
  for (const r of recs) {
    if (!m.has(r.code)) m.set(r.code, r.value);
  }
  return m;
}

function parsePoint(recs: ReadonlyArray<{ code: number; value: string }>): SvgPoint {
  const m = pluck(recs);
  const x = req(m, 10, 'POINT.x');
  const y = req(m, 20, 'POINT.y');
  return { id: autoId('dxp'), x, y };
}

function parseLine(recs: ReadonlyArray<{ code: number; value: string }>): SvgLine {
  const m = pluck(recs);
  const x1 = req(m, 10, 'LINE.x1');
  const y1 = req(m, 20, 'LINE.y1');
  const x2 = req(m, 11, 'LINE.x2');
  const y2 = req(m, 21, 'LINE.y2');
  const id = autoId('dxl');
  // p1/p2 ids are not preserved through DXF round-trips (the exporter
  // doesn't emit them as DXF data). Synthesize stable placeholders so
  // callers that key off them still get unique strings — same pattern
  // sketchSvgImport uses.
  return {
    id,
    p1: `${id}.p1`,
    p2: `${id}.p2`,
    x1, y1,
    x2, y2,
  };
}

function parseCircle(recs: ReadonlyArray<{ code: number; value: string }>): SvgCircle {
  const m = pluck(recs);
  const cx = req(m, 10, 'CIRCLE.cx');
  const cy = req(m, 20, 'CIRCLE.cy');
  const radius = req(m, 40, 'CIRCLE.radius');
  if (radius <= 0) throw new Error(`CIRCLE radius must be positive (got ${radius})`);
  return { id: autoId('dxc'), cx, cy, radius };
}

function parseArc(recs: ReadonlyArray<{ code: number; value: string }>): SvgArc {
  const m = pluck(recs);
  const cx = req(m, 10, 'ARC.cx');
  const cy = req(m, 20, 'ARC.cy');
  const radius = req(m, 40, 'ARC.radius');
  if (radius <= 0) throw new Error(`ARC radius must be positive (got ${radius})`);
  const startDeg = req(m, 50, 'ARC.startAngle');
  const endDeg = req(m, 51, 'ARC.endAngle');
  return {
    id: autoId('dxa'),
    cx,
    cy,
    radius,
    // DXF stores angles in degrees CCW; our solver wants radians CCW.
    // Straight conversion — no sign flip needed.
    startAngle: degToRad(startDeg),
    endAngle: degToRad(endDeg),
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────

/**
 * Pull a required real-number record. Throws (caught by the top-level
 * walker and turned into a warning) when the code is missing or its
 * value isn't a finite number.
 */
function req(m: Map<number, string>, code: number, label: string): number {
  const v = m.get(code);
  if (v === undefined) {
    throw new Error(`missing required group code ${code} (${label})`);
  }
  const n = parseFloat(v);
  if (!Number.isFinite(n)) {
    throw new Error(`group code ${code} (${label}) is not a finite number: "${v}"`);
  }
  return n;
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Synthesize a stable-ish id for imported entities (DXF has no native id). */
let autoCounter = 0;
function autoId(prefix: string): string {
  return `${prefix}${++autoCounter}`;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}
