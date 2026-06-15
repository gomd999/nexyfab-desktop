/**
 * DXF export for sketch entities (Phase 2 of the sketch-export pipeline).
 *
 * Where SVG is the right format for ad-hoc visual interchange, DXF is the
 * lingua franca that AutoCAD, LibreCAD, Fusion 360, SolidWorks, BricsCAD,
 * QCAD, and basically every CAD tool on the market can ingest losslessly.
 * This module emits AutoCAD R12-compatible ASCII DXF — the lowest common
 * denominator that's still universally readable in 2026.
 *
 * Why R12 and not R2000+ / AC1014+?
 *   - R12 is the simplest DXF flavor that requires no $HANDSEED/handle
 *     bookkeeping, no OBJECTS section, no CLASSES section, and no extended
 *     dictionary plumbing. The entities we need (POINT/LINE/CIRCLE/ARC)
 *     are unchanged across every DXF generation since R12.
 *   - Every CAD tool worth importing into accepts R12 as a baseline. Newer
 *     flavors gain features (splines, lwpolylines, mtext) that we don't
 *     emit yet, so there's no reason to pay the format-complexity tax.
 *   - We deliberately *omit* the $ACADVER header variable: with no
 *     $ACADVER, readers fall back to "infer the version from content,"
 *     which for our minimal entity subset is always R12-equivalent. This
 *     is what QCAD/LibreCAD do for their minimal exports too.
 *
 * Group code primer (the only ones we use):
 *     0  = entity type or section/table marker        (string)
 *     2  = name (section, table, layer name)          (string)
 *     6  = linetype name                              (string)
 *     8  = layer name                                 (string)
 *     9  = header variable name                       (string)
 *    10  = primary point X                            (real)
 *    20  = primary point Y                            (real)
 *    30  = primary point Z (always 0 for 2D sketch)   (real)
 *    11  = secondary point X (LINE end)               (real)
 *    21  = secondary point Y (LINE end)               (real)
 *    31  = secondary point Z                          (real)
 *    40  = float (radius, height, etc.)               (real)
 *    50  = angle, start                               (degrees, real)
 *    51  = angle, end                                 (degrees, real)
 *    62  = color number (1..255, 256=BYLAYER)         (int)
 *    70  = standard flag / int value                  (int)
 *   100  = subclass marker (R2000+; we skip)
 *
 * Arc convention:
 *   DXF arcs are *always* drawn CCW from start_angle to end_angle, in
 *   degrees. Our solver arcs (sketchSvgExport.SvgArc) carry radians with
 *   the same CCW convention, so the conversion is `rad * 180 / pi`. No
 *   sign-flip needed (unlike SVG, where we had to invert sweep-flag for
 *   the Y-flip wrapper — DXF stays in mathematician coords natively).
 *
 * Units:
 *   $INSUNITS controls how the receiving application *interprets* the
 *   coordinate magnitudes when inserting the drawing into a different
 *   unit system. We emit 4=Millimeters or 1=Inches. The numeric values
 *   are *not* converted — caller is responsible for feeding consistent
 *   coords. (This matches AutoCAD's own behavior; INSUNITS is metadata.)
 *
 * Line endings:
 *   DXF is strict about CRLF historically, but every modern reader
 *   accepts LF. We emit LF for clean text-diff behavior and to keep
 *   the test assertions simple. AutoCAD 2010+ has been LF-tolerant
 *   for a decade; if a 1990s-era reader rejects it we can add a
 *   `lineEnding` option later.
 *
 * No-op safety:
 *   An empty entity set produces a syntactically valid DXF (HEADER +
 *   TABLES + empty ENTITIES + EOF). Callers can chain export → download
 *   without special-casing the empty sketch — same contract as
 *   sketchSvgExport.
 */

import type { SketchEntities, SvgArc, SvgCircle, SvgLine, SvgPoint } from './sketchSvgExport';

export type { SketchEntities } from './sketchSvgExport';

export interface SketchDxfOptions {
  /** Drawing units. Mapped to $INSUNITS (4=mm, 1=inch). Defaults to 'mm'. */
  units?: 'mm' | 'inch';
  /**
   * Layer name written on every emitted entity. Defaults to '0', which is
   * the AutoCAD default layer that always exists. Custom names are added
   * to the LAYER table automatically.
   */
  layer?: string;
  /**
   * Optional document title. Stored as a comment-style header pair
   * ($PROJECTNAME). Purely informational.
   */
  title?: string;
}

const GENERATOR = 'NexyFab sketchDxfExport v1';
const DEFAULT_LAYER = '0';

// AutoCAD Color Index — 7 is black-on-white / white-on-black, the
// universal "neutral" entity color. We write it as the layer color so
// the drawing looks sensible regardless of the target tool's theme.
const ACI_BLACK_OR_WHITE = 7;

// ─── public API ──────────────────────────────────────────────────────────

/**
 * Serialize the supplied entities to an ASCII DXF (R12-compatible) string.
 *
 * The output is deterministic for a given input: same entities in the same
 * order produce byte-identical DXF, which keeps snapshot tests and
 * fixture diffs stable.
 */
