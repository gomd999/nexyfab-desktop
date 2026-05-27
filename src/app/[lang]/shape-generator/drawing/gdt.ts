// GD&T (Geometric Dimensioning & Tolerancing) — ASME Y14.5 / ISO 1101
// symbol dictionary. The Unicode characters here are the standard
// reference glyphs for each control — they render correctly with most
// engineering / Noto Sans / Sans-Serif fallback fonts. For PDF output
// (drawingExport.ts) we additionally ship the canonical SVG paths so the
// glyph survives even when the embedded PDF font lacks the codepoint.
//
// Phase 1 scope: dictionary only. Phase 2 wires the picker into the
// Drawing panel so the user can drop a feature control frame
// "⊕ ⌀0.1 Ⓜ A B C" onto a dimension.

export type GdtCategory = 'form' | 'profile' | 'orientation' | 'location' | 'runout';

export interface GdtSymbol {
  /** Stable id used in the feature control frame model. */
  id: string;
  /** ASME / ISO category. Drives the picker grouping. */
  category: GdtCategory;
  /** Reference Unicode glyph. */
  symbol: string;
  /** Korean label (technical drawing convention). */
  nameKo: string;
  /** English label. */
  nameEn: string;
  /** Whether the tolerance value is preceded by a diameter symbol (⌀). */
  needsDiameter?: boolean;
  /** Whether material-condition modifiers (Ⓜ Ⓛ Ⓢ) typically apply. */
  acceptsModifier?: boolean;
  /** Whether at least one datum reference is required (the controller
   *  emits the tolerance frame disabled until a datum is picked). */
  requiresDatum?: boolean;
  /** Deprecated in ASME Y14.5-2018 — still kept for ISO 1101 reading
   *  but the picker surfaces a "use position instead" hint. */
  legacyAsme?: boolean;
}

/** Standard 14 GD&T characteristic symbols (ASME Y14.5-2018 + ISO 1101).
 *
 *  Note on deprecations in ASME Y14.5-2018:
 *   - `concentricity` and `symmetry` are kept for ISO 1101 / legacy
 *     drawing compatibility but the 2018 revision recommends replacing
 *     them with position tolerances applied to opposing features or to
 *     a derived median plane/axis. We keep them so users can read in
 *     older drawings, but `legacyAsme` flags them in the picker so a
 *     teaching tooltip can recommend the modern alternative. */
export const GDT_SYMBOLS: GdtSymbol[] = [
  // ── Form (no datum) ──────────────────────────────────────────────
  { id: 'straightness', category: 'form', symbol: '―',  nameKo: '진직도',     nameEn: 'Straightness' },
  { id: 'flatness',     category: 'form', symbol: '▱',  nameKo: '평면도',     nameEn: 'Flatness' },
  { id: 'circularity',  category: 'form', symbol: '○',  nameKo: '진원도',     nameEn: 'Circularity' },
  { id: 'cylindricity', category: 'form', symbol: '⌭',  nameKo: '원통도',     nameEn: 'Cylindricity' },

  // ── Profile (datum optional) ─────────────────────────────────────
  { id: 'lineProfile',    category: 'profile', symbol: '⌒', nameKo: '선의 윤곽도', nameEn: 'Profile of a line' },
  { id: 'surfaceProfile', category: 'profile', symbol: '◠', nameKo: '면의 윤곽도', nameEn: 'Profile of a surface' },

  // ── Orientation (datum required) ─────────────────────────────────
  { id: 'perpendicularity', category: 'orientation', symbol: '⊥', nameKo: '직각도',   nameEn: 'Perpendicularity', requiresDatum: true },
  { id: 'angularity',       category: 'orientation', symbol: '∠', nameKo: '경사도',   nameEn: 'Angularity',       requiresDatum: true },
  { id: 'parallelism',      category: 'orientation', symbol: '∥', nameKo: '평행도',   nameEn: 'Parallelism',      requiresDatum: true },

  // ── Location (datum required) ────────────────────────────────────
  { id: 'position',      category: 'location', symbol: '⊕', nameKo: '위치도',   nameEn: 'Position',      needsDiameter: true, acceptsModifier: true, requiresDatum: true },
  { id: 'concentricity', category: 'location', symbol: '◎', nameKo: '동축도',   nameEn: 'Concentricity', requiresDatum: true, legacyAsme: true },
  { id: 'symmetry',      category: 'location', symbol: '⌯', nameKo: '대칭도',   nameEn: 'Symmetry',      requiresDatum: true, legacyAsme: true },

  // ── Runout (datum required) ──────────────────────────────────────
  { id: 'circularRunout', category: 'runout', symbol: '↗',  nameKo: '원주 흔들림', nameEn: 'Circular runout', requiresDatum: true },
  { id: 'totalRunout',    category: 'runout', symbol: '⌰', nameKo: '온 흔들림',   nameEn: 'Total runout',    requiresDatum: true },
];

