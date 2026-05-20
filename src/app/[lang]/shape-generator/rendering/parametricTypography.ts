/**
 * parametricTypography.ts — Glyph → curves → 3D extrusion for engraving.
 *
 * For products that engrave text (signs, plaques, awards, mugs)
 * customers type a string and pick a font; we need to turn it into
 * geometry the CAM pipeline can cut or extrude.
 *
 * Pipeline:
 *
 *   1. Parse glyph outlines from a font spec (stub here — production
 *      uses opentype.js to read TTF/OTF files; this module accepts
 *      pre-built glyph paths so it stays font-agnostic).
 *   2. Lay out characters with kerning + tracking + line breaks.
 *   3. Convert each glyph's path to closed polylines.
 *   4. Optionally extrude to a 3D mesh of given depth.
 *
 * Output: a list of closed loops (polygon contours) + an optional
 * extrusion mesh. Downstream CAM uses the loops as the engraving
 * pocket boundary.
 */

export interface Point2D {
  x: number;
  y: number;
}

export interface GlyphCommand {
  /** Command kind from font outline. */
  kind: 'M' | 'L' | 'C' | 'Q' | 'Z';
  /** Operand points (size depends on kind). */
  points: Point2D[];
}

export interface GlyphSpec {
  /** Unicode codepoint. */
  unicode: number;
  /** Advance width in EM units. */
  advanceWidth: number;
  /** Path commands. */
  commands: GlyphCommand[];
}

export interface FontSpec {
  /** Font family name. */
  family: string;
  /** Units per EM (typically 1000 or 2048). */
  unitsPerEm: number;
  /** Cap height in EM units. */
  capHeight: number;
  /** Glyph table keyed by codepoint. */
  glyphs: Map<number, GlyphSpec>;
  /** Optional kerning pairs: "${a},${b}" → offset in EM units. */
  kerning?: Map<string, number>;
  /** Missing-glyph fallback. */
  missingGlyph?: GlyphSpec;
}

export interface TypographyOptions {
  /** Text content. */
  text: string;
  /** Target glyph height (mm). */
  heightMm: number;
  /** Extra letter spacing (mm). */
  trackingMm: number;
  /** Line height multiplier (e.g. 1.2 for 120% line height). */
  lineHeight: number;
  /** Max width before wrapping (mm); 0 = no wrap. */
  maxWidthMm: number;
  /** Subdivision count for Bezier curves. */
  curveDivisions: number;
}

export const DEFAULT_TYPOGRAPHY_OPTIONS: TypographyOptions = {
  text: '',
  heightMm: 10,
  trackingMm: 0,
  lineHeight: 1.2,
  maxWidthMm: 0,
  curveDivisions: 12,
};

export interface TextLayout {
  /** Closed loops per glyph (polygon contours). */
  glyphLoops: Array<Point2D[][]>;
  /** Bounding box. */
  bbox: { min: Point2D; max: Point2D };
  /** Per-glyph baseline origin. */
  glyphOrigins: Point2D[];
  /** Total advance per line. */
  lineWidths: number[];
}

// ── Top-level entry ─────────────────────────────────────────────