export function exportSketchToDxf(
  entities: SketchEntities,
  opts?: SketchDxfOptions,
): string {
  const units = opts?.units ?? 'mm';
  const layer = opts?.layer ?? DEFAULT_LAYER;
  const title = opts?.title;

  const lines: string[] = [];

  // ── HEADER ────────────────────────────────────────────────────────────
  lines.push('0', 'SECTION');
  lines.push('2', 'HEADER');

  // $INSUNITS — how the receiver interprets coordinate magnitudes.
  lines.push('9', '$INSUNITS');
  lines.push('70', String(insunitsCode(units)));

  // $MEASUREMENT — 0=English, 1=Metric. Belt-and-suspenders alongside
  // $INSUNITS so tools that ignore $INSUNITS (rare but exist) still know.
  lines.push('9', '$MEASUREMENT');
  lines.push('70', units === 'mm' ? '1' : '0');

  // $EXTMIN / $EXTMAX — drawing extents. Optional in R12 but a number of
  // viewers use them to set the initial zoom rectangle; emitting them
  // gives a much nicer "Open in AutoCAD" experience than leaving zoom
  // defaulted to (0,0)-(1,1).
  const extents = computeExtents(entities);
  lines.push('9', '$EXTMIN');
  lines.push('10', fmt(extents.minX));
  lines.push('20', fmt(extents.minY));
  lines.push('30', '0.0');
  lines.push('9', '$EXTMAX');
  lines.push('10', fmt(extents.maxX));
  lines.push('20', fmt(extents.maxY));
  lines.push('30', '0.0');

  if (title) {
    // $PROJECTNAME is the standard slot for a document-level human title;
    // it's stored as a string and ignored by anything that doesn't care.
    lines.push('9', '$PROJECTNAME');
    lines.push('1', sanitizeString(title));
  }

  lines.push('0', 'ENDSEC');

  // ── TABLES ────────────────────────────────────────────────────────────
  lines.push('0', 'SECTION');
  lines.push('2', 'TABLES');

  // LAYER table. Always include '0' (AutoCAD's mandatory default layer);
  // add the user's layer if they chose something else.
  lines.push('0', 'TABLE');
  lines.push('2', 'LAYER');
  // 70 on a TABLE header is the max entries — set to a number ≥ the count
  // of entries we'll write. Most readers tolerate any positive integer.
  const layerNames = layer === DEFAULT_LAYER ? [DEFAULT_LAYER] : [DEFAULT_LAYER, layer];
  lines.push('70', String(layerNames.length));
  for (const name of layerNames) {
    lines.push('0', 'LAYER');
    lines.push('2', name);
    lines.push('70', '0'); // 0 = layer is on, thawed, unlocked, plottable
    lines.push('62', String(ACI_BLACK_OR_WHITE));
    lines.push('6', 'CONTINUOUS');
  }
  lines.push('0', 'ENDTAB');

  lines.push('0', 'ENDSEC');

  // ── ENTITIES ──────────────────────────────────────────────────────────
  lines.push('0', 'SECTION');
  lines.push('2', 'ENTITIES');

  // Stable emit order matches the SVG exporter: circles → arcs → lines →
  // points. Two equal inputs produce byte-identical DXF this way.
  for (const c of entities.circles) emitCircle(lines, c, layer);
  for (const a of entities.arcs) emitArc(lines, a, layer);
  for (const ln of entities.lines) emitLine(lines, ln, layer);
  for (const p of entities.points) emitPoint(lines, p, layer);

  lines.push('0', 'ENDSEC');

  // ── EOF ───────────────────────────────────────────────────────────────
  lines.push('0', 'EOF');

  // Trailing newline so concatenation/tail tools don't merge our last
  // record with a downstream file. Reference: DXF spec, "End of File".
  return lines.join('\n') + '\n';
}

/**
 * Trigger a download of the supplied sketch as a DXF file. Browser-only —
 * relies on `URL.createObjectURL` and a transient `<a>` element click.
 *
 * Throws if invoked outside a DOM (same contract as downloadSketchAsSvg)
 * so callers fail loudly instead of silently no-op'ing.
 */
export function downloadSketchAsDxf(
  entities: SketchEntities,
  filename: string,
  opts?: SketchDxfOptions,
): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('downloadSketchAsDxf: requires a browser (window/document)');
  }
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('downloadSketchAsDxf: URL.createObjectURL unavailable');
  }
  const dxf = exportSketchToDxf(entities, opts);
  // application/dxf is the de-facto MIME; AutoCAD's own MIME is
  // image/vnd.dxf but no browser recognizes it. Plain text/plain would
  // open in the browser instead of downloading, which we don't want.
  const blob = new Blob([dxf], { type: 'application/dxf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.toLowerCase().endsWith('.dxf') ? filename : `${filename}.dxf`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke a tick so Safari/Firefox have time to start the download.
  setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // best-effort cleanup
    }
  }, 0);
}

