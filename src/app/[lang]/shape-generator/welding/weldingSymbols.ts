/**
 * weldingSymbols.ts — AWS A2.4 / ISO 2553 welding symbols on drawings.
 *
 * SolidWorks "Weld Symbol" tool produces the standard
 * arrow-with-reference-line-and-tail composite symbol. NexyFab
 * adopts the same canonical form so anyone reading the drawing
 * knows immediately what weld to put where.
 *
 * Components:
 *   - **Arrow**: points at the weld location
 *   - **Reference line**: horizontal line carrying the symbol
 *   - **Symbol below**: weld on arrow side
 *   - **Symbol above**: weld on opposite side
 *   - **Tail**: optional, holds notes / process spec
 *
 * Output is a structured object the drawing renderer can lay out
 * as SVG. This module is the *data model* + *standard lookup*.
 */

export type WeldType =
  | 'fillet'
  | 'square-groove'
  | 'v-groove'
  | 'u-groove'
  | 'j-groove'
  | 'bevel-groove'
  | 'plug'
  | 'slot'
  | 'spot'
  | 'seam'
  | 'flare-v'
  | 'flare-bevel'
  | 'edge'
  | 'stud';

export type WeldStandard = 'AWS' | 'ISO';

export interface WeldDimension {
  /** Leg size (mm). Used for fillet, edge welds. */
  sizeMm?: number;
  /** Depth of penetration (mm). Groove welds. */
  depthMm?: number;
  /** Length of weld (mm). Intermittent welds carry this. */
  lengthMm?: number;
  /** Pitch (mm) for intermittent welds — center-to-center. */
  pitchMm?: number;
  /** Bevel/groove angle (deg). */
  angleDeg?: number;
  /** Number of welds (for spot / plug etc). */
  count?: number;
  /** Root opening (mm). */
  rootOpeningMm?: number;
}

export interface WeldSymbol {
  /** Weld type. */
  type: WeldType;
  /** Standard the symbol obeys. */
  standard: WeldStandard;
  /** Arrow-side weld (below the reference line per AWS). */
  arrowSide?: WeldDimension;
  /** Other-side weld (above the reference line per AWS). */
  otherSide?: WeldDimension;
  /** "All around" — weld extends fully around the joint. */
  allAround?: boolean;
  /** "Field weld" — done on site, not in shop. */
  fieldWeld?: boolean;
  /** Process / notes in the tail. */
  tail?: string;
}

/** Render symbol body shape per type — used by the SVG renderer. */
export const WELD_GLYPH: Record<WeldType, string> = {
  fillet:        '▷',     // triangle (filled in real renderer)
  'square-groove': '□',
  'v-groove':    'V',
  'u-groove':    'U',
  'j-groove':    'J',
  'bevel-groove': '⌐',
  plug:          '▭',
  slot:          '⊐',
  spot:          '○',
  seam:          '⊜',
  'flare-v':     'ᘠ',
  'flare-bevel': '⌐',
  edge:          '▏',
  stud:          '◉',
};

/** Format the textual representation of a symbol for the title block
 *  or a non-SVG fallback. */
export function formatWeldSymbol(symbol: WeldSymbol): string {
  const parts: string[] = [];
  parts.push(WELD_GLYPH[symbol.type] ?? '?');
  if (symbol.arrowSide?.sizeMm) parts.push(`${symbol.arrowSide.sizeMm}`);
  if (symbol.otherSide?.sizeMm) parts.push(`/${symbol.otherSide.sizeMm}`);
  if (symbol.arrowSide?.lengthMm) parts.push(`-${symbol.arrowSide.lengthMm}`);
  if (symbol.arrowSide?.pitchMm) parts.push(`×${symbol.arrowSide.pitchMm}`);
  if (symbol.allAround) parts.push('⊙');
  if (symbol.fieldWeld) parts.push('⚑');
  if (symbol.tail) parts.push(`(${symbol.tail})`);
  return parts.join(' ');
}