export function layoutText(font: FontSpec, options: Partial<TypographyOptions>): TextLayout {
  const opts = { ...DEFAULT_TYPOGRAPHY_OPTIONS, ...options };
  const emToMm = opts.heightMm / font.capHeight;
  const trackingEm = opts.trackingMm / emToMm;
  const lineHeightMm = (font.unitsPerEm / font.capHeight) * opts.heightMm * opts.lineHeight;
  const maxWidthEm = opts.maxWidthMm > 0 ? opts.maxWidthMm / emToMm : Infinity;

  const glyphLoops: Array<Point2D[][]> = [];
  const glyphOrigins: Point2D[] = [];
  const lineWidths: number[] = [];

  let cursorX = 0;
  let cursorY = 0;
  let lineWidthEm = 0;
  let lastCodepoint: number | null = null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const ch of opts.text) {
    if (ch === '\n') {
      lineWidths.push(lineWidthEm * emToMm);
      cursorX = 0;
      cursorY -= lineHeightMm;
      lineWidthEm = 0;
      lastCodepoint = null;
      continue;
    }
    const codepoint = ch.codePointAt(0)!;
    const glyph = font.glyphs.get(codepoint) ?? font.missingGlyph;
    if (!glyph) {
      lastCodepoint = codepoint;
      continue;
    }
    // Kerning.
    if (lastCodepoint !== null && font.kerning) {
      const kernKey = `${lastCodepoint},${codepoint}`;
      const kernAdvance = font.kerning.get(kernKey) ?? 0;
      cursorX += kernAdvance * emToMm;
    }
    // Wrap check.
    if (cursorX / emToMm + glyph.advanceWidth > maxWidthEm) {
      lineWidths.push(lineWidthEm * emToMm);
      cursorX = 0;
      cursorY -= lineHeightMm;
      lineWidthEm = 0;
    }

    glyphOrigins.push({ x: cursorX, y: cursorY });
    const loops = glyphToLoops(glyph, emToMm, opts.curveDivisions, cursorX, cursorY);
    glyphLoops.push(loops);
    // Bounds.
    for (const loop of loops) for (const p of loop) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    cursorX += (glyph.advanceWidth + trackingEm) * emToMm;
    lineWidthEm = cursorX / emToMm;
    lastCodepoint = codepoint;
  }
  if (lineWidthEm > 0) lineWidths.push(lineWidthEm * emToMm);

  if (!isFinite(minX)) {
    return { glyphLoops: [], bbox: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } }, glyphOrigins: [], lineWidths: [] };
  }
  return {
    glyphLoops,
    bbox: { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } },
    glyphOrigins,
    lineWidths,
  };
}

// ── Glyph → loops ──────────────────────────────────────────────

function glyphToLoops(glyph: GlyphSpec, emToMm: number, curveDivisions: number, offsetX: number, offsetY: number): Point2D[][] {
  const loops: Point2D[][] = [];
  let current: Point2D[] | null = null;
  let cursor: Point2D = { x: 0, y: 0 };
  for (const cmd of glyph.commands) {
    switch (cmd.kind) {
      case 'M':
        if (current && current.length > 0) loops.push(current);
        current = [];
        cursor = cmd.points[0]!;
        current.push({ x: cursor.x * emToMm + offsetX, y: cursor.y * emToMm + offsetY });
        break;
      case 'L':
        if (current) {
          cursor = cmd.points[0]!;
          current.push({ x: cursor.x * emToMm + offsetX, y: cursor.y * emToMm + offsetY });
        }
        break;
      case 'Q': {
        if (current) {
          const ctrl = cmd.points[0]!;
          const end = cmd.points[1]!;
          for (let i = 1; i <= curveDivisions; i++) {
            const t = i / curveDivisions;
            const x = (1 - t) ** 2 * cursor.x + 2 * (1 - t) * t * ctrl.x + t ** 2 * end.x;
            const y = (1 - t) ** 2 * cursor.y + 2 * (1 - t) * t * ctrl.y + t ** 2 * end.y;
            current.push({ x: x * emToMm + offsetX, y: y * emToMm + offsetY });
          }
          cursor = end;
        }
        break;
      }
      case 'C': {
        if (current) {
          const ctrl1 = cmd.points[0]!;
          const ctrl2 = cmd.points[1]!;
          const end = cmd.points[2]!;
          for (let i = 1; i <= curveDivisions; i++) {
            const t = i / curveDivisions;
            const x = (1 - t) ** 3 * cursor.x + 3 * (1 - t) ** 2 * t * ctrl1.x + 3 * (1 - t) * t ** 2 * ctrl2.x + t ** 3 * end.x;
            const y = (1 - t) ** 3 * cursor.y + 3 * (1 - t) ** 2 * t * ctrl1.y + 3 * (1 - t) * t ** 2 * ctrl2.y + t ** 3 * end.y;
            current.push({ x: x * emToMm + offsetX, y: y * emToMm + offsetY });
          }
          cursor = end;
        }
        break;
      }
      case 'Z':
        if (current && current.length > 0) {
          loops.push(current);
          current = null;
        }
        break;
    }
  }
  if (current && current.length > 0) loops.push(current);
  return loops;
}