/** Material-condition + tolerance-zone modifiers (ASME Y14.5-2018).
 *
 *  Coverage notes:
 *   - MMC / LMC / RFS — bonus / shift tolerance basis. Most common, used
 *     daily on hole patterns and pin features.
 *   - Projected (P) — pushes the tolerance zone outward by a given
 *     length; required for threaded inserts where the stud floats.
 *   - Free state (F) — non-rigid parts measured in unrestrained state.
 *   - Tangent plane (T) — controls the tangent plane only, not the
 *     entire surface; common on bearing seats.
 *   - Independency (I) — overrides Rule #1 envelope for a feature.
 *   - Statistical (ST), Continuous feature (CF), Unequally disposed (U)
 *     are intentionally omitted from this PR — they apply to <2% of
 *     real-world drawings and would crowd the picker; revisit when
 *     surface texture / weld symbols ship together. */
export interface GdtModifier {
  id: 'mmc' | 'lmc' | 'rfs' | 'projected' | 'freeState' | 'tangentPlane' | 'independency';
  symbol: string;
  nameKo: string;
  nameEn: string;
  /** When true, the modifier writes a length value after the symbol
   *  (e.g. `Ⓟ 25` for a 25mm projected tolerance zone). */
  carriesLength?: boolean;
}

export const GDT_MODIFIERS: GdtModifier[] = [
  { id: 'mmc',          symbol: 'Ⓜ', nameKo: '최대 실체 조건',    nameEn: 'Max material condition' },
  { id: 'lmc',          symbol: 'Ⓛ', nameKo: '최소 실체 조건',    nameEn: 'Min material condition' },
  { id: 'rfs',          symbol: 'Ⓢ', nameKo: '실치수 무관 (RFS)', nameEn: 'Regardless of feature size' },
  { id: 'projected',    symbol: 'Ⓟ', nameKo: '돌출 공차역',       nameEn: 'Projected tolerance zone', carriesLength: true },
  { id: 'freeState',    symbol: 'Ⓕ', nameKo: '자유 상태',         nameEn: 'Free state' },
  { id: 'tangentPlane', symbol: 'Ⓣ', nameKo: '접평면',            nameEn: 'Tangent plane' },
  { id: 'independency', symbol: 'Ⓘ', nameKo: '독립성 원칙',       nameEn: 'Independency (overrides Rule #1)' },
];

/** Single row inside a feature control frame. Composite tolerances stack
 *  multiple rows (typically two: pattern-locating then feature-relating)
 *  so the same symbol can express both a loose pattern and a tight
 *  feature-to-feature relationship. */
export interface GdtFrameRow {
  /** Tolerance value in mm. */
  tolerance: number;
  /** Apply diameter prefix even when symbol.needsDiameter is false. */
  diameter?: boolean;
  modifier?: GdtModifier['id'];
  /** Length applied when modifier carries one (projected tolerance zone). */
  modifierLength?: number;
  /** Up to three datum references (primary / secondary / tertiary). */
  datums?: [string?, string?, string?];
}