/** Parse a short text like "6▷ 50-100" into a symbol (best-effort). */
export function parseShortSymbol(input: string): WeldSymbol | null {
  const m = /^([\d.]+)?\s*([▷VUJ□○⊜])\s*([\d.-]+)?$/.exec(input.trim());
  if (!m) return null;
  const size = m[1] ? parseFloat(m[1]) : undefined;
  const glyph = m[2]!;
  const lengthAndPitch = m[3];
  const type = Object.entries(WELD_GLYPH).find(([, g]) => g === glyph)?.[0] as WeldType | undefined;
  if (!type) return null;
  let length: number | undefined;
  let pitch: number | undefined;
  if (lengthAndPitch) {
    const lp = lengthAndPitch.split('-');
    length = lp[0] ? parseFloat(lp[0]) : undefined;
    pitch = lp[1] ? parseFloat(lp[1]) : undefined;
  }
  return {
    type,
    standard: 'AWS',
    arrowSide: {
      sizeMm: size,
      lengthMm: length,
      pitchMm: pitch,
    },
  };
}

/** Compute SVG primitives for a weld symbol — anchored at the
 *  pointed location. The drawing renderer wraps these in a <g>. */
export interface WeldSvgPrimitive {
  kind: 'line' | 'text' | 'circle' | 'path';
  attrs: Record<string, string | number>;
  text?: string;
}

export function renderWeldSymbolSvg(
  symbol: WeldSymbol,
  arrowTipX: number,
  arrowTipY: number,
): WeldSvgPrimitive[] {
  const REF_LINE_LEN = 50;
  const LEADER_LEN = 30;
  const out: WeldSvgPrimitive[] = [];
  // Leader from arrow tip up + right.
  const refStartX = arrowTipX + LEADER_LEN;
  const refStartY = arrowTipY - LEADER_LEN;
  out.push({
    kind: 'line',
    attrs: {
      x1: arrowTipX, y1: arrowTipY,
      x2: refStartX, y2: refStartY,
      stroke: 'currentColor', 'stroke-width': 0.5,
    },
  });
  // Reference line (horizontal).
  const refEndX = refStartX + REF_LINE_LEN;
  out.push({
    kind: 'line',
    attrs: {
      x1: refStartX, y1: refStartY,
      x2: refEndX, y2: refStartY,
      stroke: 'currentColor', 'stroke-width': 0.5,
    },
  });
  // Symbol on arrow side (below line).
  if (symbol.arrowSide) {
    out.push({
      kind: 'text',
      attrs: {
        x: refStartX + REF_LINE_LEN / 2, y: refStartY + 6,
        'text-anchor': 'middle', 'font-size': 7,
      },
      text: `${WELD_GLYPH[symbol.type] ?? '?'}${symbol.arrowSide.sizeMm ?? ''}`,
    });
  }
  // Symbol on other side (above line).
  if (symbol.otherSide) {
    out.push({
      kind: 'text',
      attrs: {
        x: refStartX + REF_LINE_LEN / 2, y: refStartY - 3,
        'text-anchor': 'middle', 'font-size': 7,
      },
      text: `${WELD_GLYPH[symbol.type] ?? '?'}${symbol.otherSide.sizeMm ?? ''}`,
    });
  }
  // All-around circle.
  if (symbol.allAround) {
    out.push({
      kind: 'circle',
      attrs: {
        cx: refStartX, cy: refStartY, r: 3,
        fill: 'none', stroke: 'currentColor', 'stroke-width': 0.5,
      },
    });
  }
  // Tail (flag-shaped).
  if (symbol.tail) {
    out.push({
      kind: 'text',
      attrs: {
        x: refEndX + 4, y: refStartY + 2,
        'font-size': 6, fill: 'currentColor',
      },
      text: symbol.tail,
    });
  }
  return out;
}
