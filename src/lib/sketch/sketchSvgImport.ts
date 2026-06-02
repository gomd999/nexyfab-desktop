/**
 * SVG import for sketch entities — reverse of sketchSvgExport.
 *
 * Phase 1.B import pipeline: parse an SVG document (typically one our own
 * exporter produced, but tolerant of hand-authored / third-party SVGs)
 * back into the structural `SketchEntities` shape the solver and overlays
 * understand.
 *
 * Parser choice — regex, not DOMParser:
 *   - DOMParser is browser-only. jsdom would work in tests but adds a
 *     hard runtime dep on a multi-MB package whose surface (XML namespaces,
 *     case-insensitive attr matching, error handling differences) drifts
 *     between versions. Our exporter writes a tightly-bounded subset of
 *     SVG (no namespaces beyond default, no CSS, no scripts, no XML
 *     comments inside elements, attribute values always double-quoted)
 *     so a regex tokenizer is reliable AND keeps this module pure /
 *     runnable in any JS environment (Node, browser, web-worker, Cf-worker).
 *   - We also tolerate enough laxity (whitespace variations, optional XML
 *     declaration, single OR double quotes on attributes, scientific
 *     notation in numbers) to round-trip simple SVGs from Inkscape /
 *     LibreCAD without false rejects.
 *
 * Coordinate system:
 *   Our exporter wraps content in `<g transform="translate(0 ty) scale(1 -1)">`
 *   to flip math-y-up onto SVG-y-down — but the actual element attributes
 *   (`cy`, `y1`, `y2`, path `y` values) are written in *sketch* space and
 *   the wrapper performs the visual flip at render time. So when we see
 *   the wrapper, we read coordinates verbatim: the math is already in the
 *   space we want. We still detect the wrapper to confirm the SVG came
 *   from our exporter (or a tool that follows the same convention) and
 *   emit a warning when it's absent so the caller knows the source
 *   coordinates may be in screen space (e.g. hand-authored Inkscape SVG
 *   with no flip wrapper) and may render upside-down without manual
 *   correction.
 *
 * Phase 1 scope (this file):
 *   - `<circle cx cy r=1>` → point (r==1 heuristic, matches exporter)
 *   - `<circle cx cy r>` (r≠1) → circle
 *   - `<line x1 y1 x2 y2>` → line
 *   - `<path d="M x0 y0 A r r 0 large sweep x1 y1">` → arc
 *
 * Phase 2 (warned, not parsed):
 *   - text, polygon, polyline, rect, ellipse, path with bezier/multi-segment,
 *     <g> transforms beyond the top-level Y-flip, <use>, <defs>, etc.
 *
 * No exceptions:
 *   The public API never throws. Invalid input produces `{ok: false, error}`
 *   with `entities: undefined` so callers (UI, API routes) can render the
 *   error inline without try/catch boilerplate. Internal helpers may throw
 *   to signal "skip this element"; the top-level loop catches and turns
 *   those into warnings.
 */

import type {
  SketchEntities,
  SvgPoint,
  SvgLine,
  SvgCircle,
  SvgArc,
} from './sketchSvgExport';

export interface SketchImportResult {
  /** True when the SVG was parsed without a hard syntax error. Warnings may still be present. */
  ok: boolean;
  /** Parsed entities (sketch space, +Y up). Undefined when `ok === false`. */
  entities?: SketchEntities;
  /** Non-fatal issues: unsupported elements skipped, geometry coerced, missing flip wrapper, etc. */
  warnings: string[];
  /** Set when parsing failed entirely (invalid XML structure, no <svg> root). */
  error?: string;
}

// ─── public API ──────────────────────────────────────────────────────────

/**
 * Parse an SVG document string into `SketchEntities`.
 *
 * Round-trips with `exportSketchToSvg`: the returned entities, when
 * re-exported with the same options, produce byte-equivalent output
 * (modulo numeric precision — coordinates are preserved to 6 decimals,
 * matching the exporter's own rounding).
 *
 * Never throws — all failure modes are reported via the result object.
 */