// ─── entity emitters ─────────────────────────────────────────────────────

function emitPoint(out: string[], p: SvgPoint, layer: string): void {
  out.push('0', 'POINT');
  out.push('8', layer);
  out.push('10', fmt(p.x));
  out.push('20', fmt(p.y));
  out.push('30', '0.0');
}

function emitLine(out: string[], ln: SvgLine, layer: string): void {
  out.push('0', 'LINE');
  out.push('8', layer);
  out.push('10', fmt(ln.x1));
  out.push('20', fmt(ln.y1));
  out.push('30', '0.0');
  out.push('11', fmt(ln.x2));
  out.push('21', fmt(ln.y2));
  out.push('31', '0.0');
}

function emitCircle(out: string[], c: SvgCircle, layer: string): void {
  out.push('0', 'CIRCLE');
  out.push('8', layer);
  out.push('10', fmt(c.cx));
  out.push('20', fmt(c.cy));
  out.push('30', '0.0');
  out.push('40', fmt(c.radius));
}

function emitArc(out: string[], a: SvgArc, layer: string): void {
  out.push('0', 'ARC');
  out.push('8', layer);
  out.push('10', fmt(a.cx));
  out.push('20', fmt(a.cy));
  out.push('30', '0.0');
  out.push('40', fmt(a.radius));
  // DXF arcs are CCW from start_angle to end_angle, in DEGREES. Our solver
  // entities use radians with the same CCW convention, so a straight
  // radians→degrees conversion suffices. We also wrap into [0,360) to
  // match how AutoCAD itself stores arc angles — strict readers (older
  // BricsCAD versions) reject negative degrees.
  out.push('50', fmt(normalizeDeg(radToDeg(a.startAngle))));
  out.push('51', fmt(normalizeDeg(radToDeg(a.endAngle))));
}

// ─── helpers ─────────────────────────────────────────────────────────────

function insunitsCode(units: 'mm' | 'inch'): number {
  // From the DXF spec, $INSUNITS values: 0=Unitless, 1=Inches,
  // 2=Feet, 3=Miles, 4=Millimeters, 5=Centimeters, 6=Meters, ...
  return units === 'mm' ? 4 : 1;
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function normalizeDeg(deg: number): number {
  // Wrap to [0, 360). Using ((x % 360) + 360) % 360 instead of
  // a positive-only mod so negative inputs map cleanly.
  if (!Number.isFinite(deg)) return 0;
  const m = ((deg % 360) + 360) % 360;
  // -0 → 0 cosmetic guard
  return Object.is(m, -0) ? 0 : m;
}

interface Extents {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function computeExtents(entities: SketchEntities): Extents {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const expand = (x: number, y: number): void => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  for (const p of entities.points) expand(p.x, p.y);
  for (const ln of entities.lines) {
    expand(ln.x1, ln.y1);
    expand(ln.x2, ln.y2);
  }
  for (const c of entities.circles) {
    expand(c.cx - c.radius, c.cy - c.radius);
    expand(c.cx + c.radius, c.cy + c.radius);
  }
  for (const a of entities.arcs) {
    // Same conservative bound as the SVG exporter: full bounding circle.
    expand(a.cx - a.radius, a.cy - a.radius);
    expand(a.cx + a.radius, a.cy + a.radius);
  }

  if (!Number.isFinite(minX)) {
    // Empty sketch — zero extents centered on the origin. Readers handle
    // this gracefully (Fusion 360 just shows an empty drawing).
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Format a real number for a DXF group value. We want:
 *   - Always a decimal point (so the reader knows it's a real not int).
 *     "1" alone is ambiguous; "1.0" is unambiguous and what AutoCAD
 *     emits itself.
 *   - Trim trailing FP noise (0.1+0.2 → "0.3" not "0.30000000000000004").
 *   - No "-0" — purely cosmetic but keeps fixture diffs clean.
 */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0.0';
  const rounded = Math.round(n * 1_000_000) / 1_000_000;
  const safe = Object.is(rounded, -0) ? 0 : rounded;
  // Ensure a decimal point so the value is unambiguously a DXF real.
  const s = String(safe);
  return s.includes('.') || s.includes('e') || s.includes('E') ? s : `${s}.0`;
}

/**
 * Strip characters DXF can't carry inside a group-value string. Control
 * chars (< 0x20 except tab) and embedded newlines break the line-pair
 * parser, since every value is on its own line. We replace with spaces
 * rather than dropping so the visible content stays close to the input.
 * Reference to GENERATOR keeps the variable visible without an unused
 * warning if we ever wire it into a header field.
 */
function sanitizeString(s: string): string {
  // The generator name is intentionally part of the module's public
  // identity but not emitted in the DXF body to keep the file lean —
  // referenced here so the constant isn't tree-shaken in dev tooling.
  void GENERATOR;
  // Include 0x0a (LF) and 0x0d (CR) in the strip set — those would
  // shove the value onto its own line and corrupt the line-pair grammar.
  return s.replace(/[\x00-\x1f]/g, ' ');
}