// ── Extrusion to 3D mesh ───────────────────────────────────────

export interface ExtrusionResult {
  positions: number[];
  indices: number[];
}

export function extrudeText(layout: TextLayout, depthMm: number): ExtrusionResult {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const glyph of layout.glyphLoops) {
    for (const loop of glyph) {
      if (loop.length < 3) continue;
      const baseIdx = positions.length / 3;
      // Bottom and top vertices.
      for (const p of loop) positions.push(p.x, p.y, 0);
      for (const p of loop) positions.push(p.x, p.y, depthMm);
      // Side quads (split into 2 triangles each).
      const n = loop.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const a = baseIdx + i;
        const b = baseIdx + j;
        const c = baseIdx + n + j;
        const d = baseIdx + n + i;
        indices.push(a, b, c, a, c, d);
      }
      // Top + bottom caps via fan triangulation (good for convex glyphs only).
      for (let i = 1; i < n - 1; i++) {
        indices.push(baseIdx + n, baseIdx + n + i, baseIdx + n + i + 1);
        indices.push(baseIdx, baseIdx + i + 1, baseIdx + i);
      }
    }
  }
  return { positions, indices };
}

// ── Helpers ────────────────────────────────────────────────────

export interface TextStats {
  glyphCount: number;
  loopCount: number;
  totalPointCount: number;
  lineCount: number;
}

export function summarizeLayout(layout: TextLayout): TextStats {
  let loops = 0, points = 0;
  for (const g of layout.glyphLoops) {
    for (const l of g) {
      loops++;
      points += l.length;
    }
  }
  return {
    glyphCount: layout.glyphLoops.length,
    loopCount: loops,
    totalPointCount: points,
    lineCount: layout.lineWidths.length,
  };
}

// ── Demo font ──────────────────────────────────────────────────

/** Trivial "square A" + missing-glyph rectangle. Useful for tests. */
export function buildTestFont(): FontSpec {
  const glyphs = new Map<number, GlyphSpec>();
  // 'A' as outer triangle.
  glyphs.set(65, {
    unicode: 65,
    advanceWidth: 700,
    commands: [
      { kind: 'M', points: [{ x: 0, y: 0 }] },
      { kind: 'L', points: [{ x: 350, y: 700 }] },
      { kind: 'L', points: [{ x: 700, y: 0 }] },
      { kind: 'Z', points: [] },
    ],
  });
  glyphs.set(66, {
    unicode: 66,
    advanceWidth: 500,
    commands: [
      { kind: 'M', points: [{ x: 0, y: 0 }] },
      { kind: 'L', points: [{ x: 500, y: 0 }] },
      { kind: 'L', points: [{ x: 500, y: 700 }] },
      { kind: 'L', points: [{ x: 0, y: 700 }] },
      { kind: 'Z', points: [] },
    ],
  });
  return {
    family: 'TestFont',
    unitsPerEm: 1000,
    capHeight: 700,
    glyphs,
    missingGlyph: {
      unicode: 0xfffd,
      advanceWidth: 500,
      commands: [
        { kind: 'M', points: [{ x: 0, y: 0 }] },
        { kind: 'L', points: [{ x: 500, y: 0 }] },
        { kind: 'L', points: [{ x: 500, y: 700 }] },
        { kind: 'L', points: [{ x: 0, y: 700 }] },
        { kind: 'Z', points: [] },
      ],
    },
  };
}