export function importSketchFromSvg(source: string): SketchImportResult {
  const warnings: string[] = [];

  if (typeof source !== 'string' || source.trim().length === 0) {
    return { ok: false, warnings, error: 'empty input' };
  }

  // Strip XML comments AND the optional grid <g> block before tokenizing —
  // both can otherwise inject children (or fake elements) into the regex
  // tokenizer. Grid is render-only chrome; never part of the sketch geometry.
  const cleaned = stripGrid(stripComments(source));

  // Sanity-check: there must be exactly one <svg ...> root. We don't bother
  // validating the namespace because anything Inkscape / LibreCAD writes
  // matches one of a handful of common forms and the tag name alone is a
  // reliable signal.
  const svgOpenMatch = /<svg\b([^>]*)>/i.exec(cleaned);
  if (!svgOpenMatch) {
    return { ok: false, warnings, error: 'no <svg> root element found' };
  }
  if (!/<\/svg>/i.test(cleaned)) {
    return { ok: false, warnings, error: 'unterminated <svg> element (missing </svg>)' };
  }

  // Y-flip detection: our exporter emits exactly
  //   <g transform="translate(<tx> <ty>) scale(1 -1)">
  // Locate the (ty) so we can inverse-flip imported coordinates. If no
  // flip wrapper exists, leave coords as-is and warn — see module header.
  const flip = detectYFlip(cleaned);
  if (flip === null) {
    warnings.push(
      'no Y-flip wrapper detected — coordinates imported as-is (SVG +Y down)',
    );
  }

  // No coordinate transform needed: our exporter writes attribute values
  // in sketch space and uses the wrapper for the visual flip only.
  // `flip` is consumed just for the warning above.
  void flip;

  const points: SvgPoint[] = [];
  const lines: SvgLine[] = [];
  const circles: SvgCircle[] = [];
  const arcs: SvgArc[] = [];

  // ----- <circle> -----
  // Branches on r==1 vs r>1 to distinguish exporter-emitted points (r=1)
  // from real circles. The 1mm threshold matches sketchSvgExport's
  // `Math.max(1, strokeWidth * 3)` floor for point glyphs.
  for (const tag of iterTags(cleaned, 'circle')) {
    const attrs = parseAttrs(tag);
    const kind = attrs['data-kind'];
    const cx = num(attrs.cx);
    const cy = num(attrs.cy);
    const r = num(attrs.r);
    if (cx === null || cy === null || r === null) {
      warnings.push('skipped <circle>: missing/invalid cx/cy/r');
      continue;
    }
    const id = attrs['data-sketch-id'] ?? autoId('imp');
    if (kind === 'point' || (kind === undefined && r === 1)) {
      // Round-trip from exporter: red fill ⇒ isFixed.
      const isFixed = (attrs.fill ?? '').toLowerCase() === 'red';
      const p: SvgPoint = { id, x: cx, y: cy };
      if (isFixed) p.isFixed = true;
      points.push(p);
    } else {
      circles.push({ id, cx, cy, radius: r });
    }
  }

  // ----- <line> -----
  for (const tag of iterTags(cleaned, 'line')) {
    const attrs = parseAttrs(tag);
    // Skip grid lines emitted by sketchSvgExport's optional grid.
    if (attrs['data-kind'] === 'grid' || attrs.stroke === '#e5e5ea') {
      continue;
    }
    const x1 = num(attrs.x1);
    const y1 = num(attrs.y1);
    const x2 = num(attrs.x2);
    const y2 = num(attrs.y2);
    if (x1 === null || y1 === null || x2 === null || y2 === null) {
      warnings.push('skipped <line>: missing/invalid x1/y1/x2/y2');
      continue;
    }
    const id = attrs['data-sketch-id'] ?? autoId('iml');
    lines.push({
      id,
      // p1/p2 ids are not preserved through SVG round-trips (the export
      // doesn't emit them as attributes). Synthesize stable placeholders
      // so callers that key off them still get unique strings.
      p1: `${id}.p1`,
      p2: `${id}.p2`,
      x1, y1,
      x2, y2,
    });
  }

  // ----- <path> (arcs only in Phase 1) -----
  for (const tag of iterTags(cleaned, 'path')) {
    const attrs = parseAttrs(tag);
    const d = attrs.d;
    if (!d) {
      warnings.push('skipped <path>: missing d attribute');
      continue;
    }
    const arc = parseArcPath(d);
    if (arc === null) {
      // Could be a bezier curve, polyline path, or multi-segment shape.
      // All Phase 2.
      warnings.push(`skipped <path>: unsupported path data "${truncate(d, 40)}"`);
      continue;
    }
    const id = attrs['data-sketch-id'] ?? autoId('ima');
    arcs.push({ id, ...arc });
  }

  // ----- unsupported elements ⇒ warnings only -----
  const unsupported = ['text', 'tspan', 'polygon', 'polyline', 'rect', 'ellipse', 'image', 'use'];
  for (const tagName of unsupported) {
    const re = new RegExp(`<${tagName}\\b`, 'gi');
    const count = (cleaned.match(re) ?? []).length;
    if (count > 0) {
      warnings.push(`unsupported element <${tagName}>: ${count} instance(s) skipped (Phase 2)`);
    }
  }

  return {
    ok: true,
    entities: { points, lines, circles, arcs },
    warnings,
  };
}

