/**
 * weldSymbol — Phase 4.2 of NexyFab Pro own-CAD (ADR-013).
 *
 * AWS/ISO welding-symbol IR + formatter. A WeldSymbol annotates a Viewport
 * with a weld callout attached (via a leader line) to source-model geometry.
 *
 * Scope (Phase 4.2 minimal):
 *   - 6 weld types: fillet / square / bevel / vee / plug / spot.
 *   - Side placement relative to the reference line: arrow / other / both.
 *   - Optional size (leg/throat in mm), length, and pitch (center-to-center
 *     spacing for intermittent welds — written as "L-P").
 *   - Supplementary flags: field weld (flag) + all-around (circle).
 *   - Optional tail note for process/spec (e.g., 'GMAW', 'E70XX').
 *
 * Out of scope (Phase 4.x+):
 *   - Combined/compound weld symbols (multiple welds on one reference line)
 *   - Contour + finish modifiers (flush/convex/concave with G/M/C)
 *   - Staggered intermittent layout glyphs (renderer concern)
 *   - DXF/DWG weld-entity encoding (Phase 4.4)
 */

// ─── IR ──────────────────────────────────────────────────────────────────

export type WeldType = 'fillet' | 'square' | 'bevel' | 'vee' | 'plug' | 'spot';

export type WeldSide = 'arrow' | 'other' | 'both';

export interface WeldSymbol {
  id: string;
  viewportId: string;
  /** Source-model geometry id (edge/joint) this weld callout points at. */
  targetRef: string;
  weldType: WeldType;
  /** Placement relative to the reference line. */
  side: WeldSide;
  /** Leg/throat size in mm (must be > 0 when present). */
  size?: number;
  /** Weld length in mm (must be > 0 when present). */
  length?: number;
  /** Intermittent center-to-center pitch in mm. Requires `length`. */
  pitch?: number;
  /** Field-weld flag (welded on site, not in shop). */
  fieldWeld?: boolean;
  /** All-around weld (closed circle at the leader kink). */
  allAround?: boolean;
  /** Tail note — process or specification reference. */
  tail?: string;
}

const KNOWN_TYPES: ReadonlySet<WeldType> = new Set<WeldType>([
  'fillet',
  'square',
  'bevel',
  'vee',
  'plug',
  'spot',
]);

const KNOWN_SIDES: ReadonlySet<WeldSide> = new Set<WeldSide>([
  'arrow',
  'other',
  'both',
]);

// ─── validation ──────────────────────────────────────────────────────────

export interface WeldValidation {
  ok: boolean;
  errors: string[];
}

/**
 * Validate a weld symbol. Returns a typed result rather than throwing so
 * callers can aggregate problems across many callouts.
 */
export function validateWeldSymbol(w: WeldSymbol): WeldValidation {
  const errors: string[] = [];
  if (!w.id) errors.push('id is empty');
  if (!w.viewportId) errors.push('viewportId is empty');
  if (!w.targetRef) errors.push('targetRef is empty');
  if (!KNOWN_TYPES.has(w.weldType)) {
    errors.push(`unknown weldType '${w.weldType}'`);
  }
  if (!KNOWN_SIDES.has(w.side)) {
    errors.push(`unknown side '${w.side}'`);
  }
  if (w.size !== undefined && !(w.size > 0)) {
    errors.push(`size must be > 0, got ${w.size}`);
  }
  if (w.length !== undefined && !(w.length > 0)) {
    errors.push(`length must be > 0, got ${w.length}`);
  }
  if (w.pitch !== undefined) {
    if (!(w.pitch > 0)) {
      errors.push(`pitch must be > 0, got ${w.pitch}`);
    }
    if (w.length === undefined) {
      errors.push('pitch requires length (intermittent weld spacing)');
    }
  }
  return { ok: errors.length === 0, errors };
}

// ─── formatting ──────────────────────────────────────────────────────────

/**
 * Format a weld symbol as a readable one-line callout, e.g.
 *   "fillet 6 (arrow)"
 *   "bevel 8 50-100 (both) all-around field [GMAW]"
 */
export function formatWeldSymbol(w: WeldSymbol): string {
  const parts: string[] = [w.weldType];
  if (w.size !== undefined) parts.push(String(w.size));
  if (w.length !== undefined) {
    parts.push(w.pitch !== undefined ? `${w.length}-${w.pitch}` : String(w.length));
  }
  parts.push(`(${w.side})`);
  if (w.allAround) parts.push('all-around');
  if (w.fieldWeld) parts.push('field');
  if (w.tail) parts.push(`[${w.tail}]`);
  return parts.join(' ');
}

// ─── render hint ─────────────────────────────────────────────────────────

export interface WeldRenderHint {
  /** Which side(s) of the reference line carry the weld glyph. */
  sideGlyph: WeldSide;
  /** ASCII fallback glyph for the weld type symbol. */
  symbol: string;
  /** Supplementary annotation tokens (size, L-P, supplementary flags, tail). */
  annotations: string[];
}

/**
 * Produce a renderer hint: the per-type symbol glyph, the side, and the
 * supplementary annotation tokens. This is the fallback / text-mode mapping;
 * a graphical renderer may draw true AWS symbols instead.
 */
export function weldRenderHint(w: WeldSymbol): WeldRenderHint {
  const annotations: string[] = [];
  if (w.size !== undefined) annotations.push(`size ${w.size}`);
  if (w.length !== undefined) {
    annotations.push(w.pitch !== undefined ? `${w.length}-${w.pitch}` : `len ${w.length}`);
  }
  if (w.allAround) annotations.push('all-around');
  if (w.fieldWeld) annotations.push('field');
  if (w.tail) annotations.push(`tail:${w.tail}`);
  return {
    sideGlyph: w.side,
    symbol: weldGlyph(w.weldType),
    annotations,
  };
}

function weldGlyph(type: WeldType): string {
  switch (type) {
    case 'fillet': return '\\';
    case 'square': return '||';
    case 'bevel': return 'V';
    case 'vee': return 'V';
    case 'plug': return '[]';
    case 'spot': return 'O';
  }
}