/** Feature control frame model — single or composite (2-row) callout. */
export interface FeatureControlFrame {
  symbolId: GdtSymbol['id'];
  /** First (or only) row of the frame. */
  tolerance: number;
  diameter?: boolean;
  modifier?: GdtModifier['id'];
  modifierLength?: number;
  datums?: [string?, string?, string?];
  /** When present, makes this a **composite** feature control frame —
   *  the symbol cell spans both rows; common on hole patterns to
   *  distinguish pattern-locating (top) and feature-relating (bottom)
   *  tolerances. ASME Y14.5 §10.5. */
  secondRow?: GdtFrameRow;
}

/** Wraps a numeric dimension in the basic-dimension box (rectangle around
 *  the value). Basic dimensions are required for true position theoretical
 *  exactness — they're not tolerances themselves. The Unicode box-drawing
 *  glyphs render OK on most fonts; PDF export draws the rectangle as a
 *  proper stroked path. */
export function formatBasicDimension(value: number): string {
  return `⎕${value}⎕`;
}

/** Reference dimensions appear in parentheses — they're informational only
 *  (no tolerance applies). */
export function formatReferenceDimension(value: number): string {
  return `(${value})`;
}

function formatRow(row: GdtFrameRow): string {
  const parts: string[] = [];
  parts.push(`${row.diameter ? '⌀' : ''}${row.tolerance}`);
  if (row.modifier) {
    const m = GDT_MODIFIERS.find(x => x.id === row.modifier);
    if (m) {
      // Projected tolerance writes the length immediately after Ⓟ.
      if (m.carriesLength && Number.isFinite(row.modifierLength)) {
        parts.push(`${m.symbol}${row.modifierLength}`);
      } else {
        parts.push(m.symbol);
      }
    }
  }
  for (const d of row.datums ?? []) {
    if (d) parts.push(d);
  }
  return parts.join(' ');
}

/** Render a feature control frame to its standard string form,
 *  e.g. `⊕ ⌀0.1 Ⓜ A B C` for a simple frame or
 *  `⊕ ⌀0.4 A B C | ⌀0.1 A` (two rows separated by `|`) for composite.
 *  Used by both the live preview and the PDF/SVG exporters so on-screen
 *  text exactly matches printed output. */
export function formatFeatureControlFrame(f: FeatureControlFrame): string {
  const sym = GDT_SYMBOLS.find(s => s.id === f.symbolId);
  if (!sym) return '';
  const topRow = formatRow({
    tolerance: f.tolerance,
    diameter: f.diameter ?? sym.needsDiameter,
    modifier: f.modifier,
    modifierLength: f.modifierLength,
    datums: f.datums,
  });
  if (!f.secondRow) return `${sym.symbol} ${topRow}`;
  // Composite — second row inherits the same symbol cell visually but
  // here we just join with " | " so plain-text readers can parse it.
  const bottomRow = formatRow(f.secondRow);
  return `${sym.symbol} ${topRow} | ${bottomRow}`;
}

/** Group symbols by category for the picker UI. */
export function gdtSymbolsByCategory(): Record<GdtCategory, GdtSymbol[]> {
  const out: Record<GdtCategory, GdtSymbol[]> = {
    form: [], profile: [], orientation: [], location: [], runout: [],
  };
  for (const s of GDT_SYMBOLS) out[s.category].push(s);
  return out;
}

export const GDT_CATEGORY_LABELS: Record<GdtCategory, { ko: string; en: string }> = {
  form:        { ko: '형상',   en: 'Form' },
  profile:     { ko: '윤곽',   en: 'Profile' },
  orientation: { ko: '방향',   en: 'Orientation' },
  location:    { ko: '위치',   en: 'Location' },
  runout:      { ko: '흔들림', en: 'Runout' },
};