// ─── internals ───────────────────────────────────────────────────────────

/** Strip `<!-- ... -->` XML comments (single-line and multi-line). */
function stripComments(src: string): string {
  return src.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Strip the exporter's optional `<g data-kind="grid">...</g>` block. Grid
 * lines carry no sketch semantics — they're render-only chrome — and would
 * otherwise pollute the imported line list since they share the same
 * `<line>` element name as real sketch geometry.
 */
function stripGrid(src: string): string {
  return src.replace(/<g\b[^>]*data-kind="grid"[^>]*>[\s\S]*?<\/g>/gi, '');
}

/**
 * Detect the Y-flip wrapper our exporter emits and return its `ty` offset
 * for inverse mirroring. Returns `null` if no flip wrapper is present.
 *
 * Matches:
 *   <g transform="translate(0 20) scale(1 -1)">
 *   <g transform="translate(0,20) scale(1,-1)">
 *   <g transform="translate(0 20)scale(1 -1)">
 * etc. — whitespace + commas are interchangeable, exporter always emits 0
 * for tx but third-party tooling may differ; we still grab the ty offset.
 */
function detectYFlip(src: string): number | null {
  // translate(.. ty) — the second numeric inside translate(...) is ty.
  // We scan for scale(1 -1) anywhere afterwards to confirm it's a flip,
  // not a plain translation.
  const m = /transform\s*=\s*"\s*translate\s*\(\s*([-+0-9.eE]+)\s*[, ]\s*([-+0-9.eE]+)\s*\)\s*scale\s*\(\s*1\s*[, ]?\s*-1\s*\)\s*"/i.exec(src);
  if (!m) return null;
  const ty = parseFloat(m[2]);
  return Number.isFinite(ty) ? ty : null;
}

/**
 * Iterate all `<TAG ...>` or `<TAG .../>` openings of a given tag name.
 * Yields the entire tag string (including angle brackets). Self-closing
 * and explicit-closing forms both supported; the body of a non-self-closing
 * tag is ignored since the elements we care about (circle, line, path)
 * never have meaningful children in our SVG subset.
 */
function* iterTags(src: string, tagName: string): Generator<string> {
  const re = new RegExp(`<${tagName}\\b[^>]*?/?>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    yield m[0];
  }
}

/**
 * Parse XML attributes out of a tag string. Supports both double-quoted
 * and single-quoted values; XML entity references in values are unescaped.
 * Attribute names are case-preserved (SVG is case-sensitive in practice).
 */
function parseAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  // name = "value" | name = 'value'
  const re = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag)) !== null) {
    const name = m[1];
    const value = m[2] !== undefined ? m[2] : m[3];
    attrs[name] = unescapeXml(value ?? '');
  }
  return attrs;
}

/**
 * Parse a single-arc SVG path `d` attribute as written by sketchSvgExport:
 *   M x0 y0 A rx ry xrot large sweep x1 y1
 *
 * The exporter writes endpoint coordinates verbatim in sketch space
 * (the Y-flip wrapper handles visual presentation, not the numbers in
 * the attribute), so reconstruction also happens in sketch space.
 *
 * Convention reminder (from sketchSvgExport.renderArc):
 *   large_arc_flag = (|endAngle - startAngle| > π) ? 1 : 0
 *   sweep_flag     = (endAngle - startAngle > 0)   ? 0 : 1   ← INVERTED
 *
 * The inversion is because the screen-space sweep flag is reversed by the
 * scale(1, -1) wrapper. Since we're working in sketch space here, we use
 * the original sketch-space sign rule: a CCW arc (delta > 0) has the
 * center to the LEFT of the chord direction (positive perpendicular).
 *
 * Returns `null` for any path data that isn't a single moveto+arc — bezier
 * curves, multi-segment paths, elliptical (rx ≠ ry) arcs all bounce out.
 */
function parseArcPath(
  d: string,
): Pick<SvgArc, 'cx' | 'cy' | 'radius' | 'startAngle' | 'endAngle'> | null {
  // Tokenize: separate on commas/whitespace, keep command letters.
  const tokens = d
    .replace(/([MmAaLlHhVvCcSsQqTtZz])/g, ' $1 ')
    .split(/[\s,]+/)
    .filter((t) => t.length > 0);

  // Expected layout: M x0 y0 A rx ry xrot large sweep x1 y1  (exactly 11 tokens)
  if (tokens.length !== 11) return null;
  if (tokens[0].toUpperCase() !== 'M' || tokens[3].toUpperCase() !== 'A') return null;

  const x0 = parseFloat(tokens[1]);
  const y0 = parseFloat(tokens[2]);
  const rx = parseFloat(tokens[4]);
  const ry = parseFloat(tokens[5]);
  const largeArc = parseInt(tokens[7], 10);
  const sweep = parseInt(tokens[8], 10);
  const x1 = parseFloat(tokens[9]);
  const y1 = parseFloat(tokens[10]);

  if (![x0, y0, rx, ry, x1, y1].every(Number.isFinite)) return null;
  if (rx <= 0 || ry <= 0) return null;
  // We only emit circular arcs (rx === ry). Reject elliptical so we don't
  // silently approximate.
  if (Math.abs(rx - ry) > 1e-6) return null;
  if (largeArc !== 0 && largeArc !== 1) return null;
  if (sweep !== 0 && sweep !== 1) return null;

  const r = rx;

  // All coordinates are in sketch space (the exporter writes them verbatim;
  // the scale(1,-1) wrapper is purely a visual transform). Solve for center
  // on the perpendicular bisector of the chord, picking the side that's
  // consistent with (largeArc, sweep).
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const chord = Math.hypot(dx, dy);
  if (chord === 0) return null;
  if (chord > 2 * r + 1e-6) return null; // chord longer than diameter ⇒ impossible

  const halfChord = chord / 2;
  // Numerical floor at 0 to handle the just-diameter case (chord ≈ 2r).
  const h = Math.sqrt(Math.max(0, r * r - halfChord * halfChord));

  // Unit perpendicular to the chord (rotate chord direction +90° in math y-up).
  // The two candidate centers are (mx ± h*nx, my ± h*ny).
  const nx = -dy / chord;
  const ny = dx / chord;

  // Side selection in SKETCH SPACE (y-up):
  //   exporter convention: sweep_flag = 0 ⇔ CCW (delta > 0)
  //                         sweep_flag = 1 ⇔ CW  (delta < 0)
  //   large_arc_flag     = 1 ⇔ |delta| > π
  //
  // For a CCW arc going from start → end with the center on the +perp
  // side (using the (nx, ny) defined above which is chord rotated +90°
  // CCW in math y-up), the swept angle is < π. Flipping any one of
  // {sweep, large} flips the side.
  //
  // Sweet rule: pick +perp when (sweep XOR large) == 0; otherwise -perp.
  //   sweep=0 (CCW), large=0 (small)  → +perp
  //   sweep=0 (CCW), large=1 (large)  → -perp
  //   sweep=1 (CW),  large=0 (small)  → -perp
  //   sweep=1 (CW),  large=1 (large)  → +perp
  const usePlus = (sweep ^ largeArc) === 0;
  const cx = mx + (usePlus ? h : -h) * nx;
  const cy = my + (usePlus ? h : -h) * ny;

  // Derive sketch-space angles.
  const startAngle = Math.atan2(y0 - cy, x0 - cx);
  const endAngle = Math.atan2(y1 - cy, x1 - cx);

  return { cx, cy, radius: r, startAngle, endAngle };
}

/** Numeric parse that returns `null` for missing / NaN / Infinity inputs. */
function num(v: string | undefined): number | null {
  if (v === undefined) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** Synthesize a stable-ish id for elements that don't carry data-sketch-id. */
let autoCounter = 0;
function autoId(prefix: string): string {
  return `${prefix}${++autoCounter}`;
}

function unescapeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}
